import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { SecretHandle } from "@/lib/config/env-schema";

export const COMPANY_CONTEXT_COOKIE_POLICY_V1 = Object.freeze({
  cookieName: "company_context",
  ttlMilliseconds: 30 * 24 * 60 * 60 * 1_000,
  clockSkewMilliseconds: 5 * 60 * 1_000,
  version: 1,
});

const payloadSchema = z
  .object({
    version: z.literal(COMPANY_CONTEXT_COOKIE_POLICY_V1.version),
    userId: z.uuid(),
    companyId: z.uuid(),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
  })
  .strict();

export type CompanyContextSigningKey = Pick<
  SecretHandle<"SESSION_SECRET">,
  "withValue"
>;

export type CompanyContextCookiePayload = Readonly<
  z.infer<typeof payloadSchema>
>;

export type CompanyContextCookieOptions = Readonly<{
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  expires: Date;
}>;

export type SignedCompanyContextCookie = Readonly<{
  name: typeof COMPANY_CONTEXT_COOKIE_POLICY_V1.cookieName;
  value: string;
  options: CompanyContextCookieOptions;
}>;

function signingKey(secret: string): Buffer {
  const key = Buffer.from(secret, "base64");
  if (key.length < 32) {
    throw new TypeError("Company context requires a valid signing key.");
  }
  return key;
}

function signature(encodedPayload: string, secret: string): Buffer {
  return createHmac("sha256", signingKey(secret))
    .update(`company-context-v1\0${encodedPayload}`, "utf8")
    .digest();
}

export function signCompanyContextCookie(
  input: Readonly<{ userId: string; companyId: string; now: Date }>,
  key: CompanyContextSigningKey,
): string {
  const issuedAt = input.now.getTime();
  const payload = payloadSchema.parse({
    version: COMPANY_CONTEXT_COOKIE_POLICY_V1.version,
    userId: input.userId,
    companyId: input.companyId,
    issuedAt,
    expiresAt: issuedAt + COMPANY_CONTEXT_COOKIE_POLICY_V1.ttlMilliseconds,
  });
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return key.withValue(
    (secret) => `${encoded}.${signature(encoded, secret).toString("base64url")}`,
  );
}

export function verifyCompanyContextCookie(
  value: string | null | undefined,
  expected: Readonly<{ userId: string; now: Date }>,
  key: CompanyContextSigningKey,
): CompanyContextCookiePayload | null {
  if (
    value == null ||
    value.length === 0 ||
    value.length > 1_024 ||
    !Number.isFinite(expected.now.getTime())
  ) {
    return null;
  }
  const [encoded, encodedSignature, extra] = value.split(".");
  if (!encoded || !encodedSignature || extra !== undefined) return null;

  try {
    const validSignature = key.withValue((secret) => {
      const supplied = Buffer.from(encodedSignature, "base64url");
      const correct = signature(encoded, secret);
      return supplied.length === correct.length && timingSafeEqual(supplied, correct);
    });
    if (!validSignature) return null;

    const result = payloadSchema.safeParse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
    if (!result.success) return null;
    const now = expected.now.getTime();
    if (
      result.data.userId !== expected.userId ||
      result.data.issuedAt >
        now + COMPANY_CONTEXT_COOKIE_POLICY_V1.clockSkewMilliseconds ||
      result.data.expiresAt !==
        result.data.issuedAt + COMPANY_CONTEXT_COOKIE_POLICY_V1.ttlMilliseconds ||
      now >= result.data.expiresAt
    ) {
      return null;
    }
    return Object.freeze(result.data);
  } catch {
    return null;
  }
}

export function createCompanyContextCookie(
  input: Readonly<{
    userId: string;
    companyId: string;
    now: Date;
    production: boolean;
  }>,
  key: CompanyContextSigningKey,
): SignedCompanyContextCookie {
  const value = signCompanyContextCookie(input, key);
  return Object.freeze({
    name: COMPANY_CONTEXT_COOKIE_POLICY_V1.cookieName,
    value,
    options: Object.freeze({
      httpOnly: true,
      secure: input.production,
      sameSite: "lax",
      path: "/",
      expires: new Date(
        input.now.getTime() + COMPANY_CONTEXT_COOKIE_POLICY_V1.ttlMilliseconds,
      ),
    }),
  });
}
