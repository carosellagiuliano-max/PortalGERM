import { createHash } from "node:crypto";

import { z } from "zod";

import { PHASE32_POLICY_VERSION } from "@/lib/release/phase32-contract";
import {
  PHASE32_REQUIRED_REPORT_KINDS,
  PHASE32_REQUIRED_WALKTHROUGH_ROLES,
  type Phase32G4Manifest,
} from "@/lib/release/phase32-g4-manifest";

export const PHASE32_PRE_APPROVAL_EVIDENCE_VERSION =
  "phase32-pre-approval-evidence-v1" as const;
export const PHASE32_PRE_APPROVAL_EVIDENCE_DOMAIN =
  "SwissTalentHub/phase32/pre-approval-evidence/v1" as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const gitObjectIdSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
const safeReferenceSchema = z
  .string()
  .min(2)
  .max(255)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/u);
const instantSchema = z.iso.datetime({ offset: true });
const environmentSchema = z.enum([
  "local",
  "ci",
  "preview",
  "staging",
  "production",
]);
const reportKindSchema = z.enum(PHASE32_REQUIRED_REPORT_KINDS);
const walkthroughRoleSchema = z.enum(PHASE32_REQUIRED_WALKTHROUGH_ROLES);

const candidateIdentitySchema = z.strictObject({
  commitSha: gitObjectIdSchema,
  treeSha: gitObjectIdSchema,
  lockfileSha256: sha256Schema,
  migrationSha256: sha256Schema,
  schemaSha256: sha256Schema,
  artifactSha256: sha256Schema,
  configurationSha256: sha256Schema,
  sbomSha256: sha256Schema,
  runtimeSha256: sha256Schema,
});

const runtimeIdentitySchema = z.strictObject({
  environment: environmentSchema,
  buildIdentifier: safeReferenceSchema,
  commitSha: gitObjectIdSchema,
  artifactSha256: sha256Schema,
  configurationSha256: sha256Schema,
  runtimeSha256: sha256Schema,
  observedAt: instantSchema,
});

const reportSchema = z
  .strictObject({
    id: safeReferenceSchema,
    kind: reportKindSchema,
    status: z.literal("PASSED"),
    reportSha256: sha256Schema,
    commitSha: gitObjectIdSchema,
    artifactSha256: sha256Schema,
    configurationSha256: sha256Schema,
    failedCount: z.literal(0),
    skippedCount: z.literal(0),
    retryCount: z.literal(0),
    startedAt: instantSchema,
    completedAt: instantSchema,
  })
  .superRefine((report, context) => {
    if (Date.parse(report.completedAt) < Date.parse(report.startedAt)) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "completedAt must not precede startedAt",
      });
    }
  });

const deploymentSchema = z.strictObject({
  id: safeReferenceSchema,
  status: z.literal("PASSED"),
  environment: environmentSchema,
  commitSha: gitObjectIdSchema,
  artifactSha256: sha256Schema,
  configurationSha256: sha256Schema,
  runtimeSha256: sha256Schema,
  buildIdentifier: safeReferenceSchema,
  evidenceSha256: sha256Schema,
  deployedAt: instantSchema,
});

const walkthroughSchema = z
  .strictObject({
    id: safeReferenceSchema,
    deploymentId: safeReferenceSchema,
    status: z.literal("PASSED"),
    commitSha: gitObjectIdSchema,
    artifactSha256: sha256Schema,
    evidenceSha256: sha256Schema,
    coveredRoles: z.array(walkthroughRoleSchema),
    taskCount: z.int().min(10),
    failedTaskCount: z.literal(0),
    skippedTaskCount: z.literal(0),
    startedAt: instantSchema,
    completedAt: instantSchema,
  })
  .superRefine((walkthrough, context) => {
    assertExactStringInventory(
      walkthrough.coveredRoles,
      PHASE32_REQUIRED_WALKTHROUGH_ROLES,
      context,
      ["coveredRoles"],
      "walkthrough role",
    );
    if (
      Date.parse(walkthrough.completedAt) < Date.parse(walkthrough.startedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "completedAt must not precede startedAt",
      });
    }
  });

