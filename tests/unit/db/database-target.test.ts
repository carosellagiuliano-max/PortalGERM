import { describe, expect, it } from "vitest";

import { inspectPostgresTarget } from "@/lib/db/database-target";

describe("inspectPostgresTarget", () => {
  it.each([
    "not-a-url",
    "https://db.invalid/database",
    "postgresql://db.invalid",
    "postgresql://db.invalid/%E0%A4%A",
  ])("returns undefined without throwing for an invalid target (%s)", (value) => {
    expect(() => inspectPostgresTarget(value)).not.toThrow();
    expect(inspectPostgresTarget(value)).toBeUndefined();
  });

  it("normalizes host aliases, default ports and credentials for identity checks", () => {
    const first = inspectPostgresTarget(
      "postgresql://first:secret@localhost/SwissTalentHub_Test?schema=PUBLIC",
    );
    const second = inspectPostgresTarget(
      "postgresql://second:different@127.0.0.1:5432/swisstalenthub_test?schema=public",
    );

    expect(first).toMatchObject({
      databaseName: "SwissTalentHub_Test",
      hostname: "loopback",
      schemaName: "public",
    });
    expect(first?.identity).toBe(second?.identity);
    expect(JSON.stringify(first)).not.toContain("first");
    expect(JSON.stringify(first)).not.toContain("secret");
  });
});
