import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { createPrismaTransactionAnalyticsWriter, trackAnalyticsEventV1 } from "@/lib/analytics/track";
import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import { allocateCreditConsumptionV1, type AvailableCreditGrantV1 } from "@/lib/billing/credit-policy";
import { billingIdempotencyKeySchema, normalizeBillingNow } from "@/lib/billing/contracts";
import { getServerEnvironment } from "@/lib/config/env";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma, type BoostStatus } from "@/lib/generated/prisma/client";
import {
  isJobPubliclyEligible,
  isJobPubliclyEligibleInTransaction,
  type PublicEligibilityEnvironment,
} from "@/lib/jobs/public-eligibility";
import type { EmailProvider } from "@/lib/providers/email";
import { renderEmailTemplate } from "@/lib/providers/email/templates";

export const BOOST_POLICY_V1 = Object.freeze({
  creditDurationDays: 7,
  durations: Object.freeze({ "boost-7d": 7, "boost-30d": 30 }),
  pricesRappen: Object.freeze({ "boost-7d": 7_900, "boost-30d": 19_900 }),
} as const);

const DAY = 86_400_000;
const AUDIT_RETENTION_MS = 10 * 365 * DAY;
const MAX_SERIALIZABLE_ATTEMPTS = 4;
const BOOST_LOCK_NAMESPACE = 1313;

export type BoostLifecycleSnapshot = Readonly<{
  status: BoostStatus;
  startsAt: Date;
  endsAt: Date;
  cancelledAt?: Date | null;
}>;

export function computeBoostStatus(
  boost: BoostLifecycleSnapshot,
  now: Date,
): BoostStatus {
  assertValidBoostWindow(boost, now);
  if (boost.status === "CANCELLED" || boost.cancelledAt != null) return "CANCELLED";
  if (now.getTime() < boost.startsAt.getTime()) return "SCHEDULED";
  return now.getTime() < boost.endsAt.getTime() ? "ACTIVE" : "EXPIRED";
}

export function getEffectiveBoostStatus(
  boost: BoostLifecycleSnapshot,
  now: Date,
): BoostStatus {
  return computeBoostStatus(boost, now);
}

export function isBoostActiveAt(
  boost: BoostLifecycleSnapshot,
  now: Date,
): boolean {
  return getEffectiveBoostStatus(boost, now) === "ACTIVE";
}

export function jobHasActiveBoost(
  boosts: readonly BoostLifecycleSnapshot[],
  now: Date,
): boolean {
  return boosts.some((boost) => isBoostActiveAt(boost, now));
}

function assertValidBoostWindow(boost: BoostLifecycleSnapshot, now: Date) {
  if (
    !Number.isFinite(now.getTime()) ||
    !Number.isFinite(boost.startsAt.getTime()) ||
    !Number.isFinite(boost.endsAt.getTime()) ||
    boost.startsAt.getTime() >= boost.endsAt.getTime()
  ) {
    throw new TypeError("Boost status requires a valid half-open time window.");
  }
}

export type EmployerBoostActor = Readonly<{
  userId: string;
  email: string;
  companyId: string;
  membershipId: string;
  membershipRole: "OWNER" | "ADMIN" | "RECRUITER" | "VIEWER";
}>;

export type EmployerBoostDependencies = Readonly<{
  actor: EmployerBoostActor;
  correlationId: string;
  database: DatabaseClient;
  emailProvider: EmailProvider;
  now?: Date;
}>;

export type BoostCommandCode =
  | "INVALID_INPUT"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "JOB_NOT_ELIGIBLE"
  | "JOB_EXPIRES_TOO_SOON"
  | "OVERLAPPING_BOOST"
  | "INSUFFICIENT_CREDITS"
  | "CONFLICT"
  | "WRITE_FAILED";

export type BoostCommandResult<T> = Readonly<
  | { ok: true; value: Readonly<T>; replay?: true }
  | { ok: false; code: BoostCommandCode }
>;