const rollbackDrillSchema = z
  .strictObject({
    id: safeReferenceSchema,
    deploymentId: safeReferenceSchema,
    status: z.literal("PASSED"),
    environment: environmentSchema,
    candidateCommitSha: gitObjectIdSchema,
    candidateArtifactSha256: sha256Schema,
    rollbackArtifactSha256: sha256Schema,
    rollForwardArtifactSha256: sha256Schema,
    rollbackDurationMilliseconds: z.int().nonnegative(),
    rollForwardDurationMilliseconds: z.int().nonnegative(),
    approvedRollbackBudgetMilliseconds: z.int().positive(),
    approvedRollForwardBudgetMilliseconds: z.int().positive(),
    dataIntegrityVerified: z.literal(true),
    privacyReactivationCount: z.literal(0),
    duplicateSideEffectCount: z.literal(0),
    evidenceSha256: sha256Schema,
    startedAt: instantSchema,
    completedAt: instantSchema,
  })
  .superRefine((drill, context) => {
    if (drill.rollbackArtifactSha256 === drill.candidateArtifactSha256) {
      context.addIssue({
        code: "custom",
        path: ["rollbackArtifactSha256"],
        message: "rollback artifact must differ from the candidate artifact",
      });
    }
    if (
      drill.rollbackDurationMilliseconds >
      drill.approvedRollbackBudgetMilliseconds
    ) {
      context.addIssue({
        code: "custom",
        path: ["rollbackDurationMilliseconds"],
        message: "rollback duration exceeds the approved budget",
      });
    }
    if (
      drill.rollForwardDurationMilliseconds >
      drill.approvedRollForwardBudgetMilliseconds
    ) {
      context.addIssue({
        code: "custom",
        path: ["rollForwardDurationMilliseconds"],
        message: "roll-forward duration exceeds the approved budget",
      });
    }
    if (Date.parse(drill.completedAt) < Date.parse(drill.startedAt)) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "completedAt must not precede startedAt",
      });
    }
  });

const lc1LaunchScopeSchema = z.strictObject({
  policyVersion: z.literal(PHASE32_POLICY_VERSION),
  requestedClass: z.literal("LC1"),
  operatingMode: z.literal("LOCAL_DEMO"),
  dataMode: z.literal("SYNTHETIC_ONLY"),
  providerMode: z.literal("MOCK_OR_DISABLED"),
  moneyMode: z.literal("NO_MONEY"),
  accessMode: z.literal("LOCAL_ONLY"),
  acquisitionMode: z.literal("NONE"),
  publicIndexing: z.literal(false),
  companyTrustSurfaces: z.literal(false),
  multiPersonaPromised: z.literal(false),
  externalTrackerPromised: z.literal(false),
  interviewSchedulerPromised: z.literal(false),
  scale30BTriggered: z.literal(false),
  scale30CTriggered: z.literal(false),
});

const phase32PreApprovalEvidenceSchema = z
  .strictObject({
    schemaVersion: z.literal(PHASE32_PRE_APPROVAL_EVIDENCE_VERSION),
    candidate: candidateIdentitySchema,
    runtime: runtimeIdentitySchema,
    reports: z.array(reportSchema),
    deployment: deploymentSchema,
    launchScope: lc1LaunchScopeSchema,
    findingsLedgerSha256: sha256Schema,
    findingAliasBindingsSha256: sha256Schema,
    walkthrough: walkthroughSchema,
    rollbackDrill: rollbackDrillSchema,
  })
  .superRefine((evidence, context) => {
    assertExactStringInventory(
      evidence.reports.map(({ kind }) => kind),
      PHASE32_REQUIRED_REPORT_KINDS,
      context,
      ["reports"],
      "report kind",
    );

    const candidate = evidence.candidate;
    assertIdentity(
      context,
      ["runtime"],
      "runtime",
      {
        commitSha: candidate.commitSha,
        artifactSha256: candidate.artifactSha256,
        configurationSha256: candidate.configurationSha256,
        runtimeSha256: candidate.runtimeSha256,
        buildIdentifier: candidate.commitSha,
      },
      evidence.runtime,
    );

    evidence.reports.forEach((report, index) => {
      assertIdentity(
        context,
        ["reports", index],
        `report ${report.kind}`,
        {
          commitSha: candidate.commitSha,
          artifactSha256: candidate.artifactSha256,
          configurationSha256: candidate.configurationSha256,
        },
        report,
      );
    });

    assertIdentity(
      context,
      ["deployment"],
      "deployment",
      {
        environment: evidence.runtime.environment,
        commitSha: candidate.commitSha,
        artifactSha256: candidate.artifactSha256,
        configurationSha256: candidate.configurationSha256,
        runtimeSha256: candidate.runtimeSha256,
        buildIdentifier: candidate.commitSha,
      },
      evidence.deployment,
    );

    assertIdentity(
      context,
      ["walkthrough"],
      "walkthrough",
      {
        deploymentId: evidence.deployment.id,
        commitSha: candidate.commitSha,
        artifactSha256: candidate.artifactSha256,
      },
      evidence.walkthrough,
    );

    assertIdentity(
      context,
      ["rollbackDrill"],
      "rollback drill",
      {
        deploymentId: evidence.deployment.id,
        environment: evidence.deployment.environment,
        candidateCommitSha: candidate.commitSha,
        candidateArtifactSha256: candidate.artifactSha256,
        rollForwardArtifactSha256: candidate.artifactSha256,
      },
      evidence.rollbackDrill,
    );
  });

