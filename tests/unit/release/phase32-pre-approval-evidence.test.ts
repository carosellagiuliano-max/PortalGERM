import { describe, expect, it } from "vitest";

import {
  createPhase32PreApprovalEvidenceRoot,
  PHASE32_PRE_APPROVAL_EVIDENCE_VERSION,
  type Phase32PreApprovalEvidence,
} from "@/lib/release/phase32-pre-approval-evidence";
import {
  PHASE32_REQUIRED_REPORT_KINDS,
  PHASE32_REQUIRED_WALKTHROUGH_ROLES,
} from "@/lib/release/phase32-g4-manifest";

const COMMIT = "1".repeat(40);
const TREE = "2".repeat(40);
const LOCK = "3".repeat(64);
const MIGRATION = "4".repeat(64);
const SCHEMA = "5".repeat(64);
const ARTIFACT = "6".repeat(64);
const CONFIGURATION = "7".repeat(64);
const SBOM = "8".repeat(64);
const RUNTIME = "9".repeat(64);
const EVIDENCE = "a".repeat(64);
const ROLLBACK = "b".repeat(64);
const START = "2026-07-30T10:00:00.000+00:00";
const END = "2026-07-30T10:10:00.000+00:00";
const DEPLOYED = "2026-07-30T10:20:00.000+00:00";
const POST_DEPLOY_START = "2026-07-30T10:25:00.000+00:00";
const POST_DEPLOY_END = "2026-07-30T10:40:00.000+00:00";

type DeepMutable<T> = {
  -readonly [TKey in keyof T]: T[TKey] extends readonly (infer TItem)[]
    ? DeepMutable<TItem>[]
    : T[TKey] extends object
      ? DeepMutable<T[TKey]>
      : T[TKey];
};

type MutableEvidence = DeepMutable<Phase32PreApprovalEvidence>;