export type BoostPurchaseView = Readonly<{
  job: Readonly<{
    id: string;
    title: string;
    slug: string;
    fairScore: number | null;
    expiresAt: Date;
  }>;
  currentBoost: Readonly<{
    id: string;
    status: BoostStatus;
    startsAt: Date;
    endsAt: Date;
  }> | null;
  creditSource: Readonly<{
    grantEntryId: string;
    fundingSource: "PLAN_ALLOWANCE" | "ADMIN_GRANT";
    validTo: Date;
  }> | null;
  products: readonly Readonly<{
    slug: "boost-7d" | "boost-30d";
    name: string;
    durationDays: 7 | 30;
    netPriceRappen: number;
  }>[];
}>;

const activateBoostSchema = z.strictObject({
  jobId: z.uuid(),
  idempotencyKey: billingIdempotencyKeySchema,
});

const cancelBoostSchema = z.strictObject({
  boostId: z.uuid(),
  reason: z.string().trim().min(5).max(500),
  idempotencyKey: billingIdempotencyKeySchema,
});

export async function getEmployerBoostPurchaseView(
  actor: EmployerBoostActor,
  jobId: string,
  database: DatabaseClient,
  now = new Date(),
): Promise<BoostPurchaseView | null> {
  if (
    !z.uuid().safeParse(jobId).success ||
    !canManageBoost(actor.membershipRole) ||
    !Number.isFinite(now.getTime())
  ) {
    return null;
  }
  const [job, products, eligible, grant] = await Promise.all([
    database.job.findFirst({
      where: {
        id: jobId,
        companyId: actor.companyId,
        company: {
          memberships: {
            some: {
              id: actor.membershipId,
              userId: actor.userId,
              role: actor.membershipRole,
              status: "ACTIVE",
              removedAt: null,
            },
          },
        },
      },
      select: {
        id: true,
        slug: true,
        expiresAt: true,
        publishedRevision: {
          select: {
            title: true,
            scoreSnapshots: {
              where: { scoreVersion: "v2" },
              take: 2,
              select: { scorePoints: true },
            },
          },
        },
        boosts: {
          where: { status: { not: "CANCELLED" } },
          orderBy: [{ startsAt: "desc" }, { id: "asc" }],
          take: 20,
          select: {
            id: true,
            status: true,
            startsAt: true,
            endsAt: true,
            cancelledAt: true,
          },
        },
      },
    }),
    loadBoostProducts(database, now),
    isJobPubliclyEligible(jobId, now, publicEligibilityEnvironment(), database),
    loadFirstAvailableBoostGrant(database, actor.companyId, now, false),
  ]);
  if (
    job === null ||
    !eligible.eligible ||
    job.expiresAt === null ||
    job.publishedRevision === null ||
    products.length !== 2
  ) {
    return null;
  }
  const effectiveBoosts = job.boosts.map((boost) => Object.freeze({
    ...boost,
    effectiveStatus: getEffectiveBoostStatus(boost, now),
  }));
  const latest = effectiveBoosts.find((boost) => boost.effectiveStatus === "ACTIVE") ??
    effectiveBoosts.find((boost) => boost.effectiveStatus === "SCHEDULED") ??
    effectiveBoosts[0];
  const scoreRows = job.publishedRevision.scoreSnapshots;
  return Object.freeze({
    job: Object.freeze({
      id: job.id,
      title: job.publishedRevision.title,
      slug: job.slug,
      fairScore: scoreRows.length === 1 ? scoreRows[0]!.scorePoints : null,
      expiresAt: job.expiresAt,
    }),
    currentBoost:
      latest === undefined
        ? null
        : Object.freeze({
            id: latest.id,
            status: latest.effectiveStatus,
            startsAt: latest.startsAt,
            endsAt: latest.endsAt,
          }),
    creditSource:
      grant === null
        ? null
        : Object.freeze({
            grantEntryId: grant.id,
            fundingSource: grant.fundingSource,
            validTo: grant.validTo,
          }),
    products: Object.freeze(products),
  });
}

