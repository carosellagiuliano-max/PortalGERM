import {
  ENTITLEMENT_KEYS_V1,
  getEffectiveEntitlements,
  resolveEffectiveEntitlements,
  type EntitlementGrantRecord,
  type EntitlementRepository,
  type EntitlementResolutionInput,
  type PlanEntitlementRecord,
  type SubscriptionEntitlementSource,
} from "@/lib/billing/entitlements";
import { describe, expect, it, vi } from "vitest";

import {
  AT,
  COMPANY_ID,
  FREE_RIGHTS,
  PRO_RIGHTS,
  entitlementRows,
  planVersion,
} from "./fixtures";

function resolutionInput(
  overrides: Partial<EntitlementResolutionInput> = {},
): EntitlementResolutionInput {
  return {
    companyId: COMPANY_ID,
    at: new Date(AT),
    defaultFreePlanVersions: [planVersion()],
    subscriptions: [],
    grants: [],
    fundableCredits: [],
    ...overrides,
  };
}

function paidSubscription(
  overrides: Partial<SubscriptionEntitlementSource> = {},
): SubscriptionEntitlementSource {
  return {
    id: "subscription-1",
    companyId: COMPANY_ID,
    status: "ACTIVE",
    currentPeriodStart: new Date("2026-07-01T00:00:00.000Z"),
    currentPeriodEnd: new Date("2026-08-01T00:00:00.000Z"),
    planVersion: planVersion({
      id: "plan-version-pro-1",
      planSlug: "pro",
      isDefaultFree: false,
      status: "INACTIVE",
      entitlements: entitlementRows(PRO_RIGHTS),
    }),
    ...overrides,
  };
}

