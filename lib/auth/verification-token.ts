import "server-only";

import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";

import type { SecretHandle } from "@/lib/config/env-schema";

import { EMAIL_VERIFICATION_POLICY_V1 } from "./email-verification-policy";

const TOKEN_PATTERN =
  /^v1\.([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/iu;

export function createVerificationToken(
  challengeId: string,
  purpose: "REGISTRATION" | "INVITATION" | "LOGIN_EMAIL_CHANGE",
  addressEpoch: number,
  secret: SecretHandle<"SESSION_SECRET">,
) {
  const signature = secret.withValue((value) =>
    createHmac("sha256", Buffer.from(value, "base64"))
      .update(EMAIL_VERIFICATION_POLICY_V1.tokenSignatureDomain, "utf8")
      .update("\0", "utf8")
      .update(challengeId, "utf8")
      .update("\0", "utf8")
      .update(purpose, "utf8")
      .update("\0", "utf8")
      .update(String(addressEpoch), "utf8")
      .digest("base64url"),
  );
  return `${EMAIL_VERIFICATION_POLICY_V1.tokenVersion}.${challengeId}.${signature}`;
}

export function hashVerificationToken(rawToken: string) {
  return createHash("sha256")
    .update("swisstalenthub.email-verification-token-hash.v1\0", "utf8")
    .update(rawToken, "utf8")
    .digest("hex");
}

export function parseVerificationToken(rawToken: string) {
  if (
    rawToken.length > EMAIL_VERIFICATION_POLICY_V1.maximumTokenLength
  ) {
    return null;
  }
  const match = TOKEN_PATTERN.exec(rawToken);
  if (match === null) return null;
  return Object.freeze({
    challengeId: match[1]!.toLowerCase(),
    signature: match[2]!,
    tokenHash: hashVerificationToken(rawToken),
  });
}

export function verifyDerivedVerificationToken(
  rawToken: string,
  input: Readonly<{
    challengeId: string;
    purpose: "REGISTRATION" | "INVITATION" | "LOGIN_EMAIL_CHANGE";
    addressEpoch: number;
    secret: SecretHandle<"SESSION_SECRET">;
  }>,
) {
  const expected = createVerificationToken(
    input.challengeId,
    input.purpose,
    input.addressEpoch,
    input.secret,
  );
  const suppliedBytes = Buffer.from(rawToken, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  );
}

export function hashVerificationTarget(
  normalizedEmail: string,
  secret: SecretHandle<"SESSION_SECRET">,
) {
  return secret.withValue((value) =>
    createHmac("sha256", Buffer.from(value, "base64"))
      .update(EMAIL_VERIFICATION_POLICY_V1.targetHashDomain, "utf8")
      .update("\0", "utf8")
      .update(normalizedEmail, "utf8")
      .digest("hex"),
  );
}