export async function activateBoostWithCredit(
  raw: unknown,
  dependencies: EmployerBoostDependencies,
): Promise<BoostCommandResult<{
  boostId: string;
  jobId: string;
  jobTitle: string;
  startsAt: Date;
  endsAt: Date;
  fundingSource: "PLAN_ALLOWANCE" | "ADMIN_GRANT";
  sourceValidTo: Date;
}>> {
  const parsed = activateBoostSchema.safeParse(raw);
  if (!parsed.success) return boostFailure("INVALID_INPUT");
  if (!canManageBoost(dependencies.actor.membershipRole)) {
    return boostFailure("FORBIDDEN");
  }
  let now: Date;
  try {
    now = normalizeBillingNow(dependencies.now);
  } catch {
    return boostFailure("INVALID_INPUT");
  }
  const endsAt = new Date(now.getTime() + BOOST_POLICY_V1.creditDurationDays * DAY);

  const result = await runSerializableBoostCommand(dependencies.database, async (transaction) => {
    await acquireBoostLocks(transaction, dependencies.actor.companyId, parsed.data.jobId);
    if (!(await hasCurrentBoostMembership(transaction, dependencies.actor))) {
      return boostFailure("NOT_FOUND");
    }
    const actorUser = await transaction.user.findUnique({
      where: { id: dependencies.actor.userId },
      select: { dataProvenance: true },
    });
    if (actorUser === null) return boostFailure("NOT_FOUND");
    const existing = await transaction.jobBoost.findUnique({
      where: { idempotencyKey: parsed.data.idempotencyKey },
      select: {
        id: true,
        jobId: true,
        companyId: true,
        startsAt: true,
        endsAt: true,
        job: { select: { publishedRevision: { select: { title: true } } } },
        consumedCreditLedgerEntry: {
          select: { fundingSource: true, validTo: true },
        },
      },
    });
    if (existing !== null) {
      const source = existing.consumedCreditLedgerEntry;
      return existing.jobId === parsed.data.jobId &&
          existing.companyId === dependencies.actor.companyId &&
          existing.job.publishedRevision !== null &&
          source !== null &&
          (source.fundingSource === "PLAN_ALLOWANCE" || source.fundingSource === "ADMIN_GRANT")
        ? boostSuccess(
            {
              boostId: existing.id,
              jobId: existing.jobId,
              jobTitle: existing.job.publishedRevision.title,
              startsAt: existing.startsAt,
              endsAt: existing.endsAt,
              fundingSource: source.fundingSource,
              sourceValidTo: source.validTo,
            },
            true,
          )
        : boostFailure("CONFLICT");
    }
    const eligibility = await validateBoostJobInTransaction(
      transaction,
      dependencies.actor.companyId,
      parsed.data.jobId,
      BOOST_POLICY_V1.creditDurationDays,
      now,
    );
    if (!eligibility.ok) return eligibility;
    if (await hasOverlappingBoost(transaction, parsed.data.jobId, now, endsAt)) {
      return boostFailure("OVERLAPPING_BOOST");
    }

    const grant = await loadFirstAvailableBoostGrant(
      transaction,
      dependencies.actor.companyId,
      now,
      true,
    );
    if (grant === null) return boostFailure("INSUFFICIENT_CREDITS");
    const consumeId = randomUUID();
    await transaction.creditLedgerEntry.create({
      data: {
        id: consumeId,
        accountId: grant.accountId,
        fundingSource: grant.fundingSource,
        kind: "CONSUME",
        amount: -1,
        consumedGrantEntryId: grant.id,
        validFrom: grant.validFrom,
        validTo: grant.validTo,
        idempotencyKey: hashedOperationKey("boost-credit", parsed.data.idempotencyKey),
        reasonCode: "JOB_BOOST_ACTIVATED",
        actorUserId: dependencies.actor.userId,
        createdAt: now,
      },
    });
    await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
      action: "CREDITS_CONSUMED",
      actorKind: "USER",
      actorUserId: dependencies.actor.userId,
      capability: "EMPLOYER_JOB_BOOST_ACTIVATE",
      companyId: dependencies.actor.companyId,
      correlationId: dependencies.correlationId,
      reasonCode: "JOB_BOOST_ACTIVATED",
      result: "SUCCEEDED",
      retainUntil: new Date(now.getTime() + AUDIT_RETENTION_MS),
      targetId: consumeId,
      targetType: "CREDIT_LEDGER_ENTRY",
    });
    const boost = await transaction.jobBoost.create({
      data: {
        id: randomUUID(),
        jobId: parsed.data.jobId,
        companyId: dependencies.actor.companyId,
        consumedCreditLedgerEntryId: consumeId,
        idempotencyKey: parsed.data.idempotencyKey,
        startsAt: now,
        endsAt,
        status: "ACTIVE",
        createdAt: now,
      },
      select: { id: true },
    });
    await writeBoostActivatedEvidence(transaction, {
      actorUserId: dependencies.actor.userId,
      actorProvenance: actorUser.dataProvenance,
      boostId: boost.id,
      companyId: dependencies.actor.companyId,
      companyProvenance: eligibility.companyProvenance,
      correlationId: dependencies.correlationId,
      fundingSource: grant.fundingSource,
      jobId: parsed.data.jobId,
      jobProvenance: eligibility.jobProvenance,
      now,
      productSlug: undefined,
    });
    return boostSuccess({
      boostId: boost.id,
      jobId: parsed.data.jobId,
      jobTitle: eligibility.jobTitle,
      startsAt: now,
      endsAt,
      fundingSource: grant.fundingSource,
      sourceValidTo: grant.validTo,
    });
  });
  if (result.ok && result.replay !== true) {
    await sendBoostActivatedEmail(dependencies.emailProvider, dependencies.actor.email, {
      jobTitle: result.value.jobTitle,
      idempotencyKey: `boost:${result.value.boostId}:activated`,
    });
  }
  return result;
}

