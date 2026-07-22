import {
  CREDIT_FUNDING_SOURCES,
  CREDIT_TYPES,
  type CreditFundingSource,
  type CreditType,
} from "@/lib/billing/entitlements";

export const CREDIT_FUNDING_ORDER_V1 = Object.freeze([
  "PLAN_ALLOWANCE",
  "PURCHASED_PACK",
  "ADMIN_GRANT",
] as const satisfies readonly CreditFundingSource[]);

export type CreditPolicyErrorCode =
  | "ALREADY_REVERSED"
  | "DUPLICATE_GRANT"
  | "FOREIGN_CREDIT_TYPE"
  | "GRANT_NOT_EFFECTIVE"
  | "INSUFFICIENT_CREDITS"
  | "INVALID_CREDIT_TYPE"
  | "INVALID_FUNDING_SOURCE"
  | "INVALID_GRANT"
  | "INVALID_GRANT_AMOUNT"
  | "INVALID_GRANT_RANGE"
  | "INVALID_INSTANT"
  | "INVALID_REQUESTED_AMOUNT"
  | "INVALID_REVERSAL_ENTRY"
  | "REVERSAL_NOT_CONSUME"
  | "REVERSAL_SCOPE_MISMATCH"
  | "REVERSAL_SOURCE_NOT_EFFECTIVE";

export type CreditPolicyResult<TValue> =
  | Readonly<{ ok: true; value: TValue }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        code: CreditPolicyErrorCode;
        field?: string;
        grantId?: string;
      }>;
    }>;

export type AvailableCreditGrantV1 = Readonly<{
  id: string;
  accountId: string;
  fundingSource: CreditFundingSource;
  creditType: CreditType;
  remaining: number;
  validFrom: Date;
  validTo: Date;
  createdAt: Date;
}>;

export type CreditConsumeAllocationV1 = Readonly<{
  sourceGrantEntryId: string;
  accountId: string;
  fundingSource: CreditFundingSource;
  creditType: CreditType;
  consumeAmount: number;
  ledgerAmount: number;
  remainingBefore: number;
  remainingAfter: number;
  validFrom: Date;
  validTo: Date;
}>;

export type CreditConsumePlanV1 = Readonly<{
  requestedAmount: number;
  allocatedAmount: number;
  allocations: readonly CreditConsumeAllocationV1[];
}>;

export type CreditExpiryAllocationV1 = Readonly<{
  sourceGrantEntryId: string;
  accountId: string;
  fundingSource: CreditFundingSource;
  creditType: CreditType;
  expireAmount: number;
  ledgerAmount: number;
  boundary: Date;
}>;

export type CreditExpiryPlanV1 = Readonly<{
  totalExpired: number;
  allocations: readonly CreditExpiryAllocationV1[];
}>;

export type ReversibleCreditLedgerEntryV1 = Readonly<{
  id: string;
  accountId: string;
  fundingSource: CreditFundingSource;
  creditType: CreditType;
  kind: "GRANT" | "CONSUME" | "EXPIRE" | "REVERSAL";
  amount: number;
  validFrom: Date;
  validTo: Date;
  reversedByEntryId: string | null;
}>;

export type ExactCreditReversalV1 = Readonly<{
  reversalOfEntryId: string;
  accountId: string;
  fundingSource: CreditFundingSource;
  creditType: CreditType;
  kind: "REVERSAL";
  amount: number;
  validFrom: Date;
  validTo: Date;
}>;

const FUNDING_RANK = new Map<CreditFundingSource, number>(
  CREDIT_FUNDING_ORDER_V1.map((source, index) => [source, index]),
);
const CREDIT_TYPE_SET = new Set<string>(CREDIT_TYPES);

/**
 * Produces an all-or-nothing consume plan. The persistence adapter must lock
 * and re-read every selected source Grant in this order before appending the
 * negative ledger rows in one transaction.
 */
