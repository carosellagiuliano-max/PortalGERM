import { describe, expect, it } from "vitest";

import { PHASE32_LC1_APPROVAL_SCOPES } from "@/lib/release/phase32-approval-attestation";
import {
  PHASE32_G4_FINDING_IDS,
  PHASE32_REQUIRED_REPORT_KINDS,
  phase32G4ApprovalFromVerifiedAttestation,
  type Phase32G4Manifest,
  validatePhase32G4Manifest,
} from "@/lib/release/phase32-g4-manifest";

const COMMIT = "1".repeat(40);
const TREE = "2".repeat(40);
const LOCK = "3".repeat(64);
const MIGRATION = "4".repeat(64);
const SCHEMA = "5".repeat(64);
const ARTIFACT = "6".repeat(64);
const CONFIGURATION = "b".repeat(64);
const SBOM = "7".repeat(64);
const RUNTIME = "8".repeat(64);
const EVIDENCE = "9".repeat(64);
const ROLLBACK = "a".repeat(64);
const EXTERNAL_BUNDLE = "c".repeat(64);
const TRUSTED_KEY_REGISTRY = "d".repeat(64);
const PRE_APPROVAL_EVIDENCE = "e".repeat(64);
const ROOT_TRUST_ANCHOR = "f".repeat(64);
const START = "2026-07-30T10:00:00.000+00:00";
const END = "2026-07-30T10:10:00.000+00:00";
const DEPLOYED = "2026-07-30T10:20:00.000+00:00";
const POST_DEPLOY_START = "2026-07-30T10:25:00.000+00:00";
const POST_DEPLOY_END = "2026-07-30T10:40:00.000+00:00";
const APPROVED_AT = "2026-07-30T10:50:00.000+00:00";
const DECIDED = "2026-07-30T11:00:00.000+00:00";

