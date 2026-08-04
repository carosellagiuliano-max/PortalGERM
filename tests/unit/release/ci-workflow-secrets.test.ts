import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(import.meta.dirname, "../../../.github/workflows/ci.yml"),
  "utf8",
);

describe("CI workflow secret materialization", () => {
  it("constructs and masks database URLs at runtime instead of tracking them", () => {
    expect(workflow).not.toContain("postgresql://");
    expect(workflow).not.toMatch(/^\s+(?:DATABASE_URL|TEST_DATABASE_URL):/mu);
    expect(workflow.match(/DATABASE_URL=/gu)).toHaveLength(4);
    expect(workflow.match(/::add-mask::/gu)).toHaveLength(2);
    expect(workflow).toContain('"$database_url"');
    expect(workflow).toContain('"$test_database_url"');
    expect(workflow).toContain("$databaseUrl,");
    expect(workflow).toContain("$testDatabaseUrl");
  });

  it("installs every browser engine exercised by the full browser gate", () => {
    expect(workflow).toMatch(
      /playwright\/test\/cli\.js install --with-deps\s+chromium firefox webkit/u,
    );
    expect(workflow.indexOf("chromium firefox webkit")).toBeLessThan(
      workflow.indexOf("npm run test:e2e:browser"),
    );
  });
});
