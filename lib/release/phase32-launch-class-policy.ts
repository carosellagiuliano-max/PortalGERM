import {
  PHASE32_LAUNCH_CLASSES,
  PHASE32_POLICY_VERSION,
  phase32LaunchClassPolicyInputSchema,
  type Phase32GateId,
  type Phase32GateOutcome,
  type Phase32LaunchClass,
  type Phase32LaunchClassPolicyInput,
  type Phase32ReleaseScope,
} from "@/lib/release/phase32-contract";

type ScopeProfile = Readonly<{
  accessMode: Phase32ReleaseScope["accessMode"];
  acquisitionMode: Phase32ReleaseScope["acquisitionMode"];
  dataMode: Phase32ReleaseScope["dataMode"];
  moneyMode: Phase32ReleaseScope["moneyMode"];
  operatingMode: Phase32ReleaseScope["operatingMode"];
  providerMode: Phase32ReleaseScope["providerMode"];
  publicIndexing: boolean;
}>;

export type Phase32GateFailure = Readonly<{
  gateId: Phase32GateId;
  expected: readonly Phase32GateOutcome[];
  observed: Phase32GateOutcome | "MISSING";
}>;

export type Phase32ClassEvaluation = Readonly<{
  launchClass: Phase32LaunchClass;
  rank: number;
  scopeCompatible: boolean;
  foundationsSatisfied: boolean;
  eligible: boolean;
  gateFailures: readonly Phase32GateFailure[];
  scopeMismatches: readonly string[];
}>;

export type Phase32LaunchClassDecision = Readonly<{
  policyVersion: typeof PHASE32_POLICY_VERSION;
  status: "APPROVED" | "NO_GO";
  decision: Phase32LaunchClass | "NO_GO";
  approvedClass: Phase32LaunchClass | null;
  requestedClass: Phase32LaunchClass | null;
  evaluations: readonly Phase32ClassEvaluation[];
  validationIssues: readonly string[];
}>;

const BASE_FOUNDATIONS = Object.freeze([
  "GOVERNANCE_BASELINE",
  "FINDINGS_LEDGER",
  "AUTOMATED_REGRESSION",
  "ARTIFACT_IDENTITY",
  "ROLLBACK_PATH",
  "INDEPENDENT_APPROVALS",
] as const satisfies readonly Phase32GateId[]);

const LC2_FOUNDATIONS = Object.freeze([
  "FLOW_LEGAL_PRIVACY_AVG_TAX",
  "PARTNER_CONSENT_DPA",
  "INCIDENT_SUPPORT_OWNERS",
  "TEST_DATA_DELETION",
  "USED_PROVIDER_APPROVALS",
] as const satisfies readonly Phase32GateId[]);

const LC3_FOUNDATIONS = Object.freeze([
  "PHASE20_IDENTITY_NOTIFICATIONS",
  "PHASE21_DOCUMENT_VAULT",
  "PHASE22_PRIVACY_LEGAL",
  "PHASE23_WORKER_OPERATIONS",
  "PHASE25_SECURITY_ASSURANCE",
  "TRUST_FRAUD_SUPPORT",
  "PROVIDER_WORKER_FAILURE",
  "PHASE29B_ACCESSIBILITY",
  "PHASE30A_SEARCH_QUALITY",
  "PHASE30D_JOB_FRESHNESS",
] as const satisfies readonly Phase32GateId[]);

const LC4_FOUNDATIONS = Object.freeze([
  "PHASE26_COMPANY_TRUST",
  "PHASE29A_USER_RESEARCH",
  "PUBLIC_RETENTION_SUPPORT",
] as const satisfies readonly Phase32GateId[]);

const LC5_FOUNDATIONS = Object.freeze([
  "PHASE24_BILLING_FINANCE",
  "PHASE31_WTP_DELIVERY",
  "TAX_INVOICE_RECONCILIATION_DUNNING",
  "PAID_SERVICE_RECOVERY",
  "CAPACITY_CASHFLOW",
  "PAID_PROVIDER_APPROVALS",
] as const satisfies readonly Phase32GateId[]);

const LC6_FOUNDATIONS = Object.freeze([
  "SLO_SLI_CAPACITY",
  "BACKUP_RESTORE_RPO_RTO",
  "ON_CALL_INCIDENT",
  "LOAD_SOAK",
] as const satisfies readonly Phase32GateId[]);

const CLASS_MODE_GATES = Object.freeze({
  LC1: Object.freeze(["DEMO_CLASSIFICATION", "LC1_ISOLATION"] as const),
  LC2: Object.freeze(["LC2_SUPERVISED_CONTROL"] as const),
  LC3: Object.freeze(["LC3_INVITE_ONLY_CONTROL"] as const),
  LC4: Object.freeze(["LC4_PUBLIC_FREE_CONTROL"] as const),
  LC5: Object.freeze(["LC5_PAID_SELF_SERVICE_CONTROL"] as const),
  LC6: Object.freeze(["LC6_SCALE_CONTROL"] as const),
} satisfies Record<Phase32LaunchClass, readonly Phase32GateId[]>);

