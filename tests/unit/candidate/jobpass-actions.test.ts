// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  consumeRequestRateLimit: vi.fn(),
  database: { marker: "database" },
  environment: { marker: "environment" },
  getAuthRequestContext: vi.fn(),
  getDatabase: vi.fn(),
  getServerEnvironment: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
  revalidatePath: vi.fn(),
  requireCandidatePage: vi.fn(),
  save: vi.fn(),
  setRadar: vi.fn(),
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
vi.mock("@/lib/candidate/profile", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/candidate/profile")>();
  return {
    ...original,
    completeOwnedCandidateOnboarding: mocks.complete,
    saveOwnedCandidateProfile: mocks.save,
    setOwnedTalentRadarVisibility: mocks.setRadar,
  };
});

import {
  completeCandidateOnboardingAction,
  saveCandidateProfileAction,
  setTalentRadarVisibilityAction,
} from "@/app/candidate/jobpass/actions";
import { CandidateProfileConflictError } from "@/lib/candidate/profile";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CORRELATION_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE_IP = "192.0.2.42";
const REVISION = "2026-07-20T08:00:00.000Z";
const INITIAL = { status: "idle" as const, message: "" };

function profileFormData() {
  const formData = new FormData();
  formData.set("revision", REVISION);
  return formData;
}

