import {
  loadHashedExternalEvidence,
  validateIncidentDrillEvidence,
} from "@/lib/ops/external-operations-evidence";

try {
  const command = parseArguments(process.argv.slice(2));
  if (
    command.environment !== "staging" ||
    process.env.APP_ENV !== "staging"
  ) {
    throw new Error("INCIDENT_DRILL_CONTEXT_MISMATCH");
  }
  const raw = await loadHashedExternalEvidence({
    path: process.env.PHASE23_INCIDENT_EVIDENCE_PATH,
    expectedSha256: process.env.PHASE23_INCIDENT_EVIDENCE_SHA256,
    repositoryRoot: process.cwd(),
  });
  const result = validateIncidentDrillEvidence(raw, command.scenarios);
  process.stdout.write(
    `${JSON.stringify({ command: "phase23-incident-drill", ...result })}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      command: "phase23-incident-drill",
      status: "BLOCKED",
      error: errorCode(error),
    })}\n`,
  );
  process.exitCode = 1;
}

function parseArguments(values: readonly string[]) {
  let environment: string | undefined;
  let scenarios: readonly string[] | undefined;
  for (const value of values) {
    if (value === "--environment=staging") {
      environment = "staging";
      continue;
    }
    const match =
      /^--scenario=(queue-age,dlq,provider-outage,backup-failure,pii-canary)$/u.exec(
        value,
      );
    if (match !== null) {
      scenarios = Object.freeze(match[1]!.split(","));
      continue;
    }
    throw new Error("INCIDENT_DRILL_ARGUMENT_INVALID");
  }
  if (environment === undefined || scenarios === undefined) {
    throw new Error("INCIDENT_DRILL_ARGUMENT_INCOMPLETE");
  }
  return Object.freeze({ environment, scenarios });
}

function errorCode(error: unknown) {
  if (!(error instanceof Error)) return "EXTERNAL_EVIDENCE_FAILED";
  return error.message
    .toUpperCase()
    .replaceAll(/[^A-Z0-9_:-]/gu, "_")
    .slice(0, 64);
}
