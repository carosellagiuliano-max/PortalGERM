import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthRequestContext: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
  requireEmployerPage: vi.fn(),
  requireEmployerCompanyContext: vi.fn(),
  getDatabase: vi.fn(),
  getServerEnvironment: vi.fn(),
  saveEmployerCompanyProfile: vi.fn(),
  completeEmployerCompanyOnboarding: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: mocks.getAuthRequestContext,
  isValidAuthMutationOrigin: mocks.isValidAuthMutationOrigin,
}));
vi.mock("@/lib/auth/route-guards", () => ({
  requireEmployerPage: mocks.requireEmployerPage,
}));
vi.mock("@/lib/employer/context", () => ({
  requireEmployerCompanyContext: mocks.requireEmployerCompanyContext,
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: mocks.getServerEnvironment,
}));
vi.mock("@/lib/employer/company", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/employer/company")>();
  return {
    ...actual,
    saveEmployerCompanyProfile: mocks.saveEmployerCompanyProfile,
    completeEmployerCompanyOnboarding: mocks.completeEmployerCompanyOnboarding,
  };
});

import { saveEmployerCompanyProfileAction } from "@/app/employer/company/actions";
import { startNewCompanyVerificationCycleAction } from "@/app/employer/company/verification/actions";

const IDS = Object.freeze({
  actor: "30000000-0000-4000-8000-000000000001",
  company: "30000000-0000-4000-8000-000000000002",
  membership: "30000000-0000-4000-8000-000000000003",
  correlation: "30000000-0000-4000-8000-000000000004",
});
const IDLE = Object.freeze({ status: "idle" as const, message: "" });

beforeEach(() => {
  mocks.requireEmployerPage.mockResolvedValue({ id: IDS.actor });
  mocks.requireEmployerCompanyContext.mockResolvedValue({
    companyId: IDS.company,
    membershipId: IDS.membership,
    membershipRole: "OWNER",
  });
  mocks.getAuthRequestContext.mockResolvedValue({
    correlationId: IDS.correlation,
    sourceIp: "203.0.113.10",
  });
  mocks.isValidAuthMutationOrigin.mockReturnValue(true);
  mocks.getDatabase.mockReturnValue({ kind: "database" });
  mocks.getServerEnvironment.mockReturnValue({
    secrets: {
      keyrings: {
        AUDIT_IP_HASH_KEYS: [
          { version: "v1", value: "company-action-test-secret" },
        ],
      },
    },
  });
  mocks.saveEmployerCompanyProfile.mockResolvedValue({
    slug: "swiss-talent",
    updatedAt: new Date("2026-07-20T10:05:00.000Z"),
  });
});

describe("Phase-10 company mutation boundary", () => {
  it("rejects a mutation with an invalid origin before calling the domain command", async () => {
    mocks.isValidAuthMutationOrigin.mockReturnValue(false);

    const state = await saveEmployerCompanyProfileAction(IDLE, validFormData());

    expect(state).toMatchObject({ status: "error" });
    expect(mocks.saveEmployerCompanyProfile).not.toHaveBeenCalled();
    expect(mocks.getDatabase).not.toHaveBeenCalled();
  });

  it("applies the same origin check to verification submissions", async () => {
    mocks.isValidAuthMutationOrigin.mockReturnValue(false);

    const state = await startNewCompanyVerificationCycleAction(
      IDLE,
      new FormData(),
    );

    expect(state).toMatchObject({ status: "error" });
    expect(mocks.getDatabase).not.toHaveBeenCalled();
  });

  it("derives Company, Membership and actor scope on the server", async () => {
    const state = await saveEmployerCompanyProfileAction(IDLE, validFormData());

    expect(state).toEqual({
      status: "success",
      message: "Firmenprofil sicher gespeichert.",
    });
    expect(mocks.saveEmployerCompanyProfile).toHaveBeenCalledWith(
      { kind: "database" },
      expect.objectContaining({
        companyId: IDS.company,
        membershipId: IDS.membership,
        actorUserId: IDS.actor,
        correlationId: IDS.correlation,
      }),
      expect.objectContaining({ name: "Swiss Talent AG" }),
      new Date("2026-07-20T10:00:00.000Z"),
    );
  });

  it("rejects caller-supplied scope fields instead of trusting them", async () => {
    const formData = validFormData();
    formData.set("companyId", "30000000-0000-4000-8000-000000000099");

    const state = await saveEmployerCompanyProfileAction(IDLE, formData);

    expect(state).toMatchObject({ status: "error" });
    expect(mocks.saveEmployerCompanyProfile).not.toHaveBeenCalled();
  });
});

function validFormData() {
  const formData = new FormData();
  const fields = {
    expectedUpdatedAt: "2026-07-20T10:00:00.000Z",
    name: "Swiss Talent AG",
    uid: "",
    industry: "",
    size: "",
    website: "",
    logoStorageKey: "",
    coverStorageKey: "",
    linkedinUrl: "",
    facebookUrl: "",
    instagramUrl: "",
    about: "",
    values: "",
    benefits: "",
    locationCount: "0",
    primaryLocationIndex: "",
  } as const;
  for (const [field, value] of Object.entries(fields)) {
    formData.set(field, value);
  }
  return formData;
}
