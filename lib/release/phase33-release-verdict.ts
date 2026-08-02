import { z } from "zod";

export const PHASE33_RELEASE_POLICY_VERSION =
  "phase33-technical-activation-v1" as const;

export const PHASE33_TECHNICAL_GATE_IDS = Object.freeze([
  "BASELINE_GOVERNANCE",
  "HISTORICAL_MIGRATIONS",
  "PROVIDER_MODE_MATRIX",
  "RUNTIME_CONTRACT",
  "ROLE_JOURNEYS",
  "FAILURE_RECOVERY",
  "BROWSER_ACCESSIBILITY",
  "ARTIFACT_IDENTITY",
  "FULL_REGRESSION",
  "LC4_PAYMENT_CLOSED",
  "LC5_PAYMENT_CONTRACT",
] as const);

export const PHASE33_EXTERNAL_GATE_IDS = Object.freeze([
  "LEGAL_PRIVACY_AVG",
  "PROVIDER_SECURITY_DPA",
  "TARGET_RUNTIME_OBSERVABILITY",
  "BACKUP_RESTORE_INCIDENT",
  "OPERATIONS_ON_CALL",
  "PRODUCT_PUBLIC_SCOPE",
  "FINANCE_TAX_INVOICE",
  "PAID_PROVIDER",
  "WTP_DELIVERY_CAPACITY",
] as const);

const technicalTargetSchema = z.enum(["LC4", "LC5"]);
const digestSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/u, "must be a SHA-256 digest");
const commitSchema = z
  .string()
  .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u, "must be a full object id");
const boundedIdentitySchema = z.string().trim().min(1).max(160);

const technicalGateSchema = z.strictObject({
  gateId: z.enum(PHASE33_TECHNICAL_GATE_IDS),
  outcome: z.enum(["PASS", "FAIL", "NOT_RUN"]),
  evidenceDigest: digestSchema.optional(),
});

export const phase33TechnicalManifestSchema = z
  .strictObject({
    policyVersion: z.literal(PHASE33_RELEASE_POLICY_VERSION),
    candidateCommitSha: commitSchema,
    requestedTechnicalTarget: technicalTargetSchema,
    historicalPhase32Decision: z.literal("NO_GO"),
    artifacts: z.strictObject({
      sourceTree: digestSchema,
      lockfile: digestSchema,
      migrations: digestSchema,
      compose: digestSchema,
      standalone: digestSchema,
      ociImage: digestSchema,
      recovery: digestSchema,
      testReport: digestSchema,
    }),
    gates: z.array(technicalGateSchema).max(PHASE33_TECHNICAL_GATE_IDS.length),
  })
  .superRefine((manifest, context) => {
    addDuplicateIssues(
      manifest.gates.map(({ gateId }) => gateId),
      context,
      "gates",
    );
  });

const externalGateSchema = z.strictObject({
  gateId: z.enum(PHASE33_EXTERNAL_GATE_IDS),
  outcome: z.enum(["APPROVED", "BLOCKED", "MISSING", "EXPIRED"]),
  owner: boundedIdentitySchema,
  approvedBy: boundedIdentitySchema.optional(),
  evidenceReference: z.string().trim().min(1).max(512).optional(),
  evidenceDigest: digestSchema.optional(),
  validUntil: z.string().datetime({ offset: true }).optional(),
});

export const phase33ExternalGateLedgerSchema = z
  .strictObject({
    policyVersion: z.literal(PHASE33_RELEASE_POLICY_VERSION),
    trustClass: z.literal("UNVERIFIED_EXTERNAL_DECLARATIONS"),
    candidateCommitSha: commitSchema,
    requestedTarget: technicalTargetSchema,
    gates: z.array(externalGateSchema).max(PHASE33_EXTERNAL_GATE_IDS.length),
    activationDecision: z.strictObject({
      decision: z.enum(["APPROVE", "BLOCK"]),
      decidedAt: z.string().datetime({ offset: true }),
      decisionMakers: z.array(boundedIdentitySchema).min(2).max(8),
      evidenceDigest: digestSchema,
    }),
  })
  .superRefine((ledger, context) => {
    addDuplicateIssues(
      ledger.gates.map(({ gateId }) => gateId),
      context,
      "gates",
    );
    addDuplicateIssues(
      ledger.activationDecision.decisionMakers.map((value) =>
        value.toLocaleLowerCase("en"),
      ),
      context,
      "activationDecision.decisionMakers",
    );
  });

export type Phase33TechnicalManifest = z.infer<
  typeof phase33TechnicalManifestSchema
