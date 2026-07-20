import { beforeEach, describe, expect, it, vi } from "vitest";

const { consumeLocalMockEmail } = vi.hoisted(() => ({
  consumeLocalMockEmail: vi.fn(),
}));

vi.mock("@/lib/providers/email/local-mock-mailbox", () => ({
  consumeLocalMockEmail,
}));

import { GET, HEAD, OPTIONS } from "@/app/dev/mailbox/route";

const request = (secret = "test-secret") =>
  new Request("http://127.0.0.1:3000/dev/mailbox", {
    headers: { Authorization: `Bearer ${secret}` },
  });

describe("GET /dev/mailbox", () => {
  beforeEach(() => {
    consumeLocalMockEmail.mockReset();
  });

  it.each(["closed", "unauthorized"])(
    "returns the same private 404 when %s",
    async (status) => {
      consumeLocalMockEmail.mockReturnValue({ status });

      const response = await GET(request());

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ status: "not_found" });
      expectPrivateHeaders(response);
    },
  );

  it("authenticates each empty read and never caches the response", async () => {
    consumeLocalMockEmail.mockReturnValue({ status: "empty" });

    const response = await GET(request("mailbox-secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ email: null });
    expect(consumeLocalMockEmail).toHaveBeenCalledOnce();
    expect(consumeLocalMockEmail).toHaveBeenCalledWith(
      "Bearer mailbox-secret",
    );
    expectPrivateHeaders(response);
  });

  it("returns one authenticated raw envelope with private headers", async () => {
    const envelope = Object.freeze({
      mailboxMessageId: "33333333-3333-4333-8333-333333333333",
      to: "candidate@example.test",
      templateKey: "password_reset_mock",
      subject: "Passwort für SwissTalentHub zurücksetzen",
      body: "Lokale Testnachricht",
      actionUrl: "http://127.0.0.1:3000/reset-password?token=raw",
      capturedAt: "2026-07-20T10:00:00.000Z",
      expiresAt: "2026-07-20T10:15:00.000Z",
    });
    consumeLocalMockEmail.mockReturnValue({ status: "delivered", envelope });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ email: envelope });
    expectPrivateHeaders(response);
  });

  it("does not derive consuming HEAD or route-advertising OPTIONS behavior", async () => {
    const [head, options] = await Promise.all([HEAD(), OPTIONS()]);

    expect(head.status).toBe(404);
    expect(options.status).toBe(404);
    expect(consumeLocalMockEmail).not.toHaveBeenCalled();
    expectPrivateHeaders(head);
    expectPrivateHeaders(options);
  });
});

function expectPrivateHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("x-robots-tag")).toBe(
    "noindex, nofollow, noarchive, nosnippet",
  );
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("vary")).toContain("Authorization");
}
