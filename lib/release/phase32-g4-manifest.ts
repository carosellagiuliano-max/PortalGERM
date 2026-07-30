import { z } from "zod";

import {
  PHASE32_LC1_APPROVAL_SCOPES,
  type Phase32Lc1ApprovalScope,
  type Phase32VerifiedApproval,
} from "@/lib/release/phase32-approval-attestation";

export const PHASE32_G4_MANIFEST_VERSION = "phase32-g4-manifest-v1" as const;

export const PHASE32_G4_FINDING_IDS = Object.freeze(
  Array.from(
    { length: 37 },
    (_, index) => `STH-${String(index + 1).padStart(3, "0")}`,
  ),
);

export const PHASE32_REQUIRED_REPORT_KINDS = Object.freeze([
  "DEPENDENCY_INSTALL",
  "ENVIRONMENT",
  "PLAN_AUDIT",
  "ROUTE_AUDIT",
  "LICENSE",
  "SECRET_SCAN",
  "LINT",
  "TYPECHECK",
  "UNIT",
  "INTEGRATION",
  "MIGRATION",
  "SEED",
  "BUILD",
  "HTTP",
  "HSTS",
  "BROWSER",
  "SECURITY",
  "PRIVACY",
  "PROVIDER_WORKER",
  "RECOVERY",
] as const);

export const PHASE32_TECHNICAL_FAILURE_CODES = Object.freeze([
  "DIRTY_WORKTREE",
  "RUNTIME_IDENTITY_MISMATCH",
  "MISSING_REQUIRED_REPORT",
  "REPORT_NOT_GREEN",
  "REPORT_IDENTITY_MISMATCH",
  "DEPLOYMENT_MISSING",
  "DEPLOYMENT_NOT_GREEN",
  "DEPLOYMENT_IDENTITY_MISMATCH",
  "WALKTHROUGH_MISSING",
  "WALKTHROUGH_NOT_GREEN",
  "WALKTHROUGH_IDENTITY_MISMATCH",
  "ROLLBACK_DRILL_MISSING",
  "ROLLBACK_DRILL_NOT_GREEN",
  "ROLLBACK_DRILL_IDENTITY_MISMATCH",
] as const);

export const PHASE32_APPROVAL_SCOPES = Object.freeze([
  "RELEASE",
  "SECURITY",
  "PRODUCT",
  "OPERATIONS",
  "PRIVACY",
  "LEGAL_AVG",
  "TAX_FINANCE",
  "TRUST_FRAUD",
  "SUPPORT",
  "PROVIDER",
  "ACCESSIBILITY",
  "DATABASE_SRE",
] as const);

export const PHASE32_REQUIRED_WALKTHROUGH_ROLES = Object.freeze([
  "PUBLIC",
  "CANDIDATE",
  "EMPLOYER",
  "RECRUITER",
  "ADMIN",
  "SUPPORT_OPS",
  "SYSTEM",
] as const);

export const PHASE32_LAUNCH_DECISION_REASON_CODES = Object.freeze([
  "TECHNICAL_AUDIT_FAILED",
  "FINDINGS_BLOCKING",
  "APPROVALS_INCOMPLETE",
  "OWNER_NO_GO",
] as const);

const launchClassSchema = z.enum(["LC1", "LC2", "LC3", "LC4", "LC5", "LC6"]);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const gitObjectIdSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
const safeReferenceSchema = z
  .string()
  .min(2)
  .max(255)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/u);
const instantSchema = z.iso.datetime({ offset: true });
const reportKindSchema = z.enum(PHASE32_REQUIRED_REPORT_KINDS);
const technicalFailureCodeSchema = z.enum(PHASE32_TECHNICAL_FAILURE_CODES);
const lc1ApprovalScopeSchema = z.enum(PHASE32_LC1_APPROVAL_SCOPES);
const roleSchema = z.enum(PHASE32_REQUIRED_WALKTHROUGH_ROLES);

const candidateSchema = z.strictObject({
  commitSha: gitObjectIdSchema,
  treeSha: gitObjectIdSchema,
  cleanTree: z.boolean(),
  lockfileSha256: sha256Schema,
  migrationSha256: sha256Schema,
  schemaSha256: sha256Schema,
  artifactSha256: sha256Schema,
  configurationSha256: sha256Schema,
  sbomSha256: sha256Schema,
  runtimeSha256: sha256Schema,
});

