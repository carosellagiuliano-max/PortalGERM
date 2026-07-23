// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeRequestRateLimit: vi.fn(),
  createPublicReport: vi.fn(),
  database: {
    application: {
      findFirst: vi.fn(),
    },
  },
  environment: { APP_ENV: "local" },
  getAuthRequestContext: vi.fn(),
  getCurrentUser: vi.fn(),
  getDatabase: vi.fn(),
  getServerEnvironment: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
  publicReportInputSafeParse: vi.fn(),
  recordRateLimitDenial: vi.fn(),
  revalidatePath: vi.fn(),
  updateCandidateApplicationNote: vi.fn(),
  withdrawCandidateApplication: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/abuse/public-report", () => ({
  createPublicReport: mocks.createPublicReport,
  publicReportInputSchema: { safeParse: mocks.publicReportInputSafeParse },
}));
vi.mock("@/lib/applications/candidate-commands", () => ({
  updateCandidateApplicationNote: mocks.updateCandidateApplicationNote,
  withdrawCandidateApplication: mocks.withdrawCandidateApplication,
}));
vi.mock("@/lib/applications/service", () => ({ applyToJob: vi.fn() }));
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
vi.mock("@/lib/providers/email", () => ({ emailProvider: {} }));
vi.mock("@/lib/security/rate-limit-audit", () => ({
  recordRateLimitDenial: mocks.recordRateLimitDenial,
}));

import {
  reportApplicationEmployerAction,
  updateCandidateApplicationNoteAction,
  withdrawCandidateApplicationAction,
} from "@/app/candidate/applications/actions";
import { INITIAL_APPLICATION_ACTION_STATE } from "@/lib/applications/action-state";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const APPLICATION_ID = "22222222-2222-4222-8222-222222222222";
const COMPANY_ID = "44444444-4444-4444-8444-444444444444";
const currentUser = Object.freeze({ id: USER_ID, role: "CANDIDATE" });
const request = Object.freeze({
  correlationId: "33333333-3333-4333-8333-333333333333",
  expectedOrigin: "http://localhost:3000",
  origin: "http://localhost:3000",
  production: false,
  sourceIp: "192.0.2.42",
  userAgent: "application-action-test",
});