describe("Phase 32 G4 manifest", () => {
  it("separates a technical PASS from an independently evidenced APPROVED decision", () => {
    const result = validatePhase32G4Manifest(manifest());

    expect(result).toMatchObject({
      technicalAuditStatus: "PASS",
      launchDecision: "APPROVED",
      launchEligible: true,
      technicalFailureCodes: [],
      blockingFindingIds: [],
      missingApprovalScopes: [],
    });
  });

  it("allows a technical PASS to remain NO_GO when external approvals are absent", () => {
    const input = manifest();
    input.approvals = [];
    input.externalApprovalEvidence = null;
    input.launchDecision = {
      status: "NO_GO",
      approvedLaunchClass: null,
      reasonCodes: ["APPROVALS_INCOMPLETE"],
      decidedAt: DECIDED,
    };

    const result = validatePhase32G4Manifest(input);
    expect(result.technicalAuditStatus).toBe("PASS");
    expect(result.launchDecision).toBe("NO_GO");
    expect(result.launchEligible).toBe(false);
    expect(result.missingApprovalScopes).toEqual([
      "RELEASE",
      "SECURITY",
      "PRODUCT",
      "OPERATIONS",
    ]);
  });

  it("records a truthful technical FAIL only as NO_GO", () => {
    const input = manifest();
    input.candidate.cleanTree = false;
    input.technicalAudit = {
      status: "FAIL",
      failureCodes: ["DIRTY_WORKTREE"],
    };
    input.launchDecision = {
      status: "NO_GO",
      approvedLaunchClass: null,
      reasonCodes: ["TECHNICAL_AUDIT_FAILED"],
      decidedAt: DECIDED,
    };

    expect(validatePhase32G4Manifest(input)).toMatchObject({
      technicalAuditStatus: "FAIL",
      launchDecision: "NO_GO",
      technicalFailureCodes: ["DIRTY_WORKTREE"],
    });
  });

  it.each([
    {
      label: "dirty tree",
      mutate(input: ReturnType<typeof manifest>) {
        input.candidate.cleanTree = false;
      },
    },
    {
      label: "skipped report",
      mutate(input: ReturnType<typeof manifest>) {
        input.reports[0]!.skippedCount = 1;
      },
    },
    {
      label: "different report artifact",
      mutate(input: ReturnType<typeof manifest>) {
        input.reports[0]!.artifactSha256 = "b".repeat(64);
      },
    },
    {
      label: "different deployed runtime",
      mutate(input: ReturnType<typeof manifest>) {
        input.deployment!.runtimeSha256 = "c".repeat(64);
      },
    },
    {
      label: "incomplete walkthrough",
      mutate(input: ReturnType<typeof manifest>) {
        input.walkthrough!.coveredRoles = ["PUBLIC"];
      },
    },
    {
      label: "rollback over budget",
      mutate(input: ReturnType<typeof manifest>) {
        input.rollbackDrill!.rollbackDurationMilliseconds = 60_001;
      },
    },
  ])("rejects a claimed technical PASS for $label", ({ mutate }) => {
    const input = manifest();
    mutate(input);
    expect(() => validatePhase32G4Manifest(input)).toThrow(
      /declared technical audit PASS does not match derived FAIL/u,
    );
  });

  it("rejects APPROVED when one finding is blocking", () => {
    const input = manifest();
    input.findings[0]!.resolution = "BLOCKING";
    input.findings[0]!.launchClassValid = false;

    expect(() => validatePhase32G4Manifest(input)).toThrow(
      /launch APPROVED without a complete/u,
    );
  });

  it("rejects an approval recorded before walkthrough and rollback evidence completed", () => {
    const invalid = manifest();
    invalid.approvals[0]!.recordedAt = END;

    expect(() => validatePhase32G4Manifest(invalid)).toThrow(
      /approval RELEASE predates complete G4 evidence/u,
    );
  });

  it("requires exactly STH-001 through STH-037 once", () => {
    const input = manifest();
    input.findings.pop();
    expect(() => validatePhase32G4Manifest(input)).toThrow(
      /finding inventory must contain STH-001 through STH-037 exactly once/u,
    );

    const duplicate = manifest();
    duplicate.findings[1]!.id = duplicate.findings[0]!.id;
    expect(() => validatePhase32G4Manifest(duplicate)).toThrow(
      /finding id inventory contains duplicates/u,
    );
  });

  it("does not accept an unmodelled signature or the old metadata-only claim", () => {
    const input = manifest();
    Object.assign(input.approvals[0]!, {
      signature: "not-a-verified-signature",
      status: "APPROVED",
      attestationKind: "EXTERNAL_EVIDENCE_REFERENCE",
      evidenceRef: "evidence:old-reference",
      evidenceSha256: EVIDENCE,
    });
    expect(() => validatePhase32G4Manifest(input)).toThrow(
      /approvals\.0 Unrecognized key/u,
    );
  });

  it("rejects approval derivations without the external bundle and trusted-key binding", () => {
    const input = manifest();
    input.externalApprovalEvidence = null;

    expect(() => validatePhase32G4Manifest(input)).toThrow(
      /approvals require external bundle and trusted key registry digests/u,
    );
  });

  it("rejects a partial external evidence digest binding", () => {
    const input = manifest() as unknown as Record<string, unknown>;
    input.externalApprovalEvidence = {
      externalBundleSha256: EXTERNAL_BUNDLE,
      preApprovalEvidenceSha256: PRE_APPROVAL_EVIDENCE,
      rootTrustAnchorSha256: ROOT_TRUST_ANCHOR,
    };

    expect(() => validatePhase32G4Manifest(input)).toThrow(
      /externalApprovalEvidence\.trustedKeyRegistrySha256/u,
    );
  });

  it("requires approval evidence to be independent, current and artifact-bound", () => {
    const input = manifest();
    input.approvals[0]!.approverRef = input.operatorRef;

    expect(() => validatePhase32G4Manifest(input)).toThrow(
      /approval approverRef inventory contains duplicates|violates separation of duties/u,
    );
  });

  it("rejects an approval projection detached from the signed evidence root", () => {
    const input = manifest();
    input.approvals[0]!.preApprovalEvidenceSha256 = "0".repeat(64);

    expect(() => validatePhase32G4Manifest(input)).toThrow(
      /not bound to the manifest evidence root and trust chain/u,
    );
  });

  it("requires four distinct LC1 keys and approvers for APPROVED", () => {
    const duplicateApprover = manifest();
    duplicateApprover.approvals[1]!.approverRef =
      duplicateApprover.approvals[0]!.approverRef;
    expect(() => validatePhase32G4Manifest(duplicateApprover)).toThrow(
      /approval approverRef inventory contains duplicates/u,
    );

    const incomplete = manifest();
    incomplete.approvals.pop();
    expect(() => validatePhase32G4Manifest(incomplete)).toThrow(
      /launch APPROVED without a complete/u,
    );
  });

  it("projects only a verifier-produced Ed25519 approval into manifest form", () => {
    expect(
      phase32G4ApprovalFromVerifiedAttestation(
        {
          scope: "SECURITY",
          keyId: "key:security",
          approverRef: "approver:security",
          approvalEvidenceRef: "evidence:security",
          approvalEvidenceSha256: EVIDENCE,
          recordedAt: APPROVED_AT,
          expiresAt: "2026-08-30T10:50:00.000+00:00",
        },
        {
          attestationSha256: "e".repeat(64),
          preApprovalEvidenceSha256: PRE_APPROVAL_EVIDENCE,
          rootTrustAnchorSha256: ROOT_TRUST_ANCHOR,
          trustedKeyRegistrySha256: TRUSTED_KEY_REGISTRY,
          candidateCommitSha: COMMIT,
          artifactSha256: ARTIFACT,
        },
      ),
    ).toEqual({
      verificationMethod: "Ed25519",
      scope: "SECURITY",
      keyId: "key:security",
      approverRef: "approver:security",
      approvalEvidenceRef: "evidence:security",
      approvalEvidenceSha256: EVIDENCE,
      attestationSha256: "e".repeat(64),
      preApprovalEvidenceSha256: PRE_APPROVAL_EVIDENCE,
      rootTrustAnchorSha256: ROOT_TRUST_ANCHOR,
      trustedKeyRegistrySha256: TRUSTED_KEY_REGISTRY,
      candidateCommitSha: COMMIT,
      artifactSha256: ARTIFACT,
      launchClass: "LC1",
      recordedAt: APPROVED_AT,
      expiresAt: "2026-08-30T10:50:00.000+00:00",
    });
  });
});