const runtimeSchema = z.strictObject({
  environment: z.enum(["local", "ci", "preview", "staging", "production"]),
  buildIdentifier: safeReferenceSchema,
  commitSha: gitObjectIdSchema,
  artifactSha256: sha256Schema,
  configurationSha256: sha256Schema,
  runtimeSha256: sha256Schema,
  observedAt: instantSchema,
});

const reportSchema = z.strictObject({
  id: safeReferenceSchema,
  kind: reportKindSchema,
  status: z.enum(["PASSED", "FAILED", "NOT_RUN"]),
  reportSha256: sha256Schema,
  commitSha: gitObjectIdSchema,
  artifactSha256: sha256Schema,
  configurationSha256: sha256Schema,
  failedCount: z.int().nonnegative(),
  skippedCount: z.int().nonnegative(),
  retryCount: z.int().nonnegative(),
  startedAt: instantSchema,
  completedAt: instantSchema,
});

const deploymentSchema = z.strictObject({
  id: safeReferenceSchema,
  status: z.enum(["PASSED", "FAILED", "NOT_RUN"]),
  environment: z.enum(["local", "ci", "preview", "staging", "production"]),
  commitSha: gitObjectIdSchema,
  artifactSha256: sha256Schema,
  configurationSha256: sha256Schema,
  runtimeSha256: sha256Schema,
  buildIdentifier: safeReferenceSchema,
  evidenceSha256: sha256Schema,
  deployedAt: instantSchema,
});

const walkthroughSchema = z.strictObject({
  id: safeReferenceSchema,
  deploymentId: safeReferenceSchema,
  status: z.enum(["PASSED", "FAILED", "NOT_RUN"]),
  commitSha: gitObjectIdSchema,
  artifactSha256: sha256Schema,
  evidenceSha256: sha256Schema,
  coveredRoles: z.array(roleSchema).min(1),
  taskCount: z.int().nonnegative(),
  failedTaskCount: z.int().nonnegative(),
  skippedTaskCount: z.int().nonnegative(),
  startedAt: instantSchema,
  completedAt: instantSchema,
});

const rollbackDrillSchema = z.strictObject({
  id: safeReferenceSchema,
  deploymentId: safeReferenceSchema,
  status: z.enum(["PASSED", "FAILED", "NOT_RUN"]),
  environment: z.enum(["local", "ci", "preview", "staging", "production"]),
  candidateCommitSha: gitObjectIdSchema,
  candidateArtifactSha256: sha256Schema,
  rollbackArtifactSha256: sha256Schema,
  rollForwardArtifactSha256: sha256Schema,
  rollbackDurationMilliseconds: z.int().nonnegative(),
  rollForwardDurationMilliseconds: z.int().nonnegative(),
  approvedRollbackBudgetMilliseconds: z.int().positive(),
  approvedRollForwardBudgetMilliseconds: z.int().positive(),
  dataIntegrityVerified: z.boolean(),
  privacyReactivationCount: z.int().nonnegative(),
  duplicateSideEffectCount: z.int().nonnegative(),
  evidenceSha256: sha256Schema,
  startedAt: instantSchema,
  completedAt: instantSchema,
});

const findingSchema = z.strictObject({
  id: z.string().regex(/^STH-(?:00[1-9]|0[12][0-9]|03[0-7])$/u),
  status: z.enum(["CLOSED", "EXTERNAL", "DEFERRED / MONITORED", "DISABLED"]),
  ownerRef: safeReferenceSchema,
  scopeRef: safeReferenceSchema,
  evidenceSha256: z.array(sha256Schema).min(1),
  resolution: z.enum(["SATISFIED", "BLOCKING"]),
  launchClassValid: z.boolean(),
});

const approvalSchema = z.strictObject({
  verificationMethod: z.literal("Ed25519"),
  scope: lc1ApprovalScopeSchema,
  keyId: safeReferenceSchema,
  approverRef: safeReferenceSchema,
  approvalEvidenceRef: safeReferenceSchema,
  approvalEvidenceSha256: sha256Schema,
  attestationSha256: sha256Schema,
  preApprovalEvidenceSha256: sha256Schema,
  rootTrustAnchorSha256: sha256Schema,
  trustedKeyRegistrySha256: sha256Schema,
  candidateCommitSha: gitObjectIdSchema,
  artifactSha256: sha256Schema,
  launchClass: z.literal("LC1"),
  recordedAt: instantSchema,
  expiresAt: instantSchema,
});

