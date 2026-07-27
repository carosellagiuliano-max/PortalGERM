import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ADMIN_CAPABILITIES_V1,
  hasAdminCapability,
} from "@/lib/admin/capabilities";
import {
  ADMIN_DUTY_CONFLICTS_V2,
  ADMIN_ROLE_CATALOG_V2,
  dutiesConflict,
} from "@/lib/admin/role-policy";

describe("Phase 25 admin role and capability matrix", () => {
  it("grants no capability from the historical global ADMIN role alone", () => {
    for (const capability of ADMIN_CAPABILITIES_V1) {
      expect(
        hasAdminCapability(
          { userId: crypto.randomUUID(), role: "ADMIN", status: "ACTIVE" },
          capability,
        ),
      ).toBe(false);
    }
  });

  it("covers every closed capability through an explicit bounded role", () => {
    const granted = Object.values(ADMIN_ROLE_CATALOG_V2).flatMap(
      ({ capabilities }) => capabilities,
    );
    expect(new Set(granted)).toEqual(new Set(ADMIN_CAPABILITIES_V1));
    expect(ADMIN_CAPABILITIES_V1.length).toBeGreaterThanOrEqual(36);
  });

  it("keeps support isolated from finance, privacy and security duties", () => {
    expect(ADMIN_ROLE_CATALOG_V2.SUPPORT_AGENT.capabilities).toEqual([
      "ADMIN_SUPPORT_MANAGE",
    ]);
    expect(
      ADMIN_ROLE_CATALOG_V2.SUPPORT_AGENT.capabilities.some((capability) =>
        /BILLING|PRIVACY|SECURITY|TRUST/u.test(capability),
      ),
    ).toBe(false);
  });

  it("forwards resolved capabilities through every Admin UI actor boundary", () => {
    const adminRoot = join(process.cwd(), "app", "admin");
    const missingCapabilityForwarding = collectTypeScriptFiles(adminRoot)
      .flatMap((path) => {
        const source = readFileSync(path, "utf8");
        return [...source.matchAll(/\bactor:\s*\{([^{}]*)\}/gu)]
          .filter((match) =>
            /\brole:/u.test(match[1] ?? "") &&
            /\bstatus:/u.test(match[1] ?? "") &&
            !/\bcapabilities:/u.test(match[1] ?? ""),
          )
          .map(() => path);
      });

    expect(missingCapabilityForwarding).toEqual([]);
  });

  it.each(ADMIN_DUTY_CONFLICTS_V2)(
    "rejects the %s and %s duty combination in both directions",
    (left, right) => {
      expect(dutiesConflict([left], right)).toBe(true);
      expect(dutiesConflict([right], left)).toBe(true);
    },
  );
});

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(path);
    return entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name) ? [path] : [];
  });
}
