import { describe, expect, it } from "vitest";

import {
  assertFreshMigrationBaseline,
  MIGRATION_OWNED_DOMAIN_ROW_COUNTS,
} from "@/lib/ops/release-database-baseline";

describe("Phase-18 fresh release database baseline", () => {
  it("accepts only the exact migration-owned Phase-25 security catalog", () => {
    expect(() =>
      assertFreshMigrationBaseline({
        AdminRole: 10,
        AdminRoleCapability: 58,
        Company: 0,
        Job: 0,
        User: 0,
      }),
    ).not.toThrow();
    expect(MIGRATION_OWNED_DOMAIN_ROW_COUNTS).toEqual({
      AdminRole: 10,
      AdminRoleCapability: 58,
    });
  });

  it("rejects any business or demo row", () => {
    expect(() =>
      assertFreshMigrationBaseline({
        AdminRole: 10,
        AdminRoleCapability: 58,
        Company: 1,
      }),
    ).toThrow(/Company=1 \(expected 0\)/u);
  });

  it("rejects security-catalog drift and missing catalog tables", () => {
    expect(() =>
      assertFreshMigrationBaseline({
        AdminRole: 9,
        AdminRoleCapability: 59,
      }),
    ).toThrow(
      /AdminRole=9 \(expected 10\).*AdminRoleCapability=59 \(expected 58\)/u,
    );

    expect(() =>
      assertFreshMigrationBaseline({
        AdminRole: 10,
      }),
    ).toThrow(/AdminRoleCapability=missing \(expected 58\)/u);
  });
});
