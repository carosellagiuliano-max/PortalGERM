// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeRequestRateLimit: vi.fn(),
  createSupportCase: vi.fn(),
  database: {},
  getAuthRequestContext: vi.fn(),
  getCurrentUser: vi.fn(),
  getDatabase: vi.fn(),
  getRequesterSupportCase: vi.fn(),
  getServerEnvironment: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
  recordRateLimitDenial: vi.fn(),
  replyToSupportCase: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/admin/support", () => ({
  createSupportCase: mocks.createSupportCase,
  getRequesterSupportCase: mocks.getRequesterSupportCase,
  replyToSupportCase: mocks.replyToSupportCase,
}));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock("@/lib/auth/rate-limit-runtime", () => ({
  consumeRequestRateLimit: mocks.consumeRequestRateLimit,
}));
vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: mocks.getAuthRequestContext,
  isValidAuthMutationOrigin: mocks.isValidAuthMutationOrigin,
}));
vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: mocks.getServerEnvironment,
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/lib/security/rate-limit-audit", () => ({
  recordRateLimitDenial: mocks.recordRateLimitDenial,
}));

import { supportCaseAction } from "@/app/support/actions";
import { INITIAL_SUPPORT_ACTION_STATE } from "@/app/support/action-state";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";

describe("support action rate-limit boundaries", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => {
      if (typeof mock === "function" && "mockReset" in mock) mock.mockReset();
    });
    mocks.getCurrentUser.mockResolvedValue({
      id: USER_ID,
      status: "ACTIVE",
    });
    mocks.getAuthRequestContext.mockResolvedValue({
      correlationId: "33333333-3333-4333-8333-333333333333",
      sourceIp: "192.0.2.33",
    });
    mocks.isValidAuthMutationOrigin.mockReturnValue(true);
    mocks.getDatabase.mockReturnValue(mocks.database);
    mocks.getServerEnvironment.mockReturnValue({ APP_ENV: "ci" });
    mocks.getRequesterSupportCase.mockResolvedValue({ id: CASE_ID });
    mocks.consumeRequestRateLimit.mockResolvedValue({
      allowed: true,
      status: 200,
    });
    mocks.replyToSupportCase.mockResolvedValue({
      ok: true,
      replay: false,
      value: { caseId: CASE_ID },
    });
  });

  it("authorizes the case before consuming its target bucket", async () => {
    await supportCaseAction(INITIAL_SUPPORT_ACTION_STATE, replyForm());

    expect(
      mocks.getRequesterSupportCase.mock.invocationCallOrder[0]!,
    ).toBeLessThan(
      mocks.consumeRequestRateLimit.mock.invocationCallOrder[0]!,
    );
    expect(mocks.consumeRequestRateLimit).toHaveBeenCalledWith(
      "SUPPORT_CASE_REPLY",
      expect.objectContaining({
        actorId: USER_ID,
        targetId: CASE_ID,
        userId: USER_ID,
      }),
      expect.any(Object),
      expect.any(Date),
      expect.objectContaining({ database: mocks.database }),
    );
  });

  it("leaves domain state untouched when the authorized target is rate limited", async () => {
    mocks.consumeRequestRateLimit.mockResolvedValue({
      allowed: false,
      status: 429,
      code: "RATE_LIMITED",
      audit: {
        action: "RATE_LIMITED",
        preset: "SUPPORT_CASE_REPLY",
        scope: "ACTOR_OR_IP_TARGET",
      },
    });

    const state = await supportCaseAction(
      INITIAL_SUPPORT_ACTION_STATE,
      replyForm(),
    );

    expect(mocks.recordRateLimitDenial).toHaveBeenCalledOnce();
    expect(mocks.replyToSupportCase).not.toHaveBeenCalled();
    expect(state).toEqual({
      status: "error",
      message:
        "Zu viele Anfragen in kurzer Zeit. Bitte versuche es später erneut.",
    });
  });

  it("does not consume a target bucket or reveal whether a foreign case exists", async () => {
    mocks.getRequesterSupportCase.mockResolvedValue(null);

    const state = await supportCaseAction(
      INITIAL_SUPPORT_ACTION_STATE,
      replyForm(),
    );

    expect(mocks.consumeRequestRateLimit).not.toHaveBeenCalled();
    expect(mocks.replyToSupportCase).not.toHaveBeenCalled();
    expect(state).toEqual({
      status: "error",
      message: "Bitte prüfe deine Angaben.",
    });
  });
});

function replyForm() {
  const formData = new FormData();
  formData.set("operation", "reply");
  formData.set("caseId", CASE_ID);
  formData.set("message", "Bitte prüfen Sie meine Support-Anfrage erneut.");
  formData.set("idempotencyKey", "support-reply-phase33-01");
  return formData;
}
