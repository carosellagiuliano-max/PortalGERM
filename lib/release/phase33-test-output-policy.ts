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

export const UNIT_TEST_SHARD_COUNT = 16;

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
): readonly (readonly string[])[] {
  const base = ["run", "--config", "vitest.config.ts"] as const;
  if (forwardedArguments.length > 0) {
    return [Object.freeze([...base, ...forwardedArguments])];
  }
  return Object.freeze(
    Array.from({ length: UNIT_TEST_SHARD_COUNT }, (_, index) =>
      Object.freeze([
        ...base,
        `--shard=${String(index + 1)}/${String(UNIT_TEST_SHARD_COUNT)}`,
      ]),
    ),
  );
}
