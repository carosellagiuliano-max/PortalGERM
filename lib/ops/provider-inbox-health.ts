import "server-only";

import type { DatabaseClient } from "@/lib/db/factory";

const MINUTE = 60_000;

export const PROVIDER_INBOX_HEALTH_POLICY_V1 = Object.freeze({
  policyVersion: "provider-inbox-health-v1",
  warningAgeMilliseconds: 5 * MINUTE,
  criticalAgeMilliseconds: 15 * MINUTE,
  maximumPaymentAttempts: 16,
});

export type ProviderInboxProcessingState =
  | "HEALTHY"
  | "WARNING"
  | "DEGRADED"
  | "UNKNOWN";

export type ProviderInboxHealthReason =
  | "PAYMENT_INBOX_AGING"
  | "PAYMENT_INBOX_STALE"
  | "PAYMENT_RETRY_CONTRACT_BROKEN"
  | "EMAIL_INBOX_AGING"
  | "EMAIL_INBOX_STALE"
  | "EMAIL_INBOX_FAILED"
  | "PROVIDER_INBOX_QUERY_FAILED";

type InboxRow = Readonly<{
  inbox: "payment" | "email";
  status: string;
  count: bigint;
  oldestReceivedAt: Date | null;
  brokenRetryCount: bigint;
}>;

type StatusSummary = Readonly<{
  count: number;
  oldestAgeSeconds: number | null;
}>;

export type ProviderInboxHealth = Readonly<{
  policyVersion: typeof PROVIDER_INBOX_HEALTH_POLICY_V1.policyVersion;
  processingState: ProviderInboxProcessingState;
  manualAttention: "NONE" | "REQUIRED";
  reasons: readonly ProviderInboxHealthReason[];
  payment: Readonly<{
    received: StatusSummary;
    failed: StatusSummary;
    held: StatusSummary;
    brokenRetryCount: number;
  }>;
  email: Readonly<{
    received: StatusSummary;
    failed: StatusSummary;
  }>;
}>;

export async function readProviderInboxHealth(
  database: DatabaseClient,
  input: Readonly<{
    environment: string;
    includeEmail?: boolean;
    now: Date;
  }>,
): Promise<ProviderInboxHealth> {
  if (
    input.environment.trim().length === 0 ||
    input.environment.length > 32 ||
    !Number.isFinite(input.now.getTime())
  ) {
    return unknownHealth();
  }
  try {
    const rows = await database.$queryRaw<InboxRow[]>`
      SELECT
        'payment'::text AS "inbox",
        "status"::text AS "status",
        COUNT(*)::bigint AS "count",
        MIN("receivedAt") AS "oldestReceivedAt",
        COUNT(*) FILTER (
          WHERE "status" = 'FAILED'::"ProviderEventInboxStatus"
            AND ("nextRetryAt" IS NULL OR "attemptCount" >= 16)
        )::bigint AS "brokenRetryCount"
      FROM "ProviderEventInbox"
      WHERE "environment" = ${input.environment}
        AND "status" IN (
          'RECEIVED'::"ProviderEventInboxStatus",
          'FAILED'::"ProviderEventInboxStatus",
          'HELD'::"ProviderEventInboxStatus"
        )
      GROUP BY "status"

      UNION ALL

      SELECT
        'email'::text AS "inbox",
        "status"::text AS "status",
        COUNT(*)::bigint AS "count",
        MIN("receivedAt") AS "oldestReceivedAt",
        CASE
          WHEN "status" = 'FAILED'::"EmailProviderEventInboxStatus"
          THEN COUNT(*)::bigint
          ELSE 0::bigint
        END AS "brokenRetryCount"
      FROM "EmailProviderEventInbox"
      WHERE "environment" = ${input.environment}
        AND "status" IN (
          'RECEIVED'::"EmailProviderEventInboxStatus",
          'FAILED'::"EmailProviderEventInboxStatus"
        )
      GROUP BY "status"

      ORDER BY 1, 2
    `;
    return evaluateProviderInboxHealth(rows, {
      includeEmail: input.includeEmail !== false,
      now: input.now,
    });
  } catch {
    return unknownHealth();
  }
}