export async function cancelEmployerBoost(
  raw: unknown,
  dependencies: EmployerBoostDependencies,
): Promise<BoostCommandResult<{ boostId: string; jobId: string }>> {
  const parsed = cancelBoostSchema.safeParse(raw);
  if (!parsed.success) return boostFailure("INVALID_INPUT");
  if (!canManageBoost(dependencies.actor.membershipRole)) return boostFailure("FORBIDDEN");
  const now = normalizeBillingNow(dependencies.now);
  return cancelBoostInTransaction(parsed.data, dependencies.database, now, {
    actorUserId: dependencies.actor.userId,
    capability: "EMPLOYER_JOB_BOOST_CANCEL",
    companyId: dependencies.actor.companyId,
    correlationId: dependencies.correlationId,
    requireMembership: dependencies.actor,
  });
}

export async function cancelAdminBoost(
  raw: unknown,
  dependencies: Readonly<{
    actorUserId: string;
    correlationId: string;
    database: DatabaseClient;
    now?: Date;
  }>,
): Promise<BoostCommandResult<{ boostId: string; jobId: string }>> {
  const parsed = cancelBoostSchema.safeParse(raw);
  if (!parsed.success) return boostFailure("INVALID_INPUT");
  const now = normalizeBillingNow(dependencies.now);
  return cancelBoostInTransaction(parsed.data, dependencies.database, now, {
    actorUserId: dependencies.actorUserId,
    capability: "ADMIN_JOB_BOOST_MANAGE",
    companyId: null,
    correlationId: dependencies.correlationId,
    requireMembership: null,
  });
}

