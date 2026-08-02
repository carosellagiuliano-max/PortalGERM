import { describe, expect, it } from "vitest";

import {
  PHASE33_TEST_COMMAND_IDS,
  assertPhase33CommandLogSet,
  phase33TestReportSchema,
} from "@/lib/release/phase33-test-report-contract";
import {
  PHASE33_RELEASE_POLICY_VERSION,
  PHASE33_TECHNICAL_GATE_IDS,
} from "@/lib/release/phase33-release-verdict";

const DIGEST = `sha256:${"a".repeat(64)}`;
const COMMIT = "b".repeat(40);

describe("Phase-33 test report contract", () => {
  it("requires exactly one regular command log and rejects extra evidence", () => {
    const exact = PHASE33_TEST_COMMAND_IDS.map((id) => ({
      name: `${id}.log`,
      regularFile: true,
    }));
    expect(() =>
      assertPhase33CommandLogSet(exact, PHASE33_TEST_COMMAND_IDS),
    ).not.toThrow();
    expect(() =>
      assertPhase33CommandLogSet(
        [...exact, { name: "unreviewed.log", regularFile: true }],
        PHASE33_TEST_COMMAND_IDS,
      ),
    ).toThrow("PHASE33_CI_COMMAND_LOG_SET_INVALID");
    expect(() =>
      assertPhase33CommandLogSet(
        exact.map((entry, index) =>
          index === 0 ? { ...entry, regularFile: false } : entry,
        ),
        PHASE33_TEST_COMMAND_IDS,
      ),
    ).toThrow("PHASE33_CI_COMMAND_LOG_SET_INVALID");
  });

  it("accepts only the complete fixed clean-clone command and gate set", () => {
    expect(phase33TestReportSchema.safeParse(validReport()).success).toBe(true);

    const missing = validReport();
    missing.commands = missing.commands.slice(1);
    expect(phase33TestReportSchema.safeParse(missing).success).toBe(false);

    const duplicate = validReport();
    duplicate.commands[1] = duplicate.commands[0]!;
    expect(phase33TestReportSchema.safeParse(duplicate).success).toBe(false);
  });

  it("rejects a dirty/non-isolated claim, a non-zero summary or a non-pass gate", () => {
    expect(
      phase33TestReportSchema.safeParse({
        ...validReport(),
        isolatedCleanClone: false,
      }).success,
    ).toBe(false);
    expect(
      phase33TestReportSchema.safeParse({
        ...validReport(),
        summary: { ...validReport().summary, retries: 0 },
      }).success,
    ).toBe(false);
    const failedGate = validReport();
    failedGate.gates[0] = { ...failedGate.gates[0]!, outcome: "FAIL" };
    expect(phase33TestReportSchema.safeParse(failedGate).success).toBe(false);
  });

  it("covers LC4 and LC5 together and binds the exact OCI identity", () => {
    expect(
      phase33TestReportSchema.safeParse({
        ...validReport(),
        coveredTechnicalTargets: ["LC5"],
      }).success,
    ).toBe(false);
    const drifted = validReport();
    drifted.artifacts.ociImage.revision = "c".repeat(40);
    expect(phase33TestReportSchema.safeParse(drifted).success).toBe(false);
  });

  it("binds every command duration to ordered timestamps", () => {
    const reversed = validReport();
    reversed.commands[0]!.completedAt = "2026-08-01T22:59:59.000Z";
    expect(phase33TestReportSchema.safeParse(reversed).success).toBe(false);

    const inconsistent = validReport();
    inconsistent.commands[0]!.durationMilliseconds = 999;
    expect(phase33TestReportSchema.safeParse(inconsistent).success).toBe(false);
  });
});

function validReport() {
  return {
    schemaVersion: "phase33-test-report-v1",
    policyVersion: PHASE33_RELEASE_POLICY_VERSION,
    candidateCommitSha: COMMIT,
    coveredTechnicalTargets: ["LC4", "LC5"],
    isolatedCleanClone: true,
    generatedAt: "2026-08-01T23:30:00.000Z",
    tools: {
      node: "v24.18.0",
      npm: "11.16.0",
      docker: "28.0.0",
      compose: "2.40.0",
      postgresql: "PostgreSQL 16.13",
      playwright: "Version 1.61.1",
    },
    artifacts: {
      recovery: {
        schemaVersion: "phase18-release-gate-v2",
        digest: DIGEST,
        sizeBytes: 12_345,
        fileName: "recovery-manifest.json",
        runId: "1234567890abcdef",
        sourceDatabase: "swisstalenthub_release_test_1234567890abcdef",
        restoreDatabase: "swisstalenthub_restore_test_1234567890abcdef",
        localSnapshotToBackupLatencySeconds: 2,
        localRestoreDurationSeconds: 3,
      },
      standalone: {
        kind: "phase33-standalone-application-v1",
        digest: DIGEST,
        fileCount: 1_024,
        sizeBytes: 42_000_000,
      },
      ociImage: {
        imageId: DIGEST,
        sizeBytes: 420_000_000,
        service: "app-contract",
        revision: COMMIT,
        projectName: "swisstalenthub-phase33-run-1234-abcdef01-contract",
        reference:
          "swisstalenthub-phase33-run-1234-abcdef01-contract-app-contract:latest",
      },
      runtimeConfiguration: {
        localMock: {
          profile: "local-mock",
          projectName: "swisstalenthub-phase33-run-1234-abcdef01-local",
          digest: `sha256:${"c".repeat(64)}`,
          sizeBytes: 12_000,
          services: ["app", "worker"],
          networks: ["back", "front"],
        },
        productionContract: {
          profile: "production-contract",
          projectName: "swisstalenthub-phase33-run-1234-abcdef01-contract",
          digest: `sha256:${"d".repeat(64)}`,
          sizeBytes: 14_000,
          services: ["app-contract", "worker-contract"],
          networks: ["back", "front"],
        },
      },
    },
    summary: {
      candidateTreeChecks: 4,
      commands: PHASE33_TEST_COMMAND_IDS.length,
      failedCommands: 0,
      unexplainedSkips: 0,
    },
    commands: PHASE33_TEST_COMMAND_IDS.map((id) => ({
      id,
      command: `npm run ${id}`,
      startedAt: "2026-08-01T23:00:00.000Z",
      completedAt: "2026-08-01T23:00:01.000Z",
      durationMilliseconds: 1_000,
      exitCode: 0,
      outputDigest: DIGEST,
    })),
    gates: PHASE33_TECHNICAL_GATE_IDS.map((gateId) => ({
      gateId,
      outcome: "PASS",
      evidenceDigest: DIGEST,
    })),
  };
}
