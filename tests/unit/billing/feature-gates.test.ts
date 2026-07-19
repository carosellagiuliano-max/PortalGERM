import type { EntitlementRights, FundableBySource } from "@/lib/billing/entitlements";
import {
  canPublishJob,
  canRequestContact,
  canRunLicensedSupplyImport,
  canUseAdvancedAnalytics,
  canUseEmployerImport,
  canUseTalentRadar,
  type AdditionalJobPermitSummary,
} from "@/lib/billing/feature-gates";
import { describe, expect, it } from "vitest";

import {
  AT,
  COMPANY_ID,
  PRO_RIGHTS,
  effectiveEntitlements,
  emptyFundableBySource,
} from "./fixtures";

const DAY = 24 * 60 * 60 * 1_000;

function rights(overrides: Partial<EntitlementRights> = {}): EntitlementRights {
  return { ...PRO_RIGHTS, ...overrides };
}

function permit(
  overrides: Partial<AdditionalJobPermitSummary> = {},
): AdditionalJobPermitSummary {
  return {
    companyId: COMPANY_ID,
    targetJobId: "job-1",
    status: "ACTIVE",
    validFrom: new Date(AT.getTime() - DAY),
    validTo: new Date(AT.getTime() + 30 * DAY),
    revokedAt: null,
    ...overrides,
  };
}

describe("canPublishJob", () => {
  it("allows an ordinary publication below the global limit", () => {
    expect(
      canPublishJob({
        effectiveEntitlements: effectiveEntitlements({
          rights: rights({ ACTIVE_JOB_LIMIT: 3 }),
        }),
        currentActiveCount: 2,
        jobId: "job-1",
        revisionValidThrough: new Date(AT.getTime() + 90 * DAY),
      }),
    ).toEqual({ allowed: true });
  });

  it.each([
    [new Date(AT), "REVISION_VALIDITY_INVALID"],
    [new Date(AT.getTime() - 1), "REVISION_VALIDITY_INVALID"],
    [new Date(AT.getTime() + 90 * DAY), undefined],
    [new Date(AT.getTime() + 90 * DAY + 1), "REVISION_VALIDITY_INVALID"],
    [null, "REVISION_VALIDITY_INVALID"],
  ] as const)("enforces bounded revision validity at %s", (validThrough, reason) => {
    const result = canPublishJob({
      effectiveEntitlements: effectiveEntitlements(),
      currentActiveCount: 0,
      jobId: "job-1",
      revisionValidThrough: validThrough,
    });
    expect(result.allowed).toBe(reason === undefined);
    expect(result.reason).toBe(reason);
  });

  it("returns a typed upgrade/product result at the limit", () => {
    expect(
      canPublishJob({
        effectiveEntitlements: effectiveEntitlements({
          rights: rights({ ACTIVE_JOB_LIMIT: 1 }),
        }),
        currentActiveCount: 1,
        jobId: "job-1",
        revisionValidThrough: new Date(AT.getTime() + 20 * DAY),
      }),
    ).toEqual({
      allowed: false,
      reason: "ACTIVE_JOB_LIMIT_REACHED",
      suggestedProductSlug: "additional-job-30d",
      suggestedPlanSlug: "pro",
    });
  });

  it("allows only a current exact-target permit whose boundary covers the revision", () => {
    const entitlement = effectiveEntitlements({
      rights: rights({ ACTIVE_JOB_LIMIT: 1 }),
    });
    expect(
      canPublishJob({
        effectiveEntitlements: entitlement,
        currentActiveCount: 1,
        jobId: "job-1",
        revisionValidThrough: new Date(AT.getTime() + 30 * DAY),
        additionalJobPermit: permit(),
      }),
    ).toEqual({ allowed: true });

    for (const invalidPermit of [
      permit({ companyId: "foreign" }),
      permit({ targetJobId: "job-2" }),
      permit({ status: "REVOKED" }),
      permit({ revokedAt: new Date(AT) }),
      permit({ validFrom: new Date(AT.getTime() + 1) }),
      permit({ validTo: new Date(AT) }),
    ]) {
      expect(
        canPublishJob({
          effectiveEntitlements: entitlement,
          currentActiveCount: 1,
          jobId: "job-1",
          revisionValidThrough: new Date(AT.getTime() + 20 * DAY),
          additionalJobPermit: invalidPermit,
        }),
      ).toMatchObject({ allowed: false, reason: "ADDITIONAL_JOB_PERMIT_INVALID" });
    }
  });

  it("does not use one targeted permit to grow an already over-limit company", () => {
    expect(
      canPublishJob({
        effectiveEntitlements: effectiveEntitlements({
          rights: rights({ ACTIVE_JOB_LIMIT: 1 }),
        }),
        currentActiveCount: 2,
        jobId: "job-1",
        revisionValidThrough: new Date(AT.getTime() + 20 * DAY),
        additionalJobPermit: permit(),
      }),
    ).toMatchObject({
      allowed: false,
      reason: "ADDITIONAL_JOB_PERMIT_REQUIRED",
    });
  });
});