async function cancelBoostInTransaction(
  input: z.infer<typeof cancelBoostSchema>,
  database: DatabaseClient,
  now: Date,
  actor: Readonly<{
    actorUserId: string;
    capability: string;
    companyId: string | null;
    correlationId: string;
    requireMembership: EmployerBoostActor | null;
  }>,
): Promise<BoostCommandResult<{ boostId: string; jobId: string }>> {
  return runSerializableBoostCommand(database, async (transaction) => {
    const locked = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "JobBoost" WHERE "id" = ${input.boostId}::uuid FOR UPDATE
    `;
    if (locked.length !== 1) return boostFailure("NOT_FOUND");
    const boost = await transaction.jobBoost.findFirst({
      where: {
        id: input.boostId,
        ...(actor.companyId === null ? {} : { companyId: actor.companyId }),
      },
      select: {
        id: true,
        jobId: true,
        companyId: true,
        status: true,
        startsAt: true,
        endsAt: true,
        cancelledAt: true,
        cancelledByUserId: true,
        cancellationReason: true,
      },
    });
    if (boost === null) return boostFailure("NOT_FOUND");
    if (
      actor.requireMembership !== null &&
      !(await hasCurrentBoostMembership(transaction, actor.requireMembership))
    ) {
      return boostFailure("NOT_FOUND");
    }
    if (boost.status === "CANCELLED") {
      return boost.cancelledByUserId === actor.actorUserId &&
          boost.cancellationReason === input.reason
        ? boostSuccess({ boostId: boost.id, jobId: boost.jobId }, true)
        : boostFailure("CONFLICT");
    }
    if (!isBoostActiveAt(boost, now)) return boostFailure("CONFLICT");
    const updated = await transaction.jobBoost.updateMany({
      where: { id: boost.id, status: { not: "CANCELLED" }, cancelledAt: null },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        cancelledByUserId: actor.actorUserId,
        cancellationReason: input.reason,
      },
    });
    if (updated.count !== 1) return boostFailure("CONFLICT");
    await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
      action: "JOB_BOOST_CANCELLED",
      actorKind: "USER",
      actorUserId: actor.actorUserId,
      capability: actor.capability,
      companyId: boost.companyId,
      correlationId: actor.correlationId,
      reasonCode: "BOOST_CANCELLED_NO_REFUND",
      result: "SUCCEEDED",
      retainUntil: new Date(now.getTime() + AUDIT_RETENTION_MS),
      targetId: boost.id,
      targetType: "JOB_BOOST",
    });
    return boostSuccess({ boostId: boost.id, jobId: boost.jobId });
  });
}

export type BoostProjectionResult = Readonly<{
  activated: number;
  expired: number;
}>;

export async function syncBoostStatusProjection(input: Readonly<{
  database: DatabaseClient;
  correlationId: string;
  now?: Date;
}>): Promise<BoostProjectionResult> {
  const now = normalizeBillingNow(input.now);
  return input.database.$transaction(async (transaction) => {
    const due = await transaction.jobBoost.findMany({
      where: {
        status: { in: ["SCHEDULED", "ACTIVE"] },
        OR: [
          { status: "SCHEDULED", startsAt: { lte: now }, endsAt: { gt: now } },
          { endsAt: { lte: now } },
        ],
      },
      orderBy: [{ endsAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        companyId: true,
        status: true,
        startsAt: true,
        endsAt: true,
      },
    });
    let activated = 0;
    let expired = 0;
    for (const boost of due) {
      const target = getEffectiveBoostStatus(boost, now);
      if (target !== "ACTIVE" && target !== "EXPIRED") continue;
      const changed = await transaction.jobBoost.updateMany({
        where: { id: boost.id, status: boost.status },
        data: { status: target },
      });
      if (changed.count !== 1) continue;
      if (target === "ACTIVE") activated += 1;
      else expired += 1;
      await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
        action: target === "ACTIVE" ? "JOB_BOOST_ACTIVATED" : "JOB_BOOST_EXPIRED",
        actorKind: "SYSTEM",
        capability: "JOB_BOOST_STATUS_PROJECT",
        companyId: boost.companyId,
        correlationId: input.correlationId,
        reasonCode: target === "ACTIVE" ? "BOOST_WINDOW_STARTED" : "BOOST_WINDOW_ENDED",
        result: "SUCCEEDED",
        retainUntil: new Date(now.getTime() + AUDIT_RETENTION_MS),
        targetId: boost.id,
        targetType: "JOB_BOOST",
      });
    }
    return Object.freeze({ activated, expired });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function validateBoostJobInTransaction(
  transaction: Prisma.TransactionClient,
  companyId: string,
  jobId: string,
  durationDays: number,
  now: Date,
): Promise<
  | Readonly<{
      ok: true;
      companyProvenance: "LIVE" | "DEMO" | "TEST";
      jobProvenance: "LIVE" | "DEMO" | "TEST";
      jobTitle: string;
    }>
  | Extract<BoostCommandResult<never>, { ok: false }>
> {
  if (!Number.isInteger(durationDays) || (durationDays !== 7 && durationDays !== 30)) {
    return boostFailure("JOB_NOT_ELIGIBLE");
  }
  const job = await transaction.job.findFirst({
    where: { id: jobId, companyId },
    select: {
      expiresAt: true,
      dataProvenance: true,
      company: { select: { dataProvenance: true } },
      publishedRevision: { select: { title: true } },
    },
  });
  if (job === null || job.publishedRevision === null) return boostFailure("JOB_NOT_ELIGIBLE");
  const eligibility = await isJobPubliclyEligibleInTransaction(
    jobId,
    now,
    publicEligibilityEnvironment(),
    transaction,
  );
  if (!eligibility.eligible) return boostFailure("JOB_NOT_ELIGIBLE");
  const endsAt = new Date(now.getTime() + durationDays * DAY);
  if (job.expiresAt === null || job.expiresAt.getTime() < endsAt.getTime()) {
    return boostFailure("JOB_EXPIRES_TOO_SOON");
  }
  return Object.freeze({
    ok: true as const,
    companyProvenance: job.company.dataProvenance,
    jobProvenance: job.dataProvenance,
    jobTitle: job.publishedRevision.title,
  });
}

export async function hasOverlappingBoost(
  transaction: Prisma.TransactionClient,
  jobId: string,
  startsAt: Date,
  endsAt: Date,
): Promise<boolean> {
  return (
    (await transaction.jobBoost.findFirst({
      where: {
        jobId,
        status: { not: "CANCELLED" },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
      select: { id: true },
    })) !== null
  );
}

export async function writeBoostActivatedEvidence(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    actorUserId: string;
    actorProvenance: "LIVE" | "DEMO" | "TEST";
    boostId: string;
    companyId: string;
    companyProvenance: "LIVE" | "DEMO" | "TEST";
    correlationId: string;
    fundingSource: "PLAN_ALLOWANCE" | "ADMIN_GRANT" | "PURCHASED_PACK";
    jobId: string;
    jobProvenance: "LIVE" | "DEMO" | "TEST";
    now: Date;
    productSlug?: "boost-7d" | "boost-30d";
  }>,
) {
  await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
    action: "JOB_BOOST_ACTIVATED",
    actorKind: "USER",
    actorUserId: input.actorUserId,
    capability: "EMPLOYER_JOB_BOOST_ACTIVATE",
    companyId: input.companyId,
    correlationId: input.correlationId,
    reasonCode: "JOB_BOOST_ACTIVATED",
    result: "SUCCEEDED",
    retainUntil: new Date(input.now.getTime() + AUDIT_RETENTION_MS),
    targetId: input.boostId,
    targetType: "JOB_BOOST",
  });
  await trackAnalyticsEventV1(
    {
      schemaVersion: "1",
      producerEventId: `boost-activated:${input.boostId}`,
      occurredAt: input.now,
      kind: "BOOST_ACTIVATED",
      companyId: input.companyId,
      jobId: input.jobId,
      properties: {
        fundingSource: input.fundingSource,
        ...(input.productSlug === undefined ? {} : { productSlug: input.productSlug }),
      },
    },
    {
      producer: "job-boosts",
      productAnalyticsEnabled: false,
      provenance: {
        actor: input.actorProvenance,
        company: input.companyProvenance,
        job: input.jobProvenance,
      },
    },
    createPrismaTransactionAnalyticsWriter(transaction),
  );
}

export async function sendBoostActivatedEmail(
  provider: EmailProvider,
  to: string,
  data: Readonly<{ jobTitle: string; idempotencyKey: string }>,
): Promise<boolean> {
  try {
    const rendered = renderEmailTemplate("job_boost_activated", data);
    await provider.send({
      to,
      templateKey: "job_boost_activated",
      data: { ...data },
      subject: rendered.subject,
    });
    return true;
  } catch {
    return false;
  }
}

async function loadBoostProducts(
  database: Prisma.TransactionClient | DatabaseClient,
  now: Date,
) {
  const rows = await database.productVersion.findMany({
    where: {
      status: "ACTIVE",
      isPublic: true,
      isSelfService: true,
      requiresLegalReview: false,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
      product: { type: "JOB_BOOST", code: { in: ["boost-7d", "boost-30d"] } },
    },
    orderBy: [{ durationDays: "asc" }, { id: "asc" }],
    select: {
      netPriceRappen: true,
      durationDays: true,
      creditType: true,
      creditAmount: true,
      product: { select: { code: true, name: true } },
    },
  });
  return rows.flatMap((row) => {
    const slug = row.product.code;
    if (
      (slug !== "boost-7d" && slug !== "boost-30d") ||
      row.durationDays !== BOOST_POLICY_V1.durations[slug] ||
      row.netPriceRappen !== BOOST_POLICY_V1.pricesRappen[slug] ||
      row.creditType !== null ||
      row.creditAmount !== null
    ) {
      return [];
    }
    return [Object.freeze({
      slug,
      name: row.product.name,
      durationDays: row.durationDays as 7 | 30,
      netPriceRappen: row.netPriceRappen,
    })];
  });
}

type AvailableBoostGrant = AvailableCreditGrantV1 & Readonly<{
  fundingSource: "PLAN_ALLOWANCE" | "ADMIN_GRANT";
}>;

async function loadFirstAvailableBoostGrant(
  database: Prisma.TransactionClient | DatabaseClient,
  companyId: string,
  now: Date,
  lock: boolean,
): Promise<AvailableBoostGrant | null> {
  if (lock) {
    await (database as Prisma.TransactionClient).$queryRaw`
      SELECT grant_entry."id"
      FROM "CreditLedgerEntry" grant_entry
      JOIN "CreditAccount" account ON account."id" = grant_entry."accountId"
      WHERE account."companyId" = ${companyId}::uuid
        AND account."creditType" = 'JOB_BOOST'::"CreditType"
        AND account."fundingSource" IN ('PLAN_ALLOWANCE', 'ADMIN_GRANT')
        AND account."fundingSource" = grant_entry."fundingSource"
        AND account."periodStart" <= ${now}
        AND account."periodEnd" > ${now}
        AND grant_entry."kind" = 'GRANT'
        AND grant_entry."validFrom" <= ${now}
        AND grant_entry."validTo" > ${now}
      ORDER BY CASE grant_entry."fundingSource" WHEN 'PLAN_ALLOWANCE' THEN 0 ELSE 1 END,
        grant_entry."validTo", grant_entry."createdAt", grant_entry."id"
      FOR UPDATE OF account, grant_entry
    `;
  }
  const rows = await database.creditLedgerEntry.findMany({
    where: {
      kind: "GRANT",
      fundingSource: { in: ["PLAN_ALLOWANCE", "ADMIN_GRANT"] },
      validFrom: { lte: now },
      validTo: { gt: now },
      account: {
        companyId,
        creditType: "JOB_BOOST",
        fundingSource: { in: ["PLAN_ALLOWANCE", "ADMIN_GRANT"] },
        periodStart: { lte: now },
        periodEnd: { gt: now },
      },
    },
    orderBy: [{ validTo: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      accountId: true,
      amount: true,
      fundingSource: true,
      validFrom: true,
      validTo: true,
      createdAt: true,
      account: { select: { creditType: true } },
      grantConsumptions: {
        where: { kind: { in: ["CONSUME", "EXPIRE"] } },
        select: { amount: true, reversedByEntry: { select: { amount: true } } },
      },
    },
  });
  const grants: AvailableBoostGrant[] = rows.flatMap((row) => {
    if (row.fundingSource !== "PLAN_ALLOWANCE" && row.fundingSource !== "ADMIN_GRANT") {
      return [];
    }
    const remaining = row.amount + row.grantConsumptions.reduce(
      (sum, entry) => sum + entry.amount + (entry.reversedByEntry?.amount ?? 0),
      0,
    );
    return [{
      id: row.id,
      accountId: row.accountId,
      fundingSource: row.fundingSource,
      creditType: row.account.creditType,
      remaining,
      validFrom: row.validFrom,
      validTo: row.validTo,
      createdAt: row.createdAt,
    }];
  });
  const allocation = allocateCreditConsumptionV1({
    grants,
    creditType: "JOB_BOOST",
    amount: 1,
    at: now,
  });
  if (!allocation.ok) return null;
  const selectedId = allocation.value.allocations[0]?.sourceGrantEntryId;
  return grants.find((grant) => grant.id === selectedId) ?? null;
}

async function acquireBoostLocks(
  transaction: Prisma.TransactionClient,
  companyId: string,
  jobId: string,
) {
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(
      ${BOOST_LOCK_NAMESPACE}::integer,
      hashtext(${jobId})::integer
    ) IS NULL AS "locked"
  `;
  await transaction.$queryRaw`
    SELECT "id" FROM "Company" WHERE "id" = ${companyId}::uuid FOR UPDATE
  `;
  await transaction.$queryRaw`
    SELECT "id" FROM "Job" WHERE "id" = ${jobId}::uuid FOR UPDATE
  `;
}

async function hasCurrentBoostMembership(
  transaction: Prisma.TransactionClient,
  actor: EmployerBoostActor,
) {
  return (
    (await transaction.companyMembership.findFirst({
      where: {
        id: actor.membershipId,
        userId: actor.userId,
        companyId: actor.companyId,
        role: actor.membershipRole,
        status: "ACTIVE",
        removedAt: null,
        company: { status: "ACTIVE" },
      },
      select: { id: true },
    })) !== null
  );
}

function publicEligibilityEnvironment(): PublicEligibilityEnvironment {
  const appEnvironment = getServerEnvironment().APP_ENV;
  return appEnvironment === "production" || appEnvironment === "staging"
    ? "production"
    : "non-production";
}

function canManageBoost(role: EmployerBoostActor["membershipRole"]) {
  return role === "OWNER" || role === "ADMIN";
}

function hashedOperationKey(namespace: string, value: string) {
  return `${namespace}:${createHash("sha256").update(value).digest("hex")}`;
}

async function runSerializableBoostCommand<T>(
  database: DatabaseClient,
  command: (transaction: Prisma.TransactionClient) => Promise<BoostCommandResult<T>>,
): Promise<BoostCommandResult<T>> {
  for (let attempt = 0; attempt < MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await database.$transaction(command, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === MAX_SERIALIZABLE_ATTEMPTS - 1) {
        return boostFailure("WRITE_FAILED");
      }
    }
  }
  return boostFailure("WRITE_FAILED");
}

function isRetryableTransactionError(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String(error.code) : "";
  if (code === "P2034" || code === "40001" || code === "40P01") return true;
  const message = "message" in error ? String(error.message) : "";
  return /could not serialize access|deadlock detected|write conflict/iu.test(message);
}

function boostSuccess<T>(value: T, replay = false): BoostCommandResult<T> {
  return Object.freeze({
    ok: true as const,
    value: Object.freeze(value),
    ...(replay ? { replay: true as const } : {}),
  });
}

function boostFailure(code: BoostCommandCode): Extract<BoostCommandResult<never>, { ok: false }> {
  return Object.freeze({ ok: false as const, code });
}
