// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const intakeAtomically = vi.fn();
  const notificationUpsert = vi.fn();
  const privacyRequestFindFirst = vi.fn();
  return {
    buildNotificationPersistenceRecord: vi.fn(),
    consumeRequestRateLimit: vi.fn(),
    database: {
      notification: { upsert: notificationUpsert },
      privacyRequest: { findFirst: privacyRequestFindFirst },
    },
    getAuthRequestContext: vi.fn(),
    getDatabase: vi.fn(),
    getServerEnvironment: vi.fn(),
    intakeAtomically,
    isValidAuthMutationOrigin: vi.fn(),
    notificationUpsert,
    privacyRequestFindFirst,
    repository: { intakeAtomically, findOwned: vi.fn() },
    revalidatePath: vi.fn(),
    requireCandidatePage: vi.fn(),
  };
});

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
vi.mock("@/lib/notifications/writer", () => ({
  buildNotificationPersistenceRecord: mocks.buildNotificationPersistenceRecord,
}));
vi.mock("@/lib/privacy/postgres-adapters", () => ({
  createPostgresPrivacyRequestRepository: () => mocks.repository,
}));

import {
  INITIAL_CANDIDATE_PRIVACY_ACTION_STATE,
  createCandidatePrivacyRequestAction,
} from "@/app/candidate/privacy/actions";
import { PRIVACY_REQUEST_POLICY_V1 } from "@/lib/privacy/requests";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const IDEMPOTENCY_KEY = "jobpass-delete-0001";

describe("Phase-09 JobPass deletion request", () => {
  beforeEach(() => {
    for (const value of Object.values(mocks)) {
      if (typeof value === "function") value.mockReset();
    }
    mocks.repository.findOwned.mockReset();
    mocks.getAuthRequestContext.mockResolvedValue({ correlationId: REQUEST_ID });
    mocks.isValidAuthMutationOrigin.mockReturnValue(true);
    mocks.requireCandidatePage.mockResolvedValue({
      id: USER_ID,
      status: "ACTIVE",
    });
    mocks.getDatabase.mockReturnValue(mocks.database);
    mocks.getServerEnvironment.mockReturnValue({ nodeEnv: "test" });
    mocks.consumeRequestRateLimit.mockResolvedValue({ allowed: true, status: 200 });
    mocks.intakeAtomically.mockImplementation(
      async ({ request, dueAt, createdAt }) => ({
        outcome: "CREATED" as const,
        request: {
          id: REQUEST_ID,
          type: request.type,
          status: "PENDING" as const,
          dueAt,
          createdAt,
        },
      }),
    );
    mocks.buildNotificationPersistenceRecord.mockImplementation((input) => ({
      ...input,
      createdAt: new Date(),
    }));
    mocks.notificationUpsert.mockResolvedValue({ id: REQUEST_ID });
    mocks.privacyRequestFindFirst.mockResolvedValue(null);
  });

  it("creates the typed DELETE case from the exact confirmation phrase", async () => {
    const formData = new FormData();
    formData.set("type", "DELETE");
    formData.set("idempotencyKey", IDEMPOTENCY_KEY);
    formData.set(
      "deleteConfirmation",
      PRIVACY_REQUEST_POLICY_V1.deleteConfirmationPhrase,
    );

    const result = await createCandidatePrivacyRequestAction(
      INITIAL_CANDIDATE_PRIVACY_ACTION_STATE,
      formData,
    );

    expect(result).toMatchObject({ status: "success" });
    expect(mocks.intakeAtomically).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        request: {
          type: "DELETE",
          noticeVersion: PRIVACY_REQUEST_POLICY_V1.noticeVersion,
          idempotencyKey: IDEMPOTENCY_KEY,
          deleteConfirmation:
            PRIVACY_REQUEST_POLICY_V1.deleteConfirmationPhrase,
        },
        maximumOpenPerType: 1,
        rollingThirtyDayLimit: 5,
        eventKind: "CREATED",
        auditAction: "PRIVACY_REQUEST_CREATED",
      }),
    );
    expect(mocks.notificationUpsert).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/candidate/privacy",
      "/candidate/dashboard",
    ]);
  });

  it("does not create a case for an unsafe mutation origin", async () => {
    mocks.isValidAuthMutationOrigin.mockReturnValue(false);

    const result = await createCandidatePrivacyRequestAction(
      INITIAL_CANDIDATE_PRIVACY_ACTION_STATE,
      new FormData(),
    );

    expect(result).toMatchObject({ status: "error" });
    expect(mocks.requireCandidatePage).not.toHaveBeenCalled();
    expect(mocks.consumeRequestRateLimit).not.toHaveBeenCalled();
    expect(mocks.intakeAtomically).not.toHaveBeenCalled();
    expect(mocks.notificationUpsert).not.toHaveBeenCalled();
  });

  it("validates the exact deletion phrase before consuming the rate limit", async () => {
    const formData = new FormData();
    formData.set("type", "DELETE");
    formData.set("idempotencyKey", IDEMPOTENCY_KEY);
    formData.set("deleteConfirmation", "bitte löschen");

    const result = await createCandidatePrivacyRequestAction(
      INITIAL_CANDIDATE_PRIVACY_ACTION_STATE,
      formData,
    );

    expect(result).toMatchObject({ status: "error" });
    expect(result.fieldErrors).toHaveProperty("deleteConfirmation");
    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(mocks.consumeRequestRateLimit).not.toHaveBeenCalled();
    expect(mocks.intakeAtomically).not.toHaveBeenCalled();
  });

  it("rejects more than five correction fields before consuming the rate limit", async () => {
    const formData = new FormData();
    formData.set("type", "CORRECT");
    formData.set("idempotencyKey", IDEMPOTENCY_KEY);
    for (const code of [
      "DISPLAY_NAME",
      "LEGAL_NAME",
      "EMAIL",
      "PHONE",
      "LOCATION",
      "PROFILE_PREFERENCES",
    ]) {
      formData.append("correctionFieldCodes", code);
    }
    formData.set(
      "correctionText",
      "Bitte korrigiert die aufgeführten Angaben in meinem Profil.",
    );

    const result = await createCandidatePrivacyRequestAction(
      INITIAL_CANDIDATE_PRIVACY_ACTION_STATE,
      formData,
    );

    expect(result).toMatchObject({ status: "error" });
    expect(result.fieldErrors).toHaveProperty("correctionFieldCodes");
    expect(mocks.consumeRequestRateLimit).not.toHaveBeenCalled();
    expect(mocks.intakeAtomically).not.toHaveBeenCalled();
  });

  it("returns a visible error when the request rate limit is reached", async () => {
    mocks.consumeRequestRateLimit.mockResolvedValue({ allowed: false, status: 429 });
    const formData = new FormData();
    formData.set("type", "EXPORT");
    formData.set("idempotencyKey", IDEMPOTENCY_KEY);

    const result = await createCandidatePrivacyRequestAction(
      INITIAL_CANDIDATE_PRIVACY_ACTION_STATE,
      formData,
    );

    expect(result).toMatchObject({ status: "error" });
    expect(result.message).toContain("Zu viele");
    expect(mocks.intakeAtomically).not.toHaveBeenCalled();
    expect(mocks.notificationUpsert).not.toHaveBeenCalled();
  });
});
