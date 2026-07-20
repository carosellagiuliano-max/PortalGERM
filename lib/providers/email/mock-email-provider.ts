import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import {
  EMAIL_TEMPLATE_KEYS,
  type EmailProvider,
  type EmailTemplateKey,
} from "@/lib/providers/email/email-provider";
import type { LocalMockMailboxCaptureInput } from "@/lib/providers/email/local-mock-mailbox-core";
import { renderEmailTemplate } from "@/lib/providers/email/templates";
import { actionUrl } from "@/lib/providers/email/templates/_shared";
import { normalizedEmailSchema } from "@/lib/validation/common";

const emailInputSchema = z.strictObject({
  to: normalizedEmailSchema,
  templateKey: z.enum(EMAIL_TEMPLATE_KEYS),
  data: z.record(z.string(), z.unknown()),
  subject: z.string().trim().min(1).max(200),
});

const OPERATION_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SENSITIVE_KEY =
  /(token|url|uri|link|password|passphrase|secret|credential|authorization|cookie)/i;
const ABSOLUTE_URL_TEST = /https?:\/\/[^\s]+/iu;
const ABSOLUTE_URL_REPLACE = /https?:\/\/[^\s]+/giu;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]+/g;
const MINIMUM_RAW_TOKEN_LENGTH = 32;
const MAXIMUM_RAW_TOKEN_LENGTH = 512;

const PERSISTED_TEMPLATE_DATA_KEYS = {
  abuse_report_received: ["categoryLabel"],
  application_status_changed: ["jobTitle", "statusLabel"],
  application_submitted: ["jobTitle", "companyName"],
  company_invitation: ["companyName"],
  company_verification_status: ["companyName", "statusLabel"],
  credits_expiring: ["creditCount", "expiryDate"],
  credits_granted: ["creditCount", "creditTypeLabel"],
  demo_request_received: ["companyName"],
  employer_message_received: ["companyName", "jobTitle"],
  identity_revealed: ["companyName"],
  invoice_issued: ["invoiceNumber"],
  job_alert_digest_mock: ["alertName", "jobCount"],
  job_alert_preview: ["alertName", "jobCount"],
  job_approved: ["jobTitle"],
  job_boost_activated: ["jobTitle"],
  job_boost_expired: ["jobTitle"],
  job_rejected: ["jobTitle"],
  lead_follow_up_reminder: ["companyName"],
  password_reset_mock: ["expiresInMinutes"],
  payment_received: ["orderReference"],
  plan_limit_reached: ["featureName"],
  privacy_request_changed: ["statusLabel"],
  registration_welcome: [],
  subscription_activated: ["planName"],
  subscription_renewal_reminder: ["planName", "renewalDate"],
  talent_contact_request_received: ["companyName"],
  talent_radar_credits_low: ["remainingCredits"],
  usage_warning: ["featureName", "used", "limit"],
} as const satisfies Record<EmailTemplateKey, readonly string[]>;

export type MockEmailLogRecord = Readonly<{
  id?: string;
  recipient: string;
  purpose: string;
  templateKey: EmailTemplateKey;
  payload: Readonly<{
    schemaVersion: "1";
    deliveryStatus: "mock_recorded";
    externalDeliveryClaimed: false;
    subject: string;
    body: string;
  }>;
  status: "MOCK_RECORDED";
  providerReference: string;
}>;

export interface EmailLogRepository {
  record(input: MockEmailLogRecord): Promise<{ id: string; created: boolean }>;
}

export interface LocalMockMailboxCapturePort {
  /** Validate the complete envelope before EmailLog persistence. */
  validate(input: LocalMockMailboxCaptureInput): void | Promise<void>;
  /** Idempotent capture; identical retries must not create another envelope. */
  capture(input: LocalMockMailboxCaptureInput): void | Promise<void>;
}

export class MockEmailInputError extends Error {
  readonly issueCodes: readonly string[];

  constructor(issueCodes: readonly string[]) {
    super(`Mock email input rejected: ${issueCodes.join(",")}`);
    this.name = "MockEmailInputError";
    this.issueCodes = Object.freeze([...issueCodes]);
  }
}

export class EmailLogIdempotencyConflictError extends Error {
  constructor() {
    super("Mock email idempotency identity was reused with different content.");
    this.name = "EmailLogIdempotencyConflictError";
  }
}

/**
 * Truthful local adapter: records a redacted EmailLog and, for reset/invite
 * only, optionally forwards the raw one-time link to the ephemeral mailbox.
 * Token hash lifecycle, rotation and revocation stay in the owning Phase-06/10
 * domain transaction; this adapter never persists or revives a raw token.
 */
export class MockEmailProvider implements EmailProvider {
  readonly #repository: EmailLogRepository;
  readonly #mailbox?: LocalMockMailboxCapturePort;

