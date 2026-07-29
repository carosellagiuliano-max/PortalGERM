import { createHash } from "node:crypto";

const DAY_MS = 86_400_000;

export const JOB_FRESHNESS_POLICY_V1 = Object.freeze({
  version: "JOB_FRESHNESS_POLICY_V1",
  maximumConfirmationAgeDays: 30,
  reminderDaysBeforeDue: Object.freeze([7, 1] as const),
  candidateReviewSlaHours: 4,
  nearDuplicateThresholdBps: 8_500,
} as const);

export type JobFreshnessStateV1 =
  "ACTIVE" | "REVIEW_PENDING" | "HOLD" | "STALE" | "FILLED" | "CLOSED";

export type JobFreshnessSnapshotV1 = Readonly<{
  state: JobFreshnessStateV1;
  dueAt: Date;
  enforceAt: Date;
  reviewDueAt: Date | null;
}>;

export type JobFreshnessScheduleV1 = Readonly<{
  dueAt: Date;
  reminder7At: Date;
  reminder24At: Date;
}>;

export type PublicationFingerprintInputV1 = Readonly<{
  title: string;
  description: string;
  tasks: readonly string[];
  requirements: readonly string[];
  offer: string | null;
  categoryId: string;
  cantonId: string | null;
  cityId: string | null;
  workloadMin: number;
  workloadMax: number;
  jobType: string;
  remoteType: string;
}>;

export function buildJobPublicationSourceScopeV1(
  input: Readonly<{
    origin: "MANUAL" | "IMPORT";
    importSourceId: string | null;
  }>,
): string {
  if (input.origin === "MANUAL") return "manual";
  if (
    input.importSourceId === null ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      input.importSourceId,
    )
  ) {
    throw new TypeError("Imported publications require an import-source ID.");
  }
  return `import:${input.importSourceId}`;
}

export function calculateJobFreshnessScheduleV1(
  confirmedAt: Date,
  expiresAt: Date,
): JobFreshnessScheduleV1 {
  assertDate(confirmedAt);
  assertDate(expiresAt);
  if (expiresAt <= confirmedAt) {
    throw new RangeError("Freshness expiry must be after confirmation.");
  }
  const policyDue = new Date(
    confirmedAt.getTime() +
      JOB_FRESHNESS_POLICY_V1.maximumConfirmationAgeDays * DAY_MS,
  );
  const dueAt = new Date(Math.min(policyDue.getTime(), expiresAt.getTime()));
  return Object.freeze({
    dueAt,
    reminder7At: new Date(
      dueAt.getTime() -
        JOB_FRESHNESS_POLICY_V1.reminderDaysBeforeDue[0] * DAY_MS,
    ),
    reminder24At: new Date(
      dueAt.getTime() -
        JOB_FRESHNESS_POLICY_V1.reminderDaysBeforeDue[1] * DAY_MS,
    ),
  });
}

export function isJobFreshnessEligibleV1(
  snapshot: JobFreshnessSnapshotV1 | null | undefined,
  now: Date,
): boolean {
  assertDate(now);
  if (snapshot === null || snapshot === undefined) return true;
  if (snapshot.enforceAt > now) return true;
  if (["HOLD", "STALE", "FILLED", "CLOSED"].includes(snapshot.state)) {
    return false;
  }
  if (snapshot.dueAt <= now) return false;
  return !(
    snapshot.state === "REVIEW_PENDING" &&
    snapshot.reviewDueAt !== null &&
    snapshot.reviewDueAt <= now
  );
}

export function dueFreshnessActionsV1(
  input: Readonly<{
    state: JobFreshnessStateV1;
    dueAt: Date;
    reminder7At: Date;
    reminder24At: Date;
    reminder7SentAt: Date | null;
    reminder24SentAt: Date | null;
    reviewDueAt: Date | null;
  }>,
  now: Date,
): readonly ("REMINDER_7D" | "REMINDER_24H" | "DUE" | "REVIEW_SLA_EXCEEDED")[] {
  assertDate(now);
  if (["HOLD", "STALE", "FILLED", "CLOSED"].includes(input.state)) {
    return Object.freeze([]);
  }
  const actions: Array<
    "REMINDER_7D" | "REMINDER_24H" | "DUE" | "REVIEW_SLA_EXCEEDED"
  > = [];
  if (
    input.state === "REVIEW_PENDING" &&
    input.reviewDueAt !== null &&
    input.reviewDueAt <= now
  )
    actions.push("REVIEW_SLA_EXCEEDED");
  if (input.dueAt <= now) actions.push("DUE");
  if (
    input.reminder7SentAt === null &&
    input.reminder7At <= now &&
    input.dueAt > now
  ) {
    actions.push("REMINDER_7D");
  }
  if (
    input.reminder24SentAt === null &&
    input.reminder24At <= now &&
    input.dueAt > now
  )
    actions.push("REMINDER_24H");
  return Object.freeze(actions);
}

export function buildPublicationFingerprintV1(
  input: PublicationFingerprintInputV1,
): Readonly<{ exactFingerprint: string; signatureTokens: readonly string[] }> {
  const canonical = {
    title: normalizeContent(input.title),
    description: normalizeContent(input.description),
    tasks: input.tasks.map(normalizeContent).sort(),
    requirements: input.requirements.map(normalizeContent).sort(),
    offer: normalizeContent(input.offer ?? ""),
    categoryId: input.categoryId,
    cantonId: input.cantonId,
    cityId: input.cityId,
    workloadMin: input.workloadMin,
    workloadMax: input.workloadMax,
    jobType: input.jobType,
    remoteType: input.remoteType,
  };
  const signatureTokens = [
    ...new Set(
      [
        canonical.title,
        canonical.description,
        ...canonical.tasks,
        ...canonical.requirements,
        canonical.offer,
      ]
        .join(" ")
        .split(" ")
        .filter((token) => token.length >= 3),
    ),
  ]
    .sort()
    .slice(0, 200);
  return Object.freeze({
    exactFingerprint: createHash("sha256")
      .update(JSON.stringify(canonical), "utf8")
      .digest("hex"),
    signatureTokens: Object.freeze(signatureTokens),
  });
}

export function nearDuplicateScoreBpsV1(
  left: readonly string[],
  right: readonly string[],
): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size === 0 || rightSet.size === 0) return 0;
  const intersection = [...leftSet].filter((token) =>
    rightSet.has(token),
  ).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return Math.floor((intersection * 10_000) / union);
}

function normalizeContent(value: string): string {
  return value
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function assertDate(value: Date): void {
  if (!Number.isFinite(value.getTime()))
    throw new TypeError("Invalid freshness clock.");
}