const SCOPE_PROFILES = Object.freeze({
  LC1: Object.freeze({
    operatingMode: "LOCAL_DEMO",
    dataMode: "SYNTHETIC_ONLY",
    providerMode: "MOCK_OR_DISABLED",
    moneyMode: "NO_MONEY",
    accessMode: "LOCAL_ONLY",
    acquisitionMode: "NONE",
    publicIndexing: false,
  }),
  LC2: Object.freeze({
    operatingMode: "SUPERVISED_DESIGN_PARTNER",
    dataMode: "ALLOWLISTED_REAL",
    providerMode: "FLOW_SCOPED_APPROVED",
    moneyMode: "NO_MONEY",
    accessMode: "SUPERVISED_ALLOWLIST",
    acquisitionMode: "CLOSED_COHORT",
    publicIndexing: false,
  }),
  LC3: Object.freeze({
    operatingMode: "INVITE_ONLY_PILOT",
    dataMode: "ALLOWLISTED_REAL",
    providerMode: "APPROVED_REAL",
    moneyMode: "NO_MONEY",
    accessMode: "INVITE_ONLY",
    acquisitionMode: "CLOSED_COHORT",
    publicIndexing: false,
  }),
  LC4: Object.freeze({
    operatingMode: "PUBLIC_FREE",
    dataMode: "REAL",
    providerMode: "APPROVED_REAL",
    moneyMode: "NO_MONEY",
    accessMode: "PUBLIC_SELF_SERVICE",
    acquisitionMode: "BOUNDED_PUBLIC",
    publicIndexing: true,
  }),
  LC5: Object.freeze({
    operatingMode: "PAID_SELF_SERVICE",
    dataMode: "REAL",
    providerMode: "APPROVED_REAL",
    moneyMode: "APPROVED_PAID_OFFERS",
    accessMode: "PUBLIC_SELF_SERVICE",
    acquisitionMode: "BOUNDED_PUBLIC",
    publicIndexing: true,
  }),
  LC6: Object.freeze({
    operatingMode: "SCALED_PRODUCTION",
    dataMode: "REAL",
    providerMode: "APPROVED_REAL",
    moneyMode: "APPROVED_PAID_OFFERS",
    accessMode: "PUBLIC_SELF_SERVICE",
    acquisitionMode: "BROAD",
    publicIndexing: true,
  }),
} satisfies Record<Phase32LaunchClass, ScopeProfile>);

/**
 * Evaluates all six classes and returns only the highest class whose
 * cumulative foundations and exact, class-specific operating profile pass.
 * Invalid or future input is converted to NO_GO rather than being interpreted.
 */
export function evaluatePhase32LaunchClassPolicy(
  raw: unknown,
): Phase32LaunchClassDecision {
  const parsed = phase32LaunchClassPolicyInputSchema.safeParse(raw);
  if (!parsed.success) {
    return invalidDecision(
      parsed.error.issues.map(
        (issue) =>
          `${issue.path.map(String).join(".") || "<root>"}:${issue.code}`,
      ),
    );
  }

  const input = parsed.data;
  const gateOutcomes = new Map(
    input.gates.map(({ gateId, outcome }) => [gateId, outcome] as const),
  );
  const evaluations = PHASE32_LAUNCH_CLASSES.map((launchClass, index) =>
    evaluateClass(launchClass, index + 1, input, gateOutcomes),
  );
  const approved =
    [...evaluations].reverse().find(({ eligible }) => eligible) ?? null;
  const approvedClass = approved?.launchClass ?? null;

  return Object.freeze({
    policyVersion: PHASE32_POLICY_VERSION,
    status: approvedClass === null ? "NO_GO" : "APPROVED",
    decision: approvedClass ?? "NO_GO",
    approvedClass,
    requestedClass: input.scope.requestedClass,
    evaluations: Object.freeze(evaluations),
    validationIssues: Object.freeze([]),
  });
}

function evaluateClass(
  launchClass: Phase32LaunchClass,
  rank: number,
  input: Phase32LaunchClassPolicyInput,
  gateOutcomes: ReadonlyMap<Phase32GateId, Phase32GateOutcome>,
): Phase32ClassEvaluation {
  const scopeMismatches = scopeMismatchReasons(launchClass, input.scope);
  const expectations = gateExpectations(launchClass, input.scope);
  const gateFailures = expectations.flatMap(({ gateId, expected }) => {
    const observed = gateOutcomes.get(gateId) ?? "MISSING";
    return expected.includes(observed as Phase32GateOutcome)
      ? []
      : [
          Object.freeze({
            gateId,
            expected,
            observed,
          }),
        ];
  });
  const scopeCompatible = scopeMismatches.length === 0;
  const foundationsSatisfied = gateFailures.length === 0;

  return Object.freeze({
    launchClass,
    rank,
    scopeCompatible,
    foundationsSatisfied,
    eligible: scopeCompatible && foundationsSatisfied,
    gateFailures: Object.freeze(gateFailures),
    scopeMismatches: Object.freeze(scopeMismatches),
  });
}

