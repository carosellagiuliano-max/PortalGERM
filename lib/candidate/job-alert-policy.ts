import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

import {
  AlertFrequency,
  RemotePreference,
  type AlertFrequency as AlertFrequencyType,
  type RemotePreference as RemotePreferenceType,
} from "@/lib/generated/prisma/enums";

export const JOB_ALERT_POLICY_V1 = Object.freeze({
  version: "job-alert-policy-v1",
  timeZone: "Europe/Zurich",
  localDeliveryHour: 8,
  maximumDigestJobs: 20,
  unsubscribeTokenBytes: 32,
  unsubscribeLifetimeDays: 180,
} as const);

export const JOB_ALERT_DELIVERY_NOTICE_V1 = Object.freeze({
  version: "job-alert-delivery-v1",
  purpose: "Job alert delivery",
  copy:
    "Ich möchte dieses Jobabo als lokalen Mock-Eintrag erhalten. Dies ist unabhängig von Marketing-Nachrichten.",
});

const nullableUuid = z.union([z.string().uuid(), z.null()]);

export const jobAlertQuerySchema = z
  .object({
    keyword: z.string().trim().max(80),
    cantonId: nullableUuid,
    cityId: nullableUuid,
    radiusKm: z.number().int().min(0).max(200),
    categoryId: nullableUuid,
    workloadMin: z.number().int().min(10).max(100),
    workloadMax: z.number().int().min(10).max(100),
    salaryTransparentOnly: z.boolean(),
    remotePreference: z.enum(RemotePreference),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.workloadMin > value.workloadMax) {
      context.addIssue({
        code: "custom",
        message: "Das minimale Pensum darf nicht über dem maximalen Pensum liegen.",
        path: ["workloadMax"],
      });
    }
    if (value.cityId !== null && value.cantonId === null) {
      context.addIssue({
        code: "custom",
        message: "Eine Stadt benötigt einen Kanton.",
        path: ["cityId"],
      });
    }
  });

export const jobAlertCommandSchema = z
  .object({
    query: jobAlertQuerySchema,
    frequency: z.enum(AlertFrequency),
    active: z.boolean(),
    deliveryConsentAccepted: z.boolean(),
  })
  .strict();

export const jobAlertIdSchema = z.string().uuid();
export const unsubscribeRawTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/u);

export type JobAlertQuery = z.infer<typeof jobAlertQuerySchema>;
export type JobAlertCommand = z.infer<typeof jobAlertCommandSchema>;

export type LegacyJobAlertQuery = Readonly<{
  categorySlug: string | null;
  cantonCode: string | null;
}>;

const legacyJobAlertQuerySchema = z
  .object({
    category: z.string().trim().min(1).max(160).optional(),
    canton: z.string().trim().min(1).max(8).optional(),
    page: z.number().int().positive().optional(),
  })
  .passthrough();

export type ParsedStoredJobAlertQuery =
  | Readonly<{ kind: "v1"; query: JobAlertQuery }>
  | Readonly<{ kind: "legacy"; query: LegacyJobAlertQuery }>
  | Readonly<{ kind: "invalid" }>;

export function parseStoredJobAlertQuery(value: unknown): ParsedStoredJobAlertQuery {
  const current = jobAlertQuerySchema.safeParse(value);
  if (current.success) {
    return Object.freeze({ kind: "v1", query: Object.freeze(current.data) });
  }
  const legacy = legacyJobAlertQuerySchema.safeParse(value);
  if (legacy.success && (legacy.data.category !== undefined || legacy.data.canton !== undefined)) {
    return Object.freeze({
      kind: "legacy",
      query: Object.freeze({
        categorySlug: legacy.data.category ?? null,
        cantonCode: legacy.data.canton?.toUpperCase() ?? null,
      }),
    });
  }
  return Object.freeze({ kind: "invalid" });
}

export function firstJobAlertDueAt(
  activatedAt: Date,
  frequency: AlertFrequencyType,
): Date {
  assertValidDate(activatedAt);
  if (frequency === "DAILY") {
    const local = zurichParts(activatedAt);
    const next = addCalendarDays(local, 1);
    return zurichWallTimeToInstant(next.year, next.month, next.day, 8);
  }

  const local = zurichParts(activatedAt);
  let daysUntilMonday = (8 - local.isoWeekday) % 7;
  if (daysUntilMonday === 0 && !isStrictlyBeforeLocalEight(local)) {
    daysUntilMonday = 7;
  }
  const next = addCalendarDays(local, daysUntilMonday);
  return zurichWallTimeToInstant(next.year, next.month, next.day, 8);
}

export function nextJobAlertDueAt(
  completedAt: Date,
  frequency: AlertFrequencyType,
): Date {
  return firstJobAlertDueAt(completedAt, frequency);
}

export function jobAlertWindow(
  createdAt: Date,
  lastSuccessfulCutoffAt: Date | null,
  now: Date,
) {
  assertValidDate(createdAt);
  assertValidDate(now);
  if (lastSuccessfulCutoffAt !== null) assertValidDate(lastSuccessfulCutoffAt);
  const start = lastSuccessfulCutoffAt ?? createdAt;
  if (start.getTime() > now.getTime()) {
    throw new JobAlertPolicyError("window_inverted");
  }
  return Object.freeze({ start: new Date(start), end: new Date(now) });
}

