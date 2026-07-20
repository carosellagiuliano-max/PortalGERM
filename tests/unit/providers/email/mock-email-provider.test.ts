import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  LOCAL_MOCK_MAILBOX_TTL_MS,
  LocalMockMailbox,
  type LocalMockMailboxCaptureInput,
} from "@/lib/providers/email/local-mock-mailbox-core";
import {
  EmailLogIdempotencyConflictError,
  type LocalMockMailboxCapturePort,
  MockEmailInputError,
  MockEmailProvider,
  type EmailLogRepository,
  type MockEmailLogRecord,
} from "@/lib/providers/email/mock-email-provider";

const secret = Buffer.alloc(40, 23).toString("base64");
const authorization = `Bearer ${secret}`;

function createMemoryRepository() {
  const rows = new Map<string, MockEmailLogRecord>();
  const record = vi.fn<EmailLogRepository["record"]>(async (input) => {
    const id = input.id ?? `22222222-2222-4222-8222-${String(rows.size + 1).padStart(12, "0")}`;
    const existing = rows.get(id);
    if (existing !== undefined) {
      if (existing.providerReference !== input.providerReference) {
        throw new EmailLogIdempotencyConflictError();
      }
      return { id, created: false };
    }
    rows.set(id, input);
    return { id, created: true };
  });
  return { repository: { record } satisfies EmailLogRepository, rows, record };
}

function createMailbox() {
  const mailbox = new LocalMockMailbox({
    allowedOrigin: "http://127.0.0.1:3000",
    now: () => new Date("2026-07-20T10:00:00.000Z"),
    secret,
  });
  return {
    mailbox,
    validate: (input: LocalMockMailboxCaptureInput) => {
      mailbox.validate(input);
    },
    capture: (input: LocalMockMailboxCaptureInput) => {
      mailbox.capture(input);
    },
  };
}

