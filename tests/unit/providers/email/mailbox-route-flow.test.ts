// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getServerEnvironment } = vi.hoisted(() => ({
  getServerEnvironment: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config/env", () => ({ getServerEnvironment }));

import { GET } from "@/app/dev/mailbox/route";
import {
  captureLocalMockEmail,
  validateLocalMockEmail,
} from "@/lib/providers/email/local-mock-mailbox";
import {
  EmailLogIdempotencyConflictError,
  MockEmailProvider,
  type EmailLogRepository,
  type MockEmailLogRecord,
} from "@/lib/providers/email/mock-email-provider";

const secret = Buffer.alloc(40, 37).toString("base64");

describe("non-production reset/invitation mailbox route flow", () => {
  beforeEach(() => {
    getServerEnvironment.mockReset();
    getServerEnvironment.mockReturnValue({
      APP_ENV: "local",
      NODE_ENV: "test",
      APP_URL: "http://127.0.0.1:3000",
      ENABLE_LOCAL_MOCK_MAILBOX: true,
      secrets: {
        localMailbox: {
          withValue: (consumer: (value: string) => unknown) => consumer(secret),
        },
      },
    });
    globalThis.swissTalentHubLocalMockMailbox = undefined;
  });

  it("captures reset and invitation links outside EmailLog and reads each once", async () => {
    const resetToken = "route-reset-token-that-is-at-least-thirty-two-bytes";
    const invitationToken =
      "route-invitation-token-that-is-at-least-thirty-two-bytes";
    const resetUrl =
      `http://127.0.0.1:3000/reset-password?token=${resetToken}`;
    const invitationUrl =
      `http://127.0.0.1:3000/invitations/${invitationToken}`;
    const { repository, rows } = createMemoryRepository();
    const provider = new MockEmailProvider(repository, {
      mailbox: {
        validate(input) {
          validateLocalMockEmail(input);
        },
        capture(input) {
          captureLocalMockEmail(input);
        },
      },
    });

    await provider.send({
      to: "candidate@example.test",
      templateKey: "password_reset_mock",
      data: { idempotencyKey: "route-reset-v1", resetUrl },
      subject: "Passwort für SwissTalentHub zurücksetzen",
    });
    await provider.send({
      to: "recruiter@example.test",
      templateKey: "company_invitation",
      data: {
        companyName: "Beispiel AG",
        invitationVersion: "route-invitation-v1",
        invitationUrl,
      },
      subject: "Einladung zu einem Unternehmen auf SwissTalentHub",
    });

    const persisted = JSON.stringify([...rows.values()]);
    expect(persisted).not.toContain(resetToken);
    expect(persisted).not.toContain(invitationToken);
    expect(persisted).not.toMatch(/https?:\/\//i);

    const denied = await GET(mailboxRequest("wrong-secret"));
    expect(denied.status).toBe(404);

    const first = await GET(mailboxRequest(secret));
    const second = await GET(mailboxRequest(secret));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const envelopes = [
      (await first.json()).email,
      (await second.json()).email,
    ];
    expect(new Set(envelopes.map(({ templateKey }) => templateKey))).toEqual(
      new Set(["password_reset_mock", "company_invitation"]),
    );
    expect(new Set(envelopes.map(({ actionUrl }) => actionUrl))).toEqual(
      new Set([resetUrl, invitationUrl]),
    );
    for (const envelope of envelopes) {
      expect(envelope).not.toHaveProperty("logId");
      expect(envelope).not.toHaveProperty("providerReference");
    }
    expect(first.headers.get("cache-control")).toContain("no-store");
    expect(first.headers.get("x-robots-tag")).toContain("noindex");

    const consumed = await GET(mailboxRequest(secret));
    expect(await consumed.json()).toEqual({ email: null });
    const missingSecret = await GET(
      new Request("http://127.0.0.1:3000/dev/mailbox"),
    );
    expect(missingSecret.status).toBe(404);
  });
});

function mailboxRequest(mailboxSecret: string) {
  return new Request("http://127.0.0.1:3000/dev/mailbox", {
    headers: { Authorization: `Bearer ${mailboxSecret}` },
  });
}

function createMemoryRepository() {
  const rows = new Map<string, MockEmailLogRecord>();
  const repository: EmailLogRepository = {
    async record(input) {
      const id = input.id ?? crypto.randomUUID();
      const existing = rows.get(id);
      if (existing !== undefined) {
        if (existing.providerReference !== input.providerReference) {
          throw new EmailLogIdempotencyConflictError();
        }
        return { id, created: false };
      }
      rows.set(id, input);
      return { id, created: true };
    },
  };
  return { repository, rows };
}
