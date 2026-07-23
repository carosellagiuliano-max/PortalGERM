// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createResolvedAbuseReport: vi.fn(),
  database: {},
  getAuthRequestContext: vi.fn(),
  getDatabase: vi.fn(),
  getEmployerContext: vi.fn(),
  getServerEnvironment: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
  resolveEmployerApplicantReportTarget: vi.fn(),
  revalidatePath: vi.fn(),
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
vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: mocks.getServerEnvironment,
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/lib/employer/applications", () => ({
  addEmployerApplicationNote: vi.fn(),
  draftEmployerApplicationText: vi.fn(),
  resolveEmployerApplicantReportTarget:
    mocks.resolveEmployerApplicantReportTarget,
  sendEmployerApplicationMessage: vi.fn(),
  transitionEmployerApplication: vi.fn(),
}));
vi.mock("@/lib/providers/ai", () => ({ aiProvider: { marker: "ai" } }));
vi.mock("@/lib/providers/email", () => ({
  emailProvider: { marker: "email" },
}));

import { reportEmployerApplicantAction } from "@/app/employer/applicants/actions";
import { INITIAL_EMPLOYER_ACTION_STATE } from "@/lib/employer/action-state";

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
    mocks.getServerEnvironment.mockReturnValue({ APP_ENV: "test" });
    mocks.resolveEmployerApplicantReportTarget.mockResolvedValue({
      userId: CANDIDATE_USER_ID,
      companyId: COMPANY_ID,
    });
    mocks.createResolvedAbuseReport.mockResolvedValue({
      ok: true,
      reportId: "77777777-7777-4777-8777-777777777777",
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
});

function validForm(): FormData {
  const formData = new FormData();
  formData.set("applicationId", APPLICATION_ID);
  formData.set("reasonCode", "MISLEADING");
  formData.set(
    "description",
    "Das Profil enthält widersprüchliche Angaben, die geprüft werden sollen.",
  );
  return formData;
}
