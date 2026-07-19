// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ getDatabase: vi.fn() }));

import {
  evaluatePublicJobEligibility,
  type PublicEligibilitySnapshot,
} from "@/lib/jobs/public-eligibility";

const NOW = new Date("2026-07-19T12:00:00.000Z");
const SNAPSHOT: PublicEligibilitySnapshot = {
  id: "job-1",
  slug: "engineer",
  companyId: "company-1",
  status: "PUBLISHED",
  dataProvenance: "LIVE",
  publishedRevisionId: "revision-1",
  publishedAt: new Date("2026-07-01T00:00:00Z"),
  expiresAt: new Date("2026-08-01T00:00:00Z"),
  company: {
    name: "Talent AG",
    status: "ACTIVE",
    dataProvenance: "LIVE",
    hasCurrentVerifiedCycle: true,
  },
  revision: {
    id: "revision-1",
    title: "Engineer",
    description: "Build things",
    approvedAt: new Date(0),
    rejectedAt: null,
    validThrough: new Date("2026-08-01T00:00:00Z"),
    categoryId: "category-1",
    cantonId: "canton-1",
    cityId: "city-1",
    salaryMin: 90_000,
    salaryMax: 110_000,
    salaryPeriod: "YEARLY",
    responseTargetDays: 14,
    remoteType: "HYBRID",
    jobType: "PERMANENT",
    workloadMin: 80,
    workloadMax: 100,
    fairScore: 95,
  },
  hasEffectivePublicHideRestriction: false,
};

describe("sole public Job eligibility policy", () => {
  it("returns only the allowlisted public projection for a fully eligible job", () => {
    const result = evaluatePublicJobEligibility(SNAPSHOT, NOW, "production");
    expect(result).toMatchObject({
      eligible: true,
      job: { id: "job-1", fairScore: 95 },
    });
    expect(JSON.stringify(result)).not.toContain("dataProvenance");
  });

  it("accepts a fully remote published revision without canton or city", () => {
    const result = evaluatePublicJobEligibility(
      {
        ...SNAPSHOT,
        revision: {
          ...SNAPSHOT.revision!,
          remoteType: "REMOTE",
          cantonId: null,
          cityId: null,
        },
      },
      NOW,
      "production",
    );

    expect(result).toMatchObject({
      eligible: true,
      job: { remoteType: "REMOTE", cantonId: null, cityId: null },
    });
  });

  it.each([
    ["status", { status: "PAUSED" }],
    ["revision drift", { publishedRevisionId: "revision-old" }],
    [
      "rejected revision",
      { revision: { ...SNAPSHOT.revision!, rejectedAt: NOW } },
    ],
    ["missing publication", { publishedAt: null }],
    ["expiry drift", { expiresAt: new Date("2026-08-02T00:00:00Z") }],
    [
      "company suspended",
      { company: { ...SNAPSHOT.company, status: "SUSPENDED" } },
    ],
    [
      "verification revoked",
      { company: { ...SNAPSHOT.company, hasCurrentVerifiedCycle: false } },
    ],
    ["restriction", { hasEffectivePublicHideRestriction: true }],
    ["demo in production", { dataProvenance: "DEMO" }],
  ])("fails closed for %s", (_label, patch) => {
    expect(
      evaluatePublicJobEligibility(
        { ...SNAPSHOT, ...patch } as PublicEligibilitySnapshot,
        NOW,
        "production",
      ),
    ).toEqual({ eligible: false });
  });

  it("uses half-open publication boundaries", () => {
    const atPublish = { ...SNAPSHOT, publishedAt: new Date(NOW) };
    expect(
      evaluatePublicJobEligibility(atPublish, NOW, "production").eligible,
    ).toBe(true);
    const atExpiry = {
      ...SNAPSHOT,
      expiresAt: new Date(NOW),
      revision: { ...SNAPSHOT.revision!, validThrough: new Date(NOW) },
    };
    expect(evaluatePublicJobEligibility(atExpiry, NOW, "production")).toEqual({
      eligible: false,
    });
  });

  it("permits marked demo fixtures only outside production", () => {
    expect(
      evaluatePublicJobEligibility(
        {
          ...SNAPSHOT,
          dataProvenance: "DEMO",
          company: { ...SNAPSHOT.company, dataProvenance: "DEMO" },
        },
        NOW,
        "non-production",
      ).eligible,
    ).toBe(true);
  });
});
