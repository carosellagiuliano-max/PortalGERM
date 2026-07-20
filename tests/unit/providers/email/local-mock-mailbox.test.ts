import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  LOCAL_MOCK_MAILBOX_TTL_MS,
  LocalMockMailbox,
  LocalMockMailboxInputError,
  type LocalMockMailboxCaptureInput,
} from "@/lib/providers/email/local-mock-mailbox-core";

const secret = Buffer.alloc(40, 19).toString("base64");
const authorization = `Bearer ${secret}`;
const baseInput = Object.freeze({
  to: "candidate@example.test",
  templateKey: "password_reset_mock",
  subject: "Passwort für SwissTalentHub zurücksetzen",
  body: "Öffne http://127.0.0.1:3000/reset-password#token=raw-reset-token-that-is-at-least-thirty-two-bytes",
  actionUrl:
    "http://127.0.0.1:3000/reset-password#token=raw-reset-token-that-is-at-least-thirty-two-bytes",
} satisfies LocalMockMailboxCaptureInput);

describe("process-local mock mailbox", () => {
  it("authenticates every read, captures once and consumes exactly once", () => {
    let now = new Date("2026-07-20T10:00:00.000Z");
    const mailbox = new LocalMockMailbox({
      allowedOrigin: "http://127.0.0.1:3000",
      createMessageId: () => "11111111-1111-4111-8111-111111111111",
      now: () => now,
      secret,
    });

    expect(mailbox.capture(baseInput)).toBe("recorded");
    expect(mailbox.capture(baseInput)).toBe("duplicate");
    expect(mailbox.consume("Bearer wrong-secret")).toEqual({
      status: "unauthorized",
    });

    const first = mailbox.consume(authorization);
    expect(first).toMatchObject({
      status: "delivered",
      envelope: {
        mailboxMessageId: "11111111-1111-4111-8111-111111111111",
        actionUrl: baseInput.actionUrl,
        capturedAt: "2026-07-20T10:00:00.000Z",
        expiresAt: "2026-07-20T10:15:00.000Z",
      },
    });
    expect(mailbox.consume(authorization)).toEqual({ status: "empty" });
    expect(mailbox.consume(null)).toEqual({ status: "unauthorized" });

    now = new Date(now.getTime() + 1_000);
    expect(mailbox.capture(baseInput)).toBe("duplicate");
  });

  it("expires without disclosure at the exact fifteen-minute boundary", () => {
    let nowMs = Date.parse("2026-07-20T10:00:00.000Z");
    const mailbox = new LocalMockMailbox({
      allowedOrigin: "http://127.0.0.1:3000",
      now: () => new Date(nowMs),
      secret,
    });
    mailbox.capture(baseInput);

    nowMs += LOCAL_MOCK_MAILBOX_TTL_MS;
    expect(mailbox.consume(authorization)).toEqual({ status: "empty" });
    expect(mailbox.capture(baseInput)).toBe("duplicate");
    expect(mailbox.consume(authorization)).toEqual({ status: "empty" });
  });

  it("is empty after a new process-local instance is created", () => {
    const first = new LocalMockMailbox({
      allowedOrigin: "http://127.0.0.1:3000",
      secret,
    });
    first.capture(baseInput);

    const restarted = new LocalMockMailbox({
      allowedOrigin: "http://127.0.0.1:3000",
      secret,
    });
    expect(restarted.consume(authorization)).toEqual({ status: "empty" });
  });

  it("rejects external, credential-bearing and unsupported envelopes", () => {
    const mailbox = new LocalMockMailbox({
      allowedOrigin: "http://127.0.0.1:3000",
      secret,
    });

    for (const actionUrl of [
      "https://attacker.example/reset?token=secret",
      "http://user:pass@127.0.0.1:3000/reset?token=secret",
      "http://127.0.0.1:3000/reset-password?token=query-token-that-is-at-least-thirty-two-bytes",
    ]) {
      expect(() => mailbox.capture({ ...baseInput, actionUrl })).toThrow(
        LocalMockMailboxInputError,
      );
    }

    expect(() =>
      mailbox.capture({
        ...baseInput,
        templateKey: "registration_welcome",
      } as unknown as LocalMockMailboxCaptureInput),
    ).toThrow(LocalMockMailboxInputError);
  });
});