describe("Radar, contact, and analytics gates", () => {
  it("gates Talent Radar only on its typed entitlement", () => {
    expect(canUseTalentRadar(effectiveEntitlements())).toEqual({ allowed: true });
    expect(
      canUseTalentRadar(
        effectiveEntitlements({ rights: rights({ TALENT_RADAR_ACCESS: false }) }),
      ),
    ).toEqual({
      allowed: false,
      reason: "TALENT_RADAR_NOT_INCLUDED",
      suggestedPlanSlug: "pro",
    });
  });

  it.each(["PLAN_ALLOWANCE", "PURCHASED_PACK", "ADMIN_GRANT"] as const)(
    "allows contact with one fundable %s credit",
    (fundingSource) => {
      const summary = emptyFundableBySource() as Record<
        keyof FundableBySource,
        Record<"JOB_BOOST" | "TALENT_CONTACT" | "NEWSLETTER" | "SOCIAL_PUSH", number>
      >;
      summary[fundingSource].TALENT_CONTACT = 1;
      expect(canRequestContact(effectiveEntitlements(), summary)).toEqual({
        allowed: true,
      });
    },
  );

  it("keeps access and credit funding separate", () => {
    const summary = emptyFundableBySource() as Record<
      keyof FundableBySource,
      Record<"JOB_BOOST" | "TALENT_CONTACT" | "NEWSLETTER" | "SOCIAL_PUSH", number>
    >;
    summary.PURCHASED_PACK.TALENT_CONTACT = 50;

    expect(
      canRequestContact(
        effectiveEntitlements({ rights: rights({ TALENT_RADAR_ACCESS: false }) }),
        summary,
      ),
    ).toMatchObject({ allowed: false, reason: "TALENT_RADAR_NOT_INCLUDED" });
    expect(
      canRequestContact(effectiveEntitlements(), emptyFundableBySource()),
    ).toEqual({
      allowed: false,
      reason: "CONTACT_FUNDING_UNAVAILABLE",
      suggestedProductSlug: "contact-pack-10",
    });

    summary.PURCHASED_PACK.TALENT_CONTACT = -1;
    expect(canRequestContact(effectiveEntitlements(), summary)).toMatchObject({
      allowed: false,
      reason: "CONTACT_FUNDING_UNAVAILABLE",
    });
  });

  it.each([
    ["NONE", false],
    ["BASIC", false],
    ["ADVANCED", true],
    ["PRO", true],
  ] as const)("gates advanced analytics for %s", (level, allowed) => {
    expect(
      canUseAdvancedAnalytics(
        effectiveEntitlements({ rights: rights({ ANALYTICS_LEVEL: level }) }),
      ).allowed,
    ).toBe(allowed);
  });
});

describe("licensed platform and employer import", () => {
  const currentRights = {
    sourceId: "source-1",
    hasDocumentedLicense: true,
    hasDocumentedProvenance: true,
    validFrom: new Date(AT.getTime() - DAY),
    validTo: new Date(AT.getTime() + DAY),
    revokedAt: null,
    at: AT,
  } as const;

  it("keeps licensed platform import independent of employer plans", () => {
    expect(
      canRunLicensedSupplyImport(
        { canRunLicensedSupplyImport: true },
        currentRights,
      ),
    ).toEqual({ allowed: true });
    expect(
      canRunLicensedSupplyImport(
        { canRunLicensedSupplyImport: false },
        currentRights,
      ),
    ).toMatchObject({
      allowed: false,
      reason: "PLATFORM_IMPORT_CAPABILITY_REQUIRED",
    });
    expect(
      canRunLicensedSupplyImport(
        { canRunLicensedSupplyImport: true },
        { ...currentRights, hasDocumentedLicense: false },
      ),
    ).toMatchObject({ allowed: false, reason: "SOURCE_RIGHTS_REQUIRED" });
  });

  it("denies employer import when only a global grant raised the final right", () => {
    const entitlement = effectiveEntitlements({
      source: {
        kind: "SUBSCRIPTION",
        planSlug: "business",
        planVersionId: "business-1",
        subscriptionId: "subscription-business",
      },
      planRights: rights({ EMPLOYER_IMPORT_ACCESS: false }),
      rights: rights({ EMPLOYER_IMPORT_ACCESS: true }),
    });
    expect(
      canUseEmployerImport({
        effectiveEntitlements: entitlement,
        currentPlanSlug: "business",
        companyId: COMPANY_ID,
        sourceId: "source-1",
        accessGrant: {
          companyId: COMPANY_ID,
          sourceId: "source-1",
          status: "ACTIVE",
          validFrom: new Date(AT.getTime() - DAY),
          validTo: new Date(AT.getTime() + DAY),
          revokedAt: null,
        },
      }),
    ).toMatchObject({ allowed: false, reason: "EMPLOYER_IMPORT_DISABLED" });
  });

  it("requires eligible plan and one exact current source grant", () => {
    const planWithImport = rights({ EMPLOYER_IMPORT_ACCESS: true });
    const entitlement = effectiveEntitlements({
      source: {
        kind: "SUBSCRIPTION",
        planSlug: "business",
        planVersionId: "business-1",
        subscriptionId: "subscription-business",
      },
      planRights: planWithImport,
      rights: planWithImport,
    });
    const accessGrant = {
      companyId: COMPANY_ID,
      sourceId: "source-1",
      status: "ACTIVE" as const,
      validFrom: new Date(AT.getTime() - DAY),
      validTo: new Date(AT.getTime() + DAY),
      revokedAt: null,
    };

    expect(
      canUseEmployerImport({
        effectiveEntitlements: entitlement,
        currentPlanSlug: "business",
        companyId: COMPANY_ID,
        sourceId: "source-1",
        accessGrant,
      }),
    ).toEqual({ allowed: true });
    expect(
      canUseEmployerImport({
        effectiveEntitlements: entitlement,
        currentPlanSlug: "pro",
        companyId: COMPANY_ID,
        sourceId: "source-1",
        accessGrant,
      }),
    ).toMatchObject({ allowed: false, reason: "EMPLOYER_IMPORT_PLAN_REQUIRED" });
    expect(
      canUseEmployerImport({
        effectiveEntitlements: entitlement,
        currentPlanSlug: "business",
        companyId: COMPANY_ID,
        sourceId: "another-source",
        accessGrant,
      }),
    ).toMatchObject({ allowed: false, reason: "EMPLOYER_IMPORT_GRANT_REQUIRED" });
  });
});
