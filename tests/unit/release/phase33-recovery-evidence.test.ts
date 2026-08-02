import { describe, expect, it } from "vitest";

import {
  PHASE33_REQUIRED_RECOVERY_COMMANDS,
  parsePhase33RecoveryEvidence,
} from "@/lib/release/phase33-recovery-evidence";

const COMMIT = "a".repeat(40);

describe("Phase 33 retained recovery evidence", () => {
  it("binds a successful, cleaned recovery drill to the candidate", () => {
    const evidence = parsePhase33RecoveryEvidence(
      `${JSON.stringify(manifest())}\n`,
      COMMIT,
    );

    expect(evidence.artifact).toMatchObject({
      schemaVersion: "phase18-release-gate-v2",
      fileName: "recovery-manifest.json",
      runId: "1234567890abcdef",
      localSnapshotToBackupLatencySeconds: 2,
      localRestoreDurationSeconds: 3,
    });
    expect(evidence.artifact.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("rejects candidate drift and incomplete cleanup", () => {
    expect(() =>
      parsePhase33RecoveryEvidence(
        `${JSON.stringify(manifest())}\n`,
        "b".repeat(40),
      ),
    ).toThrow("PHASE33_RECOVERY_CANDIDATE_MISMATCH");

    const incomplete = manifest();
    incomplete.cleanup.databasesRemoved = false as never;
    expect(() =>
      parsePhase33RecoveryEvidence(JSON.stringify(incomplete), COMMIT),
    ).toThrow();
  });

  it("rejects a mismatched run identity, reversed timestamps and a fake refusal", () => {
    const mismatched = manifest();
    mismatched.database.restore =
      "swisstalenthub_restore_test_fedcba0987654321";
    expect(() =>
      parsePhase33RecoveryEvidence(JSON.stringify(mismatched), COMMIT),
    ).toThrow("PHASE33_RECOVERY_DATABASE_RUN_ID_MISMATCH");

    const reversed = manifest();
    reversed.release.completedAt = "2026-08-01T23:59:59.000Z";
    expect(() =>
      parsePhase33RecoveryEvidence(JSON.stringify(reversed), COMMIT),
    ).toThrow("PHASE33_RECOVERY_TIMESTAMP_ORDER_INVALID");

    expect(() =>
      parsePhase33RecoveryEvidence(JSON.stringify(manifest()), COMMIT, {
        startedAt: "2026-08-02T00:00:30.000Z",
        completedAt: "2026-08-02T00:02:00.000Z",
      }),
    ).toThrow("PHASE33_RECOVERY_COMMAND_WINDOW_MISMATCH");

    const fakeRefusal = manifest();
    fakeRefusal.commands.find(
      ({ command }) => command === "Production demo-seed guard",
    )!.exitCode = 0;
    expect(() =>
      parsePhase33RecoveryEvidence(JSON.stringify(fakeRefusal), COMMIT),
    ).toThrow();
  });

  it("rejects an omitted restore, a duplicate and an unknown recovery command", () => {
    const omitted = manifest();
    omitted.commands = omitted.commands.filter(
      ({ command }) => command !== "isolated encrypted restore",
    );
    expect(() =>
      parsePhase33RecoveryEvidence(JSON.stringify(omitted), COMMIT),
    ).toThrow();

    const duplicate = manifest();
    duplicate.commands[0] = { ...duplicate.commands[1]! };
    expect(() =>
      parsePhase33RecoveryEvidence(JSON.stringify(duplicate), COMMIT),
    ).toThrow("PHASE33_RECOVERY_COMMAND_SET_INVALID");

    const unknown = manifest();
    unknown.commands[0]!.command = "unapproved recovery shortcut" as never;
    expect(() =>
      parsePhase33RecoveryEvidence(JSON.stringify(unknown), COMMIT),
    ).toThrow("PHASE33_RECOVERY_COMMAND_SET_INVALID");
  });
});

function manifest() {
  const databaseSuffix = "1234567890abcdef";
  return {
    schemaVersion: "phase18-release-gate-v2",
    status: "passed",
    runId: databaseSuffix,
    release: {
      branch: "HEAD",
      commit: COMMIT,
      startedAt: "2026-08-02T00:00:00.000Z",
      completedAt: "2026-08-02T00:01:00.000Z",
    },
    runtime: {
      node: "v24.18.0",
      npm: "11.6.0",
      git: "git version 2.50.0",
      docker: "Docker version 28.0.0",
      compose: "Docker Compose version v2.40.0",
      pgDump: "pg_dump (PostgreSQL) 16.13",
      pgRestore: "pg_restore (PostgreSQL) 16.13",
      age: "v1.2.1",
      os: "win32-x64",
    },
    database: {
      source: `swisstalenthub_release_test_${databaseSuffix}`,
      restore: `swisstalenthub_restore_test_${databaseSuffix}`,
      productionGuard: `swisstalenthub_guard_test_${databaseSuffix}`,
      seedManifestSha256: "c".repeat(64),
    },
    recovery: {
      ciphertextSha256: "d".repeat(64),
      encryptedBytes: 1_024,
      location: "external ephemeral drill directory (removed after evidence)",
      retentionClass: "ephemeral restore-drill artifact",
      retentionTarget: "not configured/approved",
      localSnapshotToBackupLatencySeconds: 2,
      localRestoreDurationSeconds: 3,
      unapprovedRpoHypothesisSeconds: 86_400,
      unapprovedRtoHypothesisSeconds: 28_800,
    },
    commands: PHASE33_REQUIRED_RECOVERY_COMMANDS.map(
      ([command, expectedOutcome]) => ({
        command,
        durationMs: 1,
        exitCode: expectedOutcome === "SUCCESS" ? 0 : 1,
        expectedOutcome,
      }),
    ),
    cleanup: {
      backupRemoved: true,
      cloneRemoved: true,
      databasesRemoved: true,
      identityRemoved: true,
    },
    knownLimitations: ["local only"],
  };
}
