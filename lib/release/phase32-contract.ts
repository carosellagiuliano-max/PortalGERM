import { z } from "zod";

export const PHASE32_POLICY_VERSION = "phase32-launch-class-v1" as const;

export const PHASE32_LAUNCH_CLASSES = Object.freeze([
  "LC1",
  "LC2",
  "LC3",
  "LC4",
  "LC5",
  "LC6",
] as const);

export const PHASE32_GATE_OUTCOMES = Object.freeze([
  "PASS",
  "FAIL",
  "BLOCKED",
  "NOT_RUN",
  "DISABLED",
  "DEFERRED_MONITORED",
] as const);

/**
 * This is a closed vocabulary. Adding a gate is a policy change and must not
 * be silently accepted by an older release evaluator.
 */
export const PHASE32_GATE_IDS = Object.freeze([
  "GOVERNANCE_BASELINE",
  "FINDINGS_LEDGER",
  "AUTOMATED_REGRESSION",
  "ARTIFACT_IDENTITY",
  "ROLLBACK_PATH",
  "INDEPENDENT_APPROVALS",
  "DEMO_CLASSIFICATION",
  "LC1_ISOLATION",
  "FLOW_LEGAL_PRIVACY_AVG_TAX",
  "PARTNER_CONSENT_DPA",
  "INCIDENT_SUPPORT_OWNERS",
  "TEST_DATA_DELETION",
  "USED_PROVIDER_APPROVALS",
  "LC2_SUPERVISED_CONTROL",
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
  "LC3_INVITE_ONLY_CONTROL",
  "PHASE26_COMPANY_TRUST",
  "PHASE29A_USER_RESEARCH",
  "PUBLIC_RETENTION_SUPPORT",
  "LC4_PUBLIC_FREE_CONTROL",
  "PHASE24_BILLING_FINANCE",
  "PHASE31_WTP_DELIVERY",
  "TAX_INVOICE_RECONCILIATION_DUNNING",
  "PAID_SERVICE_RECOVERY",
  "CAPACITY_CASHFLOW",
  "PAID_PROVIDER_APPROVALS",
  "LC5_PAID_SELF_SERVICE_CONTROL",
  "SLO_SLI_CAPACITY",
  "BACKUP_RESTORE_RPO_RTO",
  "ON_CALL_INCIDENT",
  "LOAD_SOAK",
  "PHASE30B_SCALE",
  "PHASE30C_SITEMAP",
  "LC6_SCALE_CONTROL",
  "PHASE27_MULTI_PERSONA",
  "PHASE28_EXTERNAL_TRACKER",
  "PHASE28_INTERVIEW_SCHEDULER",
] as const);

export const PHASE32_OPERATING_MODES = Object.freeze([
  "LOCAL_DEMO",
  "SUPERVISED_DESIGN_PARTNER",
  "INVITE_ONLY_PILOT",
  "PUBLIC_FREE",
  "PAID_SELF_SERVICE",
  "SCALED_PRODUCTION",
] as const);

export const PHASE32_DATA_MODES = Object.freeze([
  "SYNTHETIC_ONLY",
  "ALLOWLISTED_REAL",
  "REAL",
] as const);

export const PHASE32_PROVIDER_MODES = Object.freeze([
  "MOCK_OR_DISABLED",
  "FLOW_SCOPED_APPROVED",
  "APPROVED_REAL",
] as const);

export const PHASE32_MONEY_MODES = Object.freeze([
  "NO_MONEY",
  "APPROVED_PAID_OFFERS",
] as const);

export const PHASE32_ACCESS_MODES = Object.freeze([
  "LOCAL_ONLY",
  "SUPERVISED_ALLOWLIST",
  "INVITE_ONLY",
  "PUBLIC_SELF_SERVICE",
] as const);

export const PHASE32_ACQUISITION_MODES = Object.freeze([
  "NONE",
  "CLOSED_COHORT",
  "BOUNDED_PUBLIC",
  "BROAD",
] as const);

export const phase32LaunchClassSchema = z.enum(PHASE32_LAUNCH_CLASSES);
export const phase32GateOutcomeSchema = z.enum(PHASE32_GATE_OUTCOMES);
export const phase32GateIdSchema = z.enum(PHASE32_GATE_IDS);
export const phase32OperatingModeSchema = z.enum(PHASE32_OPERATING_MODES);
export const phase32DataModeSchema = z.enum(PHASE32_DATA_MODES);
export const phase32ProviderModeSchema = z.enum(PHASE32_PROVIDER_MODES);
export const phase32MoneyModeSchema = z.enum(PHASE32_MONEY_MODES);
export const phase32AccessModeSchema = z.enum(PHASE32_ACCESS_MODES);
export const phase32AcquisitionModeSchema = z.enum(PHASE32_ACQUISITION_MODES);

export const phase32GateRecordSchema = z.strictObject({
  gateId: phase32GateIdSchema,
  outcome: phase32GateOutcomeSchema,
});

export const phase32GateSetSchema = z
  .array(phase32GateRecordSchema)
  .max(PHASE32_GATE_IDS.length)
  .superRefine((records, context) => {
    const observed = new Set<string>();
    records.forEach((record, index) => {
      if (observed.has(record.gateId)) {
        context.addIssue({
          code: "custom",
          message: "duplicate gate id",
          path: [index, "gateId"],
        });
      }
      observed.add(record.gateId);
    });
  });

/**
 * Scope is deliberately explicit rather than inferred from environment names.
 * The policy validates the complete profile for the requested class, which
 * prevents a mixed LC4-public-free/LC5-paid approval.
 */
export const phase32ReleaseScopeSchema = z.strictObject({
  requestedClass: phase32LaunchClassSchema,
  operatingMode: phase32OperatingModeSchema,
  dataMode: phase32DataModeSchema,
  providerMode: phase32ProviderModeSchema,
  moneyMode: phase32MoneyModeSchema,
  accessMode: phase32AccessModeSchema,
  acquisitionMode: phase32AcquisitionModeSchema,
  publicIndexing: z.boolean(),
  companyTrustSurfaces: z.boolean(),
  multiPersonaPromised: z.boolean(),
  externalTrackerPromised: z.boolean(),
  interviewSchedulerPromised: z.boolean(),
  scale30BTriggered: z.boolean(),
  scale30CTriggered: z.boolean(),
});

export const phase32LaunchClassPolicyInputSchema = z.strictObject({
  policyVersion: z.literal(PHASE32_POLICY_VERSION),
  scope: phase32ReleaseScopeSchema,
  gates: phase32GateSetSchema,
});

export type Phase32LaunchClass = z.infer<typeof phase32LaunchClassSchema>;
export type Phase32GateOutcome = z.infer<typeof phase32GateOutcomeSchema>;
export type Phase32GateId = z.infer<typeof phase32GateIdSchema>;
export type Phase32GateRecord = z.infer<typeof phase32GateRecordSchema>;
export type Phase32ReleaseScope = z.infer<typeof phase32ReleaseScopeSchema>;
export type Phase32LaunchClassPolicyInput = z.infer<
  typeof phase32LaunchClassPolicyInputSchema
>;
