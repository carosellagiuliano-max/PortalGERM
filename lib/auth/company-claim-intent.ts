import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { SecretHandle } from "@/lib/config/env-schema";

export const COMPANY_CLAIM_INTENT_POLICY_V1 = Object.freeze({
  version: 1,
  context: "swisstalenthub:employer-registration:company-claim-intent:v1",
  ttlMilliseconds: 15 * 60 * 1_000,
  clockSkewMilliseconds: 30 * 1_000,
  maximumTokenLength: 1_024,
});

const COMPANY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const payloadSchema = z
  .object({
    version: z.literal(COMPANY_CLAIM_INTENT_POLICY_V1.version),
    companySlug: z
      .string()
      .min(1)
      .max(200)
      .regex(COMPANY_SLUG_PATTERN),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
  })
  .strict();

export type CompanyClaimIntentSigningKey = Pick<
  SecretHandle<"SESSION_SECRET">,
  "withValue"
>;

/**
 * This payload is navigation state only. Successful verification does not
 * identify a user, create membership or authorize a claim.
 */
export type CompanyClaimIntentPayload = Readonly<z.infer<typeof payloadSchema>>;

export function signCompanyClaimIntent(
  input: Readonly<{ companySlug: string; now: Date }>,
  key: CompanyClaimIntentSigningKey,
): string {
  if (!isValidDate(input.now)) {
    throw new TypeError("Company claim intent requires a valid clock.");
  }
  const issuedAt = input.now.getTime();
  const payload = payloadSchema.parse({
    version: COMPANY_CLAIM_INTENT_POLICY_V1.version,
    companySlug: input.companySlug,
    issuedAt,
    expiresAt: issuedAt + COMPANY_CLAIM_INTENT_POLICY_V1.ttlMilliseconds,
  });
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return key.withValue((secret) =>
    `${encodedPayload}.${claimIntentSignature(encodedPayload, secret).toString("base64url")}`,
  );
}

export function verifyCompanyClaimIntent(
  value: string | null | undefined,
  expected: Readonly<{ companySlug: string; now: Date }>,
  key: CompanyClaimIntentSigningKey,
): CompanyClaimIntentPayload | null {
  if (
    value == null ||
    value.length === 0 ||
    value.length > COMPANY_CLAIM_INTENT_POLICY_V1.maximumTokenLength ||
    !COMPANY_SLUG_PATTERN.test(expected.companySlug) ||
    expected.companySlug.length > 200 ||
    !isValidDate(expected.now)
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
    const signatureIsValid = key.withValue((secret) => {
      const supplied = Buffer.from(encodedSignature, "base64url");
      const correct = claimIntentSignature(encodedPayload, secret);
      return supplied.length === correct.length && timingSafeEqual(supplied, correct);
    });
    if (!signatureIsValid) return null;

    const parsed = payloadSchema.safeParse(
      JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")),
    );
    if (!parsed.success) return null;
    const now = expected.now.getTime();
    if (
      parsed.data.companySlug !== expected.companySlug ||
      parsed.data.issuedAt >
        now + COMPANY_CLAIM_INTENT_POLICY_V1.clockSkewMilliseconds ||
      parsed.data.expiresAt !==
        parsed.data.issuedAt + COMPANY_CLAIM_INTENT_POLICY_V1.ttlMilliseconds ||
      now >= parsed.data.expiresAt
    ) {
      return null;
    }

    return Object.freeze(parsed.data);
  } catch {
    return null;
  }
}

function claimIntentSignature(encodedPayload: string, secret: string): Buffer {
  return createHmac("sha256", signingKey(secret))
    .update(`${COMPANY_CLAIM_INTENT_POLICY_V1.context}\0${encodedPayload}`, "utf8")
    .digest();
}

function signingKey(secret: string): Buffer {
  const key = Buffer.from(secret, "base64");
  if (key.length < 32) {
    throw new TypeError("Company claim intent requires a valid signing key.");
  }
  return key;
}

function isCanonicalBase64Url(value: string): boolean {
  if (!BASE64URL_PATTERN.test(value)) return false;
  const decoded = Buffer.from(value, "base64url");
  return decoded.toString("base64url") === value;
}

function isValidDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}