>;
export type Phase33ExternalGateLedger = z.infer<
  typeof phase33ExternalGateLedgerSchema
>;
export type Phase33TechnicalTarget = z.infer<typeof technicalTargetSchema>;
type Phase33TechnicalGateId = (typeof PHASE33_TECHNICAL_GATE_IDS)[number];
type Phase33ExternalGateId = (typeof PHASE33_EXTERNAL_GATE_IDS)[number];

export type Phase33ReleaseVerdict = Readonly<{
  policyVersion: typeof PHASE33_RELEASE_POLICY_VERSION;
  candidateCommitSha: string | null;
  requestedTarget: Phase33TechnicalTarget | null;
  technical: Readonly<{
    verdict:
      | "TECHNICALLY_READY_FOR_LC4"
      | "TECHNICALLY_READY_FOR_LC5_CONFIGURATION"
      | "TECHNICAL_NO_GO";
    blockers: readonly string[];
  }>;
  activation: Readonly<{
    verdict: "ACTIVATION_BLOCKED_BY_EXTERNAL_GATES";
    blockers: readonly string[];
  }>;
}>;

const COMMON_TECHNICAL_GATES = Object.freeze([
  "BASELINE_GOVERNANCE",
  "HISTORICAL_MIGRATIONS",
  "PROVIDER_MODE_MATRIX",
  "RUNTIME_CONTRACT",
  "ROLE_JOURNEYS",
  "FAILURE_RECOVERY",
  "BROWSER_ACCESSIBILITY",
  "ARTIFACT_IDENTITY",
  "FULL_REGRESSION",
] as const);

const COMMON_EXTERNAL_GATES = Object.freeze([
  "LEGAL_PRIVACY_AVG",
  "PROVIDER_SECURITY_DPA",
  "TARGET_RUNTIME_OBSERVABILITY",
  "BACKUP_RESTORE_INCIDENT",
  "OPERATIONS_ON_CALL",
  "PRODUCT_PUBLIC_SCOPE",
] as const);

export function evaluatePhase33ReleaseVerdict(
  rawTechnicalManifest: unknown,
  rawExternalLedger?: unknown,
  now = new Date(),
): Phase33ReleaseVerdict {
  const technicalParsed =
    phase33TechnicalManifestSchema.safeParse(rawTechnicalManifest);
  if (!technicalParsed.success) {
    return verdict({
      candidateCommitSha: null,
      requestedTarget: null,
      technicalBlockers: technicalParsed.error.issues.map(
        (issue) => `TECHNICAL_MANIFEST_INVALID:${issuePath(issue.path)}`,
      ),
      activationBlockers: ["TECHNICAL_READINESS_REQUIRED"],
    });
  }

  const technical = technicalParsed.data;
  const requiredTechnical: Phase33TechnicalGateId[] = [
    ...COMMON_TECHNICAL_GATES,
    "LC4_PAYMENT_CLOSED",
    ...(technical.requestedTechnicalTarget === "LC5"
      ? (["LC5_PAYMENT_CONTRACT"] as const)
      : []),
  ];
  const technicalById = new Map(
    technical.gates.map((gate) => [gate.gateId, gate] as const),
  );
  const technicalBlockers = requiredTechnical.flatMap((gateId) => {
    const gate = technicalById.get(gateId);
    if (gate === undefined) return [`TECHNICAL_GATE_MISSING:${gateId}`];
    if (gate.outcome !== "PASS") {
      return [`TECHNICAL_GATE_${gate.outcome}:${gateId}`];
    }
    if (gate.evidenceDigest === undefined) {
      return [`TECHNICAL_EVIDENCE_MISSING:${gateId}`];
    }
    return [];
  });

  if (technicalBlockers.length > 0) {
    return verdict({
      candidateCommitSha: technical.candidateCommitSha,
      requestedTarget: technical.requestedTechnicalTarget,
      technicalBlockers,
      activationBlockers: ["TECHNICAL_READINESS_REQUIRED"],
    });
  }

  const activationBlockers = inspectExternalLedger(
    technical,
    rawExternalLedger,
    now,
  );
  return verdict({
    candidateCommitSha: technical.candidateCommitSha,
    requestedTarget: technical.requestedTechnicalTarget,
    technicalBlockers: [],
    activationBlockers,
  });
}

/** Missing or incomplete external evidence is a distinct, non-technical exit. */
export function phase33ReleaseExitCode(
  decision: Phase33ReleaseVerdict,
  mode: "technical" | "activation",
) {
  if (mode === "technical") {
    return decision.technical.verdict === "TECHNICAL_NO_GO" ? 1 : 0;
  }
  return 2;
}

