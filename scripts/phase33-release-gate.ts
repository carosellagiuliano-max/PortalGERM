import { resolve } from "node:path";

import {
  evaluatePhase33ReleaseVerdict,
  phase33ReleaseExitCode,
} from "@/lib/release/phase33-release-verdict";
import {
  invalidatePhase33EvidenceOutput,
  readPhase33ExternalLedgerFile,
  readPhase33EvidenceFile,
  resolvePhase33EvidencePath,
  writePhase33EvidenceAtomic,
} from "@/lib/release/phase33-release-files";

type ReleaseMode = "activation" | "technical";
const repository = process.cwd();

try {
  await run();
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      command: "phase33-release-gate",
      error: safeError(error),
      status: "FAIL",
    })}\n`,
  );
  process.exitCode = 1;
}

async function run() {
  const command = parseArguments(process.argv.slice(2));
  if (command.outputPath !== undefined) {
    await invalidatePhase33EvidenceOutput(repository, command.outputPath);
  }
  const technicalManifest = await readTechnicalManifest(
    command.technicalManifestPath,
  );
  const externalLedger =
    command.externalLedgerPath === undefined
      ? undefined
      : await readJson(command.externalLedgerPath);
  const decision = evaluatePhase33ReleaseVerdict(
    technicalManifest,
    externalLedger,
  );
  const serialized = `${JSON.stringify(decision, null, 2)}\n`;
  if (command.outputPath !== undefined) {
    await writePhase33EvidenceAtomic(
      repository,
      command.outputPath,
      serialized,
    );
  }
  process.stdout.write(serialized);
  process.exitCode = phase33ReleaseExitCode(decision, command.mode);
}

function parseArguments(values: readonly string[]) {
  let mode: ReleaseMode = "technical";
  let technicalManifestPath: string | undefined;
  let externalLedgerPath: string | undefined;
  let outputPath: string | undefined;
  for (const value of values) {
    const modeMatch = /^--mode=(technical|activation)$/u.exec(value);
    if (modeMatch !== null) {
      mode = modeMatch[1] as ReleaseMode;
      continue;
    }
    const technicalMatch = /^--technical-manifest=(.+)$/u.exec(value);
    if (technicalMatch !== null) {
      if (technicalManifestPath !== undefined) {
        throw new Error("PHASE33_TECHNICAL_MANIFEST_DUPLICATE");
      }
      technicalManifestPath = resolve(technicalMatch[1] ?? "");
      continue;
    }
    const externalMatch = /^--external-ledger=(.+)$/u.exec(value);
    if (externalMatch !== null) {
      if (externalLedgerPath !== undefined) {
        throw new Error("PHASE33_EXTERNAL_LEDGER_DUPLICATE");
      }
      externalLedgerPath = resolve(externalMatch[1] ?? "");
      continue;
    }
    const outputMatch = /^--output=(.+)$/u.exec(value);
    if (outputMatch !== null) {
      if (outputPath !== undefined) {
        throw new Error("PHASE33_RELEASE_OUTPUT_DUPLICATE");
      }
      outputPath = resolve(outputMatch[1] ?? "");
      continue;
    }
    throw new Error("PHASE33_RELEASE_ARGUMENT_INVALID");
  }
  if (technicalManifestPath === undefined) {
    throw new Error("PHASE33_TECHNICAL_MANIFEST_REQUIRED");
  }
  technicalManifestPath = resolvePhase33EvidencePath(
    repository,
    technicalManifestPath,
    ["technical-manifest-lc4.json", "technical-manifest-lc5.json"],
  );
  if (outputPath !== undefined) {
    outputPath = resolvePhase33EvidencePath(repository, outputPath, [
      "release-verdict.json",
      "release-verdict-lc4.json",
      "release-verdict-lc5.json",
    ]);
  }
  return Object.freeze({
    externalLedgerPath,
    mode,
    outputPath,
    technicalManifestPath,
  });
}

async function readJson(path: string) {
  try {
    return JSON.parse(
      (await readPhase33ExternalLedgerFile(path)).toString("utf8"),
    ) as unknown;
  } catch {
    throw new Error("PHASE33_RELEASE_INPUT_INVALID");
  }
}

async function readTechnicalManifest(path: string) {
  try {
    return JSON.parse(
      (await readPhase33EvidenceFile(repository, path)).toString("utf8"),
    ) as unknown;
  } catch {
    throw new Error("PHASE33_RELEASE_INPUT_INVALID");
  }
}

function safeError(error: unknown) {
  const value = error instanceof Error ? error.message : "UNKNOWN_FAILURE";
  return value.replaceAll(/[^A-Za-z0-9_:.-]/gu, "_").slice(0, 256);
}