const externalApprovalEvidenceSchema = z.strictObject({
  externalBundleSha256: sha256Schema,
  preApprovalEvidenceSha256: sha256Schema,
  rootTrustAnchorSha256: sha256Schema,
  trustedKeyRegistrySha256: sha256Schema,
});

const manifestSchema = z.strictObject({
  schemaVersion: z.literal(PHASE32_G4_MANIFEST_VERSION),
  manifestId: safeReferenceSchema,
  createdAt: instantSchema,
  operatorRef: safeReferenceSchema,
  requestedLaunchClass: launchClassSchema,
  candidate: candidateSchema,
  runtime: runtimeSchema,
  reports: z.array(reportSchema),
  deployment: deploymentSchema.nullable(),
  walkthrough: walkthroughSchema.nullable(),
  rollbackDrill: rollbackDrillSchema.nullable(),
  findings: z.array(findingSchema),
  externalApprovalEvidence: externalApprovalEvidenceSchema.nullable(),
  approvals: z.array(approvalSchema),
  technicalAudit: z.strictObject({
    status: z.enum(["PASS", "FAIL"]),
    failureCodes: z.array(technicalFailureCodeSchema),
  }),
  launchDecision: z.strictObject({
    status: z.enum(["APPROVED", "NO_GO"]),
    approvedLaunchClass: launchClassSchema.nullable(),
    reasonCodes: z.array(z.enum(PHASE32_LAUNCH_DECISION_REASON_CODES)),
    decidedAt: instantSchema,
  }),
});

export type Phase32G4Manifest = z.infer<typeof manifestSchema>;
export type Phase32G4Approval = z.infer<typeof approvalSchema>;
export type Phase32G4ExternalApprovalEvidence = z.infer<
  typeof externalApprovalEvidenceSchema
>;
export type Phase32TechnicalFailureCode =
  (typeof PHASE32_TECHNICAL_FAILURE_CODES)[number];
export type Phase32ApprovalScope = (typeof PHASE32_APPROVAL_SCOPES)[number];

export type Phase32G4ValidationResult = Readonly<{
  manifest: Phase32G4Manifest;
  technicalAuditStatus: "PASS" | "FAIL";
  launchDecision: "APPROVED" | "NO_GO";
  launchEligible: boolean;
  technicalFailureCodes: readonly Phase32TechnicalFailureCode[];
  blockingFindingIds: readonly string[];
  missingApprovalScopes: readonly Phase32ApprovalScope[];
}>;

/**
 * Converts the output of the Ed25519 verifier into the only approval shape
 * accepted by the G4 manifest. The immutable attestation digest lets a later
 * verifier bind the derived record back to the signed external bundle.
 */
export function phase32G4ApprovalFromVerifiedAttestation(
  verified: Phase32VerifiedApproval,
  binding: Readonly<{
    attestationSha256: string;
    preApprovalEvidenceSha256: string;
    rootTrustAnchorSha256: string;
    trustedKeyRegistrySha256: string;
    candidateCommitSha: string;
    artifactSha256: string;
  }>,
): Phase32G4Approval {
  const parsed = approvalSchema.safeParse({
    verificationMethod: "Ed25519",
    scope: verified.scope,
    keyId: verified.keyId,
    approverRef: verified.approverRef,
    approvalEvidenceRef: verified.approvalEvidenceRef,
    approvalEvidenceSha256: verified.approvalEvidenceSha256,
    attestationSha256: binding.attestationSha256,
    preApprovalEvidenceSha256: binding.preApprovalEvidenceSha256,
    rootTrustAnchorSha256: binding.rootTrustAnchorSha256,
    trustedKeyRegistrySha256: binding.trustedKeyRegistrySha256,
    candidateCommitSha: binding.candidateCommitSha,
    artifactSha256: binding.artifactSha256,
    launchClass: "LC1",
    recordedAt: verified.recordedAt,
    expiresAt: verified.expiresAt,
  });
  if (!parsed.success) {
    fail(
      `verified Ed25519 approval derivation invalid: ${formatIssues(parsed.error)}`,
    );
  }
  return Object.freeze(parsed.data);
}