function scopeMismatchReasons(
  launchClass: Phase32LaunchClass,
  scope: Phase32ReleaseScope,
): string[] {
  const mismatches: string[] = [];
  if (scope.requestedClass !== launchClass) {
    mismatches.push("REQUESTED_CLASS");
  }
  const expected = SCOPE_PROFILES[launchClass];
  for (const key of [
    "operatingMode",
    "dataMode",
    "providerMode",
    "moneyMode",
    "accessMode",
    "acquisitionMode",
    "publicIndexing",
  ] as const) {
    if (scope[key] !== expected[key]) mismatches.push(key);
  }
  if (
    (launchClass === "LC1" || launchClass === "LC2") &&
    scope.companyTrustSurfaces
  ) {
    mismatches.push("companyTrustSurfaces");
  }
  if (
    (launchClass === "LC4" || launchClass === "LC5" || launchClass === "LC6") &&
    !scope.companyTrustSurfaces
  ) {
    mismatches.push("companyTrustSurfaces");
  }
  if (
    launchClass !== "LC6" &&
    (scope.scale30BTriggered || scope.scale30CTriggered)
  ) {
    mismatches.push("scaleTriggers");
  }
  return mismatches;
}

function gateExpectations(
  launchClass: Phase32LaunchClass,
  scope: Phase32ReleaseScope,
): readonly Readonly<{
  gateId: Phase32GateId;
  expected: readonly Phase32GateOutcome[];
}>[] {
  const expectations = new Map<Phase32GateId, readonly Phase32GateOutcome[]>();
  const requirePass = (gateIds: readonly Phase32GateId[]) => {
    for (const gateId of gateIds) expectations.set(gateId, PASS);
  };

  requirePass(BASE_FOUNDATIONS);
  if (atLeast(launchClass, "LC2")) requirePass(LC2_FOUNDATIONS);
  if (atLeast(launchClass, "LC3")) requirePass(LC3_FOUNDATIONS);
  if (atLeast(launchClass, "LC4")) requirePass(LC4_FOUNDATIONS);
  if (atLeast(launchClass, "LC5")) requirePass(LC5_FOUNDATIONS);
  if (atLeast(launchClass, "LC6")) requirePass(LC6_FOUNDATIONS);
  requirePass(CLASS_MODE_GATES[launchClass]);

  expectations.set(
    "PHASE27_MULTI_PERSONA",
    scope.multiPersonaPromised ? PASS : DISABLED,
  );
  expectations.set(
    "PHASE28_EXTERNAL_TRACKER",
    scope.externalTrackerPromised ? PASS : DISABLED,
  );
  expectations.set(
    "PHASE28_INTERVIEW_SCHEDULER",
    scope.interviewSchedulerPromised ? PASS : DISABLED,
  );

  if (launchClass === "LC3") {
    expectations.set(
      "PHASE26_COMPANY_TRUST",
      scope.companyTrustSurfaces ? PASS : DISABLED,
    );
  } else if (launchClass === "LC1" || launchClass === "LC2") {
    expectations.set("PHASE26_COMPANY_TRUST", DISABLED);
  }

  if (launchClass === "LC6") {
    expectations.set(
      "PHASE30B_SCALE",
      scope.scale30BTriggered ? PASS : DEFERRED_MONITORED,
    );
    expectations.set(
      "PHASE30C_SITEMAP",
      scope.scale30CTriggered ? PASS : DEFERRED_MONITORED,
    );
  }

  return Object.freeze(
    [...expectations.entries()].map(([gateId, expected]) =>
      Object.freeze({ gateId, expected }),
    ),
  );
}

const PASS = Object.freeze(["PASS"] as const);
const DISABLED = Object.freeze(["DISABLED"] as const);
const DEFERRED_MONITORED = Object.freeze(["DEFERRED_MONITORED"] as const);

function atLeast(candidate: Phase32LaunchClass, minimum: Phase32LaunchClass) {
  return (
    PHASE32_LAUNCH_CLASSES.indexOf(candidate) >=
    PHASE32_LAUNCH_CLASSES.indexOf(minimum)
  );
}

function invalidDecision(
  validationIssues: readonly string[],
): Phase32LaunchClassDecision {
  const evaluations = PHASE32_LAUNCH_CLASSES.map((launchClass, index) =>
    Object.freeze({
      launchClass,
      rank: index + 1,
      scopeCompatible: false,
      foundationsSatisfied: false,
      eligible: false,
      gateFailures: Object.freeze([]),
      scopeMismatches: Object.freeze(["INVALID_INPUT"]),
    }),
  );
  return Object.freeze({
    policyVersion: PHASE32_POLICY_VERSION,
    status: "NO_GO",
    decision: "NO_GO",
    approvedClass: null,
    requestedClass: null,
    evaluations: Object.freeze(evaluations),
    validationIssues: Object.freeze([...validationIssues]),
  });
}
