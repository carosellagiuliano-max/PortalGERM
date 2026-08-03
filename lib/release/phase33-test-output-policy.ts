const ANSI_ESCAPE_SEQUENCE = new RegExp(
  `${String.fromCharCode(27)}\\[[0-9;]*m`,
  "gu",
);

const VITEST_INFRASTRUCTURE_FAILURES = Object.freeze([
  /(?:^|\n)\s*Unhandled Errors?\s*(?:\r?\n|$)/iu,
  /Vitest caught\s+[1-9]\d*\s+unhandled errors?/iu,
  /(?:^|\n)\s*Errors\s+[1-9]\d*\s+errors?\b/iu,
  /\[vitest-pool(?:-runner)?\]:\s+(?:Failed|Timeout)/iu,
  /UnhandledPromiseRejection|Unhandled Rejection|Uncaught Exception/iu,
]);

// Vitest recreates an isolated worker for every file. On Windows, repeatedly
// starting workers inside one pool can time out even with maxWorkers=1. The
// outer runner therefore supplies an explicit, small file batch to each fresh
// Vitest process instead of relying on a static shard count that silently grows
// as the suite gains files.
export const UNIT_TEST_FILES_PER_INVOCATION = 3;

export function assertVitestOutputHasNoInfrastructureFailures(
  output: string,
): void {
  const normalized = output.replaceAll(ANSI_ESCAPE_SEQUENCE, "");
  if (
    VITEST_INFRASTRUCTURE_FAILURES.some((pattern) => pattern.test(normalized))
  ) {
    throw new Error("VITEST_INFRASTRUCTURE_ERROR_REPORTED");
  }
}

export function assertPhase33TestCommandOutput(
  commandId: string,
  output: string,
): void {
  assertVitestOutputHasNoInfrastructureFailures(output);
  const normalized = output.replaceAll(ANSI_ESCAPE_SEQUENCE, "");
  if (/\b(?:[1-9]\d*)\s+(?:skipped|pending)\b/iu.test(normalized)) {
    throw new Error(`PHASE33_UNEXPLAINED_SKIP:${commandId}`);
  }
}

export function unitTestInvocations(
  forwardedArguments: readonly string[],
  discoveredUnitTestFiles: readonly string[] = [],
): readonly (readonly string[])[] {
  const base = ["run", "--config", "vitest.config.ts"] as const;
  if (forwardedArguments.length > 0) {
    return [Object.freeze([...base, ...forwardedArguments])];
  }
  if (discoveredUnitTestFiles.length === 0) {
    throw new Error("UNIT_TEST_INVENTORY_EMPTY");
  }
  const files = [...discoveredUnitTestFiles].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  const unique = new Set<string>();
  for (const file of files) {
    if (!/^tests\/unit\/.+\.test\.tsx?$/u.test(file)) {
      throw new Error(`UNIT_TEST_FILE_INVALID:${file}`);
    }
    if (unique.has(file)) {
      throw new Error(`UNIT_TEST_FILE_DUPLICATE:${file}`);
    }
    unique.add(file);
  }
  return Object.freeze(
    Array.from(
      {
        length: Math.ceil(files.length / UNIT_TEST_FILES_PER_INVOCATION),
      },
      (_, index) =>
        Object.freeze([
          ...base,
          ...files.slice(
            index * UNIT_TEST_FILES_PER_INVOCATION,
            (index + 1) * UNIT_TEST_FILES_PER_INVOCATION,
          ),
        ]),
    ),
  );
}