export function evaluateProviderInboxHealth(
  rows: readonly InboxRow[],
  input: Readonly<{ includeEmail?: boolean; now: Date }>,
): ProviderInboxHealth {
  const includeEmail = input.includeEmail !== false;
  if (!Number.isFinite(input.now.getTime())) return unknownHealth();
  const summaries = new Map<string, StatusSummary>();
  let brokenPaymentRetries = 0;
  for (const row of rows) {
    const allowed =
      (row.inbox === "payment" &&
        ["RECEIVED", "FAILED", "HELD"].includes(row.status)) ||
      (row.inbox === "email" &&
        ["RECEIVED", "FAILED"].includes(row.status));
    const key = `${row.inbox}:${row.status}`;
    const count = safeCount(row.count);
    const brokenRetryCount = safeCount(row.brokenRetryCount);
    if (
      !allowed ||
      summaries.has(key) ||
      count === null ||
      brokenRetryCount === null ||
      (count > 0 && row.oldestReceivedAt === null)
    ) {
      return unknownHealth();
    }
    const age = oldestAgeSeconds(row.oldestReceivedAt, input.now);
    if (age === undefined) return unknownHealth();
    summaries.set(key, Object.freeze({ count, oldestAgeSeconds: age }));
    if (row.inbox === "payment" && row.status === "FAILED") {
      brokenPaymentRetries = brokenRetryCount;
    }
  }

  const payment = Object.freeze({
    received: summary(summaries, "payment:RECEIVED"),
    failed: summary(summaries, "payment:FAILED"),
    held: summary(summaries, "payment:HELD"),
    brokenRetryCount: brokenPaymentRetries,
  });
  const email = Object.freeze({
    received: summary(summaries, "email:RECEIVED"),
    failed: summary(summaries, "email:FAILED"),
  });
  const reasons: ProviderInboxHealthReason[] = [];
  addAgeReason(
    reasons,
    payment.received,
    "PAYMENT_INBOX_AGING",
    "PAYMENT_INBOX_STALE",
  );
  addAgeReason(
    reasons,
    payment.failed,
    "PAYMENT_INBOX_AGING",
    "PAYMENT_INBOX_STALE",
  );
  if (payment.brokenRetryCount > 0) {
    reasons.push("PAYMENT_RETRY_CONTRACT_BROKEN");
  }
  if (includeEmail) {
    addAgeReason(
      reasons,
      email.received,
      "EMAIL_INBOX_AGING",
      "EMAIL_INBOX_STALE",
    );
    if (email.failed.count > 0) reasons.push("EMAIL_INBOX_FAILED");
  }
  const uniqueReasons = Object.freeze([...new Set(reasons)]);
  const degraded = uniqueReasons.some((reason) =>
    [
      "PAYMENT_INBOX_STALE",
      "PAYMENT_RETRY_CONTRACT_BROKEN",
      "EMAIL_INBOX_STALE",
      "EMAIL_INBOX_FAILED",
    ].includes(reason),
  );
  const warning = uniqueReasons.some((reason) =>
    ["PAYMENT_INBOX_AGING", "EMAIL_INBOX_AGING"].includes(reason),
  );
  return Object.freeze({
    policyVersion: PROVIDER_INBOX_HEALTH_POLICY_V1.policyVersion,
    processingState: degraded ? "DEGRADED" : warning ? "WARNING" : "HEALTHY",
    manualAttention: payment.held.count > 0 ? "REQUIRED" : "NONE",
    reasons: uniqueReasons,
    payment,
    email,
  });
}

function addAgeReason(
  reasons: ProviderInboxHealthReason[],
  value: StatusSummary,
  warning: ProviderInboxHealthReason,
  critical: ProviderInboxHealthReason,
) {
  if (value.oldestAgeSeconds === null) return;
  const ageMilliseconds = value.oldestAgeSeconds * 1_000;
  if (
    ageMilliseconds >=
    PROVIDER_INBOX_HEALTH_POLICY_V1.criticalAgeMilliseconds
  ) {
    reasons.push(critical);
  } else if (
    ageMilliseconds >= PROVIDER_INBOX_HEALTH_POLICY_V1.warningAgeMilliseconds
  ) {
    reasons.push(warning);
  }
}

function oldestAgeSeconds(value: Date | null, now: Date) {
  if (value === null) return null;
  const milliseconds = value.getTime();
  if (!Number.isFinite(milliseconds) || milliseconds > now.getTime()) {
    return undefined;
  }
  return Math.floor((now.getTime() - milliseconds) / 1_000);
}

function safeCount(value: bigint) {
  return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : null;
}

function summary(values: Map<string, StatusSummary>, key: string) {
  return (
    values.get(key) ?? Object.freeze({ count: 0, oldestAgeSeconds: null })
  );
}

function unknownHealth(): ProviderInboxHealth {
  const empty = Object.freeze({ count: 0, oldestAgeSeconds: null });
  return Object.freeze({
    policyVersion: PROVIDER_INBOX_HEALTH_POLICY_V1.policyVersion,
    processingState: "UNKNOWN",
    manualAttention: "NONE",
    reasons: Object.freeze(["PROVIDER_INBOX_QUERY_FAILED" as const]),
    payment: Object.freeze({
      received: empty,
      failed: empty,
      held: empty,
      brokenRetryCount: 0,
    }),
    email: Object.freeze({
      received: empty,
      failed: empty,
    }),
  });
}
