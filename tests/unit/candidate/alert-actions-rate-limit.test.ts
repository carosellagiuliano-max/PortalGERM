// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeRequestRateLimit: vi.fn(),
  createJobAlert: vi.fn(),
  database: { marker: "database" },
  deleteJobAlert: vi.fn(),
  environment: { marker: "environment" },
  grantJobAlertDeliveryConsent: vi.fn(),
  getAuthRequestContext: vi.fn(),
  getDatabase: vi.fn(),
  getServerEnvironment: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
  pauseJobAlert: vi.fn(),
  recordRateLimitDenial: vi.fn(),
  requireCandidatePage: vi.fn(),
  resolveJobAlertDeliveryAvailability: vi.fn(),
  resumeJobAlert: vi.fn(),
  revokeJobAlertDeliveryConsentGlobally: vi.fn(),
  runJobAlertDigestMock: vi.fn(),
  updateJobAlert: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
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
vi.mock("@/lib/candidate/job-alerts", () => ({
  JobAlertActionError: class JobAlertActionError extends Error {},
  createJobAlert: mocks.createJobAlert,
  deleteJobAlert: mocks.deleteJobAlert,
  grantJobAlertDeliveryConsent: mocks.grantJobAlertDeliveryConsent,
  pauseJobAlert: mocks.pauseJobAlert,
  resumeJobAlert: mocks.resumeJobAlert,
  revokeJobAlertDeliveryConsentGlobally:
    mocks.revokeJobAlertDeliveryConsentGlobally,
  runJobAlertDigestMock: mocks.runJobAlertDigestMock,
  updateJobAlert: mocks.updateJobAlert,
}));
vi.mock("@/lib/candidate/job-alert-delivery-runtime", () => ({
  resolveJobAlertDeliveryAvailability:
    mocks.resolveJobAlertDeliveryAvailability,
}));
vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: mocks.getServerEnvironment,
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/lib/security/rate-limit-audit", () => ({
  recordRateLimitDenial: mocks.recordRateLimitDenial,
}));

import { INITIAL_JOB_ALERT_ACTION_STATE } from "@/app/candidate/alerts/action-state";
import {
  createJobAlertAction,
  deleteJobAlertAction,
  grantJobAlertDeliveryAction,
  pauseJobAlertAction,
  resumeJobAlertAction,
  revokeJobAlertDeliveryAction,
  runJobAlertDigestMockAction,
  updateJobAlertAction,
} from "@/app/candidate/alerts/actions";

const USER_ID = "91000000-0000-4000-8000-000000000001";
const REQUEST = Object.freeze({
  correlationId: "91000000-0000-4000-8000-000000000002",
  sourceIp: "192.0.2.91",
});

