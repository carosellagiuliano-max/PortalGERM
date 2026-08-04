import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  invalidatePhase33EvidenceOutput,
  readPhase33CommandLogFile,
  readPhase33EvidenceFile,
  readPhase33ExternalLedgerFile,
  resolvePhase33CommandLogPath,
  resolvePhase33EvidencePath,
  writePhase33EvidenceAtomic,
} from "@/lib/release/phase33-release-files";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Phase-33 release evidence files", () => {
  it("invalidates stale evidence and atomically publishes only the final JSON", async () => {
    const repository = await temporaryRepository();
    const output = resolvePhase33EvidencePath(
      repository,
      "test-results/phase33/test-report.json",
      ["test-report.json"],
    );
    await invalidatePhase33EvidenceOutput(repository, output);
    await writeFile(output, "stale", "utf8");

    await invalidatePhase33EvidenceOutput(repository, output);
    await writePhase33EvidenceAtomic(repository, output, '{"status":"PASS"}\n');

    await expect(readFile(output, "utf8")).resolves.toBe('{"status":"PASS"}\n');
    await expect(
      writePhase33EvidenceAtomic(repository, output, "replacement"),
    ).rejects.toThrow("PHASE33_EVIDENCE_OUTPUT_ALREADY_EXISTS");
  });

  it("denies traversal, nesting and unapproved output names", async () => {
    const repository = await temporaryRepository();
    for (const path of [
      "test-results/phase33/nested/test-report.json",
      "test-results/PHASE33/test-report.json",
      "test-results/phase33/report.json",
      "../test-report.json",
    ]) {
      expect(() =>
        resolvePhase33EvidencePath(repository, path, ["test-report.json"]),
      ).toThrow("PHASE33_EVIDENCE_PATH_OUT_OF_SCOPE");
    }
  });

  it("reads only a stable regular file inside the real evidence directory", async () => {
    const repository = await temporaryRepository();
    const input = resolvePhase33EvidencePath(
      repository,
      "test-results/phase33/test-report.json",
      ["test-report.json"],
    );
    await invalidatePhase33EvidenceOutput(repository, input);
    await writeFile(input, '{"status":"PASS"}\n', "utf8");

    await expect(readPhase33EvidenceFile(repository, input)).resolves.toEqual(
      Buffer.from('{"status":"PASS"}\n'),
    );
  });

  it("denies an evidence-file symlink and a junction-backed test-results root", async () => {
    const repository = await temporaryRepository();
    const evidenceRoot = resolve(repository, "test-results", "phase33");
    await mkdir(evidenceRoot, { recursive: true });
    const outside = resolve(repository, "outside.json");
    await writeFile(outside, "{}", "utf8");
    const linkedInput = resolve(evidenceRoot, "test-report.json");
    await symlink(outside, linkedInput, "file");
    await expect(
      readPhase33EvidenceFile(repository, linkedInput),
    ).rejects.toThrow("PHASE33_EVIDENCE_INPUT_SYMLINK_DENIED");

    await rm(resolve(repository, "test-results"), {
      recursive: true,
      force: true,
    });
    const externalRoot = resolve(repository, "external-results");
    await mkdir(resolve(externalRoot, "phase33"), { recursive: true });
    await symlink(
      externalRoot,
      resolve(repository, "test-results"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      readPhase33EvidenceFile(
        repository,
        resolve(repository, "test-results", "phase33", "test-report.json"),
      ),
    ).rejects.toThrow("PHASE33_EVIDENCE_DIRECTORY_SYMLINK_DENIED");
  });

  it("denies a junction-backed phase33 evidence root", async () => {
    const repository = await temporaryRepository();
    const externalRoot = resolve(repository, "external-phase33");
    await mkdir(externalRoot, { recursive: true });
    await mkdir(resolve(repository, "test-results"), { recursive: true });
    await symlink(
      externalRoot,
      resolve(repository, "test-results", "phase33"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(
      readPhase33EvidenceFile(
        repository,
        resolve(repository, "test-results", "phase33", "test-report.json"),
      ),
    ).rejects.toThrow("PHASE33_EVIDENCE_DIRECTORY_SYMLINK_DENIED");
  });

  it("allows only a bounded direct command log under the real logs directory", async () => {
    const repository = await temporaryRepository();
    const log = resolvePhase33CommandLogPath(
      repository,
      "test-results/phase33/logs/unit.log",
      ["unit.log"],
    );
    await mkdir(resolve(repository, "test-results/phase33/logs"), {
      recursive: true,
    });
    await writeFile(log, "bounded output", "utf8");

    await expect(
      readPhase33CommandLogFile(repository, log, 64),
    ).resolves.toEqual(Buffer.from("bounded output"));
    await expect(readPhase33CommandLogFile(repository, log, 4)).rejects.toThrow(
      "PHASE33_EVIDENCE_INPUT_TOO_LARGE",
    );
    expect(() =>
      resolvePhase33CommandLogPath(
        repository,
        "test-results/phase33/logs/nested/unit.log",
        ["unit.log"],
      ),
    ).toThrow("PHASE33_COMMAND_LOG_PATH_OUT_OF_SCOPE");
  });

  it("denies a junction-backed log root and a direct command-log symlink", async () => {
    const junctionRepository = await temporaryRepository();
    const externalLogs = resolve(junctionRepository, "external-logs");
    await mkdir(externalLogs, { recursive: true });
    await writeFile(resolve(externalLogs, "unit.log"), "outside", "utf8");
    await mkdir(resolve(junctionRepository, "test-results", "phase33"), {
      recursive: true,
    });
    const linkedLogRoot = resolve(
      junctionRepository,
      "test-results",
      "phase33",
      "logs",
    );
    await symlink(
      externalLogs,
      linkedLogRoot,
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      readPhase33CommandLogFile(
        junctionRepository,
        resolve(linkedLogRoot, "unit.log"),
        64,
      ),
    ).rejects.toThrow("PHASE33_EVIDENCE_DIRECTORY_SYMLINK_DENIED");

    const symlinkRepository = await temporaryRepository();
    const logRoot = resolve(
      symlinkRepository,
      "test-results",
      "phase33",
      "logs",
    );
    await mkdir(logRoot, { recursive: true });
    const target = resolve(symlinkRepository, "direct-log-target.txt");
    await writeFile(target, "inside", "utf8");
    const linkedLog = resolve(logRoot, "unit.log");
    await symlink(target, linkedLog, "file");
    await expect(
      readPhase33CommandLogFile(symlinkRepository, linkedLog, 64),
    ).rejects.toThrow("PHASE33_EVIDENCE_INPUT_SYMLINK_DENIED");
  });

  it("reads an external ledger only as a bounded stable regular file", async () => {
    const repository = await temporaryRepository();
    const ledger = resolve(repository, "external-ledger.json");
    await writeFile(ledger, '{"status":"PENDING"}', "utf8");
    await expect(readPhase33ExternalLedgerFile(ledger, 64)).resolves.toEqual(
      Buffer.from('{"status":"PENDING"}'),
    );
    await expect(readPhase33ExternalLedgerFile(ledger, 4)).rejects.toThrow(
      "PHASE33_EVIDENCE_INPUT_TOO_LARGE",
    );
    await expect(
      readPhase33ExternalLedgerFile(ledger, Number.MAX_SAFE_INTEGER),
    ).rejects.toThrow("PHASE33_EVIDENCE_INPUT_LIMIT_INVALID");

    const linked = resolve(repository, "external-ledger-link.json");
    await symlink(ledger, linked, "file");
    await expect(readPhase33ExternalLedgerFile(linked)).rejects.toThrow(
      "PHASE33_EVIDENCE_INPUT_SYMLINK_DENIED",
    );
  });

  it("accepts an ancestor workspace link for direct evidence inputs", async () => {
    const realRepository = await temporaryRepository();
    const aliasRoot = await mkdtemp(
      resolve(tmpdir(), "phase33-evidence-alias-test-"),
    );
    temporaryRoots.push(aliasRoot);
    const repositoryAlias = resolve(aliasRoot, "repository");
    await symlink(
      realRepository,
      repositoryAlias,
      process.platform === "win32" ? "junction" : "dir",
    );

    const evidence = resolvePhase33EvidencePath(
      repositoryAlias,
      "test-results/phase33/test-report.json",
      ["test-report.json"],
    );
    await invalidatePhase33EvidenceOutput(repositoryAlias, evidence);
    await writePhase33EvidenceAtomic(
      repositoryAlias,
      evidence,
      '{"status":"PASS"}\n',
    );
    await expect(
      readPhase33EvidenceFile(repositoryAlias, evidence),
    ).resolves.toEqual(Buffer.from('{"status":"PASS"}\n'));

    const log = resolvePhase33CommandLogPath(
      repositoryAlias,
      "test-results/phase33/logs/unit.log",
      ["unit.log"],
    );
    await mkdir(resolve(repositoryAlias, "test-results/phase33/logs"), {
      recursive: true,
    });
    await writeFile(log, "bounded output", "utf8");
    await expect(
      readPhase33CommandLogFile(repositoryAlias, log, 64),
    ).resolves.toEqual(Buffer.from("bounded output"));

    const ledger = resolve(repositoryAlias, "external-ledger.json");
    await writeFile(ledger, '{"status":"PENDING"}', "utf8");
    await expect(readPhase33ExternalLedgerFile(ledger, 64)).resolves.toEqual(
      Buffer.from('{"status":"PENDING"}'),
    );
  });
});

async function temporaryRepository() {
  const root = await mkdtemp(resolve(tmpdir(), "phase33-evidence-test-"));
  temporaryRoots.push(root);
  return root;
}
