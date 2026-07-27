import {
  loadHashedExternalEvidence,
  validateStagingDeploymentEvidence,
} from "@/lib/ops/external-operations-evidence";

try {
  const command = parseArguments(process.argv.slice(2));
  if (
    command.environment !== "staging" ||
    process.env.APP_ENV !== "staging" ||
    process.env.TESTED_ARTIFACT_DIGEST !== command.artifactDigest
  ) {
    throw new Error("STAGING_DEPLOYMENT_CONTEXT_MISMATCH");
  }
  const raw = await loadHashedExternalEvidence({
    path: process.env.PHASE23_STAGING_DEPLOY_EVIDENCE_PATH,
    expectedSha256: process.env.PHASE23_STAGING_DEPLOY_EVIDENCE_SHA256,
    repositoryRoot: process.cwd(),
  });
  const result = validateStagingDeploymentEvidence(raw, {
    artifactDigest: command.artifactDigest,
    scenarios: command.scenarios,
  });
  process.stdout.write(
    `${JSON.stringify({
      command: "phase23-staging-deploy-smoke",
      ...result,
    })}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      command: "phase23-staging-deploy-smoke",
      status: "BLOCKED",
      error: errorCode(error),
    })}\n`,
  );
  process.exitCode = 1;
}

function parseArguments(values: readonly string[]) {
  let environment: string | undefined;
  let artifactDigest: string | undefined;
  let scenarios: readonly string[] | undefined;
  for (const value of values) {
    const environmentMatch = /^--environment=(staging)$/u.exec(value);
    if (environmentMatch !== null) {
      environment = environmentMatch[1];
      continue;
    }
    const digestMatch =
      /^--artifact-digest=([A-Za-z0-9][A-Za-z0-9._:+/-]{0,127})$/u.exec(
        value,
      );
    if (digestMatch !== null) {
      artifactDigest = digestMatch[1];
      continue;
    }
    const scenarioMatch =
      /^--scenario=(deploy,migrate,canary,rollback)$/u.exec(value);
    if (scenarioMatch !== null) {
      scenarios = Object.freeze(scenarioMatch[1]!.split(","));
      continue;
    }
    throw new Error("STAGING_DEPLOYMENT_ARGUMENT_INVALID");
  }
  if (
    environment === undefined ||
    artifactDigest === undefined ||
    scenarios === undefined
  ) {
    throw new Error("STAGING_DEPLOYMENT_ARGUMENT_INCOMPLETE");
  }
  return Object.freeze({ environment, artifactDigest, scenarios });
}

function errorCode(error: unknown) {
  if (!(error instanceof Error)) return "EXTERNAL_EVIDENCE_FAILED";
  return error.message
    .toUpperCase()
    .replaceAll(/[^A-Z0-9_:-]/gu, "_")
    .slice(0, 64);
}
