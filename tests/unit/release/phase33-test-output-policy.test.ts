import { describe, expect, it } from "vitest";

import {
  assertPhase33TestCommandOutput,
  assertVitestOutputHasNoInfrastructureFailures,
  UNIT_TEST_SHARD_COUNT,
  unitTestInvocations,
} from "@/lib/release/phase33-test-output-policy";

describe("Phase 33 test output policy", () => {
  it("rejects a Vitest unhandled worker failure even when all collected tests passed", () => {
    const output = [
      "Test Files 351 passed (351)",
      "Tests 2608 passed (2608)",
      "\u001B[31mUnhandled Errors\u001B[39m",
      "Vitest caught 1 unhandled error during the test run.",
      "Errors 1 error",
    ].join("\n");

    expect(() => assertVitestOutputHasNoInfrastructureFailures(output)).toThrow(
      "VITEST_INFRASTRUCTURE_ERROR_REPORTED",
    );
    expect(() => assertPhase33TestCommandOutput("unit", output)).toThrow(
      "VITEST_INFRASTRUCTURE_ERROR_REPORTED",
    );
  });

  it("accepts a clean Vitest summary and still rejects unexplained skips", () => {
    const clean = "Test Files 88 passed (88)\nTests 651 passed (651)";
    expect(() => assertPhase33TestCommandOutput("unit", clean)).not.toThrow();
    expect(() =>
      assertPhase33TestCommandOutput("unit", `${clean}\n1 skipped`),
    ).toThrow("PHASE33_UNEXPLAINED_SKIP:unit");
  });

  it("runs targeted arguments once and the complete suite in bounded shards", () => {
    expect(unitTestInvocations(["tests/unit/example.test.ts"])).toEqual([
      ["run", "--config", "vitest.config.ts", "tests/unit/example.test.ts"],
    ]);
    const full = unitTestInvocations([]);
    expect(full).toHaveLength(UNIT_TEST_SHARD_COUNT);
    expect(full[0]).toEqual([
      "run",
      "--config",
      "vitest.config.ts",
      "--shard=1/64",
    ]);
    expect(full.at(-1)).toEqual([
      "run",
      "--config",
      "vitest.config.ts",
      "--shard=64/64",
    ]);
  });
});