function inspectExternalLedger(
  technical: Phase33TechnicalManifest,
  rawExternalLedger: unknown,
  now: Date,
) {
  if (rawExternalLedger === undefined) return ["EXTERNAL_LEDGER_MISSING"];
  const parsed = phase33ExternalGateLedgerSchema.safeParse(rawExternalLedger);
  if (!parsed.success) {
    return parsed.error.issues.map(
      (issue) => `EXTERNAL_LEDGER_INVALID:${issuePath(issue.path)}`,
    );
  }
  const ledger = parsed.data;
  const blockers: string[] = [];
  if (ledger.candidateCommitSha !== technical.candidateCommitSha) {
    blockers.push("EXTERNAL_CANDIDATE_MISMATCH");
  }
  if (ledger.requestedTarget !== technical.requestedTechnicalTarget) {
    blockers.push("EXTERNAL_TARGET_MISMATCH");
  }
  const required: Phase33ExternalGateId[] = [
    ...COMMON_EXTERNAL_GATES,
    ...(technical.requestedTechnicalTarget === "LC5"
      ? ([
          "FINANCE_TAX_INVOICE",
          "PAID_PROVIDER",
          "WTP_DELIVERY_CAPACITY",
        ] as const)
      : []),
  ];
  const byId = new Map(
    ledger.gates.map((gate) => [gate.gateId, gate] as const),
  );
  for (const gateId of required) {
    const gate = byId.get(gateId);
    if (gate === undefined) {
      blockers.push(`EXTERNAL_GATE_MISSING:${gateId}`);
      continue;
    }
    if (gate.outcome !== "APPROVED") {
      blockers.push(`EXTERNAL_GATE_${gate.outcome}:${gateId}`);
      continue;
    }
    if (
      gate.approvedBy === undefined ||
      gate.evidenceDigest === undefined ||
      gate.evidenceReference === undefined
    ) {
      blockers.push(`EXTERNAL_EVIDENCE_INCOMPLETE:${gateId}`);
    }
    if (
      gate.approvedBy?.toLocaleLowerCase("en") ===
      gate.owner.toLocaleLowerCase("en")
    ) {
      blockers.push(`EXTERNAL_SELF_APPROVAL:${gateId}`);
    }
    if (
      gate.validUntil !== undefined &&
      Date.parse(gate.validUntil) <= now.getTime()
    ) {
      blockers.push(`EXTERNAL_EVIDENCE_EXPIRED:${gateId}`);
    }
  }
  if (ledger.activationDecision.decision !== "APPROVE") {
    blockers.push("ACTIVATION_DECISION_NOT_APPROVED");
  }
  // This repository can validate completeness but cannot authenticate human,
  // legal or commercial declarations from candidate-controlled JSON. A real
  // GO_LIVE_APPROVED decision belongs to a protected deployment control that
  // verifies independently provisioned signatures/identities. Keep this local
  // evaluator advisory and fail closed even when every declaration is present.
  blockers.push("PROTECTED_EXTERNAL_ATTESTATION_REQUIRED");
  return blockers;
}

function verdict(
  input: Readonly<{
    candidateCommitSha: string | null;
    requestedTarget: Phase33TechnicalTarget | null;
    technicalBlockers: readonly string[];
    activationBlockers: readonly string[];
  }>,
): Phase33ReleaseVerdict {
  const technicalReady = input.technicalBlockers.length === 0;
  return Object.freeze({
    policyVersion: PHASE33_RELEASE_POLICY_VERSION,
    candidateCommitSha: input.candidateCommitSha,
    requestedTarget: input.requestedTarget,
    technical: Object.freeze({
      verdict: !technicalReady
        ? "TECHNICAL_NO_GO"
        : input.requestedTarget === "LC4"
          ? "TECHNICALLY_READY_FOR_LC4"
          : "TECHNICALLY_READY_FOR_LC5_CONFIGURATION",
      blockers: Object.freeze([...input.technicalBlockers].sort()),
    }),
    activation: Object.freeze({
      verdict: "ACTIVATION_BLOCKED_BY_EXTERNAL_GATES",
      blockers: Object.freeze([...input.activationBlockers].sort()),
    }),
  });
}

function addDuplicateIssues(
  values: readonly string[],
  context: z.RefinementCtx,
  path: string,
) {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        message: "duplicate value",
        path: [path, index],
      });
    }
    seen.add(value);
  });
}

function issuePath(path: readonly PropertyKey[]) {
  return path.map(String).join(".") || "<root>";
}
