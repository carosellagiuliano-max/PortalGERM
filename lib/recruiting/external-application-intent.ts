import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { SecretHandle } from "@/lib/config/env-schema";

export const EXTERNAL_APPLICATION_RESUME_POLICY_V1 = Object.freeze({
  version: 1,
  context: "swisstalenthub:external-application-resume:v1",
  cookieName: "sth_external_application_resume",
  ttlMilliseconds: 14 * 24 * 60 * 60 * 1_000,
  maximumTokenLength: 1_024,
});

const payloadSchema = z.strictObject({
  version: z.literal(EXTERNAL_APPLICATION_RESUME_POLICY_V1.version),
  jobId: z.uuid(),
  jobRevisionId: z.uuid(),
  jobSlug: z
    .string()
    .min(1)
    .max(220)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
});

type SigningKey = Pick<SecretHandle<"SESSION_SECRET">, "withValue">;

export function signExternalApplicationResumeIntent(
  input: Readonly<{
    jobId: string;
    jobRevisionId: string;
    jobSlug: string;
    now: Date;
  }>,
  key: SigningKey,
): string {
  const issuedAt = input.now.getTime();
  const payload = payloadSchema.parse({
    version: EXTERNAL_APPLICATION_RESUME_POLICY_V1.version,
    jobId: input.jobId,
    jobRevisionId: input.jobRevisionId,
    jobSlug: input.jobSlug,
    issuedAt,
    expiresAt:
      issuedAt + EXTERNAL_APPLICATION_RESUME_POLICY_V1.ttlMilliseconds,
  });
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return key.withValue(
    (secret) => `${encoded}.${signature(encoded, secret).toString("base64url")}`,
  );
}

export function verifyExternalApplicationResumeIntent(
  token: string | null | undefined,
  now: Date,
  key: SigningKey,
) {
  if (
    token == null ||
    token.length === 0 ||
    token.length > EXTERNAL_APPLICATION_RESUME_POLICY_V1.maximumTokenLength ||
    !Number.isFinite(now.getTime())
  ) {
    return null;
  }
  const [encoded, suppliedSignature, extra] = token.split(".");
  if (
    encoded === undefined ||
    suppliedSignature === undefined ||
    extra !== undefined ||
    !/^[A-Za-z0-9_-]+$/u.test(encoded) ||
    !/^[A-Za-z0-9_-]+$/u.test(suppliedSignature)
  ) {
    return null;
  }
  try {
    const valid = key.withValue((secret) => {
      const supplied = Buffer.from(suppliedSignature, "base64url");
      const expected = signature(encoded, secret);
      return (
        supplied.toString("base64url") === suppliedSignature &&
        supplied.length === expected.length &&
        timingSafeEqual(supplied, expected)
      );
    });
    if (!valid) return null;
    const parsed = payloadSchema.safeParse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
    if (
      !parsed.success ||
      parsed.data.expiresAt !==
        parsed.data.issuedAt +
          EXTERNAL_APPLICATION_RESUME_POLICY_V1.ttlMilliseconds ||
      now.getTime() >= parsed.data.expiresAt ||
      parsed.data.issuedAt > now.getTime() + 30_000
    ) {
      return null;
    }
    return Object.freeze(parsed.data);
  } catch {
    return null;
  }
}

function signature(encoded: string, secret: string): Buffer {
  const material = Buffer.from(secret, "base64");
  if (material.length < 32) throw new TypeError("A valid signing key is required.");
  return createHmac("sha256", material)
    .update(`${EXTERNAL_APPLICATION_RESUME_POLICY_V1.context}\0${encoded}`, "utf8")
    .digest();
}
