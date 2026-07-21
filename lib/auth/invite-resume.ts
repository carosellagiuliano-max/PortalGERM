import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { z } from "zod";

import type { SecretHandle } from "@/lib/config/env-schema";

export const INVITE_RESUME_PATH = "/invite/resume" as const;

export const INVITE_RESUME_COOKIE_POLICY_V1 = Object.freeze({
  cookieName: "invite_resume",
  ttlMilliseconds: 30 * 60 * 1_000,
  clockSkewMilliseconds: 60 * 1_000,
  version: 1,
  path: "/invite" as const,
});

const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MAXIMUM_SEALED_VALUE_LENGTH = 1_024;
const ADDITIONAL_AUTHENTICATED_DATA = Buffer.from(
  "swisstalenthub-invite-resume-v1",
  "utf8",
);

const payloadSchema = z
  .object({
    version: z.literal(INVITE_RESUME_COOKIE_POLICY_V1.version),
    token: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/u),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
  })
  .strict();

export type InviteResumeKey = Pick<
  SecretHandle<"SESSION_SECRET">,
  "withValue"
>;

export type InviteResumePayload = Readonly<z.infer<typeof payloadSchema>>;

export type InviteResumeCookieOptions = Readonly<{
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: typeof INVITE_RESUME_COOKIE_POLICY_V1.path;
  expires: Date;
  maxAge: number;
}>;

export type InviteResumeCookieWriter = Readonly<{
  set(
    name: string,
    value: string,
    options: InviteResumeCookieOptions,
  ): void;
}>;

export function createInviteResumeCookie(
  input: Readonly<{ token: string; now: Date; secure: boolean }>,
  key: InviteResumeKey,
) {
  const issuedAt = input.now.getTime();
  const payload = payloadSchema.parse({
    version: INVITE_RESUME_COOKIE_POLICY_V1.version,
    token: input.token,
    issuedAt,
    expiresAt: issuedAt + INVITE_RESUME_COOKIE_POLICY_V1.ttlMilliseconds,
  });
  const expires = new Date(payload.expiresAt);

  return Object.freeze({
    name: INVITE_RESUME_COOKIE_POLICY_V1.cookieName,
    value: sealPayload(payload, key),
    options: Object.freeze({
      httpOnly: true as const,
      secure: input.secure,
      sameSite: "lax" as const,
      path: INVITE_RESUME_COOKIE_POLICY_V1.path,
      expires,
      maxAge: INVITE_RESUME_COOKIE_POLICY_V1.ttlMilliseconds / 1_000,
    }),
  });
}

export function readInviteResumeToken(
  value: string | null | undefined,
  now: Date,
  key: InviteResumeKey,
): string | null {
  if (
    value == null ||
    value.length === 0 ||
    value.length > MAXIMUM_SEALED_VALUE_LENGTH ||
    !Number.isFinite(now.getTime())
  ) {
    return null;
  }

  const [version, encodedNonce, encodedCiphertext, encodedAuthTag, extra] =
    value.split(".");
  if (
    version !== "v1" ||
    !encodedNonce ||
    !encodedCiphertext ||
    !encodedAuthTag ||
    extra !== undefined
  ) {
    return null;
  }

  try {
    const nonce = decodeCanonicalBase64Url(encodedNonce);
    const ciphertext = decodeCanonicalBase64Url(encodedCiphertext);
    const authTag = decodeCanonicalBase64Url(encodedAuthTag);
    if (
      nonce === null ||
      ciphertext === null ||
      authTag === null ||
      nonce.length !== NONCE_BYTES ||
      ciphertext.length === 0 ||
      authTag.length !== AUTH_TAG_BYTES
    ) {
      return null;
    }

    const plaintext = key.withValue((secret) => {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        deriveEncryptionKey(secret),
        nonce,
      );
      decipher.setAAD(ADDITIONAL_AUTHENTICATED_DATA);
      decipher.setAuthTag(authTag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    });
    const parsed = payloadSchema.safeParse(JSON.parse(plaintext));
    if (!parsed.success) return null;

    const nowMilliseconds = now.getTime();
    if (
      parsed.data.issuedAt >
        nowMilliseconds + INVITE_RESUME_COOKIE_POLICY_V1.clockSkewMilliseconds ||
      parsed.data.expiresAt !==
        parsed.data.issuedAt + INVITE_RESUME_COOKIE_POLICY_V1.ttlMilliseconds ||
      nowMilliseconds >= parsed.data.expiresAt
    ) {
      return null;
    }
    return parsed.data.token;
  } catch {
    return null;
  }
}

export function writeInviteResumeCookie(
  cookies: InviteResumeCookieWriter,
  cookie: ReturnType<typeof createInviteResumeCookie>,
): void {
  cookies.set(cookie.name, cookie.value, cookie.options);
}

export function clearInviteResumeCookie(
  cookies: InviteResumeCookieWriter,
  secure: boolean,
): void {
  cookies.set(INVITE_RESUME_COOKIE_POLICY_V1.cookieName, "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: INVITE_RESUME_COOKIE_POLICY_V1.path,
    expires: new Date(0),
    maxAge: 0,
  });
}

function sealPayload(
  payload: InviteResumePayload,
  key: InviteResumeKey,
): string {
  return key.withValue((secret) => {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv(
      "aes-256-gcm",
      deriveEncryptionKey(secret),
      nonce,
    );
    cipher.setAAD(ADDITIONAL_AUTHENTICATED_DATA);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      "v1",
      nonce.toString("base64url"),
      ciphertext.toString("base64url"),
      authTag.toString("base64url"),
    ].join(".");
  });
}

function deriveEncryptionKey(secret: string): Buffer {
  const decoded = Buffer.from(secret, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== secret) {
    throw new TypeError("Invitation resume requires a valid encryption key.");
  }
  return createHash("sha256")
    .update("swisstalenthub-invite-resume-key-v1\0", "utf8")
    .update(decoded)
    .digest();
}

function decodeCanonicalBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  const decoded = Buffer.from(value, "base64url");
  return decoded.toString("base64url") === value ? decoded : null;
}