type ParsedPhase32PreApprovalEvidence = z.infer<
  typeof phase32PreApprovalEvidenceSchema
>;
export type Phase32PreApprovalCandidateIdentity = Readonly<
  Pick<
    Phase32G4Manifest["candidate"],
    | "commitSha"
    | "treeSha"
    | "lockfileSha256"
    | "migrationSha256"
    | "schemaSha256"
    | "artifactSha256"
    | "configurationSha256"
    | "sbomSha256"
    | "runtimeSha256"
  >
>;
export type Phase32PreApprovalEvidence = Readonly<
  Omit<ParsedPhase32PreApprovalEvidence, "candidate"> & {
    candidate: Phase32PreApprovalCandidateIdentity;
  }
>;
export type Phase32PreApprovalEvidenceRoot = Readonly<{
  schemaVersion: typeof PHASE32_PRE_APPROVAL_EVIDENCE_VERSION;
  sha256: string;
}>;

/**
 * Validates and canonicalizes every technical/external evidence item that
 * must exist before an LC1 approver signs. Reports are normalized to the
 * closed required inventory, making their array order irrelevant without
 * weakening the exact-kind constraint.
 */
export function canonicalizePhase32PreApprovalEvidence(raw: unknown): string {
  const evidence = parseAndNormalize(raw);
  return canonicalJson({
    domain: PHASE32_PRE_APPROVAL_EVIDENCE_DOMAIN,
    evidence,
  });
}

export function createPhase32PreApprovalEvidenceRoot(
  raw: unknown,
): Phase32PreApprovalEvidenceRoot {
  const sha256 = createHash("sha256")
    .update(canonicalizePhase32PreApprovalEvidence(raw), "utf8")
    .digest("hex");
  return Object.freeze({
    schemaVersion: PHASE32_PRE_APPROVAL_EVIDENCE_VERSION,
    sha256,
  });
}

function parseAndNormalize(raw: unknown): Phase32PreApprovalEvidence {
  const parsed = phase32PreApprovalEvidenceSchema.safeParse(raw);
  if (!parsed.success) {
    fail(
      `schema or binding invalid: ${parsed.error.issues
        .map(
          (issue) =>
            `${issue.path.map(String).join(".") || "<root>"} ${issue.message}`,
        )
        .join("; ")}`,
    );
  }

  const reportsByKind = new Map(
    parsed.data.reports.map((report) => [report.kind, report] as const),
  );
  const reports = PHASE32_REQUIRED_REPORT_KINDS.map((kind) => {
    const report = reportsByKind.get(kind);
    if (report === undefined) {
      fail(`required report ${kind} disappeared during normalization`);
    }
    return report;
  });

  return {
    ...parsed.data,
    reports,
  };
}

function assertExactStringInventory(
  observed: readonly string[],
  required: readonly string[],
  context: z.RefinementCtx,
  path: PropertyKey[],
  label: string,
) {
  const seen = new Set<string>();
  observed.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        path: [...path, index],
        message: `duplicate ${label}: ${value}`,
      });
    }
    seen.add(value);
  });

  for (const value of required) {
    if (!seen.has(value)) {
      context.addIssue({
        code: "custom",
        path,
        message: `missing ${label}: ${value}`,
      });
    }
  }
  for (const value of seen) {
    if (!required.includes(value)) {
      context.addIssue({
        code: "custom",
        path,
        message: `unexpected ${label}: ${value}`,
      });
    }
  }
  if (observed.length !== required.length) {
    context.addIssue({
      code: "custom",
      path,
      message: `${label} inventory must contain exactly ${String(required.length)} entries`,
    });
  }
}

function assertIdentity<
  TExpected extends Readonly<Record<string, string>>,
  TObserved extends TExpected,
>(
  context: z.RefinementCtx,
  path: PropertyKey[],
  label: string,
  expected: TExpected,
  observed: TObserved,
) {
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (observed[field as keyof TObserved] !== expectedValue) {
      context.addIssue({
        code: "custom",
        path: [...path, field],
        message: `${label} identity does not match the candidate`,
      });
    }
  }
}

type CanonicalJsonPrimitive = null | boolean | number | string;
type CanonicalJsonValue =
  CanonicalJsonPrimitive | readonly CanonicalJsonValue[] | CanonicalJsonObject;

interface CanonicalJsonObject {
  readonly [key: string]: CanonicalJsonValue;
}

function canonicalJson(value: CanonicalJsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const entries = Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return `{${entries
    .map(
      ([key, entry]) =>
        `${JSON.stringify(key)}:${canonicalJson(entry as CanonicalJsonValue)}`,
    )
    .join(",")}}`;
}

function fail(message: string): never {
  throw new Error(`Phase 32 pre-approval evidence invalid: ${message}.`);
}
