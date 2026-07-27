import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadHashedExternalEvidence,
  validateBackupRestoreEvidence,
  validateIncidentDrillEvidence,
  validateStagingDeploymentEvidence,
} from "@/lib/ops/external-operations-evidence";

const temporaryDirectories: string[] = [];
const INSTANT = "2026-07-27T20:00:00.000Z";
const DIGEST = "a".repeat(64);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("Phase-23 external operations evidence", () => {
  it("accepts a same-digest staging deploy/migrate/canary/rollback manifest", () => {
    const raw = {
      contract: "phase23-staging-deploy-v1",
      environment: "staging",
      status: "PASSED",
      artifactDigest: "git-phase23",
      testedArtifactDigest: "git-phase23",
      immutableArtifact: true,
      scenarios: ["deploy", "migrate", "canary", "rollback"],
      migration: {
        emptyDatabasePassed: true,
        upgradeDatabasePassed: true,
        pendingCount: 0,
        lockBudgetExceeded: false,
      },
      canary: {
        liveStatus: 200,
        readyStatus: 200,
        workerStatus: "HEALTHY",
        demoRowCount: 0,
      },
      rollback: {
        passed: true,
        durationMilliseconds: 30_000,
        approvedBudgetMilliseconds: 60_000,
      },
      owner: "ops-primary",
      evidenceRef: "pager:evidence:phase23",
      recordedAt: INSTANT,
    };
    expect(
      validateStagingDeploymentEvidence(raw, {
        artifactDigest: "git-phase23",
        scenarios: ["deploy", "migrate", "canary", "rollback"],
      }),
    ).toMatchObject({ status: "PASSED", artifactDigest: "git-phase23" });
    expect(() =>
      validateStagingDeploymentEvidence(
        {
          ...raw,
          testedArtifactDigest: "different-build",
        },
        {
          artifactDigest: "git-phase23",
          scenarios: ["deploy", "migrate", "canary", "rollback"],
        },
      ),
    ).toThrow(/mismatch/iu);
  });

  it("requires all pager scenarios, separate owners and bounded alert/ack timing", () => {
    const scenarios = [
      "queue-age",
      "dlq",
      "provider-outage",
      "backup-failure",
      "pii-canary",
    ] as const;
    const evidence = {
      contract: "phase23-incident-drill-v1",
      environment: "staging",
      pagerMode: "sandbox",
      status: "PASSED",
      scenarios: scenarios.map((scenario) => ({
        scenario,
        alertAt: INSTANT,
        pageAt: "2026-07-27T20:00:10.000Z",
        acknowledgedAt: "2026-07-27T20:00:20.000Z",
        recoveredAt: "2026-07-27T20:01:00.000Z",
        primaryOwner: "ops-primary",
        secondaryOwner: "ops-secondary",
        runbookRef: `runbook:${scenario}`,
      })),
      alertIntervalMilliseconds: 10_000,
      approvedAckMilliseconds: 30_000,
      piiCanaryMatches: 0,
      secretCanaryMatches: 0,
      owner: "ops-primary",
      evidenceRef: "pager:evidence:phase23",
      recordedAt: INSTANT,
    };
    expect(validateIncidentDrillEvidence(evidence, scenarios)).toMatchObject({
      status: "PASSED",
      scenarioCount: 5,
    });
    expect(() =>
      validateIncidentDrillEvidence(
        {
          ...evidence,
          scenarios: evidence.scenarios.map((scenario) => ({
            ...scenario,
            secondaryOwner: "ops-primary",
          })),
        },
        scenarios,
      ),
    ).toThrow(/timeline/iu);
  });

  it("requires a distinct encrypted restore within approved RPO/RTO", () => {
    const raw = {
      contract: "phase23-backup-restore-v1",
      environment: "staging",
      status: "PASSED",
      sourceId: "staging-source",
      restoreId: "staging-restore-isolated",
      encrypted: true,
      identitySeparated: true,
      sourceChecksum: DIGEST,
      restoredChecksum: DIGEST,
      sourceSchemaDigest: DIGEST,
      restoredSchemaDigest: DIGEST,
      sourceCountDigest: DIGEST,
      restoredCountDigest: DIGEST,
      backupCapturedAt: "2026-07-27T19:00:00.000Z",
      restoreStartedAt: "2026-07-27T20:00:00.000Z",
      restoreCompletedAt: "2026-07-27T20:30:00.000Z",
      measuredRpoMilliseconds: 3_600_000,
      measuredRtoMilliseconds: 1_800_000,
      approvedRpoMilliseconds: 86_400_000,
      approvedRtoMilliseconds: 28_800_000,
      approvalRef: "approval:business-ops",
      owner: "ops-primary",
      evidenceRef: "restore:evidence:phase23",
      recordedAt: INSTANT,
    };
    expect(
      validateBackupRestoreEvidence(raw, {
        sourceId: "staging-source",
        restoreId: "staging-restore-isolated",
      }),
    ).toMatchObject({ status: "PASSED" });
    expect(() =>
      validateBackupRestoreEvidence(
        { ...raw, measuredRtoMilliseconds: 30_000_000 },
        {
          sourceId: "staging-source",
          restoreId: "staging-restore-isolated",
        },
      ),
    ).toThrow(/invalid/iu);
  });

  it("loads only a bounded outside-repository file with the expected SHA-256", async () => {
    const directory = join(
      tmpdir(),
      `swisstalenthub-phase23-evidence-${crypto.randomUUID()}`,
    );
    await mkdir(directory, { recursive: true });
    temporaryDirectories.push(directory);
    const path = join(directory, "evidence.json");
    const content = JSON.stringify({ contract: "test" });
    await writeFile(path, content, "utf8");
    const digest = createHash("sha256").update(content).digest("hex");
    await expect(
      loadHashedExternalEvidence({
        path,
        expectedSha256: digest,
        repositoryRoot: process.cwd(),
      }),
    ).resolves.toEqual({ contract: "test" });
    await expect(
      loadHashedExternalEvidence({
        path,
        expectedSha256: "b".repeat(64),
        repositoryRoot: process.cwd(),
      }),
    ).rejects.toThrow(/DIGEST_MISMATCH/u);
  });
});
