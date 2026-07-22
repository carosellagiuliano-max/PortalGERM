import type {
  CreditFundingSource,
  CreditType,
  EffectiveEntitlements,
  EntitlementResolutionResult,
  FundableBySource,
} from "@/lib/billing/entitlements";
import {
  CREDIT_FUNDING_SOURCES,
  CREDIT_TYPES,
} from "@/lib/billing/entitlements";
import {
  canPublishJob,
  type AdditionalJobPermitSummary,
  type FeatureGateReason,
} from "@/lib/billing/feature-gates";

export const COMPANY_QUOTA_ADVISORY_LOCK_NAMESPACE = 1_398_032_385;

export type QuotaJob = Readonly<{
  id: string;
  status: string;
  publishedAt: Date | null;
  expiresAt: Date | null;
}>;

export type CreditLedgerUsageEntry = Readonly<{
  creditType: CreditType;
  fundingSource: CreditFundingSource;
  kind: "GRANT" | "CONSUME" | "EXPIRE" | "REVERSAL";
  amount: number;
  validFrom: Date;
  validTo: Date;
  createdAt: Date;
}>;

export type PublishQuotaCommitInput = Readonly<{
  companyId: string;
  jobId: string;
  revisionId: string;
  now: Date;
  effectiveEntitlements: EffectiveEntitlements;
}>;

export type PublishQuotaTransaction<TPublication> = Readonly<{
  /** Must execute pg_advisory_xact_lock(namespace, stableCompanyKey). */
  acquireCompanyQuotaAdvisoryLock(
    namespace: number,
    companyId: string,
  ): Promise<void>;
  /** Must count the canonical predicate at the supplied instant. */
  countQuotaConsumingJobs(companyId: string, now: Date): Promise<number>;
  resolveEffectiveEntitlements(
    companyId: string,
    now: Date,
  ): Promise<EntitlementResolutionResult>;
  findCurrentAdditionalJobPermit(
    companyId: string,
    jobId: string,
    now: Date,
  ): Promise<AdditionalJobPermitSummary | null>;
  /** Consumes the exact paid permit under the same Company quota lock. */
  consumeCurrentAdditionalJobPermit(
    permitId: string,
    companyId: string,
    jobId: string,
    now: Date,
  ): Promise<boolean>;
  /** Must write Job status/projections, event, and required Audit atomically. */
  commitPublication(input: PublishQuotaCommitInput): Promise<TPublication>;
}>;

export type PublishQuotaPort<TPublication> = Readonly<{
  transaction<TResult>(
    callback: (
      transaction: PublishQuotaTransaction<TPublication>,
    ) => Promise<TResult>,
  ): Promise<TResult>;
}>;

export type PublishWithQuotaResult<TPublication> =
  | Readonly<{ ok: true; value: TPublication }>
  | Readonly<{
      ok: false;
      reason: FeatureGateReason | "ENTITLEMENT_RESOLUTION_FAILED";
      suggestedProductSlug?: string;
      suggestedPlanSlug?: string;
    }>;

export function isQuotaConsumingJob(job: QuotaJob, now: Date): boolean {
  return (
    job.status === "PUBLISHED" &&
    isValidDate(now) &&
    isValidDate(job.publishedAt) &&
    isValidDate(job.expiresAt) &&
    job.publishedAt.getTime() <= now.getTime() &&
    now.getTime() < job.expiresAt.getTime()
  );
}

export function countActiveJobs(
  jobs: readonly QuotaJob[],
  now: Date,
): number {
  return jobs.reduce(
    (count, job) => count + Number(isQuotaConsumingJob(job, now)),
    0,
  );
}

export function computeCreditsRemaining(
  entries: readonly CreditLedgerUsageEntry[],
  at: Date,
): FundableBySource {
  if (!isValidDate(at)) {
    throw new TypeError("A valid injected instant is required.");
  }

  const balances = emptyFundableBySource();
  for (const entry of entries) {
    if (
      !Number.isSafeInteger(entry.amount) ||
      !hasValidLedgerSign(entry.kind, entry.amount) ||
      !isValidDate(entry.validFrom) ||
      !isValidDate(entry.validTo) ||
      entry.validFrom.getTime() >= entry.validTo.getTime()
    ) {
      throw new TypeError("Malformed credit ledger entry.");
    }
    if (
      entry.validFrom.getTime() <= at.getTime() &&
      at.getTime() < entry.validTo.getTime()
    ) {
      const current = balances[entry.fundingSource][entry.creditType];
      const next = current + entry.amount;
      if (!Number.isSafeInteger(next)) {
        throw new RangeError("Credit balance exceeds the safe integer range.");
      }
      balances[entry.fundingSource][entry.creditType] = next;
    }
  }

  for (const source of CREDIT_FUNDING_SOURCES) {
    for (const creditType of CREDIT_TYPES) {
      if (balances[source][creditType] < 0) {
        throw new RangeError("Credit ledger balance cannot be negative.");
      }
    }
  }
  return balances;
}

export function summarizeIncludedCreditUsage(
  entries: readonly Readonly<{
    kind: "GRANT" | "CONSUME" | "EXPIRE" | "REVERSAL";
    amount: number;
  }>[],
) {
  const granted = entries.reduce(
    (total, entry) => total + (entry.kind === "GRANT" ? entry.amount : 0),
    0,
  );
  const remaining = entries.reduce((total, entry) => total + entry.amount, 0);
  const normalizedGranted = Math.max(0, granted);
  const normalizedRemaining = Math.max(0, remaining);
  return Object.freeze({
    granted: normalizedGranted,
    used: Math.max(0, normalizedGranted - normalizedRemaining),
    remaining: normalizedRemaining,
  });
}

