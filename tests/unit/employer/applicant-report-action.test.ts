// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createResolvedAbuseReport: vi.fn(),
  consumeRequestRateLimit: vi.fn(),
  database: {},
  getAuthRequestContext: vi.fn(),
  getDatabase: vi.fn(),
  getEmployerContext: vi.fn(),
  getServerEnvironment: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
  recordRateLimitDenial: vi.fn(),
  resolveEmployerApplicantReportTarget: vi.fn(),
  revalidatePath: vi.fn(),
  sendEmployerApplicationMessage: vi.fn(),
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
vi.mock("@/lib/auth/employer-context", () => ({
  getEmployerContext: mocks.getEmployerContext,
}));
vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: mocks.getAuthRequestContext,
  isValidAuthMutationOrigin: mocks.isValidAuthMutationOrigin,
}));
vi.mock("@/lib/auth/rate-limit-runtime", () => ({
  consumeRequestRateLimit: mocks.consumeRequestRateLimit,
}));
vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: mocks.getServerEnvironment,
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/lib/employer/applications", () => ({
  addEmployerApplicationNote: vi.fn(),
  draftEmployerApplicationText: vi.fn(),
  resolveEmployerApplicantReportTarget:
    mocks.resolveEmployerApplicantReportTarget,
  sendEmployerApplicationMessage: mocks.sendEmployerApplicationMessage,
  transitionEmployerApplication: vi.fn(),
}));
vi.mock("@/lib/providers/ai", () => ({
  resolveAiProvider: () => ({ marker: "ai" }),
}));
vi.mock("@/lib/providers/email", () => ({
  emailProvider: { marker: "email" },
}));
vi.mock("@/lib/security/rate-limit-audit", () => ({
  recordRateLimitDenial: mocks.recordRateLimitDenial,
}));

import {
  reportEmployerApplicantAction,
  sendEmployerMessageAction,
} from "@/app/employer/applicants/actions";
import { INITIAL_EMPLOYER_ACTION_STATE } from "@/lib/employer/action-state";
import { appendLocalPublicIntakePrivacyBinding } from "@/tests/fixtures/public-intake-privacy";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const MEMBERSHIP_ID = "22222222-2222-4222-8222-222222222222";
const COMPANY_ID = "33333333-3333-4333-8333-333333333333";
const APPLICATION_ID = "44444444-4444-4444-8444-444444444444";
const CANDIDATE_USER_ID = "55555555-5555-4555-8555-555555555555";

