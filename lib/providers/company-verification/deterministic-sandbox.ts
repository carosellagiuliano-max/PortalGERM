import {
  COMPANY_VERIFICATION_PROVIDER_CONTRACT_V1,
  normalizeCompanyName,
  normalizeDomainChallengeInput,
  normalizeRegisterCheckInput,
  providerDigest,
  type DomainChallengeCheckInput,
  type CompanyDomainChallengeProvider,
  type CompanyRegisterCheckInput,
  type CompanyRegisterProvider,
} from "@/lib/providers/company-verification/provider-contract";

type RegisterFixture = Readonly<{
  uid: string;
  legalName: string;
  cantonCode: string;
  providerReference: string;
}>;

export function createDeterministicRegisterProvider(
  fixtures: readonly RegisterFixture[],
  now: () => Date = () => new Date(),
): CompanyRegisterProvider {
  const rows = fixtures.map((fixture) => ({
    ...fixture,
    legalNameNormalized: normalizeCompanyName(fixture.legalName),
  }));
  return Object.freeze({
    adapterKey: "deterministic_sandbox",
    adapterVersion: "v1" as const,
    async check(input: CompanyRegisterCheckInput) {
      const startedAt = now();
      const normalized = normalizeRegisterCheckInput(input);
      if (normalized === null) {
        return registerResult({
          input,
          result: "MALFORMED",
          uidMatched: null,
          nameMatched: null,
          cantonMatched: null,
          providerReference: null,
          retryable: false,
          failureCode: "INPUT_MALFORMED",
          checkedAt: startedAt,
        });
      }
      const fixture = rows.find((row) => row.uid === normalized.uid);
      if (fixture === undefined) {
        return registerResult({
          input: normalized,
          result: "NOT_FOUND",
          uidMatched: false,
          nameMatched: null,
          cantonMatched: null,
          providerReference: null,
          retryable: false,
          failureCode: "UID_NOT_FOUND",
          checkedAt: startedAt,
        });
      }
      const nameMatched = fixture.legalNameNormalized === normalized.legalName;
      const cantonMatched = fixture.cantonCode === normalized.cantonCode;
      const exact = nameMatched && cantonMatched;
      return registerResult({
        input: normalized,
        result: exact ? "EXACT_MATCH" : "MISMATCH",
        uidMatched: true,
        nameMatched,
        cantonMatched,
        providerReference: fixture.providerReference,
        retryable: false,
        failureCode: exact ? null : "REGISTER_ATTRIBUTES_MISMATCH",
        checkedAt: startedAt,
      });
    },
  });
}

export function createDeterministicDomainChallengeProvider(
  now: () => Date = () => new Date(),
): CompanyDomainChallengeProvider {
  return Object.freeze({
    adapterKey: "deterministic_sandbox",
    adapterVersion: "v1" as const,
    async check(input: DomainChallengeCheckInput) {
      const checkedAt = now();
      const normalized = normalizeDomainChallengeInput(input);
      if (normalized === null) {
        return domainResult({
          input,
          result: "MALFORMED",
          domainMatched: null,
          retryable: false,
          failureCode: "CHALLENGE_INPUT_MALFORMED",
          checkedAt,
        });
      }
      const expectedProof = `sth-domain-verification=${normalized.challengeToken}`;
      const matched = normalized.presentedProof === expectedProof;
      return domainResult({
        input: normalized,
        result: matched ? "EXACT_MATCH" : "MISMATCH",
        domainMatched: matched,
        retryable: false,
        failureCode: matched ? null : "DOMAIN_PROOF_MISMATCH",
        checkedAt,
      });
    },
  });
}

export function createDisabledRegisterProvider(): CompanyRegisterProvider {
  return Object.freeze({
    adapterKey: "disabled",
    adapterVersion: "v1" as const,
    async check(input: CompanyRegisterCheckInput) {
      return registerResult({
        input,
        result: "PROVIDER_ERROR",
        uidMatched: null,
        nameMatched: null,
        cantonMatched: null,
        providerReference: null,
        retryable: false,
        failureCode: "PROVIDER_DISABLED",
        checkedAt: new Date(),
      });
    },
  });
}

export function createDisabledDomainChallengeProvider(): CompanyDomainChallengeProvider {
  return Object.freeze({
    adapterKey: "disabled",
    adapterVersion: "v1" as const,
    async check(input: DomainChallengeCheckInput) {
      return domainResult({
        input,
        result: "PROVIDER_ERROR",
        domainMatched: null,
        retryable: false,
        failureCode: "PROVIDER_DISABLED",
        checkedAt: new Date(),
      });
    },
  });
}

function registerResult(input: {
  input: unknown;
  result:
    | "EXACT_MATCH"
    | "MISMATCH"
    | "NOT_FOUND"
    | "MALFORMED"
    | "PROVIDER_ERROR";
  uidMatched: boolean | null;
  nameMatched: boolean | null;
  cantonMatched: boolean | null;
  providerReference: string | null;
  retryable: boolean;
  failureCode: string | null;
  checkedAt: Date;
}) {
  const safeResponse = {
    result: input.result,
    uidMatched: input.uidMatched,
    nameMatched: input.nameMatched,
    cantonMatched: input.cantonMatched,
    failureCode: input.failureCode,
  };
  return Object.freeze({
    contractVersion: COMPANY_VERIFICATION_PROVIDER_CONTRACT_V1,
    result: input.result,
    uidMatched: input.uidMatched,
    nameMatched: input.nameMatched,
    cantonMatched: input.cantonMatched,
    requestDigest: providerDigest(input.input),
    responseDigest: providerDigest(safeResponse),
    providerReferenceDigest:
      input.providerReference === null
        ? null
        : providerDigest(input.providerReference),
    retryable: input.retryable,
    failureCode: input.failureCode,
    checkedAt: new Date(input.checkedAt),
    latencyMs: 0,
  });
}

function domainResult(input: {
  input: unknown;
  result:
    | "EXACT_MATCH"
    | "MISMATCH"
    | "MALFORMED"
    | "PROVIDER_ERROR";
  domainMatched: boolean | null;
  retryable: boolean;
  failureCode: string | null;
  checkedAt: Date;
}) {
  const safeResponse = {
    result: input.result,
    domainMatched: input.domainMatched,
    failureCode: input.failureCode,
  };
  return Object.freeze({
    contractVersion: COMPANY_VERIFICATION_PROVIDER_CONTRACT_V1,
    result: input.result,
    domainMatched: input.domainMatched,
    requestDigest: providerDigest(input.input),
    responseDigest: providerDigest(safeResponse),
    retryable: input.retryable,
    failureCode: input.failureCode,
    checkedAt: new Date(input.checkedAt),
    latencyMs: 0,
  });
}
