import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { parsePhase33RecoveryEvidence } from "@/lib/release/phase33-recovery-evidence";
import {
  readPhase33CommandLogFile,
  readPhase33EvidenceFile,
  resolvePhase33CommandLogPath,
  resolvePhase33EvidencePath,
} from "@/lib/release/phase33-release-files";
import {
  evaluatePhase33ReleaseVerdict,
  phase33ReleaseExitCode,
  phase33TechnicalManifestSchema,
  type Phase33TechnicalTarget,
} from "@/lib/release/phase33-release-verdict";
import {
  PHASE33_COMMAND_LOG_MAX_BYTES,
  assertPhase33CommandLogSet,
  phase33TestReportSchema,
  type Phase33TestReport,
} from "@/lib/release/phase33-test-report-contract";

const repository = process.cwd();

try {
  await run(parseArguments(process.argv.slice(2)));
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      command: "phase33-ci-evidence-verify",
      error: safeError(error),
      status: "FAIL",
    })}\n`,
  );
  process.exitCode = 1;
}

async function run(command: ReturnType<typeof parseArguments>) {
  const reportPath = evidencePath("test-report.json");
  const reportInput = await readJson(reportPath);
  const report = phase33TestReportSchema.parse(reportInput.value);
  if (report.candidateCommitSha !== command.candidate) {
    throw new Error("PHASE33_CI_EVIDENCE_CANDIDATE_MISMATCH");
  }
  const reportDigest = digestBuffer(reportInput.serialized);
  await assertRecoveryEvidence(report, command.candidate);
  await assertCommandLogEvidence(report);
  const manifests = [];

  for (const target of ["LC4", "LC5"] as const) {
    const suffix = target.toLocaleLowerCase("en");
    const manifestInput = await readJson(
      evidencePath(`technical-manifest-${suffix}.json`),
    );
    const manifest = phase33TechnicalManifestSchema.parse(manifestInput.value);
    const storedVerdict = (
      await readJson(evidencePath(`release-verdict-${suffix}.json`))
    ).value;
    assertTargetEvidence({
      candidate: command.candidate,
      manifest,
      report,
      reportDigest,
      storedVerdict,
      target,
    });
    manifests.push(manifest);
  }

  if (!isDeepStrictEqual(manifests[0]?.artifacts, manifests[1]?.artifacts)) {
    throw new Error("PHASE33_CI_TARGET_ARTIFACT_DRIFT");
  }
  process.stdout.write(
    `${JSON.stringify({
      command: "phase33-ci-evidence-verify",
      candidateCommitSha: command.candidate,
      coveredTechnicalTargets: ["LC4", "LC5"],
      activation: "ACTIVATION_BLOCKED_BY_EXTERNAL_GATES",
      status: "PASS",
    })}\n`,
  );
}

async function assertRecoveryEvidence(
  report: Phase33TestReport,
  candidate: string,
) {
  const recoveryReceipt = report.commands.find(({ id }) => id === "recovery");
  if (recoveryReceipt === undefined) {
    throw new Error("PHASE33_CI_RECOVERY_RECEIPT_MISSING");
  }
  const recovery = await readPhase33EvidenceFile(
    repository,
    evidencePath("recovery-manifest.json"),
  );
  const retained = parsePhase33RecoveryEvidence(
    recovery.toString("utf8"),
    candidate,
    recoveryReceipt,
  );
  if (!isDeepStrictEqual(retained.artifact, report.artifacts.recovery)) {
    throw new Error("PHASE33_CI_RECOVERY_EVIDENCE_DRIFT");
  }
}

async function assertCommandLogEvidence(report: Phase33TestReport) {
  const allowed = report.commands.map(({ id }) => `${id}.log`);
  const entries = await readdir(
    resolve(repository, "test-results", "phase33", "logs"),
    { withFileTypes: true },
  );
  assertPhase33CommandLogSet(
    entries.map((entry) => ({
      name: entry.name,
      regularFile: entry.isFile(),
    })),
    report.commands.map(({ id }) => id),
  );
  for (const receipt of report.commands) {
    const name = `${receipt.id}.log`;
    const path = resolvePhase33CommandLogPath(
      repository,
      `test-results/phase33/logs/${name}`,
      allowed,
    );
    const log = await readPhase33CommandLogFile(
      repository,
      path,
      PHASE33_COMMAND_LOG_MAX_BYTES,
    );
    if (digestBuffer(log) !== receipt.outputDigest) {
      throw new Error(`PHASE33_CI_COMMAND_LOG_DRIFT:${receipt.id}`);
    }
  }
}

function assertTargetEvidence(
  input: Readonly<{
    candidate: string;
    manifest: ReturnType<typeof phase33TechnicalManifestSchema.parse>;
    report: ReturnType<typeof phase33TestReportSchema.parse>;
    reportDigest: string;
    storedVerdict: unknown;
    target: Phase33TechnicalTarget;
  }>,
) {
  if (
    input.manifest.candidateCommitSha !== input.candidate ||
    input.manifest.requestedTechnicalTarget !== input.target ||
    input.manifest.artifacts.testReport !== input.reportDigest ||
    input.manifest.artifacts.standalone !==
      input.report.artifacts.standalone.digest ||
    input.manifest.artifacts.ociImage !==
      input.report.artifacts.ociImage.imageId ||
    input.manifest.artifacts.recovery !==
      input.report.artifacts.recovery.digest ||
    !isDeepStrictEqual(input.manifest.gates, input.report.gates)
  ) {
    throw new Error(`PHASE33_CI_${input.target}_EVIDENCE_DRIFT`);
  }
  const expected = evaluatePhase33ReleaseVerdict(input.manifest);
  const expectedTechnical =
    input.target === "LC4"
      ? "TECHNICALLY_READY_FOR_LC4"
      : "TECHNICALLY_READY_FOR_LC5_CONFIGURATION";
  if (
    !isDeepStrictEqual(input.storedVerdict, expected) ||
    expected.technical.verdict !== expectedTechnical ||
    expected.technical.blockers.length !== 0 ||
    expected.activation.verdict !== "ACTIVATION_BLOCKED_BY_EXTERNAL_GATES" ||
    !expected.activation.blockers.includes("EXTERNAL_LEDGER_MISSING") ||
    phase33ReleaseExitCode(expected, "technical") !== 0 ||
    phase33ReleaseExitCode(expected, "activation") !== 2 ||
    JSON.stringify(input.storedVerdict).includes("GO_LIVE_APPROVED")
  ) {
    throw new Error(`PHASE33_CI_${input.target}_VERDICT_INVALID`);
  }
}

function parseArguments(values: readonly string[]) {
  if (values.length !== 1) {
    throw new Error("PHASE33_CI_EVIDENCE_ARGUMENT_INVALID");
  }
  const match = /^--candidate=([a-f0-9]{40}|[a-f0-9]{64})$/u.exec(
    values[0] ?? "",
  );
  if (match === null) throw new Error("PHASE33_CI_EVIDENCE_CANDIDATE_REQUIRED");
  return Object.freeze({ candidate: match[1]! });
}

function evidencePath(name: string) {
  return resolvePhase33EvidencePath(
    repository,
    `test-results/phase33/${name}`,
    [name],
  );
}

async function readJson(path: string) {
  try {
    const serialized = await readPhase33EvidenceFile(repository, path);
    return Object.freeze({
      serialized,
      value: JSON.parse(serialized.toString("utf8")) as unknown,
    });
  } catch {
    throw new Error("PHASE33_CI_EVIDENCE_JSON_INVALID");
  }
}

function digestBuffer(value: Buffer) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "UNKNOWN_FAILURE")
    .replaceAll(/[^A-Za-z0-9_:.-]/gu, "_")
    .slice(0, 256);
}