  constructor(
    repository: EmailLogRepository,
    options: Readonly<{ mailbox?: LocalMockMailboxCapturePort }> = {},
  ) {
    this.#repository = repository;
    this.#mailbox = options.mailbox;
  }

  async send(input: {
    to: string;
    templateKey: EmailTemplateKey;
    data: Record<string, unknown>;
    subject: string;
  }): Promise<{ logId: string }> {
    const parsed = emailInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new MockEmailInputError(
        parsed.error.issues.map((issue) =>
          `${issue.path.join(".") || "input"}:${issue.code}`
        ),
      );
    }

    const { to, templateKey, data } = parsed.data;
    const outbound = renderEmailTemplate(templateKey, data);
    if (parsed.data.subject !== outbound.subject) {
      throw new MockEmailInputError(["subject:template_mismatch"]);
    }

    const action = getSensitiveAction(templateKey, data);
    const operationParts = resolveOperationParts(templateKey, data);
    const operation = operationParts === undefined
      ? undefined
      : buildOperationIdentity(to, templateKey, operationParts);
    const sensitiveValues = collectSensitiveValues(data, action);
    const persisted = renderEmailTemplate(
      templateKey,
      buildRedactedTemplateData(templateKey, data, sensitiveValues),
    );
    const payload = Object.freeze({
      schemaVersion: "1" as const,
      deliveryStatus: "mock_recorded" as const,
      externalDeliveryClaimed: false as const,
      subject: redactPersistedText(persisted.subject, sensitiveValues),
      body: redactPersistedText(persisted.body, sensitiveValues),
    });
    assertPersistenceIsRedacted(payload, sensitiveValues);

    const messageFingerprint = buildMessageFingerprint(
      to,
      templateKey,
      outbound.subject,
      outbound.body,
    );
    const mailboxEnvelope = action === undefined || this.#mailbox === undefined
      ? undefined
      : Object.freeze({
          to,
          templateKey: action.templateKey,
          subject: outbound.subject,
          body: outbound.body,
          actionUrl: action.url,
        });
    if (mailboxEnvelope !== undefined) {
      await this.#mailbox?.validate(mailboxEnvelope);
    }

    const providerReference = operation === undefined
      ? `mock-email-v2:unscoped:${messageFingerprint}`
      : `mock-email-v2:${operation.digest}:${messageFingerprint}`;
    const row = await this.#repository.record(Object.freeze({
      ...(operation === undefined ? {} : { id: operation.id }),
      recipient: to,
      purpose: templateKey,
      templateKey,
      payload,
      status: "MOCK_RECORDED" as const,
      providerReference,
    }));

    if (mailboxEnvelope !== undefined) {
      // Capture is intentionally retried even when the EmailLog already exists.
      // This heals a prior process-local capture failure while the mailbox's
      // idempotency prevents a duplicate envelope on ordinary retries.
      await this.#mailbox?.capture(mailboxEnvelope);
    }

    return Object.freeze({ logId: row.id });
  }
}

type SensitiveAction = Readonly<{
  templateKey: "password_reset_mock" | "company_invitation";
  url: string;
  taints: readonly string[];
}>;

function getSensitiveAction(
  templateKey: EmailTemplateKey,
  data: Readonly<Record<string, unknown>>,
): SensitiveAction | undefined {
  if (templateKey === "password_reset_mock") {
    return parseSensitiveAction(templateKey, data, "resetUrl", true);
  }
  if (templateKey === "company_invitation") {
    return parseSensitiveAction(templateKey, data, "invitationUrl", false);
  }
  return undefined;
}

function parseSensitiveAction(
  templateKey: SensitiveAction["templateKey"],
  data: Readonly<Record<string, unknown>>,
  dataKey: "resetUrl" | "invitationUrl",
  requireQueryToken: boolean,
): SensitiveAction {
  const value = actionUrl(data, dataKey);
  if (value === undefined) {
    throw new MockEmailInputError([`data.${dataKey}:invalid`]);
  }

  const url = new URL(value);
  if (url.hash !== "") {
    throw new MockEmailInputError([`data.${dataKey}:invalid`]);
  }
  const pathSegments = url.pathname
    .split("/")
    .filter(Boolean)
    .map(safeDecodeURIComponent);
  const queryToken = url.searchParams.get("token") ?? undefined;
  const pathToken = pathSegments.at(-1);
  const rawToken = requireQueryToken ? queryToken : queryToken ?? pathToken;
  if (!isPlausibleRawToken(rawToken)) {
    throw new MockEmailInputError([`data.${dataKey}:token_invalid`]);
  }

  const queryValues = [...url.searchParams.values()];
  const taints = uniqueSensitiveValues([
    value,
    rawToken,
    encodeURIComponent(rawToken),
    ...pathSegments,
    ...queryValues,
  ]);
  return Object.freeze({ templateKey, url: value, taints });
}