describe("Phase 32 pre-approval evidence root", () => {
  it("creates a canonical SHA-256 root over the complete LC1 evidence set", () => {
    const root = createPhase32PreApprovalEvidenceRoot(evidence());

    expect(root).toEqual({
      schemaVersion: PHASE32_PRE_APPROVAL_EVIDENCE_VERSION,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(Object.isFrozen(root)).toBe(true);
    expect(root).toEqual(createPhase32PreApprovalEvidenceRoot(evidence()));
  });

  it("is independent of recursive object-property order", () => {
    const input = evidence();
    const reordered = reverseObjectKeys(input);

    expect(createPhase32PreApprovalEvidenceRoot(reordered)).toEqual(
      createPhase32PreApprovalEvidenceRoot(input),
    );
  });

  it("normalizes the required report inventory order", () => {
    const input = evidence();
    const reversed = evidence();
    reversed.reports.reverse();

    expect(createPhase32PreApprovalEvidenceRoot(reversed)).toEqual(
      createPhase32PreApprovalEvidenceRoot(input),
    );
  });

  it("changes the root when valid evidence is tampered with", () => {
    const input = evidence();
    const original = createPhase32PreApprovalEvidenceRoot(input);
    input.deployment.evidenceSha256 = "c".repeat(64);

    expect(createPhase32PreApprovalEvidenceRoot(input)).not.toEqual(original);
  });

  it("rejects a missing required report", () => {
    const input = evidence();
    input.reports.pop();

    expect(() => createPhase32PreApprovalEvidenceRoot(input)).toThrow(
      /missing report kind|report kind inventory/u,
    );
  });

  it("rejects an extra or unknown report kind", () => {
    const input = evidence() as unknown as {
      reports: Array<Record<string, unknown>>;
    };
    input.reports.push({
      ...input.reports[0],
      id: "report:future",
      kind: "FUTURE_REPORT",
    });

    expect(() => createPhase32PreApprovalEvidenceRoot(input)).toThrow(
      /reports\.20\.kind|Invalid option/u,
    );
  });

  it("rejects duplicate report kinds even when the array length is exact", () => {
    const input = evidence();
    input.reports[1]!.kind = input.reports[0]!.kind;

    expect(() => createPhase32PreApprovalEvidenceRoot(input)).toThrow(
      /duplicate report kind/u,
    );
  });

  it.each([
    {
      label: "runtime commit",
      mutate(input: MutableEvidence) {
        input.runtime.commitSha = "f".repeat(40);
      },
    },
    {
      label: "report artifact",
      mutate(input: MutableEvidence) {
        input.reports[0]!.artifactSha256 = "f".repeat(64);
      },
    },
    {
      label: "deployment configuration",
      mutate(input: MutableEvidence) {
        input.deployment.configurationSha256 = "f".repeat(64);
      },
    },
    {
      label: "walkthrough deployment",
      mutate(input: MutableEvidence) {
        input.walkthrough.deploymentId = "deployment:other";
      },
    },
    {
      label: "rollback roll-forward artifact",
      mutate(input: MutableEvidence) {
        input.rollbackDrill.rollForwardArtifactSha256 = "f".repeat(64);
      },
    },
  ])("rejects a $label identity mismatch", ({ mutate }) => {
    const input = evidence();
    mutate(input);

    expect(() => createPhase32PreApprovalEvidenceRoot(input)).toThrow(
      /identity does not match the candidate/u,
    );
  });

  it("rejects an LC1 scope that enables a public surface", () => {
    const input = evidence() as unknown as {
      launchScope: { publicIndexing: boolean };
    };
    input.launchScope.publicIndexing = true;

    expect(() => createPhase32PreApprovalEvidenceRoot(input)).toThrow(
      /launchScope\.publicIndexing/u,
    );
  });

  it("rejects unknown keys at the root and in nested evidence", () => {
    const rootExtra = {
      ...evidence(),
      approvalClaim: "must-not-be-hashed-silently",
    };
    expect(() => createPhase32PreApprovalEvidenceRoot(rootExtra)).toThrow(
      /Unrecognized key/u,
    );

    const nestedExtra = evidence() as unknown as {
      candidate: Record<string, unknown>;
    };
    nestedExtra.candidate.unboundDigest = "d".repeat(64);
    expect(() => createPhase32PreApprovalEvidenceRoot(nestedExtra)).toThrow(
      /candidate Unrecognized key/u,
    );
  });
});

function evidence(): MutableEvidence {
  return {
    schemaVersion: PHASE32_PRE_APPROVAL_EVIDENCE_VERSION,
    candidate: {
      commitSha: COMMIT,
      treeSha: TREE,
      lockfileSha256: LOCK,
      migrationSha256: MIGRATION,
      schemaSha256: SCHEMA,
      artifactSha256: ARTIFACT,
      configurationSha256: CONFIGURATION,
      sbomSha256: SBOM,
      runtimeSha256: RUNTIME,
    },
    runtime: {
      environment: "local",
      buildIdentifier: COMMIT,
      commitSha: COMMIT,
      artifactSha256: ARTIFACT,
      configurationSha256: CONFIGURATION,
      runtimeSha256: RUNTIME,
      observedAt: END,
    },
    reports: PHASE32_REQUIRED_REPORT_KINDS.map((kind, index) => ({
      id: `report:${String(index + 1)}`,
      kind,
      status: "PASSED",
      reportSha256: "0123456789abcdefabcd"[index]!.repeat(64),
      commitSha: COMMIT,
      artifactSha256: ARTIFACT,
      configurationSha256: CONFIGURATION,
      failedCount: 0,
      skippedCount: 0,
      retryCount: 0,
      startedAt: START,
      completedAt: END,
    })),
    deployment: {
      id: "deployment:local-g4",
      status: "PASSED",
      environment: "local",
      commitSha: COMMIT,
      artifactSha256: ARTIFACT,
      configurationSha256: CONFIGURATION,
      runtimeSha256: RUNTIME,
      buildIdentifier: COMMIT,
      evidenceSha256: EVIDENCE,
      deployedAt: DEPLOYED,
    },
    launchScope: {
      policyVersion: "phase32-launch-class-v1",
      requestedClass: "LC1",
      operatingMode: "LOCAL_DEMO",
      dataMode: "SYNTHETIC_ONLY",
      providerMode: "MOCK_OR_DISABLED",
      moneyMode: "NO_MONEY",
      accessMode: "LOCAL_ONLY",
      acquisitionMode: "NONE",
      publicIndexing: false,
      companyTrustSurfaces: false,
      multiPersonaPromised: false,
      externalTrackerPromised: false,
      interviewSchedulerPromised: false,
      scale30BTriggered: false,
      scale30CTriggered: false,
    },
    findingsLedgerSha256: "d".repeat(64),
    findingAliasBindingsSha256: "e".repeat(64),
    walkthrough: {
      id: "walkthrough:local-g4",
      deploymentId: "deployment:local-g4",
      status: "PASSED",
      commitSha: COMMIT,
      artifactSha256: ARTIFACT,
      evidenceSha256: EVIDENCE,
      coveredRoles: [...PHASE32_REQUIRED_WALKTHROUGH_ROLES],
      taskCount: 10,
      failedTaskCount: 0,
      skippedTaskCount: 0,
      startedAt: POST_DEPLOY_START,
      completedAt: POST_DEPLOY_END,
    },
    rollbackDrill: {
      id: "rollback:local-g4",
      deploymentId: "deployment:local-g4",
      status: "PASSED",
      environment: "local",
      candidateCommitSha: COMMIT,
      candidateArtifactSha256: ARTIFACT,
      rollbackArtifactSha256: ROLLBACK,
      rollForwardArtifactSha256: ARTIFACT,
      rollbackDurationMilliseconds: 30_000,
      rollForwardDurationMilliseconds: 35_000,
      approvedRollbackBudgetMilliseconds: 60_000,
      approvedRollForwardBudgetMilliseconds: 60_000,
      dataIntegrityVerified: true,
      privacyReactivationCount: 0,
      duplicateSideEffectCount: 0,
      evidenceSha256: EVIDENCE,
      startedAt: POST_DEPLOY_START,
      completedAt: POST_DEPLOY_END,
    },
  };
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => reverseObjectKeys(entry));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, entry]) => [key, reverseObjectKeys(entry)]),
    );
  }
  return value;
}
