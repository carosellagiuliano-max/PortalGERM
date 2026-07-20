import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { SecretHandle } from "@/lib/config/env-schema";

export const JOB_INTENT_ACTIONS_V1 = ["SAVE", "APPLY"] as const;
export type JobIntentActionV1 = (typeof JOB_INTENT_ACTIONS_V1)[number];

export const SIGNED_JOB_INTENT_POLICY_V1 = Object.freeze({
  version: 1,
  context: "swisstalenthub:public-job-intent:v1",
  ttlMilliseconds: 30 * 60 * 1_000,
  clockSkewMilliseconds: 30 * 1_000,
  maximumTokenLength: 1_024,
});

const JOB_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const payloadSchema = z
  .strictObject({
    version: z.literal(SIGNED_JOB_INTENT_POLICY_V1.version),
    action: z.enum(JOB_INTENT_ACTIONS_V1),
    jobSlug: z.string().min(1).max(220).regex(JOB_SLUG_PATTERN),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
  });

export type SignedJobIntentPayloadV1 = Readonly<z.infer<typeof payloadSchema>>;
export type SignedJobIntentKey = Pick<
  SecretHandle<"SESSION_SECRET">,
  "withValue"
>;

export function signJobIntent(
  input: Readonly<{
    action: JobIntentActionV1;
    jobSlug: string;
    now: Date;
  }>,
  key: SignedJobIntentKey,
): string {
  assertValidClock(input.now);
  const issuedAt = input.now.getTime();
  const payload = payloadSchema.parse({
    version: SIGNED_JOB_INTENT_POLICY_V1.version,
    action: input.action,
    jobSlug: input.jobSlug,
    issuedAt,
    expiresAt: issuedAt + SIGNED_JOB_INTENT_POLICY_V1.ttlMilliseconds,
  });
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return key.withValue((secret) => {
    const signature = intentSignature(encodedPayload, secret).toString("base64url");
    return `${encodedPayload}.${signature}`;
  });
}

export function verifyJobIntent(
  value: string | null | undefined,
  expected: Readonly<{
    now: Date;
    action?: JobIntentActionV1;
    jobSlug?: string;
  }>,
  key: SignedJobIntentKey,
): SignedJobIntentPayloadV1 | null {
  if (
    value == null ||
    value.length === 0 ||
    value.length > SIGNED_JOB_INTENT_POLICY_V1.maximumTokenLength ||
    !isValidClock(expected.now) ||
    (expected.jobSlug !== undefined &&
      (expected.jobSlug.length > 220 || !JOB_SLUG_PATTERN.test(expected.jobSlug)))
  ) {
    return null;
  }

  const [encodedPayload, encodedSignature, extra] = value.split(".");
  if (
    !encodedPayload ||
    !encodedSignature ||
    extra !== undefined ||
    !isCanonicalBase64Url(encodedPayload) ||
    !isCanonicalBase64Url(encodedSignature)
  ) {
    return null;
  }

  try {
    const validSignature = key.withValue((secret) => {
      const supplied = Buffer.from(encodedSignature, "base64url");
      const correct = intentSignature(encodedPayload, secret);
      return supplied.length === correct.length && timingSafeEqual(supplied, correct);
    });
    if (!validSignature) return null;

    const parsed = payloadSchema.safeParse(
      JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")),
    );
    if (!parsed.success) return null;
    const now = expected.now.getTime();
    if (
      parsed.data.issuedAt >
        now + SIGNED_JOB_INTENT_POLICY_V1.clockSkewMilliseconds ||
      parsed.data.expiresAt !==
        parsed.data.issuedAt + SIGNED_JOB_INTENT_POLICY_V1.ttlMilliseconds ||
      now >= parsed.data.expiresAt ||
      (expected.action !== undefined && parsed.data.action !== expected.action) ||
      (expected.jobSlug !== undefined && parsed.data.jobSlug !== expected.jobSlug)
    ) {
      return null;
    }
    return Object.freeze(parsed.data);
  } catch {
    return null;
  }
}

export function buildJobIntentNextPath(
  jobSlug: string,
  signedIntent: string,
): string {
  if (
    jobSlug.length > 220 ||
    !JOB_SLUG_PATTERN.test(jobSlug) ||
    signedIntent.length === 0 ||
    signedIntent.length > SIGNED_JOB_INTENT_POLICY_V1.maximumTokenLength ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(signedIntent)
  ) {
    throw new TypeError("A canonical signed job intent path is required.");
  }
  return `/jobs/${jobSlug}?intent=${encodeURIComponent(signedIntent)}`;
}

export function isStructurallySafeJobIntentNextPath(
  pathname: string,
  searchParams: URLSearchParams,
): boolean {
  const match = /^\/jobs\/([a-z0-9]+(?:-[a-z0-9]+)*)$/u.exec(pathname);
  if (match === null || match[1]!.length > 220) return false;
  if ([...searchParams.keys()].some((key) => key !== "intent")) return false;
  const values = searchParams.getAll("intent");
  return (
    values.length === 1 &&
    values[0]!.length > 0 &&
    values[0]!.length <= SIGNED_JOB_INTENT_POLICY_V1.maximumTokenLength &&
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(values[0]!)
  );
}

function intentSignature(encodedPayload: string, secret: string): Buffer {
  const key = Buffer.from(secret, "base64");
  if (key.length < 32) {
    throw new TypeError("Signed job intent requires a valid signing key.");
  }
  return createHmac("sha256", key)
    .update(`${SIGNED_JOB_INTENT_POLICY_V1.context}\0${encodedPayload}`, "utf8")
    .digest();
}

function isCanonicalBase64Url(value: string): boolean {
  if (!BASE64URL_PATTERN.test(value)) return false;
  const decoded = Buffer.from(value, "base64url");
  return decoded.toString("base64url") === value;
}

function assertValidClock(value: Date): void {
  if (!isValidClock(value)) {
    throw new TypeError("Signed job intent requires a valid clock.");
  }
}

function isValidClock(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}
