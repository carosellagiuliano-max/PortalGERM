import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PHASE33_CI_PINNED_ACTIONS,
  PHASE33_CI_WORKFLOW_PATH,
  inspectPhase33CiWorkflow,
  phase33CiImageReference,
} from "@/lib/release/phase33-ci-workflow-contract";
import {
  PHASE33_RELEASE_POLICY_VERSION,
  PHASE33_TECHNICAL_GATE_IDS,
} from "@/lib/release/phase33-release-verdict";
import { PHASE33_TEST_COMMAND_IDS } from "@/lib/release/phase33-test-report-contract";

const DIGEST = `sha256:${"a".repeat(64)}`;
const COMMIT = "b".repeat(40);
const workflow = readFileSync(
  resolve(import.meta.dirname, `../../../${PHASE33_CI_WORKFLOW_PATH}`),
  "utf8",
);

describe("Phase-33 GitHub Actions G4 contract", () => {
  it("keeps the checked-in workflow read-only, pinned and fail-closed", () => {
    expect(PHASE33_TEST_COMMAND_IDS).toHaveLength(38);
    expect(PHASE33_CI_PINNED_ACTIONS).toHaveLength(3);
    expect(inspectPhase33CiWorkflow(workflow)).toEqual({
      issues: [],
      status: "PASS",
    });
    expect(workflow).toContain("test-results/phase33/logs/*.log");
  });

  it.each([
    [
      "moving action tag",
      (source: string) => source.replace(
        PHASE33_CI_PINNED_ACTIONS[0],
        "actions/checkout@v5",
      ),
      "ACTION_PIN_SET_INVALID",
    ],
    [
      "secret authority",
      (source: string) => `${source}\n# \${{ secrets.PRODUCTION_TOKEN }}\n`,
      "PRODUCTION_AUTHORITY_OR_EFFECT_FORBIDDEN",
    ],
    [
      "failure artifact upload",
      (source: string) => source.replace(
        "uses: actions/upload-artifact@",
        "if: ${{ always() }}\n        uses: actions/upload-artifact@",
      ),
      "PREPASS_OR_UNBOUNDED_UPLOAD_FORBIDDEN",
    ],
    [
      "missing full gate",
      (source: string) => source.replace(
        "run: npm run test:phase33",
        "run: npm test",
      ),
      "FULL_G4_COMMAND_NOT_EXACTLY_ONCE",
    ],
  ] as const)("rejects %s", (_name, mutate, expectedIssue) => {
    expect(inspectPhase33CiWorkflow(mutate(workflow)).issues).toContain(
      expectedIssue,
    );
  });

  it("extracts only a schema-valid, candidate-bound, output-safe OCI reference", () => {
    expect(phase33CiImageReference(validReport(), COMMIT)).toBe(
      "swisstalenthub-phase33-run-1234-abcdef01-contract-app-contract:latest",
    );
    expect(() => phase33CiImageReference(validReport(), "c".repeat(40))).toThrow(
      "PHASE33_CI_TEST_REPORT_CANDIDATE_MISMATCH",
    );
    const unsafe = validReport();
    unsafe.artifacts.ociImage.reference = "safe:latest\nforged=value";
    expect(() => phase33CiImageReference(unsafe, COMMIT)).toThrow(
      "PHASE33_CI_OCI_REFERENCE_UNSAFE",
    );
  });
});

function validReport() {
  return {
    schemaVersion: "phase33-test-report-v1",
    policyVersion: PHASE33_RELEASE_POLICY_VERSION,
    candidateCommitSha: COMMIT,
    coveredTechnicalTargets: ["LC4", "LC5"],
    isolatedCleanClone: true,
    generatedAt: "2026-08-02T00:00:00.000Z",
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
        sizeBytes: 1,
        fileName: "recovery-manifest.json",
        runId: "1234567890abcdef",
        sourceDatabase: "swisstalenthub_release_test_1234567890abcdef",
        restoreDatabase: "swisstalenthub_restore_test_1234567890abcdef",
        localSnapshotToBackupLatencySeconds: 1,
        localRestoreDurationSeconds: 1,
      },
      standalone: {
        kind: "phase33-standalone-application-v1",
        digest: DIGEST,
        fileCount: 1,
        sizeBytes: 1,
      },
      ociImage: {
        imageId: DIGEST,
        sizeBytes: 1,
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
          sizeBytes: 1,
          services: ["app-local"],
          networks: ["database", "front"],
        },
        productionContract: {
          profile: "production-contract",
          projectName: "swisstalenthub-phase33-run-1234-abcdef01-contract",
          digest: `sha256:${"d".repeat(64)}`,
          sizeBytes: 1,
          services: ["app-contract"],
          networks: ["database", "edge"],
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
      startedAt: "2026-08-02T00:00:00.000Z",
      completedAt: "2026-08-02T00:00:01.000Z",
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