describe("MockEmailProvider", () => {
  it("writes a truthful MOCK_RECORDED German template snapshot", async () => {
    const { repository, rows } = createMemoryRepository();
    const validate = vi.fn();
    const capture = vi.fn();
    const provider = new MockEmailProvider(repository, {
      mailbox: { validate, capture },
    });

    const result = await provider.send({
      to: "USER@Example.Test",
      templateKey: "registration_welcome",
      data: { firstName: "Mara", arbitraryPrivateField: "not-persisted" },
      subject: "Willkommen bei SwissTalentHub",
    });

    expect(result.logId).toMatch(/^22222222-/);
    expect(rows).toHaveLength(1);
    expect([...rows.values()][0]).toMatchObject({
      recipient: "user@example.test",
      purpose: "registration_welcome",
      templateKey: "registration_welcome",
      status: "MOCK_RECORDED",
      providerReference: expect.stringMatching(
        /^mock-email-v2:unscoped:[a-f0-9]{64}$/,
      ),
      payload: {
        schemaVersion: "1",
        deliveryStatus: "mock_recorded",
        externalDeliveryClaimed: false,
        subject: "Willkommen bei SwissTalentHub",
      },
    });
    expect(JSON.stringify([...rows.values()])).not.toContain(
      "arbitraryPrivateField",
    );
    expect(capture).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
  });

  it("redacts reset URL/token, dedupes its EmailLog and captures one raw envelope", async () => {
    const token = "reset-token-canary-that-must-never-persist";
    const resetUrl =
      `http://127.0.0.1:3000/reset-password?token=${token}`;
    const { repository, rows } = createMemoryRepository();
    const mailbox = createMailbox();
    const provider = new MockEmailProvider(repository, {
      mailbox: { validate: mailbox.validate, capture: mailbox.capture },
    });
    const input = {
      to: "candidate@example.test",
      templateKey: "password_reset_mock" as const,
      data: {
        idempotencyKey: "password-reset-version-42",
        resetUrl,
        token,
      },
      subject: "Passwort für SwissTalentHub zurücksetzen",
    };

    const [first, retry] = await Promise.all([
      provider.send(input),
      provider.send(input),
    ]);

    expect(retry.logId).toBe(first.logId);
    expect(rows).toHaveLength(1);
    const serializedRows = JSON.stringify([...rows.values()]);
    expect(serializedRows).not.toContain(resetUrl);
    expect(serializedRows).not.toContain(token);
    expect(serializedRows).not.toMatch(/https?:\/\//i);
    expect(serializedRows).toContain("MOCK_RECORDED");

    expect(mailbox.mailbox.consume("Bearer invalid")).toEqual({
      status: "unauthorized",
    });
    const outbound = mailbox.mailbox.consume(authorization);
    expect(outbound).toMatchObject({
      status: "delivered",
      envelope: { actionUrl: resetUrl, templateKey: "password_reset_mock" },
    });
    expect(mailbox.mailbox.consume(authorization)).toEqual({ status: "empty" });
  });

  it("dedupes an invitation version and gives a new version a new log identity", async () => {
    const { repository, rows } = createMemoryRepository();
    const provider = new MockEmailProvider(repository);
    const sendVersion = (version: string, token: string) =>
      provider.send({
        to: "recruiter@example.test",
        templateKey: "company_invitation",
        data: {
          companyName: "Beispiel AG",
          invitationVersion: version,
          invitationUrl: `http://127.0.0.1:3000/invitations/${token}`,
        },
        subject: "Einladung zu einem Unternehmen auf SwissTalentHub",
      });

    const firstToken = "first-raw-token-that-is-at-least-thirty-two-bytes";
    const secondToken = "second-raw-token-that-is-at-least-thirty-two-bytes";
    const first = await sendVersion("invitation-v1", firstToken);
    const retry = await sendVersion("invitation-v1", firstToken);
    const rotated = await sendVersion("invitation-v2", secondToken);

    expect(retry.logId).toBe(first.logId);
    expect(rotated.logId).not.toBe(first.logId);
    expect(rows).toHaveLength(2);
    expect(JSON.stringify([...rows.values()])).not.toContain("raw-token");
  });

  it("rejects changed raw content for one operation and never captures a second envelope", async () => {
    const { repository, rows } = createMemoryRepository();
    const mailbox = createMailbox();
    const provider = new MockEmailProvider(repository, {
      mailbox: { validate: mailbox.validate, capture: mailbox.capture },
    });
    const send = (token: string) => provider.send({
      to: "candidate@example.test",
      templateKey: "password_reset_mock",
      data: {
        idempotencyKey: "password-reset-version-conflict",
        resetUrl: `http://127.0.0.1:3000/reset-password?token=${token}`,
      },
      subject: "Passwort für SwissTalentHub zurücksetzen",
    });
    const firstToken = "first-reset-token-that-is-at-least-thirty-two-bytes";
    const changedToken = "changed-token-that-is-at-least-thirty-two-bytes";

    const first = await send(firstToken);
    const retry = await send(firstToken);
    await expect(send(changedToken)).rejects.toThrow(
      EmailLogIdempotencyConflictError,
    );

    expect(retry.logId).toBe(first.logId);
    expect(rows).toHaveLength(1);
    expect(mailbox.mailbox.consume(authorization)).toMatchObject({
      status: "delivered",
      envelope: { actionUrl: expect.stringContaining(firstToken) },
    });
    expect(mailbox.mailbox.consume(authorization)).toEqual({ status: "empty" });
  });

  it("validates a raw-link envelope before persistence", async () => {
    const { repository, rows, record } = createMemoryRepository();
    const mailbox = createMailbox();
    const provider = new MockEmailProvider(repository, {
      mailbox: { validate: mailbox.validate, capture: mailbox.capture },
    });

    await expect(provider.send({
      to: "candidate@example.test",
      templateKey: "password_reset_mock",
      data: {
        idempotencyKey: "password-reset-invalid-envelope",
        resetUrl:
          "https://evil.example/reset-password?token=valid-token-that-is-at-least-thirty-two-bytes",
      },
      subject: "Passwort für SwissTalentHub zurücksetzen",
    })).rejects.toThrow("action_url_invalid");

    expect(record).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it("retries an idempotent mailbox capture after a transient capture failure", async () => {
    const { repository, rows, record } = createMemoryRepository();
    const capture = vi
      .fn<LocalMockMailboxCapturePort["capture"]>()
      .mockRejectedValueOnce(new Error("transient capture failure"))
      .mockResolvedValueOnce(undefined);
    const provider = new MockEmailProvider(repository, {
      mailbox: { validate: vi.fn(), capture },
    });
    const input = {
      to: "candidate@example.test",
      templateKey: "password_reset_mock" as const,
      data: {
        idempotencyKey: "password-reset-capture-retry",
        resetUrl:
          "http://127.0.0.1:3000/reset-password?token=retry-token-that-is-at-least-thirty-two-bytes",
      },
      subject: "Passwort für SwissTalentHub zurücksetzen",
    };

    await expect(provider.send(input)).rejects.toThrow("transient capture failure");
    const retry = await provider.send(input);

    expect(retry.logId).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows).toHaveLength(1);
    expect(record).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("never revives a consumed raw link on a retry after its TTL", async () => {
    let nowMs = Date.parse("2026-07-20T10:00:00.000Z");
    const mailbox = new LocalMockMailbox({
      allowedOrigin: "http://127.0.0.1:3000",
      now: () => new Date(nowMs),
      secret,
    });
    const { repository, rows } = createMemoryRepository();
    const provider = new MockEmailProvider(repository, {
      mailbox: {
        validate: (input) => mailbox.validate(input),
        capture: (input) => {
          mailbox.capture(input);
        },
      },
    });
    const input = {
      to: "candidate@example.test",
      templateKey: "password_reset_mock" as const,
      data: {
        idempotencyKey: "password-reset-no-revival",
        resetUrl:
          "http://127.0.0.1:3000/reset-password?token=one-time-token-that-is-at-least-thirty-two-bytes",
      },
      subject: "Passwort für SwissTalentHub zurücksetzen",
    };

    await provider.send(input);
    expect(mailbox.consume(authorization)).toMatchObject({ status: "delivered" });
    nowMs += LOCAL_MOCK_MAILBOX_TTL_MS;
    await provider.send(input);

    expect(rows).toHaveLength(1);
    expect(mailbox.consume(authorization)).toEqual({ status: "empty" });
  });

  it("uses collision-safe framing for invitation version and idempotency tuples", async () => {
    const { repository } = createMemoryRepository();
    const provider = new MockEmailProvider(repository);
    const send = (
      invitationVersion: string,
      idempotencyKey: string,
      token: string,
    ) => provider.send({
      to: "recruiter@example.test",
      templateKey: "company_invitation",
      data: {
        idempotencyKey,
        invitationVersion,
        invitationUrl: `http://127.0.0.1:3000/invitations/${token}`,
      },
      subject: "Einladung zu einem Unternehmen auf SwissTalentHub",
    });

    const left = await send(
      "a",
      "b:c",
      "left-token-that-is-at-least-thirty-two-bytes",
    );
    const right = await send(
      "a:b",
      "c",
      "right-token-that-is-at-least-thirty-two-bytes",
    );

    expect(right.logId).not.toBe(left.logId);
  });

  it("requires stable operation keys for both raw-link templates", async () => {
    const { repository, rows } = createMemoryRepository();
    const provider = new MockEmailProvider(repository);

    await expect(
      provider.send({
        to: "candidate@example.test",
        templateKey: "password_reset_mock",
        data: {
          resetUrl:
            "http://127.0.0.1:3000/reset-password?token=valid-token-that-is-at-least-thirty-two-bytes",
        },
        subject: "Passwort für SwissTalentHub zurücksetzen",
      }),
    ).rejects.toThrow(MockEmailInputError);
    await expect(
      provider.send({
        to: "recruiter@example.test",
        templateKey: "company_invitation",
        data: {
          invitationUrl:
            "http://127.0.0.1:3000/invitations/valid-token-that-is-at-least-thirty-two-bytes",
        },
        subject: "Einladung zu einem Unternehmen auf SwissTalentHub",
      }),
    ).rejects.toThrow(MockEmailInputError);
    expect(rows).toHaveLength(0);
  });

  it("rejects a caller-supplied subject and errors without secret values", async () => {
    const canary = "subject-secret-canary-must-not-leak";
    const { repository, record } = createMemoryRepository();
    const provider = new MockEmailProvider(repository);

    try {
      await provider.send({
        to: "candidate@example.test",
        templateKey: "registration_welcome",
        data: { token: canary },
        subject: canary,
      });
      expect.unreachable("template subject mismatch must fail");
    } catch (error) {
      expect(error).toBeInstanceOf(MockEmailInputError);
      expect(String(error)).not.toContain(canary);
      expect(JSON.stringify(error)).not.toContain(canary);
    }
    expect(record).not.toHaveBeenCalled();
  });
});