export function allocateCreditConsumptionV1(input: Readonly<{
  grants: readonly AvailableCreditGrantV1[];
  creditType: CreditType;
  amount: number;
  at: Date;
}>): CreditPolicyResult<CreditConsumePlanV1> {
  if (!isCreditType(input.creditType)) {
    return failure("INVALID_CREDIT_TYPE", { field: "creditType" });
  }
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    return failure("INVALID_REQUESTED_AMOUNT", { field: "amount" });
  }
  if (!isValidDate(input.at)) {
    return failure("INVALID_INSTANT", { field: "at" });
  }
  const validated = validateGrants(input.grants, input.creditType);
  if (!validated.ok) return validated;
  const ineffective = validated.value.find(
    (grant) => !containsInstant(grant.validFrom, grant.validTo, input.at),
  );
  if (ineffective !== undefined) {
    return failure("GRANT_NOT_EFFECTIVE", { grantId: ineffective.id });
  }

  let unallocated = input.amount;
  const allocations: CreditConsumeAllocationV1[] = [];
  for (const grant of validated.value.slice().sort(compareGrants)) {
    if (unallocated === 0) break;
    if (grant.remaining === 0) continue;
    const consumeAmount = Math.min(grant.remaining, unallocated);
    allocations.push(
      Object.freeze({
        sourceGrantEntryId: grant.id,
        accountId: grant.accountId,
        fundingSource: grant.fundingSource,
        creditType: grant.creditType,
        consumeAmount,
        ledgerAmount: -consumeAmount,
        remainingBefore: grant.remaining,
        remainingAfter: grant.remaining - consumeAmount,
        validFrom: new Date(grant.validFrom.getTime()),
        validTo: new Date(grant.validTo.getTime()),
      }),
    );
    unallocated -= consumeAmount;
  }
  if (unallocated !== 0) {
    return failure("INSUFFICIENT_CREDITS", { field: "amount" });
  }
  return success(
    Object.freeze({
      requestedAmount: input.amount,
      allocatedAmount: input.amount,
      allocations: Object.freeze(allocations),
    }),
  );
}

/**
 * Builds negative EXPIRE rows for every remaining Grant at or after its
 * exclusive validTo boundary. Before validTo no allocation is emitted.
 */
export function allocateCreditExpiriesV1(input: Readonly<{
  grants: readonly AvailableCreditGrantV1[];
  creditType: CreditType;
  at: Date;
}>): CreditPolicyResult<CreditExpiryPlanV1> {
  if (!isCreditType(input.creditType)) {
    return failure("INVALID_CREDIT_TYPE", { field: "creditType" });
  }
  if (!isValidDate(input.at)) {
    return failure("INVALID_INSTANT", { field: "at" });
  }
  const validated = validateGrants(input.grants, input.creditType);
  if (!validated.ok) return validated;

  let totalExpired = 0;
  const allocations: CreditExpiryAllocationV1[] = [];
  for (const grant of validated.value.slice().sort(compareGrants)) {
    if (grant.remaining === 0 || input.at.getTime() < grant.validTo.getTime()) {
      continue;
    }
    if (totalExpired > Number.MAX_SAFE_INTEGER - grant.remaining) {
      return failure("INVALID_GRANT_AMOUNT", { grantId: grant.id });
    }
    totalExpired += grant.remaining;
    allocations.push(
      Object.freeze({
        sourceGrantEntryId: grant.id,
        accountId: grant.accountId,
        fundingSource: grant.fundingSource,
        creditType: grant.creditType,
        expireAmount: grant.remaining,
        ledgerAmount: -grant.remaining,
        boundary: new Date(grant.validTo.getTime()),
      }),
    );
  }
  return success(
    Object.freeze({
      totalExpired,
      allocations: Object.freeze(allocations),
    }),
  );
}

/**
 * Derives, rather than accepts, the exact positive inverse of one CONSUME.
 * Scope is repeated by the caller so a foreign account/source cannot be
 * reversed accidentally. Expired sources cannot be revived.
 */
