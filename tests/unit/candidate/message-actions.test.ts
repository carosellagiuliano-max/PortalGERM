// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeRequestRateLimit: vi.fn(),
  database: {},
  getAuthRequestContext: vi.fn(),
  getDatabase: vi.fn(),
  getServerEnvironment: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
  revalidatePath: vi.fn(),
  requireCandidatePage: vi.fn(),
  sendCandidateMessage: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/rate-limit-runtime", () => ({
  consumeRequestRateLimit: mocks.consumeRequestRateLimit,
}));
vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: mocks.getAuthRequestContext,
  isValidAuthMutationOrigin: mocks.isValidAuthMutationOrigin,
}));
vi.mock("@/lib/auth/route-guards", () => ({
  requireCandidatePage: mocks.requireCandidatePage,
}));
vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: mocks.getServerEnvironment,
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/lib/candidate/messages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/candidate/messages")>();
  return { ...actual, sendCandidateMessage: mocks.sendCandidateMessage };
});

import { sendCandidateMessageAction } from "@/app/candidate/messages/actions";
import { INITIAL_CANDIDATE_MESSAGE_ACTION_STATE } from "@/lib/candidate/message-action-state";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";

describe("candidate message action", () => {
  beforeEach(() => {
    mocks.consumeRequestRateLimit.mockReset();
    mocks.getAuthRequestContext.mockReset();
    mocks.getDatabase.mockReset();
    mocks.getServerEnvironment.mockReset();
    mocks.isValidAuthMutationOrigin.mockReset();
    mocks.revalidatePath.mockReset();
    mocks.requireCandidatePage.mockReset();
    mocks.sendCandidateMessage.mockReset();
    mocks.getAuthRequestContext.mockResolvedValue({ sourceIp: "192.0.2.10" });
    mocks.requireCandidatePage.mockResolvedValue({ id: USER_ID });
    mocks.isValidAuthMutationOrigin.mockReturnValue(true);
    mocks.getDatabase.mockReturnValue(mocks.database);
    mocks.getServerEnvironment.mockReturnValue({ NODE_ENV: "test" });
    mocks.consumeRequestRateLimit.mockResolvedValue({ allowed: true, status: 200 });
    mocks.sendCandidateMessage.mockResolvedValue({
      ok: true,
      messageId: "33333333-3333-4333-8333-333333333333",
      duplicate: false,
    });
  });

  it("validates before consuming the abuse limit", async () => {
    const state = await sendCandidateMessageAction(
      INITIAL_CANDIDATE_MESSAGE_ACTION_STATE,
      messageForm({ body: "" }),
    );

    expect(state).toMatchObject({ status: "error" });
    expect(mocks.consumeRequestRateLimit).not.toHaveBeenCalled();
    expect(mocks.sendCandidateMessage).not.toHaveBeenCalled();
  });

  it("rate-limits valid messages and exposes success feedback", async () => {
    const formData = messageForm();
    const state = await sendCandidateMessageAction(
      INITIAL_CANDIDATE_MESSAGE_ACTION_STATE,
      formData,
    );

    expect(mocks.consumeRequestRateLimit).toHaveBeenCalledWith(
      "MESSAGE_SEND",
      { userId: USER_ID },
      { sourceIp: "192.0.2.10" },
      expect.any(Date),
      expect.objectContaining({ database: mocks.database }),
    );
    expect(mocks.sendCandidateMessage).toHaveBeenCalledWith(
      mocks.database,
      USER_ID,
      {
        conversationId: CONVERSATION_ID,
        body: "Sichere Nachricht",
        idempotencyKey: "message-action-0001",
      },
    );
    expect(state).toMatchObject({ status: "success", message: "Nachricht gesendet." });
    expect(state.nextIdempotencyKey).toMatch(/^[a-f0-9-]{36}$/u);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(3);
  });

  it("does not write when the rate limit is exhausted", async () => {
    mocks.consumeRequestRateLimit.mockResolvedValue({
      allowed: false,
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 60,
    });

    const state = await sendCandidateMessageAction(
      INITIAL_CANDIDATE_MESSAGE_ACTION_STATE,
      messageForm(),
    );

    expect(state).toMatchObject({ status: "error" });
    expect(mocks.sendCandidateMessage).not.toHaveBeenCalled();
  });

  it("reports the server-side Radar trust block without revalidating the thread", async () => {
    mocks.sendCandidateMessage.mockResolvedValue({
      ok: false,
      code: "TRUST_BLOCKED",
    });

    const state = await sendCandidateMessageAction(
      INITIAL_CANDIDATE_MESSAGE_ACTION_STATE,
      messageForm(),
    );

    expect(state).toEqual({
      status: "error",
      message:
        "Neue Nachrichten sind gesperrt, weil die Firma nicht aktiv und aktuell verifiziert ist. Bitte lade neu.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

function messageForm(overrides: Readonly<{ body?: string }> = {}): FormData {
  const formData = new FormData();
  formData.set("conversationId", CONVERSATION_ID);
  formData.set("idempotencyKey", "message-action-0001");
  formData.set("body", overrides.body ?? "Sichere Nachricht");
  return formData;
}