/**
 * Validates the immutable manifest and the bindings of already verified
 * Ed25519 approval derivations. Signature and trusted-key verification must
 * happen before projection with phase32G4ApprovalFromVerifiedAttestation.
 */
export function validatePhase32G4Manifest(
  raw: unknown,
): Phase32G4ValidationResult {
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    fail(
      `schema invalid: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"} ${issue.message}`)
        .join("; ")}`,
    );
  }
  const manifest = parsed.data;
  assertUniqueInventory(manifest);
  assertChronology(manifest);
  assertApprovalDerivations(manifest);

  const technicalFailureCodes = technicalFailures(manifest);
  const expectedTechnicalStatus =
    technicalFailureCodes.length === 0 ? "PASS" : "FAIL";
  if (
    manifest.technicalAudit.status !== expectedTechnicalStatus ||
    !sameSet(manifest.technicalAudit.failureCodes, technicalFailureCodes)
  ) {
    fail(
      `declared technical audit ${manifest.technicalAudit.status} does not match derived ${expectedTechnicalStatus}`,
    );
  }

  const blockingFindingIds = manifest.findings
    .filter(
      (finding) =>
        finding.resolution === "BLOCKING" || !finding.launchClassValid,
    )
    .map(({ id }) => id)
    .sort();
  const missingApprovalScopes = incompleteApprovalScopes(manifest);
  const launchEligible =
    expectedTechnicalStatus === "PASS" &&
    blockingFindingIds.length === 0 &&
    missingApprovalScopes.length === 0;
  assertLaunchDecision(manifest, {
    launchEligible,
    blockingFindingIds,
    missingApprovalScopes,
  });

  return Object.freeze({
    manifest,
    technicalAuditStatus: expectedTechnicalStatus,
    launchDecision: manifest.launchDecision.status,
    launchEligible,
    technicalFailureCodes: Object.freeze(technicalFailureCodes),
    blockingFindingIds: Object.freeze(blockingFindingIds),
    missingApprovalScopes: Object.freeze(missingApprovalScopes),
  });
}

function technicalFailures(manifest: Phase32G4Manifest) {
  const failures = new Set<Phase32TechnicalFailureCode>();
  const candidate = manifest.candidate;
  if (!candidate.cleanTree) failures.add("DIRTY_WORKTREE");
  if (
    manifest.runtime.commitSha !== candidate.commitSha ||
    manifest.runtime.artifactSha256 !== candidate.artifactSha256 ||
    manifest.runtime.configurationSha256 !== candidate.configurationSha256 ||
    manifest.runtime.runtimeSha256 !== candidate.runtimeSha256 ||
    manifest.runtime.buildIdentifier !== candidate.commitSha
  ) {
    failures.add("RUNTIME_IDENTITY_MISMATCH");
  }

  const reportsByKind = new Map(
    manifest.reports.map((report) => [report.kind, report]),
  );
  if (PHASE32_REQUIRED_REPORT_KINDS.some((kind) => !reportsByKind.has(kind))) {
    failures.add("MISSING_REQUIRED_REPORT");
  }
  for (const report of manifest.reports) {
    if (
      report.status !== "PASSED" ||
      report.failedCount !== 0 ||
      report.skippedCount !== 0 ||
      report.retryCount !== 0
    ) {
      failures.add("REPORT_NOT_GREEN");
    }
    if (
      report.commitSha !== candidate.commitSha ||
      report.artifactSha256 !== candidate.artifactSha256 ||
      report.configurationSha256 !== candidate.configurationSha256
    ) {
      failures.add("REPORT_IDENTITY_MISMATCH");
    }
  }

  const deployment = manifest.deployment;
  if (deployment === null) {
    failures.add("DEPLOYMENT_MISSING");
  } else {
    if (deployment.status !== "PASSED") {
      failures.add("DEPLOYMENT_NOT_GREEN");
    }
    if (
      deployment.commitSha !== candidate.commitSha ||
      deployment.artifactSha256 !== candidate.artifactSha256 ||
      deployment.configurationSha256 !== candidate.configurationSha256 ||
      deployment.runtimeSha256 !== candidate.runtimeSha256 ||
      deployment.buildIdentifier !== candidate.commitSha ||
      deployment.environment !== manifest.runtime.environment
    ) {
      failures.add("DEPLOYMENT_IDENTITY_MISMATCH");
    }
  }

  const walkthrough = manifest.walkthrough;
  if (walkthrough === null) {
    failures.add("WALKTHROUGH_MISSING");
  } else {
    const roleSet = new Set(walkthrough.coveredRoles);
    if (
      walkthrough.status !== "PASSED" ||
      walkthrough.taskCount < 10 ||
      walkthrough.failedTaskCount !== 0 ||
      walkthrough.skippedTaskCount !== 0 ||
      roleSet.size !== walkthrough.coveredRoles.length ||
      PHASE32_REQUIRED_WALKTHROUGH_ROLES.some((role) => !roleSet.has(role))
    ) {
      failures.add("WALKTHROUGH_NOT_GREEN");
    }
    if (
      walkthrough.commitSha !== candidate.commitSha ||
      walkthrough.artifactSha256 !== candidate.artifactSha256 ||
      deployment === null ||
      walkthrough.deploymentId !== deployment.id
    ) {
      failures.add("WALKTHROUGH_IDENTITY_MISMATCH");
    }
  }

  const drill = manifest.rollbackDrill;
  if (drill === null) {
    failures.add("ROLLBACK_DRILL_MISSING");
  } else {
    if (
      drill.status !== "PASSED" ||
      !drill.dataIntegrityVerified ||
      drill.privacyReactivationCount !== 0 ||
      drill.duplicateSideEffectCount !== 0 ||
      drill.rollbackDurationMilliseconds >
        drill.approvedRollbackBudgetMilliseconds ||
      drill.rollForwardDurationMilliseconds >
        drill.approvedRollForwardBudgetMilliseconds
    ) {
      failures.add("ROLLBACK_DRILL_NOT_GREEN");
    }
    if (
      drill.candidateCommitSha !== candidate.commitSha ||
      drill.candidateArtifactSha256 !== candidate.artifactSha256 ||
      drill.rollForwardArtifactSha256 !== candidate.artifactSha256 ||
      drill.rollbackArtifactSha256 === candidate.artifactSha256 ||
      deployment === null ||
      drill.deploymentId !== deployment.id ||
      drill.environment !== deployment.environment
    ) {
      failures.add("ROLLBACK_DRILL_IDENTITY_MISMATCH");
    }
  }
  return [...failures].sort();
}

function incompleteApprovalScopes(manifest: Phase32G4Manifest) {
  const required = requiredPhase32ApprovalScopes(manifest.requestedLaunchClass);
  if (manifest.externalApprovalEvidence === null) {
    return required;
  }
  const decisionAt = Date.parse(manifest.launchDecision.decidedAt);
  const individuallyComplete = manifest.approvals.filter(
    (approval) =>
      approval.approverRef !== manifest.operatorRef &&
      approval.candidateCommitSha === manifest.candidate.commitSha &&
      approval.artifactSha256 === manifest.candidate.artifactSha256 &&
      approval.launchClass === manifest.requestedLaunchClass &&
      Date.parse(approval.recordedAt) <= decisionAt &&
      Date.parse(approval.expiresAt) > decisionAt,
  );
  const approverCounts = individuallyComplete.reduce(
    (counts, approval) =>
      counts.set(
        approval.approverRef,
        (counts.get(approval.approverRef) ?? 0) + 1,
      ),
    new Map<string, number>(),
  );
  const approved = new Map<Phase32ApprovalScope, string>();
  for (const approval of individuallyComplete) {
    if (approverCounts.get(approval.approverRef) !== 1) continue;
    approved.set(approval.scope, approval.approverRef);
  }
  return required.filter((scope) => !approved.has(scope));
}

function approvalEvidenceReadyAt(manifest: Phase32G4Manifest) {
  return Math.max(
    ...manifest.reports.map((report) => Date.parse(report.completedAt)),
    manifest.deployment === null
      ? Number.POSITIVE_INFINITY
      : Date.parse(manifest.deployment.deployedAt),
    manifest.walkthrough === null
      ? Number.POSITIVE_INFINITY
      : Date.parse(manifest.walkthrough.completedAt),
    manifest.rollbackDrill === null
      ? Number.POSITIVE_INFINITY
      : Date.parse(manifest.rollbackDrill.completedAt),
  );
}

function assertApprovalDerivations(manifest: Phase32G4Manifest) {
  if (
    manifest.externalApprovalEvidence === null &&
    manifest.approvals.length > 0
  ) {
    fail(
      "verified Ed25519 approvals require external bundle and trusted key registry digests",
    );
  }
  if (manifest.approvals.length === 0) return;
  if (manifest.requestedLaunchClass !== "LC1") {
    fail("verified Ed25519 approvals are bound to LC1 only");
  }

  const evidenceReadyAt = approvalEvidenceReadyAt(manifest);
  const decisionAt = Date.parse(manifest.launchDecision.decidedAt);
  for (const approval of manifest.approvals) {
    if (
      approval.candidateCommitSha !== manifest.candidate.commitSha ||
      approval.artifactSha256 !== manifest.candidate.artifactSha256
    ) {
      fail(`approval ${approval.scope} is not bound to the release candidate`);
    }
    if (
      manifest.externalApprovalEvidence === null ||
      approval.preApprovalEvidenceSha256 !==
        manifest.externalApprovalEvidence.preApprovalEvidenceSha256 ||
      approval.rootTrustAnchorSha256 !==
        manifest.externalApprovalEvidence.rootTrustAnchorSha256 ||
      approval.trustedKeyRegistrySha256 !==
        manifest.externalApprovalEvidence.trustedKeyRegistrySha256
    ) {
      fail(
        `approval ${approval.scope} is not bound to the manifest evidence root and trust chain`,
      );
    }
    if (approval.approverRef === manifest.operatorRef) {
      fail(`approval ${approval.scope} violates separation of duties`);
    }
    if (Date.parse(approval.recordedAt) < evidenceReadyAt) {
      fail(`approval ${approval.scope} predates complete G4 evidence`);
    }
    if (Date.parse(approval.recordedAt) > decisionAt) {
      fail(`approval ${approval.scope} was recorded after the launch decision`);
    }
    if (Date.parse(approval.expiresAt) <= decisionAt) {
      fail(`approval ${approval.scope} is expired at the launch decision`);
    }
  }
}

export function requiredPhase32ApprovalScopes(
  launchClass: "LC1",
): readonly Phase32Lc1ApprovalScope[];
export function requiredPhase32ApprovalScopes(
  launchClass: Phase32G4Manifest["requestedLaunchClass"],
): readonly Phase32ApprovalScope[];
export function requiredPhase32ApprovalScopes(
  launchClass: Phase32G4Manifest["requestedLaunchClass"],
): readonly Phase32ApprovalScope[] {
  const scopes: Phase32ApprovalScope[] = [
    "RELEASE",
    "SECURITY",
    "PRODUCT",
    "OPERATIONS",
  ];
  if (launchClass !== "LC1") {
    scopes.push("PRIVACY", "LEGAL_AVG", "TAX_FINANCE");
  }
  if (["LC3", "LC4", "LC5", "LC6"].includes(launchClass)) {
    scopes.push("TRUST_FRAUD", "SUPPORT", "PROVIDER");
  }
  if (["LC4", "LC5", "LC6"].includes(launchClass)) {
    scopes.push("ACCESSIBILITY");
  }
  if (launchClass === "LC6") scopes.push("DATABASE_SRE");
  return Object.freeze(scopes);
}

function assertLaunchDecision(
  manifest: Phase32G4Manifest,
  input: Readonly<{
    launchEligible: boolean;
    blockingFindingIds: readonly string[];
    missingApprovalScopes: readonly string[];
  }>,
) {
  const decision = manifest.launchDecision;
  if (decision.status === "APPROVED") {
    if (
      !input.launchEligible ||
      manifest.requestedLaunchClass !== "LC1" ||
      manifest.externalApprovalEvidence === null ||
      manifest.approvals.length !== PHASE32_LC1_APPROVAL_SCOPES.length ||
      decision.approvedLaunchClass !== manifest.requestedLaunchClass ||
      decision.reasonCodes.length !== 0
    ) {
      fail(
        "launch APPROVED without a complete technical/finding/approval gate",
      );
    }
    return;
  }
  if (decision.approvedLaunchClass !== null) {
    fail("NO_GO decision must not name an approved launch class");
  }
  const expectedReasons = new Set<
    Phase32G4Manifest["launchDecision"]["reasonCodes"][number]
  >();
  if (manifest.technicalAudit.status === "FAIL") {
    expectedReasons.add("TECHNICAL_AUDIT_FAILED");
  }
  if (input.blockingFindingIds.length > 0) {
    expectedReasons.add("FINDINGS_BLOCKING");
  }
  if (input.missingApprovalScopes.length > 0) {
    expectedReasons.add("APPROVALS_INCOMPLETE");
  }
  if (expectedReasons.size === 0) expectedReasons.add("OWNER_NO_GO");
  if (!sameSet(decision.reasonCodes, [...expectedReasons])) {
    fail("NO_GO reasons do not match the derived launch blockers");
  }
}

function assertUniqueInventory(manifest: Phase32G4Manifest) {
  assertUnique(
    manifest.reports.map(({ id }) => id),
    "report id",
  );
  assertUnique(
    manifest.reports.map(({ kind }) => kind),
    "report kind",
  );
  assertUnique(
    manifest.findings.map(({ id }) => id),
    "finding id",
  );
  if (
    manifest.findings.length !== PHASE32_G4_FINDING_IDS.length ||
    !sameSet(
      manifest.findings.map(({ id }) => id),
      PHASE32_G4_FINDING_IDS,
    )
  ) {
    fail("finding inventory must contain STH-001 through STH-037 exactly once");
  }
  assertUnique(
    manifest.approvals.map(({ scope }) => scope),
    "approval scope",
  );
  assertUnique(
    manifest.approvals.map(({ keyId }) => keyId),
    "approval keyId",
  );
  assertUnique(
    manifest.approvals.map(({ approverRef }) => approverRef),
    "approval approverRef",
  );
  assertUnique(
    manifest.approvals.map(({ attestationSha256 }) => attestationSha256),
    "approval attestation digest",
  );
}

function assertChronology(manifest: Phase32G4Manifest) {
  const decisionAt = Date.parse(manifest.launchDecision.decidedAt);
  if (Date.parse(manifest.runtime.observedAt) > decisionAt) {
    fail("launch decision precedes runtime observation");
  }
  for (const report of manifest.reports) {
    assertOrdered(report.startedAt, report.completedAt, `report ${report.id}`);
    if (Date.parse(report.completedAt) > decisionAt) {
      fail(`launch decision precedes report ${report.id}`);
    }
  }
  if (
    manifest.deployment !== null &&
    Date.parse(manifest.deployment.deployedAt) > decisionAt
  ) {
    fail("launch decision precedes deployment");
  }
  if (manifest.walkthrough !== null) {
    assertOrdered(
      manifest.walkthrough.startedAt,
      manifest.walkthrough.completedAt,
      "walkthrough",
    );
    if (
      Date.parse(manifest.walkthrough.completedAt) > decisionAt ||
      (manifest.deployment !== null &&
        Date.parse(manifest.walkthrough.startedAt) <
          Date.parse(manifest.deployment.deployedAt))
    ) {
      fail("walkthrough is outside the deployed pre-decision evidence window");
    }
  }
  if (manifest.rollbackDrill !== null) {
    assertOrdered(
      manifest.rollbackDrill.startedAt,
      manifest.rollbackDrill.completedAt,
      "rollback drill",
    );
    if (
      Date.parse(manifest.rollbackDrill.completedAt) > decisionAt ||
      (manifest.deployment !== null &&
        Date.parse(manifest.rollbackDrill.startedAt) <
          Date.parse(manifest.deployment.deployedAt))
    ) {
      fail(
        "rollback drill is outside the deployed pre-decision evidence window",
      );
    }
  }
  if (
    Date.parse(manifest.createdAt) >
    Date.parse(manifest.launchDecision.decidedAt)
  ) {
    fail("launch decision precedes manifest creation");
  }
  for (const approval of manifest.approvals) {
    assertOrdered(
      approval.recordedAt,
      approval.expiresAt,
      `approval ${approval.scope}`,
    );
  }
}

function assertOrdered(start: string, end: string, label: string) {
  if (Date.parse(end) < Date.parse(start)) {
    fail(`${label} completion precedes start`);
  }
}

function assertUnique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length) {
    fail(`${label} inventory contains duplicates`);
  }
}

function sameSet(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    left.every((value) => right.includes(value))
  );
}

function fail(message: string): never {
  throw new Error(`Phase 32 G4 manifest invalid: ${message}.`);
}

function formatIssues(error: z.ZodError) {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"} ${issue.message}`)
    .join("; ");
}
