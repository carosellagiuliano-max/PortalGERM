import "server-only";

import {
  createHash,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import type { EmailTemplateKey } from "@/lib/providers/email/email-provider";
import { normalizedEmailSchema } from "@/lib/validation/common";

export const LOCAL_MOCK_MAILBOX_TTL_MS = 15 * 60 * 1_000;

export type LocalMockMailboxTemplateKey = Extract<
  EmailTemplateKey,
  "password_reset_mock" | "company_invitation"
>;

export type LocalMockMailboxEnvelope = Readonly<{
  mailboxMessageId: string;
  to: string;
  templateKey: LocalMockMailboxTemplateKey;
  subject: string;
  body: string;
  actionUrl: string;
  capturedAt: string;
  expiresAt: string;
}>;

export type LocalMockMailboxCaptureInput = Readonly<{
  to: string;
  templateKey: LocalMockMailboxTemplateKey;
  subject: string;
  body: string;
  actionUrl: string;
}>;

export type LocalMockMailboxReadResult =
  | Readonly<{ status: "unauthorized" }>
  | Readonly<{ status: "empty" }>
  | Readonly<{
      status: "delivered";
      envelope: LocalMockMailboxEnvelope;
    }>;

type StoredEnvelope = Readonly<{
  dedupeDigest: string;
  envelope: LocalMockMailboxEnvelope;
  expiresAtMs: number;
}>;

type MailboxOptions = Readonly<{
  secret: string;
  allowedOrigin: string;
  now?: () => Date;
  createMessageId?: () => string;
}>;

export class LocalMockMailboxInputError extends Error {
  constructor(code: string) {
    super(`Local mock mailbox input rejected: ${code}`);
    this.name = "LocalMockMailboxInputError";
  }
}

/**
 * Ephemeral reset/invitation capture. It has no database dependency and exposes
 * no query/list API: every envelope read authenticates and consumes one item.
 */
export class LocalMockMailbox {
  readonly #allowedOrigin: string;
  readonly #createMessageId: () => string;
  readonly #now: () => Date;
  readonly #secretDigest: Buffer;
  readonly #envelopes = new Map<string, StoredEnvelope>();
  // A digest stays sealed for this process lifetime after consumption or
  // expiry. Otherwise a late retry could make the same raw link readable
  // again after its original fifteen-minute window.
  readonly #sealedDigests = new Set<string>();

  constructor(options: MailboxOptions) {
    this.#allowedOrigin = parseAllowedOrigin(options.allowedOrigin);
    this.#secretDigest = digestSecret(options.secret);
    this.#now = options.now ?? (() => new Date());
    this.#createMessageId = options.createMessageId ?? randomUUID;
  }

  validate(input: LocalMockMailboxCaptureInput): void {
    normalizeCaptureInput(input, this.#allowedOrigin);
  }

  capture(input: LocalMockMailboxCaptureInput): "recorded" | "duplicate" {
    const now = this.#now();
    assertValidDate(now);
    this.#purgeExpired(now.getTime());

    const normalized = normalizeCaptureInput(input, this.#allowedOrigin);
    const dedupeDigest = createHash("sha256")
      .update("local-mock-mailbox-envelope-v1\0", "utf8")
      .update(normalized.to, "utf8")
      .update("\0", "utf8")
      .update(normalized.templateKey, "utf8")
      .update("\0", "utf8")
      .update(normalized.actionUrl, "utf8")
      .digest("hex");

    if (
      this.#envelopes.has(dedupeDigest) ||
      this.#sealedDigests.has(dedupeDigest)
    ) {
      return "duplicate";
    }

    const expiresAtMs = now.getTime() + LOCAL_MOCK_MAILBOX_TTL_MS;
    const envelope = Object.freeze({
      mailboxMessageId: this.#createMessageId(),
      ...normalized,
      capturedAt: now.toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
    });
    this.#envelopes.set(
      dedupeDigest,
      Object.freeze({ dedupeDigest, envelope, expiresAtMs }),
    );
    return "recorded";
  }

  consume(authorizationHeader: string | null): LocalMockMailboxReadResult {
    if (!this.#isAuthorized(authorizationHeader)) {
      return Object.freeze({ status: "unauthorized" });
    }

    const now = this.#now();
    assertValidDate(now);
    const nowMs = now.getTime();
    this.#purgeExpired(nowMs);

    const next = [...this.#envelopes.values()].sort(
      (left, right) =>
        left.envelope.capturedAt.localeCompare(right.envelope.capturedAt) ||
        left.envelope.mailboxMessageId.localeCompare(
          right.envelope.mailboxMessageId,
        ),
    )[0];
    if (next === undefined) {
      return Object.freeze({ status: "empty" });
    }

    this.#envelopes.delete(next.dedupeDigest);
    this.#sealedDigests.add(next.dedupeDigest);
    return Object.freeze({ status: "delivered", envelope: next.envelope });
  }

  #isAuthorized(authorizationHeader: string | null) {
    const match = /^Bearer ([^\s]+)$/.exec(authorizationHeader ?? "");
    const suppliedDigest = createHash("sha256")
      .update(match?.[1] ?? "", "utf8")
      .digest();
    return (
      match !== null && timingSafeEqual(suppliedDigest, this.#secretDigest)
    );
  }

  #purgeExpired(nowMs: number) {
    for (const [key, stored] of this.#envelopes) {
      if (stored.expiresAtMs <= nowMs) {
        this.#envelopes.delete(key);
        this.#sealedDigests.add(key);
      }
    }
  }
}

function normalizeCaptureInput(
  input: LocalMockMailboxCaptureInput,
  allowedOrigin: string,
): Omit<LocalMockMailboxEnvelope, "mailboxMessageId" | "capturedAt" | "expiresAt"> {
  const recipient = normalizedEmailSchema.safeParse(input.to);
  if (!recipient.success) {
    throw new LocalMockMailboxInputError("recipient_invalid");
  }
  if (
    input.templateKey !== "password_reset_mock" &&
    input.templateKey !== "company_invitation"
  ) {
    throw new LocalMockMailboxInputError("template_not_allowed");
  }

  const subject = normalizeBoundedText(input.subject, 200, "subject_invalid");
  const body = normalizeBoundedText(input.body, 10_000, "body_invalid");
  const actionUrl = parseActionUrl(
    input.actionUrl,
    allowedOrigin,
    input.templateKey,
  );

  return Object.freeze({
    to: recipient.data,
    templateKey: input.templateKey,
    subject,
    body,
    actionUrl,
  });
}

function normalizeBoundedText(value: unknown, maximum: number, code: string) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximum
  ) {
    throw new LocalMockMailboxInputError(code);
  }
  return value;
}

