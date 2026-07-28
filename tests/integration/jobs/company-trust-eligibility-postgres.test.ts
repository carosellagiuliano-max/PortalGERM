import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { evaluateCompanyTrustForCompany } from "@/lib/companies/verification/read-model";
import {
  evaluatePublicJobEligibility,
  type PublicEligibilitySnapshot,
} from "@/lib/jobs/public-eligibility";
import {
  createPhase26CompanyTrustFixture,
  type Phase26CompanyTrustFixture,
} from "@/tests/fixtures/phase26-company-trust";

let fixture: Phase26CompanyTrustFixture | undefined;

beforeAll(async () => {
  fixture = await createPhase26CompanyTrustFixture("job_eligibility");
  await fixture.createStrongTrust();
}, 120_000);

afterAll(async () => {
  await fixture?.dispose();
  fixture = undefined;
});

describe.sequential("Phase 26 server-side trust eligibility", () => {
  it("gates public jobs and Radar from the central PostgreSQL trust decision", async () => {
    const current = fixture!;
    const activation = {
      policyMode: "enforce" as const,
      strongBadge: true,
      publicEligibility: true,
      rapidRevoke: true,
      legacyDemoCompatibility: false,
    };
    const strong = await evaluateCompanyTrustForCompany(
      current.database,
      current.companyId,
      { now: current.now, environment: "production", activation },
    );
    expect(
      evaluatePublicJobEligibility(
        jobSnapshot(current, strong.publicEligible),
        current.now,
        "non-production",
      ),
    ).toMatchObject({ eligible: true });
    expect(strong.radarEligible).toBe(true);

    const flagOff = await evaluateCompanyTrustForCompany(
      current.database,
      current.companyId,
      {
        now: current.now,
        environment: "production",
        activation: { ...activation, policyMode: "observe" },
      },
    );
    expect(flagOff.badge).toBeNull();
    expect(flagOff.radarEligible).toBe(false);
    expect(
      evaluatePublicJobEligibility(
        jobSnapshot(current, flagOff.publicEligible),
        current.now,
        "non-production",
      ),
    ).toEqual({ eligible: false });

    await current.database.companyTrustProjection.update({
      where: {
        companyId_scope: {
          companyId: current.companyId,
          scope: "COMPANY_IDENTITY",
        },
      },
      data: {
        status: "ON_HOLD",
        riskState: "HOLD",
        reasonCode: "INCIDENT_HOLD",
        changedAt: current.now,
        version: { increment: 1 },
      },
    });
    const held = await evaluateCompanyTrustForCompany(
      current.database,
      current.companyId,
      { now: current.now, environment: "production", activation },
    );
    expect(held).toMatchObject({
      badge: null,
      publicEligible: false,
      radarEligible: false,
      reason: "RISK_BLOCKED",
    });
    expect(
      evaluatePublicJobEligibility(
        jobSnapshot(current, held.publicEligible),
        current.now,
        "non-production",
      ),
    ).toEqual({ eligible: false });
  });
});

function jobSnapshot(
  current: Phase26CompanyTrustFixture,
  hasCurrentTrustEligibility: boolean,
): PublicEligibilitySnapshot {
  const publishedAt = new Date(current.now.getTime() - 60_000);
  const expiresAt = new Date(current.now.getTime() + 86_400_000);
  return {
    id: "job-phase26",
    slug: "job-phase26",
    companyId: current.companyId,
    status: "PUBLISHED",
    dataProvenance: "TEST",
    currentRevisionId: "revision-phase26",
    publishedRevisionId: "revision-phase26",
    publishedAt,
    expiresAt,
    company: {
      name: "Phase 26 Prüfwerk AG",
      status: "ACTIVE",
      dataProvenance: "TEST",
      hasCurrentVerifiedCycle: true,
      hasCurrentTrustEligibility,
    },
    revision: {
      id: "revision-phase26",
      title: "Phase 26 Teststelle",
      description: "Trustgebundene öffentliche Stelle.",
      approvedAt: publishedAt,
      rejectedAt: null,
      validThrough: expiresAt,
      categoryId: "category-phase26",
      categoryIsActive: true,
      cantonId: current.cantonId,
      cityId: null,
      salaryMin: null,
      salaryMax: null,
      salaryPeriod: null,
      responseTargetDays: 7,
      remoteType: "HYBRID",
      jobType: "PERMANENT",
      workloadMin: 80,
      workloadMax: 100,
      fairScore: 100,
    },
    hasEffectivePublicHideRestriction: false,
  };
}