export function isInsideJobAlertWindow(
  publishedAt: Date,
  window: Readonly<{ start: Date; end: Date }>,
) {
  assertValidDate(publishedAt);
  return (
    publishedAt.getTime() > window.start.getTime() &&
    publishedAt.getTime() <= window.end.getTime()
  );
}

export function createJobAlertUnsubscribeToken(
  issuedAt: Date,
  random: (size: number) => Buffer = randomBytes,
) {
  assertValidDate(issuedAt);
  const bytes = random(JOB_ALERT_POLICY_V1.unsubscribeTokenBytes);
  if (!Buffer.isBuffer(bytes) || bytes.byteLength !== JOB_ALERT_POLICY_V1.unsubscribeTokenBytes) {
    throw new JobAlertPolicyError("token_entropy_invalid");
  }
  const rawToken = bytes.toString("base64url");
  const tokenHash = hashJobAlertUnsubscribeToken(rawToken);
  const expiresAt = new Date(
    issuedAt.getTime() +
      JOB_ALERT_POLICY_V1.unsubscribeLifetimeDays * 24 * 60 * 60 * 1_000,
  );
  return Object.freeze({ rawToken, tokenHash, issuedAt: new Date(issuedAt), expiresAt });
}

export function hashJobAlertUnsubscribeToken(rawToken: string) {
  const parsed = unsubscribeRawTokenSchema.safeParse(rawToken);
  if (!parsed.success) throw new JobAlertPolicyError("token_invalid");
  return createHash("sha256").update(parsed.data, "utf8").digest("hex");
}

export function jobAlertConsentNoticeHash() {
  return createHash("sha256")
    .update(JOB_ALERT_DELIVERY_NOTICE_V1.version, "utf8")
    .update("\0", "utf8")
    .update(JOB_ALERT_DELIVERY_NOTICE_V1.purpose, "utf8")
    .update("\0", "utf8")
    .update(JOB_ALERT_DELIVERY_NOTICE_V1.copy, "utf8")
    .digest("hex");
}

export function defaultJobAlertQuery(): JobAlertQuery {
  return Object.freeze({
    keyword: "",
    cantonId: null,
    cityId: null,
    radiusKm: 0,
    categoryId: null,
    workloadMin: 10,
    workloadMax: 100,
    salaryTransparentOnly: false,
    remotePreference: RemotePreference.ANY,
  });
}

export function jobAlertEligibilityEnvironment(
  appEnvironment: string,
): "production" | "non-production" {
  return appEnvironment === "production" || appEnvironment === "staging"
    ? "production"
    : "non-production";
}

export function remotePreferenceMatches(
  preference: RemotePreferenceType,
  remoteType: "ONSITE" | "HYBRID" | "REMOTE",
) {
  return preference === "ANY" || preference === remoteType;
}

export function distanceInKilometres(
  from: Readonly<{ latitude: number; longitude: number }>,
  to: Readonly<{ latitude: number; longitude: number }>,
) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(from.latitude)) *
      Math.cos(radians(to.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export class JobAlertPolicyError extends Error {
  constructor(readonly code: string) {
    super(`Job alert policy rejected: ${code}`);
    this.name = "JobAlertPolicyError";
  }
}

type ZurichParts = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  isoWeekday: number;
}>;

const zurichFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: JOB_ALERT_POLICY_V1.timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

const weekdayNumber: Readonly<Record<string, number>> = Object.freeze({
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
});

function zurichParts(value: Date): ZurichParts {
  const parts = Object.fromEntries(
    zurichFormatter
      .formatToParts(value)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value: partValue }) => [type, partValue]),
  );
  const isoWeekday = weekdayNumber[parts.weekday ?? ""];
  if (isoWeekday === undefined) throw new JobAlertPolicyError("calendar_invalid");
  return Object.freeze({
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    millisecond: value.getUTCMilliseconds(),
    isoWeekday,
  });
}

function isStrictlyBeforeLocalEight(parts: ZurichParts) {
  return parts.hour < 8;
}

function addCalendarDays(parts: ZurichParts, days: number) {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12));
  return Object.freeze({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

function zurichWallTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
) {
  const desiredWallMs = Date.UTC(year, month - 1, day, hour, 0, 0, 0);
  let candidateMs = desiredWallMs;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const observed = zurichParts(new Date(candidateMs));
    const observedWallMs = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
      observed.millisecond,
    );
    const delta = desiredWallMs - observedWallMs;
    candidateMs += delta;
    if (delta === 0) break;
  }
  const result = new Date(candidateMs);
  const verified = zurichParts(result);
  if (
    verified.year !== year ||
    verified.month !== month ||
    verified.day !== day ||
    verified.hour !== hour ||
    verified.minute !== 0 ||
    verified.second !== 0
  ) {
    throw new JobAlertPolicyError("calendar_conversion_failed");
  }
  return result;
}

function assertValidDate(value: Date) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new JobAlertPolicyError("clock_invalid");
  }
}