type DeepMutable<T> = {
  -readonly [TKey in keyof T]: T[TKey] extends readonly (infer TItem)[]
    ? DeepMutable<TItem>[]
    : T[TKey] extends object
      ? DeepMutable<T[TKey]>
      : T[TKey];
};

type MutableManifest = DeepMutable<Phase32G4Manifest>;

function manifest(): MutableManifest {
  return {
    schemaVersion: "phase32-g4-manifest-v1",
    manifestId: "phase32-g4-test",
    createdAt: END,
    operatorRef: "operator:release",
    requestedLaunchClass: "LC1",
    candidate: {
      commitSha: COMMIT,
      treeSha: TREE,
      cleanTree: true,
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
      reportSha256: "0123456789abcdef"[index % 16]!.repeat(64),
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
    walkthrough: {
      id: "walkthrough:local-g4",
      deploymentId: "deployment:local-g4",
      status: "PASSED",
      commitSha: COMMIT,
      artifactSha256: ARTIFACT,
      evidenceSha256: EVIDENCE,
      coveredRoles: [
        "PUBLIC",
        "CANDIDATE",
        "EMPLOYER",
        "RECRUITER",
        "ADMIN",
        "SUPPORT_OPS",
        "SYSTEM",
      ],
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
    findings: PHASE32_G4_FINDING_IDS.map((id) => ({
      id,
      status: "CLOSED",
      ownerRef: `owner:${id.toLowerCase()}`,
      scopeRef: `scope:${id.toLowerCase()}`,
      evidenceSha256: [EVIDENCE],
      resolution: "SATISFIED",
      launchClassValid: true,
    })),
    externalApprovalEvidence: {
      externalBundleSha256: EXTERNAL_BUNDLE,
      preApprovalEvidenceSha256: PRE_APPROVAL_EVIDENCE,
      rootTrustAnchorSha256: ROOT_TRUST_ANCHOR,
      trustedKeyRegistrySha256: TRUSTED_KEY_REGISTRY,
    },
    approvals: PHASE32_LC1_APPROVAL_SCOPES.map((scope, index) => ({
      verificationMethod: "Ed25519",
      scope,
      keyId: `key:approval-${String(index + 1)}`,
      approverRef: `approver:${String(index + 1)}`,
      approvalEvidenceRef: `evidence:approval-${String(index + 1)}`,
      approvalEvidenceSha256: String(index + 1).repeat(64),
      attestationSha256: "abcdef0123456789"[index]!.repeat(64),
      preApprovalEvidenceSha256: PRE_APPROVAL_EVIDENCE,
      rootTrustAnchorSha256: ROOT_TRUST_ANCHOR,
      trustedKeyRegistrySha256: TRUSTED_KEY_REGISTRY,
      candidateCommitSha: COMMIT,
      artifactSha256: ARTIFACT,
      launchClass: "LC1",
      recordedAt: APPROVED_AT,
      expiresAt: "2026-08-30T10:50:00.000+00:00",
    })),
    technicalAudit: {
      status: "PASS",
      failureCodes: [],
    },
    launchDecision: {
      status: "APPROVED",
      approvedLaunchClass: "LC1",
      reasonCodes: [],
      decidedAt: DECIDED,
    },
  };
}