export function countUsedContacts(
  entries: readonly CreditLedgerUsageEntry[],
  period: Readonly<{ start: Date; end: Date }>,
): number {
  if (
    !isValidDate(period.start) ||
    !isValidDate(period.end) ||
    period.start.getTime() >= period.end.getTime()
  ) {
    throw new TypeError("A valid half-open usage period is required.");
  }

  let used = 0;
  for (const entry of entries) {
    if (
      entry.creditType === "TALENT_CONTACT" &&
      entry.kind === "CONSUME" &&
      !isValidDate(entry.createdAt)
    ) {
      throw new TypeError("A contact consumption must have a valid timestamp.");
    }
    if (
      entry.creditType === "TALENT_CONTACT" &&
      entry.kind === "CONSUME" &&
      isValidDate(entry.createdAt) &&
      entry.createdAt.getTime() >= period.start.getTime() &&
      entry.createdAt.getTime() < period.end.getTime()
    ) {
      if (!Number.isSafeInteger(entry.amount) || entry.amount >= 0) {
        throw new TypeError("A contact consumption must have a negative amount.");
      }
      used += -entry.amount;
      if (!Number.isSafeInteger(used)) {
        throw new RangeError("Contact usage exceeds the safe integer range.");
      }
    }
  }
  return used;
}

export async function publishWithQuota<TPublication>(
  input: Readonly<{
    companyId: string;
    jobId: string;
    revisionId: string;
    revisionValidThrough: Date | null;
    now: Date;
  }>,
  port: PublishQuotaPort<TPublication>,
): Promise<PublishWithQuotaResult<TPublication>> {
  if (
    input.companyId.trim().length === 0 ||
    input.jobId.trim().length === 0 ||
    input.revisionId.trim().length === 0 ||
    !isValidDate(input.now)
  ) {
    return { ok: false, reason: "INVALID_INPUT" };
  }

  return port.transaction(async (transaction) => {
    await transaction.acquireCompanyQuotaAdvisoryLock(
      COMPANY_QUOTA_ADVISORY_LOCK_NAMESPACE,
      input.companyId,
    );

    const currentActiveCount = await transaction.countQuotaConsumingJobs(
      input.companyId,
      input.now,
    );
    const resolution = await transaction.resolveEffectiveEntitlements(
      input.companyId,
      input.now,
    );
    if (
      !resolution.ok ||
      resolution.value.companyId !== input.companyId ||
      resolution.value.resolvedAt.getTime() !== input.now.getTime()
    ) {
      return { ok: false, reason: "ENTITLEMENT_RESOLUTION_FAILED" } as const;
    }

    const needsPermit =
      currentActiveCount >= resolution.value.rights.ACTIVE_JOB_LIMIT;
    const additionalJobPermit = needsPermit
      ? await transaction.findCurrentAdditionalJobPermit(
          input.companyId,
          input.jobId,
          input.now,
        )
      : null;
    const gate = canPublishJob({
      effectiveEntitlements: resolution.value,
      currentActiveCount,
      jobId: input.jobId,
      revisionValidThrough: input.revisionValidThrough,
      additionalJobPermit,
    });
    if (!gate.allowed) {
      return {
        ok: false,
        reason: gate.reason ?? "INVALID_INPUT",
        ...(gate.suggestedProductSlug === undefined
          ? {}
          : { suggestedProductSlug: gate.suggestedProductSlug }),
        ...(gate.suggestedPlanSlug === undefined
          ? {}
          : { suggestedPlanSlug: gate.suggestedPlanSlug }),
      } as const;
    }

    if (needsPermit && additionalJobPermit !== null) {
      const consumed = await transaction.consumeCurrentAdditionalJobPermit(
        additionalJobPermit.id,
        input.companyId,
        input.jobId,
        input.now,
      );
      if (!consumed) {
        return {
          ok: false,
          reason: "ADDITIONAL_JOB_PERMIT_INVALID",
          ...(gate.suggestedPlanSlug === undefined
            ? {}
            : { suggestedPlanSlug: gate.suggestedPlanSlug }),
        } as const;
      }
    }

    const publication = await transaction.commitPublication({
      companyId: input.companyId,
      jobId: input.jobId,
      revisionId: input.revisionId,
      now: input.now,
      effectiveEntitlements: resolution.value,
    });
    return { ok: true, value: publication } as const;
  });
}

function emptyFundableBySource(): Record<
  CreditFundingSource,
  Record<CreditType, number>
> {
  return {
    PLAN_ALLOWANCE: emptyCreditRecord(),
    PURCHASED_PACK: emptyCreditRecord(),
    ADMIN_GRANT: emptyCreditRecord(),
  };
}

function emptyCreditRecord(): Record<CreditType, number> {
  return {
    JOB_BOOST: 0,
    TALENT_CONTACT: 0,
    NEWSLETTER: 0,
    SOCIAL_PUSH: 0,
  };
}

function isValidDate(value: Date | null): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function hasValidLedgerSign(
  kind: CreditLedgerUsageEntry["kind"],
  amount: number,
): boolean {
  return kind === "GRANT" || kind === "REVERSAL" ? amount > 0 : amount < 0;
}
