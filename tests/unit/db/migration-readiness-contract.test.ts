import { readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { REQUIRED_MIGRATION_ID } from "@/lib/db/health";

describe("migration readiness contract", () => {
  it("pins readiness to the latest committed migration", () => {
    const migrations = readdirSync(resolve(process.cwd(), "prisma/migrations"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(migrations.at(-1)).toBe(REQUIRED_MIGRATION_ID);
  });
});