describe("Phase-09 JobPass server actions", () => {
  beforeEach(() => {
    for (const value of Object.values(mocks)) {
      if (typeof value === "function") value.mockReset();
    }
    mocks.requireCandidatePage.mockResolvedValue({ id: USER_ID, role: "CANDIDATE" });
    mocks.getAuthRequestContext.mockResolvedValue({
      correlationId: CORRELATION_ID,
      sourceIp: SOURCE_IP,
    });
    mocks.isValidAuthMutationOrigin.mockReturnValue(true);
    mocks.getDatabase.mockReturnValue(mocks.database);
    mocks.getServerEnvironment.mockReturnValue(mocks.environment);
    mocks.consumeRequestRateLimit.mockResolvedValue({ allowed: true, status: 200 });
    mocks.save.mockResolvedValue({
      outcome: "SAVED",
      reopened: false,
      consentChanged: false,
      radarState: "OFF",
    });
    mocks.complete.mockResolvedValue({
      outcome: "COMPLETED",
      missing: [],
      radarState: "OFF",
    });
    mocks.setRadar.mockResolvedValue({
      outcome: "CHANGED",
      granted: true,
      radarState: "INCOMPLETE",
    });
  });

  it("derives ownership only from the authenticated candidate", async () => {
    const result = await saveCandidateProfileAction(INITIAL, profileFormData());

    expect(result).toMatchObject({ status: "success" });
    expect(mocks.requireCandidatePage).toHaveBeenCalledOnce();
    expect(mocks.consumeRequestRateLimit).toHaveBeenCalledWith(
      "CANDIDATE_PROFILE_MUTATION",
      { userId: USER_ID },
      { correlationId: CORRELATION_ID, sourceIp: SOURCE_IP },
      expect.any(Date),
      { database: mocks.database, environment: mocks.environment },
    );
    expect(mocks.save).toHaveBeenCalledWith(
      mocks.database,
      expect.objectContaining({
        actorUserId: USER_ID,
        correlationId: CORRELATION_ID,
        expectedUpdatedAt: new Date(REVISION),
        profile: expect.objectContaining({ radarVisible: false }),
      }),
    );
    const serializedCommand = JSON.stringify(mocks.save.mock.calls[0]?.[1]);
    expect(serializedCommand).not.toContain("candidateProfileId");
    expect(mocks.requireCandidatePage.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.getAuthRequestContext.mock.invocationCallOrder[0]!,
    );
    expect(mocks.getAuthRequestContext.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.isValidAuthMutationOrigin.mock.invocationCallOrder[0]!,
    );
    expect(mocks.isValidAuthMutationOrigin.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.consumeRequestRateLimit.mock.invocationCallOrder[0]!,
    );
    expect(mocks.consumeRequestRateLimit.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.save.mock.invocationCallOrder[0]!,
    );
  });

  it("rejects invalid CV metadata before touching persistence", async () => {
    const formData = profileFormData();
    formData.set("cvFileName", "payload.exe");
    formData.set("cvMimeType", "application/octet-stream");
    formData.set("cvSizeBytes", "1000");

    const result = await saveCandidateProfileAction(INITIAL, formData);

    expect(result).toMatchObject({ status: "error" });
    expect(result.fieldErrors).toHaveProperty("cv");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("returns a visible conflict without revalidating when the profile revision is stale", async () => {
    mocks.save.mockRejectedValue(new CandidateProfileConflictError());

    const result = await saveCandidateProfileAction(INITIAL, profileFormData());

    expect(result).toMatchObject({
      status: "error",
      code: "PROFILE_CONFLICT",
    });
    expect(result.message).toContain("inzwischen");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a missing profile revision before persistence", async () => {
    const result = await saveCandidateProfileAction(INITIAL, new FormData());

    expect(result).toMatchObject({
      status: "error",
      code: "PROFILE_CONFLICT",
    });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("completes through the dedicated owner command and invalidates all profile views", async () => {
    const result = await completeCandidateOnboardingAction(
      INITIAL,
      new FormData(),
    );

    expect(result).toMatchObject({ status: "success" });
    expect(mocks.complete).toHaveBeenCalledWith(
      mocks.database,
      expect.objectContaining({ actorUserId: USER_ID, correlationId: CORRELATION_ID }),
    );
    expect(mocks.consumeRequestRateLimit).toHaveBeenCalledWith(
      "CANDIDATE_PROFILE_MUTATION",
      { userId: USER_ID },
      expect.objectContaining({ sourceIp: SOURCE_IP }),
      expect.any(Date),
      expect.objectContaining({ database: mocks.database }),
    );
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/candidate/jobpass",
      "/candidate/talent-radar",
      "/candidate/dashboard",
      "/candidate/privacy",
    ]);
  });

  it("accepts only the closed explicit Radar boolean and never a profile id", async () => {
    const malformed = new FormData();
    malformed.set("granted", "yes");
    expect(
      await setTalentRadarVisibilityAction(INITIAL, malformed),
    ).toMatchObject({ status: "error" });
    expect(mocks.setRadar).not.toHaveBeenCalled();
    expect(mocks.consumeRequestRateLimit).toHaveBeenCalledOnce();

    const valid = new FormData();
    valid.set("granted", "true");
    await setTalentRadarVisibilityAction(INITIAL, valid);
    expect(mocks.consumeRequestRateLimit).toHaveBeenCalledTimes(2);
    expect(mocks.setRadar).toHaveBeenCalledWith(
      mocks.database,
      expect.objectContaining({ actorUserId: USER_ID, granted: true }),
    );
    expect(JSON.stringify(mocks.setRadar.mock.calls[0]?.[1])).not.toContain(
      "candidateProfileId",
    );
  });

  it("rejects an unsafe mutation origin after candidate authentication", async () => {
    mocks.isValidAuthMutationOrigin.mockReturnValue(false);
    const result = await saveCandidateProfileAction(INITIAL, new FormData());
    expect(result).toMatchObject({ status: "error" });
    expect(mocks.requireCandidatePage).toHaveBeenCalledOnce();
    expect(mocks.consumeRequestRateLimit).not.toHaveBeenCalled();
    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("returns a visible denial before any profile persistence", async () => {
    mocks.consumeRequestRateLimit.mockResolvedValue({
      allowed: false,
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 60,
    });

    const result = await saveCandidateProfileAction(INITIAL, profileFormData());

    expect(result).toMatchObject({ status: "error" });
    expect(result.message).toContain("Zu viele Profiländerungen");
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.setRadar).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.isValidAuthMutationOrigin.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.consumeRequestRateLimit.mock.invocationCallOrder[0]!,
    );
  });
});