describe("candidate application mutation actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(currentUser);
    mocks.getAuthRequestContext.mockResolvedValue(request);
    mocks.isValidAuthMutationOrigin.mockReturnValue(true);
    mocks.getDatabase.mockReturnValue(mocks.database);
    mocks.getServerEnvironment.mockReturnValue(mocks.environment);
    mocks.consumeRequestRateLimit.mockResolvedValue({ allowed: true, status: 200 });
    mocks.database.application.findFirst.mockResolvedValue({
      job: {
        company: {
          id: COMPANY_ID,
          slug: "reported-company",
        },
      },
    });
    mocks.publicReportInputSafeParse.mockImplementation((data) => ({
      success: true,
      data,
    }));
    mocks.createPublicReport.mockResolvedValue({
      ok: true,
      reportId: "55555555-5555-4555-8555-555555555555",
    });
    mocks.recordRateLimitDenial.mockResolvedValue({
      written: true,
      gated: false,
    });
    mocks.updateCandidateApplicationNote.mockResolvedValue({
      ok: true,
      applicationId: APPLICATION_ID,
      duplicate: false,
    });
    mocks.withdrawCandidateApplication.mockResolvedValue({
      ok: true,
      applicationId: APPLICATION_ID,
      duplicate: false,
    });
  });

  it("validates a candidate note before consuming the shared rate limit", async () => {
    const state = await updateCandidateApplicationNoteAction(
      INITIAL_APPLICATION_ACTION_STATE,
      noteForm({ body: "" }),
    );

    expect(state).toMatchObject({ status: "error" });
    expect(mocks.consumeRequestRateLimit).not.toHaveBeenCalled();
    expect(mocks.updateCandidateApplicationNote).not.toHaveBeenCalled();
  });

  it("rate-limits and forwards a valid note with the authenticated request context", async () => {
    const state = await updateCandidateApplicationNoteAction(
      INITIAL_APPLICATION_ACTION_STATE,
      noteForm(),
    );

    expect(mocks.consumeRequestRateLimit).toHaveBeenCalledWith(
      "APPLICATION_CANDIDATE_MUTATION",
      { userId: USER_ID },
      request,
      expect.any(Date),
      { database: mocks.database, environment: mocks.environment },
    );
    expect(mocks.updateCandidateApplicationNote).toHaveBeenCalledWith(
      {
        applicationId: APPLICATION_ID,
        body: "Nur für mich sichtbar",
        idempotencyKey: "note-action-0001",
      },
      expect.objectContaining({
        currentUser,
        request,
        database: mocks.database,
        environment: mocks.environment,
      }),
    );
    expect(state).toMatchObject({ status: "success" });
  });

  it("rate-limits and forwards a confirmed withdrawal", async () => {
    const state = await withdrawCandidateApplicationAction(
      INITIAL_APPLICATION_ACTION_STATE,
      withdrawForm(),
    );

    expect(mocks.consumeRequestRateLimit).toHaveBeenCalledWith(
      "APPLICATION_CANDIDATE_MUTATION",
      { userId: USER_ID },
      request,
      expect.any(Date),
      { database: mocks.database, environment: mocks.environment },
    );
    expect(mocks.withdrawCandidateApplication).toHaveBeenCalledWith(
      {
        applicationId: APPLICATION_ID,
        confirmed: true,
        idempotencyKey: "withdraw-action-0001",
      },
      expect.objectContaining({ request }),
    );
    expect(state).toMatchObject({ status: "success" });
  });

  it("does not execute either command after the shared limit is exhausted", async () => {
    mocks.consumeRequestRateLimit.mockResolvedValue({
      allowed: false,
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 60,
      audit: {
        action: "RATE_LIMITED",
        preset: "APPLICATION_CANDIDATE_MUTATION",
        scope: "USER",
      },
    });

    const noteState = await updateCandidateApplicationNoteAction(
      INITIAL_APPLICATION_ACTION_STATE,
      noteForm(),
    );
    const withdrawState = await withdrawCandidateApplicationAction(
      INITIAL_APPLICATION_ACTION_STATE,
      withdrawForm(),
    );

    expect(noteState).toMatchObject({ status: "error" });
    expect(withdrawState).toMatchObject({ status: "error" });
    expect(mocks.recordRateLimitDenial).toHaveBeenCalledTimes(2);
    expect(mocks.recordRateLimitDenial).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        preset: "APPLICATION_CANDIDATE_MUTATION",
        scope: "USER",
      }),
      {
        actorKind: "USER",
        actorUserId: USER_ID,
        capability: "CANDIDATE_APPLICATION_MUTATE",
        targetId: APPLICATION_ID,
        targetType: "APPLICATION",
      },
      expect.objectContaining({
        database: mocks.database,
        environment: mocks.environment,
        request,
      }),
    );
    expect(mocks.recordRateLimitDenial).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        preset: "APPLICATION_CANDIDATE_MUTATION",
        scope: "USER",
      }),
      expect.objectContaining({
        targetId: APPLICATION_ID,
        targetType: "APPLICATION",
      }),
      expect.objectContaining({ request }),
    );
    expect(mocks.updateCandidateApplicationNote).not.toHaveBeenCalled();
    expect(mocks.withdrawCandidateApplication).not.toHaveBeenCalled();
  });

  it("records a gated denial when the application-report precheck is exhausted", async () => {
    mocks.consumeRequestRateLimit.mockResolvedValue({
      allowed: false,
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 60,
      audit: {
        action: "RATE_LIMITED",
        preset: "ABUSE_INTAKE_PRECHECK",
        scope: "ACTOR_OR_IP",
      },
    });

    const state = await reportApplicationEmployerAction(
      INITIAL_APPLICATION_ACTION_STATE,
      reportForm(),
    );

    expect(state).toMatchObject({
      status: "error",
      message: expect.stringMatching(/Zu viele Meldungen/u),
    });
    expect(mocks.recordRateLimitDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        preset: "ABUSE_INTAKE_PRECHECK",
        scope: "ACTOR_OR_IP",
      }),
      {
        actorKind: "USER",
        actorUserId: USER_ID,
        capability: "CANDIDATE_APPLICATION_ABUSE_REPORT_PRECHECK",
        companyId: COMPANY_ID,
        targetId: COMPANY_ID,
        targetType: "COMPANY",
      },
      expect.objectContaining({
        database: mocks.database,
        environment: mocks.environment,
        request,
      }),
    );
    expect(mocks.createPublicReport).not.toHaveBeenCalled();
  });
});

function noteForm(overrides: Readonly<{ body?: string }> = {}): FormData {
  const formData = new FormData();
  formData.set("applicationId", APPLICATION_ID);
  formData.set("body", overrides.body ?? "Nur für mich sichtbar");
  formData.set("idempotencyKey", "note-action-0001");
  return formData;
}

function withdrawForm(): FormData {
  const formData = new FormData();
  formData.set("applicationId", APPLICATION_ID);
  formData.set("confirmed", "true");
  formData.set("idempotencyKey", "withdraw-action-0001");
  return formData;
}

function reportForm(): FormData {
  const formData = new FormData();
  formData.set("applicationId", APPLICATION_ID);
  formData.set("reasonCode", "SCAM_OR_FRAUD");
  formData.set(
    "description",
    "Die Firmenkommunikation fordert verdächtige Zahlungen außerhalb der Plattform.",
  );
  return formData;
}
