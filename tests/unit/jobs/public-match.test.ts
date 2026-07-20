// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getDatabase: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/db/client", () => ({ getDatabase: mocks.getDatabase }));

import { getCurrentCandidateMatchForJob } from "@/lib/jobs/public-match";

describe("public candidate match gate", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getDatabase.mockReturnValue({
      candidateProfile: { findUnique: mocks.findUnique },
    });
  });

  it.each([
    ["anonymous visitors", null],
    ["employers", { id: "employer-1", role: "EMPLOYER" }],
    ["administrators", { id: "admin-1", role: "ADMIN" }],
  ])("does not load any profile for %s", async (_label, currentUser) => {
    mocks.getCurrentUser.mockResolvedValue(currentUser);

    await expect(getCurrentCandidateMatchForJob(publicJob())).resolves.toBeNull();

    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("loads only the authenticated candidate owner and returns calculated factors", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "candidate-1", role: "CANDIDATE" });
    mocks.findUnique.mockResolvedValue({
      cantonId: "canton-zh",
      skills: [{ skillId: "skill-typescript" }],
      languages: [{ code: "DE", level: "C1" }],
      preference: {
        desiredJobTypes: ["PERMANENT"],
        salaryPeriod: "YEARLY",
        salaryMinChf: 90_000,
        salaryMaxChf: 130_000,
        workloadMin: 80,
        workloadMax: 100,
        remotePreference: "HYBRID",
        availableFrom: new Date("2026-08-01T00:00:00.000Z"),
      },
    });

    const result = await getCurrentCandidateMatchForJob(publicJob());

    expect(mocks.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "candidate-1" } }),
    );
    expect(result).toMatchObject({
      version: "v1",
      score: expect.any(Number),
      confidence: expect.any(Number),
      factorScores: expect.any(Object),
    });
    expect(JSON.stringify(result)).not.toContain("candidate-1");
  });
});

function publicJob() {
  return {
    skills: [{ id: "skill-typescript", required: true }],
    canton: { id: "canton-zh" },
    workloadMin: 80,
    workloadMax: 100,
    salaryMin: 100_000,
    salaryMax: 125_000,
    salaryPeriod: "YEARLY",
    remoteType: "HYBRID",
    languages: [{ code: "DE", minLevel: "B2" }],
    jobType: "PERMANENT",
    startDate: new Date("2026-08-15T00:00:00.000Z"),
  } as never;
}