describe("employer applicant report action", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => {
      if (typeof mock === "function" && "mockReset" in mock) mock.mockReset();
    });
    mocks.getEmployerContext.mockResolvedValue({
      user: {
        id: USER_ID,
        role: "EMPLOYER",
        status: "ACTIVE",
      },
      current: {
        companyId: COMPANY_ID,
        membershipId: MEMBERSHIP_ID,
        membershipRole: "OWNER",
      },
    });
    mocks.getAuthRequestContext.mockResolvedValue({
      correlationId: "66666666-6666-4666-8666-666666666666",
      sourceIp: "192.0.2.66",
    });
    mocks.isValidAuthMutationOrigin.mockReturnValue(true);
    mocks.getDatabase.mockReturnValue(mocks.database);
    mocks.getServerEnvironment.mockReturnValue({ APP_ENV: "local" });
    mocks.resolveEmployerApplicantReportTarget.mockResolvedValue({
      userId: CANDIDATE_USER_ID,
      companyId: COMPANY_ID,
    });
    mocks.createResolvedAbuseReport.mockResolvedValue({
      ok: true,
      reportId: "77777777-7777-4777-8777-777777777777",
    });
    mocks.consumeRequestRateLimit.mockResolvedValue({
      allowed: true,
      status: 200,
    });
    mocks.sendEmployerApplicationMessage.mockResolvedValue({
      ok: true,
      duplicate: false,
    });
  });

  it("ignores a browser-supplied user id and reports only the scoped application target", async () => {
    const formData = validForm();
    formData.set("userId", "88888888-8888-4888-8888-888888888888");

    const state = await reportEmployerApplicantAction(
      INITIAL_EMPLOYER_ACTION_STATE,
      formData,
    );

    expect(mocks.resolveEmployerApplicantReportTarget).toHaveBeenCalledWith(
      APPLICATION_ID,
      {
        companyId: COMPANY_ID,
        membershipId: MEMBERSHIP_ID,
        userId: USER_ID,
        membershipRole: "OWNER",
      },
      mocks.database,
    );
    expect(mocks.createResolvedAbuseReport).toHaveBeenCalledWith(
      {
        reasonCode: "MISLEADING",
        description:
          "Das Profil enthält widersprüchliche Angaben, die geprüft werden sollen.",
      },
      {
        id: CANDIDATE_USER_ID,
        targetType: "USER",
        companyId: COMPANY_ID,
      },
      expect.objectContaining({
        currentUser: expect.objectContaining({ id: USER_ID }),
        database: mocks.database,
      }),
    );
    expect(state).toMatchObject({ status: "success" });
  });

  it("returns the same safe failure for a foreign or missing application", async () => {
    mocks.resolveEmployerApplicantReportTarget.mockResolvedValue(null);

    const state = await reportEmployerApplicantAction(
      INITIAL_EMPLOYER_ACTION_STATE,
      validForm(),
    );

    expect(state).toEqual({
      status: "error",
      message: "Die Meldung konnte nicht sicher erfasst werden.",
    });
    expect(mocks.createResolvedAbuseReport).not.toHaveBeenCalled();
  });

  it("authorizes the application before rate limiting and writes no message when denied", async () => {
    mocks.consumeRequestRateLimit.mockResolvedValue({
      allowed: false,
      status: 429,
      code: "RATE_LIMITED",
      audit: {
        action: "RATE_LIMITED",
        preset: "EMPLOYER_MESSAGE_SEND",
        scope: "ACTOR_OR_IP_TARGET",
      },
    });
    const formData = messageForm();

    const state = await sendEmployerMessageAction(
      INITIAL_EMPLOYER_ACTION_STATE,
      formData,
    );

    expect(
      mocks.resolveEmployerApplicantReportTarget.mock.invocationCallOrder[0]!,
    ).toBeLessThan(
      mocks.consumeRequestRateLimit.mock.invocationCallOrder[0]!,
    );
    expect(mocks.consumeRequestRateLimit).toHaveBeenCalledWith(
      "EMPLOYER_MESSAGE_SEND",
      expect.objectContaining({
        actorId: USER_ID,
        companyId: COMPANY_ID,
        targetId: APPLICATION_ID,
      }),
      expect.any(Object),
      expect.any(Date),
      expect.objectContaining({ database: mocks.database }),
    );
    expect(mocks.recordRateLimitDenial).toHaveBeenCalledOnce();
    expect(mocks.sendEmployerApplicationMessage).not.toHaveBeenCalled();
    expect(state).toEqual({
      status: "error",
      message:
        "Zu viele Nachrichten in kurzer Zeit. Bitte versuche es später erneut.",
    });
  });

  it("does not consume a target bucket for a foreign application", async () => {
    mocks.resolveEmployerApplicantReportTarget.mockResolvedValue(null);

    await sendEmployerMessageAction(
      INITIAL_EMPLOYER_ACTION_STATE,
      messageForm(),
    );

    expect(mocks.consumeRequestRateLimit).not.toHaveBeenCalled();
    expect(mocks.sendEmployerApplicationMessage).not.toHaveBeenCalled();
  });
});

function validForm(): FormData {
  const formData = new FormData();
  formData.set("applicationId", APPLICATION_ID);
  formData.set("reasonCode", "MISLEADING");
  formData.set(
    "description",
    "Das Profil enthält widersprüchliche Angaben, die geprüft werden sollen.",
  );
  return appendLocalPublicIntakePrivacyBinding(formData, "ABUSE_REPORT");
}

function messageForm(): FormData {
  const formData = new FormData();
  formData.set("applicationId", APPLICATION_ID);
  formData.set(
    "body",
    "Guten Tag, wir möchten den nächsten Schritt mit Ihnen besprechen.",
  );
  formData.set("idempotencyKey", "message-rate-limited-01");
  return formData;
}