function parseActionUrl(
  value: string,
  allowedOrigin: string,
  templateKey: LocalMockMailboxTemplateKey,
) {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new LocalMockMailboxInputError("action_url_invalid");
  }
  try {
    const url = new URL(value);
    if (
      url.origin !== allowedOrigin ||
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== ""
    ) {
      throw new LocalMockMailboxInputError("action_url_invalid");
    }
    if (templateKey === "password_reset_mock") {
      const fragment = new URLSearchParams(url.hash.replace(/^#/u, ""));
      const tokenValues = fragment.getAll("token");
      if (
        url.pathname !== "/reset-password" ||
        url.search !== "" ||
        [...fragment.keys()].length !== 1 ||
        tokenValues.length !== 1 ||
        !isPlausibleMailboxToken(tokenValues[0])
      ) {
        throw new LocalMockMailboxInputError("action_url_invalid");
      }
    } else if (url.hash !== "") {
      throw new LocalMockMailboxInputError("action_url_invalid");
    }
    return url.toString();
  } catch (error) {
    if (error instanceof LocalMockMailboxInputError) {
      throw error;
    }
    throw new LocalMockMailboxInputError("action_url_invalid");
  }
}

function isPlausibleMailboxToken(value: string | undefined): value is string {
  return (
    value !== undefined &&
    value.length >= 32 &&
    value.length <= 512 &&
    /^[A-Za-z0-9_-]+$/u.test(value)
  );
}

function parseAllowedOrigin(value: string) {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      throw new LocalMockMailboxInputError("origin_invalid");
    }
    return url.origin;
  } catch (error) {
    if (error instanceof LocalMockMailboxInputError) {
      throw error;
    }
    throw new LocalMockMailboxInputError("origin_invalid");
  }
}

function digestSecret(secret: string) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new LocalMockMailboxInputError("secret_invalid");
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

function assertValidDate(value: Date) {
  if (!Number.isFinite(value.getTime())) {
    throw new LocalMockMailboxInputError("clock_invalid");
  }
}
