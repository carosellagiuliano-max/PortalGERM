import type { CompanyRegisterSandboxFixture } from "@/lib/companies/verification/composition";

/**
 * Fictitious, local/CI-only register rows. They are deliberately not derived
 * from employer input, so a sandbox exact match still exercises a real
 * provider boundary instead of accepting self-asserted values.
 */
export const COMPANY_VERIFICATION_SANDBOX_FIXTURES = Object.freeze([
  Object.freeze({
    uid: "CHE-111.000.001",
    legalName: "NovaRigi Digital AG",
    cantonCode: "ZH",
    providerReference: "sandbox-register:nova-rigi:v1",
  }),
  Object.freeze({
    uid: "CHE-117.000.001",
    legalName: "Carevia Quartiergesundheit AG",
    cantonCode: "BS",
    providerReference: "sandbox-register:carevia:v1",
  }),
  Object.freeze({
    uid: "CHE-117.170.002",
    legalName: "Phase 17 Prüfwerk AG",
    cantonCode: "ZH",
    providerReference: "sandbox-register:phase17-pruefwerk:v1",
  }),
] as const satisfies readonly CompanyRegisterSandboxFixture[]);