function grant(
  overrides: Partial<EntitlementGrantRecord> = {},
): EntitlementGrantRecord {
  return {
    id: "grant-1",
    companyId: COMPANY_ID,
    key: "ACTIVE_JOB_LIMIT",
    valueType: "INTEGER",
    booleanValue: null,
    integerValue: 2,
    analyticsLevelValue: null,
    integerMode: "ADD",
    validFrom: new Date("2026-07-01T00:00:00.000Z"),
    validTo: new Date("2026-08-01T00:00:00.000Z"),
    revokedAt: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("effective entitlement precedence", () => {
  it("resolves the one complete default Free baseline", () => {
    const result = resolveEffectiveEntitlements(resolutionInput());

    expect(result).toEqual({
      ok: true,
      value: {
        companyId: COMPANY_ID,
        resolvedAt: AT,
        source: {
          kind: "DEFAULT_FREE",
          planSlug: "free",
          planVersionId: "plan-version-free-1",
          subscriptionId: null,
        },
        planRights: FREE_RIGHTS,
        rights: FREE_RIGHTS,
        appliedGrantIds: [],
        fundableBySource: {
          PLAN_ALLOWANCE: {
            JOB_BOOST: 0,
            TALENT_CONTACT: 0,
            NEWSLETTER: 0,
            SOCIAL_PUSH: 0,
          },
          PURCHASED_PACK: {
            JOB_BOOST: 0,
            TALENT_CONTACT: 0,
            NEWSLETTER: 0,
            SOCIAL_PUSH: 0,
          },
          ADMIN_GRANT: {
            JOB_BOOST: 0,
            TALENT_CONTACT: 0,
            NEWSLETTER: 0,
            SOCIAL_PUSH: 0,
          },
        },
      },
    });
  });

  it("replaces the whole Free baseline with one effective subscription", () => {
    const result = resolveEffectiveEntitlements(
      resolutionInput({ subscriptions: [paidSubscription()] }),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        source: {
          kind: "SUBSCRIPTION",
          planSlug: "pro",
          subscriptionId: "subscription-1",
        },
        planRights: PRO_RIGHTS,
        rights: PRO_RIGHTS,
      },
    });
  });

  it("does not fill a missing paid-plan key from Free", () => {
    const incomplete = paidSubscription({
      planVersion: planVersion({
        id: "paid-incomplete",
        planSlug: "pro",
        isDefaultFree: false,
        entitlements: entitlementRows(PRO_RIGHTS).slice(0, -1),
      }),
    });
    expect(
      resolveEffectiveEntitlements(
        resolutionInput({ subscriptions: [incomplete] }),
      ),
    ).toEqual({
      ok: false,
      error: { code: "MISSING_ENTITLEMENT", key: "EMPLOYER_IMPORT_ACCESS" },
    });
  });

  it("uses half-open subscription periods and accepts CANCELLING until end", () => {
    const subscription = paidSubscription({ status: "CANCELLING" });
    const atStart = resolveEffectiveEntitlements(
      resolutionInput({
        at: subscription.currentPeriodStart,
        subscriptions: [subscription],
      }),
    );
    const atEnd = resolveEffectiveEntitlements(
      resolutionInput({
        at: subscription.currentPeriodEnd,
        subscriptions: [subscription],
      }),
    );

    expect(atStart).toMatchObject({ ok: true, value: { source: { kind: "SUBSCRIPTION" } } });
    expect(atEnd).toMatchObject({ ok: true, value: { source: { kind: "DEFAULT_FREE" } } });
  });

  it("fails closed for zero or multiple effective Free versions", () => {
    expect(
      resolveEffectiveEntitlements(
        resolutionInput({ defaultFreePlanVersions: [] }),
      ),
    ).toMatchObject({ ok: false, error: { code: "MISSING_DEFAULT_FREE" } });
    expect(
      resolveEffectiveEntitlements(
        resolutionInput({
          defaultFreePlanVersions: [
            planVersion(),
            planVersion({ id: "another-free-version" }),
          ],
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "AMBIGUOUS_DEFAULT_FREE" } });
  });

  it("fails closed for multiple effective subscriptions", () => {
    expect(
      resolveEffectiveEntitlements(
        resolutionInput({
          subscriptions: [
            paidSubscription(),
            paidSubscription({ id: "subscription-2" }),
          ],
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "AMBIGUOUS_SUBSCRIPTION" } });
  });
});

describe("typed catalog fail-closed validation", () => {
  it("contains exactly the eight frozen entitlement keys", () => {
    expect(ENTITLEMENT_KEYS_V1).toEqual([
      "ACTIVE_JOB_LIMIT",
      "SEAT_LIMIT",
      "TALENT_RADAR_ACCESS",
      "TALENT_CONTACT_ALLOWANCE",
      "JOB_BOOST_ALLOWANCE",
      "ANALYTICS_LEVEL",
      "ENHANCED_COMPANY_PROFILE",
      "EMPLOYER_IMPORT_ACCESS",
    ]);
  });

  it.each(ENTITLEMENT_KEYS_V1)("rejects a duplicate %s row", (key) => {
    const rows = entitlementRows(FREE_RIGHTS);
    const duplicate = rows.find((row) => row.key === key);
    expect(duplicate).toBeDefined();
    const result = resolveEffectiveEntitlements(
      resolutionInput({
        defaultFreePlanVersions: [
          planVersion({ entitlements: [...rows, duplicate as PlanEntitlementRecord] }),
        ],
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: { code: "DUPLICATE_ENTITLEMENT", key },
    });
  });

  it("rejects unknown keys", () => {
    const rows = entitlementRows(FREE_RIGHTS);
    rows[0] = { ...rows[0]!, key: "FUTURE_UNKNOWN_KEY" };
    expect(
      resolveEffectiveEntitlements(
        resolutionInput({
          defaultFreePlanVersions: [planVersion({ entitlements: rows })],
        }),
      ),
    ).toEqual({
      ok: false,
      error: { code: "UNKNOWN_ENTITLEMENT_KEY", key: "FUTURE_UNKNOWN_KEY" },
    });
  });

  it("rejects a key/type mismatch and multiple populated value columns", () => {
    const wrongType = entitlementRows(FREE_RIGHTS);
    wrongType[0] = {
      key: "ACTIVE_JOB_LIMIT",
      valueType: "BOOLEAN",
      booleanValue: true,
      integerValue: null,
      analyticsLevelValue: null,
    };
    expect(
      resolveEffectiveEntitlements(
        resolutionInput({
          defaultFreePlanVersions: [planVersion({ entitlements: wrongType })],
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "ENTITLEMENT_TYPE_MISMATCH", key: "ACTIVE_JOB_LIMIT" },
    });

    const multipleValues = entitlementRows(FREE_RIGHTS);
    multipleValues[0] = { ...multipleValues[0]!, booleanValue: false };
    expect(
      resolveEffectiveEntitlements(
        resolutionInput({
          defaultFreePlanVersions: [planVersion({ entitlements: multipleValues })],
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_ENTITLEMENT_VALUE", key: "ACTIVE_JOB_LIMIT" },
    });
  });
});

describe("typed active grants", () => {
  it("applies non-negative ADD and non-reducing REPLACE deterministically", () => {
    const result = resolveEffectiveEntitlements(
      resolutionInput({
        grants: [
          grant({ id: "add-2", integerValue: 2, integerMode: "ADD" }),
          grant({ id: "replace-5", integerValue: 5, integerMode: "REPLACE" }),
          grant({ id: "add-3", integerValue: 3, integerMode: "ADD" }),
        ],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        planRights: { ACTIVE_JOB_LIMIT: 1 },
        rights: { ACTIVE_JOB_LIMIT: 10 },
      },
    });
  });

  it("raises Boolean and Analytics access", () => {
    const result = resolveEffectiveEntitlements(
      resolutionInput({
        grants: [
          grant({
            id: "radar",
            key: "TALENT_RADAR_ACCESS",
            valueType: "BOOLEAN",
            booleanValue: true,
            integerValue: null,
            integerMode: null,
          }),
          grant({
            id: "analytics",
            key: "ANALYTICS_LEVEL",
            valueType: "ANALYTICS_LEVEL",
            integerValue: null,
            analyticsLevelValue: "ADVANCED",
            integerMode: null,
          }),
        ],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        rights: {
          TALENT_RADAR_ACCESS: true,
          ANALYTICS_LEVEL: "ADVANCED",
        },
      },
    });
  });

  it("combines multiple Analytics grants by highest level independent of row order", () => {
    const analyticsGrant = (
      id: string,
      analyticsLevelValue: "ADVANCED" | "PRO",
    ) =>
      grant({
        id,
        key: "ANALYTICS_LEVEL",
        valueType: "ANALYTICS_LEVEL",
        integerValue: null,
        analyticsLevelValue,
        integerMode: null,
      });
    for (const grants of [
      [analyticsGrant("pro", "PRO"), analyticsGrant("advanced", "ADVANCED")],
      [analyticsGrant("advanced", "ADVANCED"), analyticsGrant("pro", "PRO")],
    ]) {
      expect(
        resolveEffectiveEntitlements(resolutionInput({ grants })),
      ).toMatchObject({
        ok: true,
        value: { rights: { ANALYTICS_LEVEL: "PRO" } },
      });
    }
  });

  it.each([
    grant({ integerMode: "REPLACE", integerValue: 0 }),
    grant({
      key: "TALENT_RADAR_ACCESS",
      valueType: "BOOLEAN",
      booleanValue: false,
      integerValue: null,
      integerMode: null,
    }),
  ])("rejects a grant that reduces or cannot raise access", (reducingGrant) => {
    expect(
      resolveEffectiveEntitlements(
        resolutionInput({ grants: [reducingGrant] }),
      ),
    ).toMatchObject({ ok: false, error: { code: "GRANT_REDUCES_ACCESS" } });
  });

  it("ignores revoked and expired grants at the exact boundary", () => {
    const result = resolveEffectiveEntitlements(
      resolutionInput({
        grants: [
          grant({ id: "expired", validTo: new Date(AT) }),
          grant({ id: "revoked", revokedAt: new Date(AT) }),
        ],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: { rights: { ACTIVE_JOB_LIMIT: 1 }, appliedGrantIds: [] },
    });
  });

  it("fails closed for an active foreign-company grant", () => {
    expect(
      resolveEffectiveEntitlements(
        resolutionInput({ grants: [grant({ companyId: "foreign-company" })] }),
      ),
    ).toMatchObject({ ok: false, error: { code: "GRANT_SCOPE_MISMATCH" } });
  });

  it("keeps plan rights separate when a global grant raises import access", () => {
    const result = resolveEffectiveEntitlements(
      resolutionInput({
        grants: [
          grant({
            key: "EMPLOYER_IMPORT_ACCESS",
            valueType: "BOOLEAN",
            booleanValue: true,
            integerValue: null,
            integerMode: null,
          }),
        ],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        planRights: { EMPLOYER_IMPORT_ACCESS: false },
        rights: { EMPLOYER_IMPORT_ACCESS: true },
      },
    });
  });
});

describe("ledger separation and repository wrapper", () => {
  it("returns source-separated balances without changing plan rights", () => {
    const result = resolveEffectiveEntitlements(
      resolutionInput({
        fundableCredits: [
          { fundingSource: "PLAN_ALLOWANCE", creditType: "TALENT_CONTACT", available: 2 },
          { fundingSource: "PURCHASED_PACK", creditType: "TALENT_CONTACT", available: 4 },
          { fundingSource: "ADMIN_GRANT", creditType: "JOB_BOOST", available: 1 },
        ],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        rights: { TALENT_RADAR_ACCESS: false },
        fundableBySource: {
          PLAN_ALLOWANCE: { TALENT_CONTACT: 2 },
          PURCHASED_PACK: { TALENT_CONTACT: 4 },
          ADMIN_GRANT: { JOB_BOOST: 1 },
        },
      },
    });
  });

  it("fails closed on malformed ledger summaries", () => {
    expect(
      resolveEffectiveEntitlements(
        resolutionInput({
          fundableCredits: [
            { fundingSource: "UNKNOWN", creditType: "TALENT_CONTACT", available: 1 },
          ],
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "INVALID_LEDGER_SUMMARY" } });
  });

  it("loads every source through getEffectiveEntitlements", async () => {
    const repository: EntitlementRepository = {
      listDefaultFreePlanVersions: vi.fn(async () => [planVersion()]),
      listCompanySubscriptions: vi.fn(async () => []),
      listCompanyEntitlementGrants: vi.fn(async () => []),
      listFundableCredits: vi.fn(async () => []),
    };
    const result = await getEffectiveEntitlements(COMPANY_ID, AT, repository);

    expect(result).toMatchObject({ ok: true });
    expect(repository.listDefaultFreePlanVersions).toHaveBeenCalledWith(AT);
    expect(repository.listCompanySubscriptions).toHaveBeenCalledWith(COMPANY_ID, AT);
    expect(repository.listCompanyEntitlementGrants).toHaveBeenCalledWith(COMPANY_ID, AT);
    expect(repository.listFundableCredits).toHaveBeenCalledWith(COMPANY_ID, AT);
  });
});