describe("candidate alert rate-limit denial", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCandidatePage.mockResolvedValue({ id: USER_ID });
    mocks.getAuthRequestContext.mockResolvedValue(REQUEST);
    mocks.isValidAuthMutationOrigin.mockReturnValue(true);
    mocks.getDatabase.mockReturnValue(mocks.database);
    mocks.getServerEnvironment.mockReturnValue(mocks.environment);
    mocks.consumeRequestRateLimit.mockResolvedValue({
      allowed: false,
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 60,
      audit: {
        action: "RATE_LIMITED",
        preset: "JOB_ALERT_MUTATION",
        scope: "USER",
      },
    });
    mocks.recordRateLimitDenial.mockResolvedValue({
      written: true,
      gated: false,
    });
    mocks.resolveJobAlertDeliveryAvailability.mockResolvedValue({
      canActivate: true,
      manualMockEnabled: false,
      mode: "EXTERNAL",
      reason: "AVAILABLE",
    });
    mocks.createJobAlert.mockResolvedValue({ id: "alert", status: "ACTIVE" });
    mocks.resumeJobAlert.mockResolvedValue({ id: "alert", status: "ACTIVE" });
    mocks.pauseJobAlert.mockResolvedValue({ id: "alert", status: "PAUSED" });
    mocks.updateJobAlert.mockResolvedValue({ id: "alert", status: "ACTIVE" });
    mocks.grantJobAlertDeliveryConsent.mockResolvedValue({
      granted: true,
      pausedAlertCount: 0,
    });
    mocks.revokeJobAlertDeliveryConsentGlobally.mockResolvedValue({
      granted: false,
      pausedAlertCount: 1,
    });
    mocks.deleteJobAlert.mockResolvedValue({ id: "alert", changed: true });
  });

  it("records the central denial before returning the friendly state", async () => {
    const result = await deleteJobAlertAction(
      "91000000-0000-4000-8000-000000000003",
      INITIAL_JOB_ALERT_ACTION_STATE,
      new FormData(),
    );

    expect(result).toMatchObject({
      status: "error",
      message: expect.stringContaining("Zu viele Jobabo-Aktionen"),
    });
    expect(mocks.recordRateLimitDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        preset: "JOB_ALERT_MUTATION",
        scope: "USER",
      }),
      {
        actorKind: "USER",
        actorUserId: USER_ID,
        capability: "CANDIDATE_JOB_ALERT_MUTATE",
        targetId: USER_ID,
        targetType: "USER",
      },
      {
        database: mocks.database,
        environment: mocks.environment,
        request: REQUEST,
        now: expect.any(Date),
      },
    );
    expect(mocks.deleteJobAlert).not.toHaveBeenCalled();
  });

  it("does not expose the manual mailbox effect outside local/ci local_mock", async () => {
    mocks.consumeRequestRateLimit.mockResolvedValue({ allowed: true });
    mocks.getServerEnvironment.mockReturnValue({
      APP_ENV: "production",
      EMAIL_PROVIDER_MODE: "resend_live",
    });

    const result = await runJobAlertDigestMockAction(
      "91000000-0000-4000-8000-000000000003",
      INITIAL_JOB_ALERT_ACTION_STATE,
      new FormData(),
    );

    expect(result).toMatchObject({
      status: "error",
      message: expect.stringContaining("lokalen Testumgebung"),
    });
    expect(mocks.runJobAlertDigestMock).not.toHaveBeenCalled();
  });

  it("fails closed before active creation, resume or consent writes when runtime delivery is unavailable", async () => {
    mocks.consumeRequestRateLimit.mockResolvedValue({ allowed: true });
    mocks.resolveJobAlertDeliveryAvailability.mockResolvedValue({
      canActivate: false,
      manualMockEnabled: false,
      mode: "UNAVAILABLE",
      reason: "WORKER_HEARTBEAT_STALE",
    });

    const created = await createJobAlertAction(
      INITIAL_JOB_ALERT_ACTION_STATE,
      alertForm(true),
    );
    const resumed = await resumeJobAlertAction(
      "91000000-0000-4000-8000-000000000003",
      INITIAL_JOB_ALERT_ACTION_STATE,
      new FormData(),
    );
    const granted = await grantJobAlertDeliveryAction(
      INITIAL_JOB_ALERT_ACTION_STATE,
      new FormData(),
    );
    const updated = await updateJobAlertAction(
      "91000000-0000-4000-8000-000000000003",
      INITIAL_JOB_ALERT_ACTION_STATE,
      alertForm(true),
    );

    for (const state of [created, resumed, granted, updated]) {
      expect(state).toMatchObject({
        status: "error",
        message: expect.stringContaining("nicht betriebsbereit"),
      });
    }
    expect(mocks.createJobAlert).not.toHaveBeenCalled();
    expect(mocks.resumeJobAlert).not.toHaveBeenCalled();
    expect(mocks.grantJobAlertDeliveryConsent).not.toHaveBeenCalled();
    expect(mocks.updateJobAlert).not.toHaveBeenCalled();
  });

  it("keeps pause, consent revoke and delete available as safe recovery paths", async () => {
    mocks.consumeRequestRateLimit.mockResolvedValue({ allowed: true });
    mocks.resolveJobAlertDeliveryAvailability.mockResolvedValue({
      canActivate: false,
      manualMockEnabled: false,
      mode: "UNAVAILABLE",
      reason: "SCHEDULER_HEARTBEAT_STALE",
    });
    const alertId = "91000000-0000-4000-8000-000000000003";

    const paused = await pauseJobAlertAction(
      alertId,
      INITIAL_JOB_ALERT_ACTION_STATE,
      new FormData(),
    );
    const revoked = await revokeJobAlertDeliveryAction(
      INITIAL_JOB_ALERT_ACTION_STATE,
      new FormData(),
    );
    const deleted = await deleteJobAlertAction(
      alertId,
      INITIAL_JOB_ALERT_ACTION_STATE,
      new FormData(),
    );

    expect(paused).toEqual({ status: "success", message: "Jobabo pausiert." });
    expect(revoked).toMatchObject({
      status: "success",
      message: expect.stringContaining("1 aktive Jobabos wurden pausiert"),
    });
    expect(deleted).toEqual({ status: "success", message: "Jobabo gelöscht." });
    expect(mocks.resolveJobAlertDeliveryAvailability).not.toHaveBeenCalled();
    expect(mocks.pauseJobAlert).toHaveBeenCalledOnce();
    expect(mocks.revokeJobAlertDeliveryConsentGlobally).toHaveBeenCalledOnce();
    expect(mocks.deleteJobAlert).toHaveBeenCalledOnce();
  });

  it("still permits a paused draft while unavailable and never labels it delivered", async () => {
    mocks.consumeRequestRateLimit.mockResolvedValue({ allowed: true });
    mocks.resolveJobAlertDeliveryAvailability.mockResolvedValue({
      canActivate: false,
      manualMockEnabled: false,
      mode: "UNAVAILABLE",
      reason: "JOB_ALERT_PROVIDER_INACTIVE",
    });
    mocks.createJobAlert.mockResolvedValue({ id: "alert", status: "PAUSED" });

    const result = await createJobAlertAction(
      INITIAL_JOB_ALERT_ACTION_STATE,
      alertForm(false),
    );

    expect(result).toEqual({
      status: "success",
      message: "Jobabo als pausierter Entwurf erstellt.",
    });
    expect(mocks.resolveJobAlertDeliveryAvailability).not.toHaveBeenCalled();
    expect(mocks.createJobAlert).toHaveBeenCalledWith(
      expect.objectContaining({ active: false }),
      expect.objectContaining({
        actorUserId: USER_ID,
        database: mocks.database,
      }),
    );
  });

  it("describes an available local activation strictly as a mock", async () => {
    mocks.consumeRequestRateLimit.mockResolvedValue({ allowed: true });
    mocks.resolveJobAlertDeliveryAvailability.mockResolvedValue({
      canActivate: true,
      manualMockEnabled: true,
      mode: "LOCAL_MOCK",
      reason: "AVAILABLE",
    });

    const result = await createJobAlertAction(
      INITIAL_JOB_ALERT_ACTION_STATE,
      alertForm(true),
    );

    expect(result).toMatchObject({
      status: "success",
      message: expect.stringMatching(/lokalen Mock-Test.*keine echte E-Mail/u),
    });
  });
});

function alertForm(active: boolean) {
  const formData = new FormData();
  formData.set("keyword", "Pflege");
  formData.set("cantonId", "");
  formData.set("cityId", "");
  formData.set("radiusKm", "0");
  formData.set("categoryId", "");
  formData.set("workloadMin", "40");
  formData.set("workloadMax", "100");
  formData.set("remotePreference", "ANY");
  formData.set("frequency", "DAILY");
  if (active) {
    formData.set("active", "true");
    formData.set("deliveryConsentAccepted", "true");
  }
  return formData;
}
