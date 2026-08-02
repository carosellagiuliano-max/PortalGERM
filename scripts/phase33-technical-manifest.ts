import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  digestPhase32Directory,
  digestPhase32File,
} from "@/lib/release/phase32-artifact-digest";
import {
  invalidatePhase33EvidenceOutput,
  readPhase33EvidenceFile,
  resolvePhase33EvidencePath,
  writePhase33EvidenceAtomic,
} from "@/lib/release/phase33-release-files";
import { parsePhase33RecoveryEvidence } from "@/lib/release/phase33-recovery-evidence";
import { assertPhase33OciImageMatchesReceipt } from "@/lib/release/phase33-oci-identity";
import { PHASE33_CLEAN_TREE_GIT_ARGUMENTS } from "@/lib/release/phase33-process-invocation";
import {
  PHASE33_RELEASE_POLICY_VERSION,
  phase33TechnicalManifestSchema,
  type Phase33TechnicalManifest,
} from "@/lib/release/phase33-release-verdict";
import { phase33TestReportSchema } from "@/lib/release/phase33-test-report-contract";

const repository = resolve(import.meta.dirname, "..");

try {
  await run();
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      command: "phase33-technical-manifest",
      status: "FAIL",
      error: safeError(error),
    })}\n`,
  );
  process.exitCode = 1;
}

async function run() {
  const command = parseArguments(process.argv.slice(2));
  await invalidatePhase33EvidenceOutput(repository, command.outputPath);
  for (const verdictName of [
    "release-verdict.json",
    `release-verdict-${command.target.toLowerCase()}.json`,
  ]) {
    await invalidatePhase33EvidenceOutput(
      repository,
      resolve(repository, "test-results", "phase33", verdictName),
    );
  }
  assertTrackedTreeClean();
  const candidateCommitSha = gitText("rev-parse", "HEAD").trim();
  const testReportInput = await readTestReport(command.testReportPath);
  const testReport = testReportInput.report;
  if (testReport.candidateCommitSha !== candidateCommitSha) {
    throw new Error("TEST_REPORT_CANDIDATE_MISMATCH");
  }
  if (!testReport.coveredTechnicalTargets.includes(command.target)) {
    throw new Error("TEST_REPORT_TARGET_MISMATCH");
  }
  const retainedRecovery = parsePhase33RecoveryEvidence(
    (
      await readPhase33EvidenceFile(
        repository,
        command.recoveryManifestPath,
      )
    ).toString("utf8"),
    candidateCommitSha,
  );
  if (
    !isDeepStrictEqual(
      retainedRecovery.artifact,
      testReport.artifacts.recovery,
    )
  ) {
    throw new Error("RECOVERY_MANIFEST_REPORT_BINDING_MISMATCH");
  }
  const ociImageDigest = dockerImageDigest(
    command.ociImage,
    candidateCommitSha,
    testReport.artifacts.ociImage,
  );
  const manifest = {
    policyVersion: PHASE33_RELEASE_POLICY_VERSION,
    candidateCommitSha,
    requestedTechnicalTarget: command.target,
    historicalPhase32Decision: "NO_GO",
    artifacts: {
      sourceTree: digestBuffer(gitBuffer("archive", "--format=tar", "HEAD")),
      lockfile: phase32FileDigest(
        await digestPhase32File(resolve(repository, "package-lock.json")),
      ),
      migrations: phase32DirectoryDigest(
        await digestPhase32Directory(resolve(repository, "prisma/migrations")),
      ),
      compose: phase32FileDigest(
        await digestPhase32File(resolve(repository, "compose.phase33.yml")),
      ),
      standalone: testReport.artifacts.standalone.digest,
      ociImage: ociImageDigest,
      recovery: retainedRecovery.artifact.digest,
      testReport: digestBuffer(testReportInput.serialized),
    },
    gates: testReport.gates,
  } satisfies Phase33TechnicalManifest;
  const validated = phase33TechnicalManifestSchema.parse(manifest);
  const serialized = `${JSON.stringify(validated, null, 2)}\n`;
  await writePhase33EvidenceAtomic(repository, command.outputPath, serialized);
  process.stdout.write(serialized);
}

function parseArguments(values: readonly string[]) {
  const argumentsByName = new Map<string, string>();
  for (const value of values) {
    const match = /^--([a-z-]+)=(.+)$/u.exec(value);
    if (match === null || argumentsByName.has(match[1]!)) {
      throw new Error("PHASE33_MANIFEST_ARGUMENT_INVALID");
    }
    argumentsByName.set(match[1]!, match[2]!);
  }
  const target = argumentsByName.get("target");
  if (target !== "LC4" && target !== "LC5") {
    throw new Error("PHASE33_MANIFEST_TARGET_REQUIRED");
  }
  const testReport = argumentsByName.get("test-report");
  const ociImage = argumentsByName.get("oci-image");
  const output = argumentsByName.get("output");
  if (
    testReport === undefined ||
    ociImage === undefined ||
    output === undefined
  ) {
    throw new Error("PHASE33_MANIFEST_INPUT_REQUIRED");
  }
  if (!/^[a-z0-9][a-z0-9._/@:-]{1,254}$/u.test(ociImage)) {
    throw new Error("PHASE33_OCI_IMAGE_INVALID");
  }
  const expectedManifestName = `technical-manifest-${target.toLowerCase()}.json`;
  const testReportPath = resolvePhase33EvidencePath(
    repository,
    testReport,
    ["test-report.json"],
  );
  return Object.freeze({
    ociImage,
    outputPath: resolvePhase33EvidencePath(repository, output, [
      expectedManifestName,
    ]),
    target,
    recoveryManifestPath: resolvePhase33EvidencePath(
      repository,
      resolve(dirname(testReportPath), "recovery-manifest.json"),
      ["recovery-manifest.json"],
    ),
    testReportPath,
  });
}

async function readTestReport(path: string) {
  const serialized = await readPhase33EvidenceFile(repository, path);
  const parsed = phase33TestReportSchema.safeParse(
    JSON.parse(serialized.toString("utf8")) as unknown,
  );
  if (!parsed.success) throw new Error("TEST_REPORT_INVALID");
  return Object.freeze({ report: parsed.data, serialized });
}

function assertTrackedTreeClean() {
  const status = gitText(...PHASE33_CLEAN_TREE_GIT_ARGUMENTS);
  const unsafe = status
    .split(/\r?\n/u)
    .filter((line) => line.length > 0);
  if (unsafe.length > 0) throw new Error("CANDIDATE_TREE_NOT_CLEAN");
}

function dockerImageDigest(
  image: string,
  candidateCommitSha: string,
  expected: Phase33TestReportOciImage,
) {
  const inspected = execFileSync("docker", ["image", "inspect", image], {
    cwd: repository,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 60_000,
    windowsHide: true,
  });
  return assertPhase33OciImageMatchesReceipt(
    JSON.parse(inspected) as unknown,
    expected,
    { candidateCommitSha, requestedReference: image },
  );
}

type Phase33TestReportOciImage = Awaited<
  ReturnType<typeof readTestReport>
>["report"]["artifacts"]["ociImage"];

function phase32FileDigest(input: Readonly<{ sha256: string }>) {
  return `sha256:${input.sha256}` as const;
}

function phase32DirectoryDigest(input: Readonly<{ sha256: string }>) {
  return `sha256:${input.sha256}` as const;
}

function digestBuffer(value: Buffer) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function gitText(...args: string[]) {
  return execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 60_000,
    windowsHide: true,
  });
}

function gitBuffer(...args: string[]) {
  return execFileSync("git", args, {
    cwd: repository,
    maxBuffer: 256 * 1024 * 1024,
    timeout: 60_000,
    windowsHide: true,
  });
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "UNKNOWN_FAILURE")
    .replaceAll(/[^A-Za-z0-9_:,./-]/gu, "_")
    .slice(0, 1_024);
}
