// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ADMIN_FUNNEL_POLICY_V1,
  parseAdminFunnelFiltersV1,
  type AdminFunnelClusterOption,
} from "@/lib/analytics/admin-funnels";

const NOW = new Date("2026-07-21T10:00:00.000Z");
const CLUSTERS: readonly AdminFunnelClusterOption[] = Object.freeze([
  Object.freeze({
    key: "ZH:engineering-technik",
    cantonCode: "ZH",
    cantonName: "Zürich",
    categorySlug: "engineering-technik",
    categoryName: "Engineering & Technik",
  }),
]);

describe("Phase 12 admin funnel filters", () => {
  it("uses the bounded default without warning on an unfiltered first visit", () => {
    const filters = parseAdminFunnelFiltersV1({}, NOW, CLUSTERS);

    expect(filters).toMatchObject({
      fromDate: "2026-06-21",
      toDate: "2026-07-21",
      clusterKey: null,
      channel: "ALL",
      plan: "ALL",
      adjusted: false,
    });
  });

  it("accepts only bounded dates and allowlisted cluster, channel and Plan values", () => {
    const filters = parseAdminFunnelFiltersV1(
      {
        from: "2026-06-21",
        to: "2026-07-21",
        cluster: "ZH:engineering-technik",
        channel: "JOB_SEARCH",
        plan: "PRO",
      },
      NOW,
      CLUSTERS,
    );

    expect(filters).toEqual({
      fromDate: "2026-06-21",
      toDate: "2026-07-21",
      maximumToDate: "2026-07-21",
      from: new Date("2026-06-20T22:00:00.000Z"),
      to: new Date("2026-07-20T22:00:00.000Z"),
      clusterKey: "ZH:engineering-technik",
      channel: "JOB_SEARCH",
      plan: "PRO",
      adjusted: false,
    });
  });

  it("falls back as one closed policy instead of passing arbitrary query values through", () => {
    const filters = parseAdminFunnelFiltersV1(
      {
        from: "2025-01-01",
        to: "2025-02-01",
        cluster: "BE:private-pii-segment",
        channel: "email@example.ch",
        plan: "hidden-contract",
      },
      NOW,
      CLUSTERS,
    );

    expect(filters).toMatchObject({
      fromDate: "2026-06-21",
      toDate: "2026-07-21",
      maximumToDate: "2026-07-21",
      clusterKey: null,
      channel: "ALL",
      plan: "ALL",
      adjusted: true,
    });
    expect(
      (filters.to.getTime() - filters.from.getTime()) / 86_400_000,
    ).toBe(30);
  });

  it("treats the explicit ALL cluster as valid and preserves Zurich DST boundaries", () => {
    const filters = parseAdminFunnelFiltersV1(
      {
        from: "2026-03-29",
        to: "2026-03-30",
        cluster: "ALL",
        channel: "ALL",
        plan: "ALL",
      },
      new Date("2026-04-01T10:00:00.000Z"),
      CLUSTERS,
    );

    expect(filters.adjusted).toBe(false);
    expect(filters.clusterKey).toBeNull();
    expect(filters.from).toEqual(new Date("2026-03-28T23:00:00.000Z"));
    expect(filters.to).toEqual(new Date("2026-03-29T22:00:00.000Z"));
    expect(filters.to.getTime() - filters.from.getTime()).toBe(23 * 3_600_000);
  });

  it("freezes the public limits used by every card and query", () => {
    expect(ADMIN_FUNNEL_POLICY_V1).toMatchObject({
      version: "ADMIN_FUNNELS_V1",
      definitionVersion: "v1",
      businessTimezone: "Europe/Zurich",
      maximumCohortDays: 90,
      minimumDenominatorSubjects: 20,
    });
  });
});
