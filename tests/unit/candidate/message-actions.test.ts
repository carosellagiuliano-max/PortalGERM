// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeRequestRateLimit: vi.fn(),
  createResolvedAbuseReport: vi.fn(),
  database: {},
  getAuthRequestContext: vi.fn(),
  getDatabase: vi.fn(),
  getServerEnvironment: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
  recordRateLimitDenial: vi.fn(),
  revalidatePath: vi.fn(),
  requireCandidatePage: vi.fn(),
  resolveCandidateMessageReportTarget: vi.fn(),
  sendCandidateMessage: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/abuse/public-report", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/abuse/public-report")>();
  return {
    ...actual,
    createResolvedAbuseReport: mocks.createResolvedAbuseReport,
  };
});
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
  return {
    ...actual,
    resolveCandidateMessageReportTarget:
      mocks.resolveCandidateMessageReportTarget,
    sendCandidateMessage: mocks.sendCandidateMessage,
  };
});
vi.mock("@/lib/providers/email", () => ({ emailProvider: { marker: "email" } }));
vi.mock("@/lib/security/rate-limit-audit", () => ({
  recordRateLimitDenial: mocks.recordRateLimitDenial,
}));

import {
  reportCandidateMessageAction,
  sendCandidateMessageAction,
} from "@/app/candidate/messages/actions";
import { INITIAL_CANDIDATE_MESSAGE_ACTION_STATE } from "@/lib/candidate/message-action-state";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const MESSAGE_ID = "33333333-3333-4333-8333-333333333333";
const COMPANY_ID = "44444444-4444-4444-8444-444444444444";

describe("candidate message action", () => {
  beforeEach(() => {
    mocks.consumeRequestRateLimit.mockReset();
    mocks.createResolvedAbuseReport.mockReset();
    mocks.getAuthRequestContext.mockReset();
    mocks.getDatabase.mockReset();
    mocks.getServerEnvironment.mockReset();
    mocks.isValidAuthMutationOrigin.mockReset();
    mocks.revalidatePath.mockReset();
    mocks.requireCandidatePage.mockReset();
    mocks.resolveCandidateMessageReportTarget.mockReset();
    mocks.sendCandidateMessage.mockReset();
    mocks.getAuthRequestContext.mockResolvedValue({
      correlationId: "55555555-5555-4555-8555-555555555555",
      sourceIp: "192.0.2.10",
    });
    mocks.requireCandidatePage.mockResolvedValue({
      id: USER_ID,
      role: "CANDIDATE",
      status: "ACTIVE",
    });
    mocks.isValidAuthMutationOrigin.mockReturnValue(true);
    mocks.getDatabase.mockReturnValue(mocks.database);
    mocks.getServerEnvironment.mockReturnValue({ NODE_ENV: "test" });
    mocks.recordRateLimitDenial.mockResolvedValue({
      written: true,
      gated: false,
    });
    mocks.consumeRequestRateLimit.mockResolvedValue({ allowed: true, status: 200 });
    mocks.sendCandidateMessage.mockResolvedValue({
      ok: true,
      messageId: MESSAGE_ID,
      duplicate: false,
    });
    mocks.resolveCandidateMessageReportTarget.mockResolvedValue({
      id: MESSAGE_ID,
      conversationId: CONVERSATION_ID,
      companyId: COMPANY_ID,
    });
    mocks.createResolvedAbuseReport.mockResolvedValue({
      ok: true,
      reportId: "66666666-6666-4666-8666-666666666666",
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
      {
        correlationId: "55555555-5555-4555-8555-555555555555",
        sourceIp: "192.0.2.10",
      },
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
      audit: {
        action: "RATE_LIMITED",
        preset: "MESSAGE_SEND",
        scope: "USER",
      },
    });

    const state = await sendCandidateMessageAction(
      INITIAL_CANDIDATE_MESSAGE_ACTION_STATE,
      messageForm(),
    );

    expect(state).toMatchObject({ status: "error" });
    expect(mocks.recordRateLimitDenial).toHaveBeenCalledWith(
      {
        action: "RATE_LIMITED",
        preset: "MESSAGE_SEND",
        scope: "USER",
      },
      {
        actorKind: "USER",
        actorUserId: USER_ID,
        capability: "CANDIDATE_MESSAGE_SEND",
        targetId: CONVERSATION_ID,
        targetType: "CONVERSATION",
      },
      expect.objectContaining({
        database: mocks.database,
        request: expect.objectContaining({
          correlationId: "55555555-5555-4555-8555-555555555555",
        }),
      }),
    );
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

  it("reports only a server-resolved incoming message target", async () => {
    const formData = reportForm();
    formData.set("userId", "77777777-7777-4777-8777-777777777777");

    const state = await reportCandidateMessageAction(
      INITIAL_CANDIDATE_MESSAGE_ACTION_STATE,
      formData,
    );

    expect(mocks.resolveCandidateMessageReportTarget).toHaveBeenCalledWith(
      mocks.database,
      USER_ID,
      MESSAGE_ID,
    );
    expect(mocks.createResolvedAbuseReport).toHaveBeenCalledWith(
      {
        reasonCode: "SCAM_OR_FRAUD",
        description:
          "Diese Nachricht fordert verdächtige Zahlungen außerhalb der Plattform.",
      },
      {
        id: MESSAGE_ID,
        targetType: "MESSAGE",
        companyId: COMPANY_ID,
      },
      expect.objectContaining({
        currentUser: expect.objectContaining({ id: USER_ID }),
        database: mocks.database,
      }),
    );
    expect(state).toMatchObject({ status: "success" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      `/candidate/messages/${CONVERSATION_ID}`,
    );
  });

  it("uses the same generic failure for a foreign or missing message", async () => {
    mocks.resolveCandidateMessageReportTarget.mockResolvedValue(null);

    const state = await reportCandidateMessageAction(
      INITIAL_CANDIDATE_MESSAGE_ACTION_STATE,
      reportForm(),
    );

    expect(state).toEqual({
      status: "error",
      message: "Die Meldung konnte nicht sicher erfasst werden.",
    });
    expect(mocks.createResolvedAbuseReport).not.toHaveBeenCalled();
  });
});

function messageForm(overrides: Readonly<{ body?: string }> = {}): FormData {
  const formData = new FormData();
  formData.set("conversationId", CONVERSATION_ID);
  formData.set("idempotencyKey", "message-action-0001");
  formData.set("body", overrides.body ?? "Sichere Nachricht");
  return formData;
}

function reportForm(): FormData {
  const formData = new FormData();
  formData.set("messageId", MESSAGE_ID);
  formData.set("reasonCode", "SCAM_OR_FRAUD");
  formData.set(
    "description",
    "Diese Nachricht fordert verdächtige Zahlungen außerhalb der Plattform.",
  );
  return formData;
}
