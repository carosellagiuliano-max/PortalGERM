import { phase33CiImageReference } from "@/lib/release/phase33-ci-workflow-contract";
import {
  readPhase33EvidenceFile,
  resolvePhase33EvidencePath,
} from "@/lib/release/phase33-release-files";

const repository = process.cwd();

try {
  const command = parseArguments(process.argv.slice(2));
  const raw: unknown = JSON.parse(
    (
      await readPhase33EvidenceFile(repository, command.reportPath)
    ).toString("utf8"),
  );
  process.stdout.write(`${phase33CiImageReference(raw, command.candidate)}\n`);
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      command: "phase33-ci-report-reference",
      error: safeError(error),
      status: "FAIL",
    })}\n`,
  );
  process.exitCode = 1;
}

function parseArguments(values: readonly string[]) {
  let candidate: string | undefined;
  let report: string | undefined;
  for (const value of values) {
    const candidateMatch = /^--candidate=([a-f0-9]{40}|[a-f0-9]{64})$/u.exec(
      value,
    );
    if (candidateMatch !== null && candidate === undefined) {
      candidate = candidateMatch[1];
      continue;
    }
    const reportMatch = /^--report=(.+)$/u.exec(value);
    if (reportMatch !== null && report === undefined) {
      report = reportMatch[1];
      continue;
    }
    throw new Error("PHASE33_CI_REPORT_ARGUMENT_INVALID");
  }
  if (candidate === undefined || report === undefined) {
    throw new Error("PHASE33_CI_REPORT_ARGUMENT_REQUIRED");
  }
  return Object.freeze({
    candidate,
    reportPath: resolvePhase33EvidencePath(repository, report, [
      "test-report.json",
    ]),
  });
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "UNKNOWN_FAILURE")
    .replaceAll(/[^A-Za-z0-9_:.-]/gu, "_")
    .slice(0, 256);
}
