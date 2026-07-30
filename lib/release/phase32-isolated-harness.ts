export function phase32IsolatedHarnessEnvironment(
  environment: Readonly<NodeJS.ProcessEnv>,
): NodeJS.ProcessEnv {
  if (
    environment.APP_ENV !== "local" ||
    environment.NODE_ENV !== "test" ||
    environment.CI !== "true"
  ) {
    throw new Error(
      "Phase 32 isolated orchestration requires the local CI test harness; only nested builds and servers may run with production semantics.",
    );
  }

  return { ...environment };
}