export function buildExactCreditConsumeReversalV1(input: Readonly<{
  entry: ReversibleCreditLedgerEntryV1;
  expectedAccountId: string;
  expectedFundingSource: CreditFundingSource;
  expectedCreditType: CreditType;
  at: Date;
}>): CreditPolicyResult<ExactCreditReversalV1> {
  const { entry } = input;
  if (!isValidDate(input.at)) {
    return failure("INVALID_INSTANT", { field: "at" });
  }
  if (
    !isNonEmpty(input.expectedAccountId) ||
    !isFundingSource(input.expectedFundingSource) ||
    !isCreditType(input.expectedCreditType)
  ) {
    return failure("REVERSAL_SCOPE_MISMATCH", { field: "expectedScope" });
  }
  if (
    !isNonEmpty(entry.id) ||
    !isNonEmpty(entry.accountId) ||
    !isFundingSource(entry.fundingSource) ||
    !isCreditType(entry.creditType) ||
    !isValidDate(entry.validFrom) ||
    !isValidDate(entry.validTo) ||
    entry.validFrom.getTime() >= entry.validTo.getTime() ||
    !Number.isSafeInteger(entry.amount) ||
    (entry.reversedByEntryId !== null && !isNonEmpty(entry.reversedByEntryId))
  ) {
    return failure("INVALID_REVERSAL_ENTRY", { field: "entry" });
  }
  if (entry.kind !== "CONSUME") {
    return failure("REVERSAL_NOT_CONSUME", { field: "entry.kind" });
  }
  if (entry.amount >= 0) {
    return failure("INVALID_REVERSAL_ENTRY", { field: "entry.amount" });
  }
  if (
    entry.accountId !== input.expectedAccountId ||
    entry.fundingSource !== input.expectedFundingSource ||
    entry.creditType !== input.expectedCreditType
  ) {
    return failure("REVERSAL_SCOPE_MISMATCH", { field: "expectedScope" });
  }
  if (entry.reversedByEntryId !== null) {
    return failure("ALREADY_REVERSED", { field: "entry.reversedByEntryId" });
  }
  if (!containsInstant(entry.validFrom, entry.validTo, input.at)) {
    return failure("REVERSAL_SOURCE_NOT_EFFECTIVE", { field: "at" });
  }
  return success(
    Object.freeze({
      reversalOfEntryId: entry.id,
      accountId: entry.accountId,
      fundingSource: entry.fundingSource,
      creditType: entry.creditType,
      kind: "REVERSAL",
      amount: -entry.amount,
      validFrom: new Date(entry.validFrom.getTime()),
      validTo: new Date(entry.validTo.getTime()),
    }),
  );
}

function validateGrants(
  grants: readonly AvailableCreditGrantV1[],
  expectedCreditType: CreditType,
): CreditPolicyResult<readonly AvailableCreditGrantV1[]> {
  const seenIds = new Set<string>();
  for (const grant of grants) {
    if (!isNonEmpty(grant.id) || !isNonEmpty(grant.accountId)) {
      return failure("INVALID_GRANT", { field: "grants", grantId: grant.id });
    }
    if (seenIds.has(grant.id)) {
      return failure("DUPLICATE_GRANT", { grantId: grant.id });
    }
    seenIds.add(grant.id);
    if (!isFundingSource(grant.fundingSource)) {
      return failure("INVALID_FUNDING_SOURCE", { grantId: grant.id });
    }
    if (!isCreditType(grant.creditType) || grant.creditType !== expectedCreditType) {
      return failure("FOREIGN_CREDIT_TYPE", { grantId: grant.id });
    }
    if (
      !Number.isSafeInteger(grant.remaining) ||
      grant.remaining < 0
    ) {
      return failure("INVALID_GRANT_AMOUNT", { grantId: grant.id });
    }
    if (
      !isValidDate(grant.validFrom) ||
      !isValidDate(grant.validTo) ||
      !isValidDate(grant.createdAt) ||
      grant.validFrom.getTime() >= grant.validTo.getTime()
    ) {
      return failure("INVALID_GRANT_RANGE", { grantId: grant.id });
    }
  }
  return success(grants);
}

function compareGrants(
  left: AvailableCreditGrantV1,
  right: AvailableCreditGrantV1,
): number {
  return (
    (FUNDING_RANK.get(left.fundingSource) ?? Number.MAX_SAFE_INTEGER) -
      (FUNDING_RANK.get(right.fundingSource) ?? Number.MAX_SAFE_INTEGER) ||
    left.validTo.getTime() - right.validTo.getTime() ||
    left.createdAt.getTime() - right.createdAt.getTime() ||
    left.id.localeCompare(right.id)
  );
}

function containsInstant(validFrom: Date, validTo: Date, at: Date): boolean {
  return validFrom.getTime() <= at.getTime() && at.getTime() < validTo.getTime();
}

function isFundingSource(value: unknown): value is CreditFundingSource {
  return (
    typeof value === "string" &&
    CREDIT_FUNDING_SOURCES.some((source) => source === value)
  );
}

function isCreditType(value: unknown): value is CreditType {
  return typeof value === "string" && CREDIT_TYPE_SET.has(value);
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function success<TValue>(value: TValue): CreditPolicyResult<TValue> {
  return Object.freeze({ ok: true, value });
}

function failure(
  code: CreditPolicyErrorCode,
  context: Readonly<{ field?: string; grantId?: string }> = {},
): Extract<CreditPolicyResult<never>, { ok: false }> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, ...context }),
  });
}