function resolveOperationParts(
  templateKey: EmailTemplateKey,
  data: Readonly<Record<string, unknown>>,
) {
  const idempotencyKey = parseOperationKey(data.idempotencyKey);
  const invitationVersion = parseOperationKey(data.invitationVersion);
  if (
    (data.idempotencyKey !== undefined && idempotencyKey === undefined) ||
    (data.invitationVersion !== undefined && invitationVersion === undefined)
  ) {
    throw new MockEmailInputError(["data.operationKey:invalid"]);
  }
  if (
    (templateKey === "password_reset_mock" && idempotencyKey === undefined) ||
    (templateKey === "company_invitation" &&
      idempotencyKey === undefined &&
      invitationVersion === undefined)
  ) {
    throw new MockEmailInputError(["data.operationKey:required"]);
  }
  if (idempotencyKey === undefined && invitationVersion === undefined) {
    return undefined;
  }
  return Object.freeze({ idempotencyKey, invitationVersion });
}

function parseOperationKey(value: unknown) {
  return typeof value === "string" && OPERATION_KEY.test(value)
    ? value
    : undefined;
}

function buildOperationIdentity(
  recipient: string,
  templateKey: EmailTemplateKey,
  parts: Readonly<{
    idempotencyKey?: string;
    invitationVersion?: string;
  }>,
) {
  const digest = digestLengthPrefixed("mock-email-operation-v2", [
    recipient,
    templateKey,
    parts.invitationVersion ?? "",
    parts.idempotencyKey ?? "",
  ]);
  const uuidHex = `${digest.slice(0, 12)}4${digest.slice(13, 16)}a${digest.slice(17, 32)}`;
  return Object.freeze({
    id: [
      uuidHex.slice(0, 8),
      uuidHex.slice(8, 12),
      uuidHex.slice(12, 16),
      uuidHex.slice(16, 20),
      uuidHex.slice(20, 32),
    ].join("-"),
    digest,
  });
}

function buildMessageFingerprint(
  recipient: string,
  templateKey: EmailTemplateKey,
  subject: string,
  body: string,
) {
  return digestLengthPrefixed("mock-email-message-v1", [
    recipient,
    templateKey,
    subject,
    body,
  ]);
}

function digestLengthPrefixed(domain: string, values: readonly string[]) {
  const hash = createHash("sha256");
  updateLengthPrefixed(hash, domain);
  for (const value of values) {
    updateLengthPrefixed(hash, value);
  }
  return hash.digest("hex");
}

function updateLengthPrefixed(
  hash: ReturnType<typeof createHash>,
  value: string,
) {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length);
  hash.update(length);
  hash.update(bytes);
}

function buildRedactedTemplateData(
  templateKey: EmailTemplateKey,
  data: Readonly<Record<string, unknown>>,
  sensitiveValues: readonly string[],
) {
  const result: Record<string, unknown> = {};
  for (const key of PERSISTED_TEMPLATE_DATA_KEYS[templateKey]) {
    const value = data[key];
    if (typeof value === "string") {
      result[key] = redactPersistedText(value, sensitiveValues);
    } else if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      result[key] = value;
    }
  }
  return Object.freeze(result);
}

function collectSensitiveValues(
  data: Readonly<Record<string, unknown>>,
  action: SensitiveAction | undefined,
) {
  const keyedValues = Object.entries(data)
    .filter(([key, value]) => SENSITIVE_KEY.test(key) && typeof value === "string")
    .map(([, value]) => value as string)
    .filter((value) => value.length >= 8);
  return uniqueSensitiveValues([
    ...keyedValues,
    ...(action?.taints ?? []),
  ]);
}

function uniqueSensitiveValues(values: readonly string[]) {
  return [...new Set(values.filter((value) => value.length >= 4))]
    .sort((left, right) => right.length - left.length);
}

function redactPersistedText(value: string, sensitiveValues: readonly string[]) {
  let redacted = value.replace(CONTROL_CHARACTERS, " ");
  for (const sensitive of sensitiveValues) {
    redacted = redacted.split(sensitive).join("[geschützt]");
  }
  return redacted.replace(ABSOLUTE_URL_REPLACE, "[geschützter Link]");
}

function assertPersistenceIsRedacted(
  payload: MockEmailLogRecord["payload"],
  sensitiveValues: readonly string[],
) {
  const serialized = JSON.stringify(payload);
  if (ABSOLUTE_URL_TEST.test(serialized)) {
    throw new MockEmailInputError(["payload:url_redaction_failed"]);
  }
  if (sensitiveValues.some((value) => serialized.includes(value))) {
    throw new MockEmailInputError(["payload:secret_redaction_failed"]);
  }
}

function isPlausibleRawToken(value: string | undefined): value is string {
  return (
    value !== undefined &&
    value.length >= MINIMUM_RAW_TOKEN_LENGTH &&
    value.length <= MAXIMUM_RAW_TOKEN_LENGTH &&
    !/[\s\u0000-\u001f\u007f]/u.test(value)
  );
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
