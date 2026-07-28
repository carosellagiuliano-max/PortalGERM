import "server-only";

import { getServerEnvironment } from "@/lib/config/env";
import {
  createDeterministicDomainChallengeProvider,
  createDeterministicRegisterProvider,
  createDisabledDomainChallengeProvider,
  createDisabledRegisterProvider,
} from "@/lib/providers/company-verification/deterministic-sandbox";

export type CompanyRegisterSandboxFixture = Readonly<{
  uid: string;
  legalName: string;
  cantonCode: string;
  providerReference: string;
}>;

export function createCompanyVerificationProviders(
  fixtures: readonly CompanyRegisterSandboxFixture[] = [],
) {
  const environment = getServerEnvironment();
  const sandboxAllowed =
    (environment.APP_ENV === "local" || environment.APP_ENV === "ci") &&
    environment.COMPANY_VERIFICATION_COHORT === "test";
  return Object.freeze({
    register:
      sandboxAllowed &&
      environment.COMPANY_REGISTER_PROVIDER_MODE ===
        "deterministic_sandbox"
        ? createDeterministicRegisterProvider(fixtures)
        : createDisabledRegisterProvider(),
    domain:
      sandboxAllowed &&
      environment.COMPANY_DOMAIN_PROVIDER_MODE === "deterministic_sandbox"
        ? createDeterministicDomainChallengeProvider()
        : createDisabledDomainChallengeProvider(),
  });
}

export function companyVerificationRuntimeFlags() {
  const environment = getServerEnvironment();
  return Object.freeze({
    stepUpMode: environment.PRIVILEGED_STEP_UP_MODE,
    activation: Object.freeze({
      trustV2: environment.COMPANY_TRUST_V2,
      registerCheck: environment.COMPANY_REGISTER_CHECK,
      domainChallenge: environment.COMPANY_DOMAIN_CHALLENGE,
      document: environment.COMPANY_VERIFICATION_DOCUMENT,
      rapidRevoke: environment.COMPANY_TRUST_RAPID_REVOKE,
      legacyReverify: environment.LEGACY_COMPANY_REVERIFY,
    }),
  });
}
