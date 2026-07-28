import { createHash } from "node:crypto";

import { z } from "zod";

export const COMPANY_VERIFICATION_PROVIDER_CONTRACT_V1 =
  "COMPANY_VERIFICATION_PROVIDER_CONTRACT_V1";

const uidSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^CHE-\d{3}\.\d{3}\.\d{3}$/u);
const normalizedNameSchema = z.string().trim().min(2).max(200);
const cantonCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/u);
const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u,
  );

export type CompanyRegisterCheckInput = Readonly<{
  uid: string;
  legalName: string;
  cantonCode: string;
  requestKey: string;
}>;

export type CompanyRegisterCheckResult = Readonly<{
  contractVersion: typeof COMPANY_VERIFICATION_PROVIDER_CONTRACT_V1;
  result:
    | "EXACT_MATCH"
    | "PARTIAL_MATCH"
    | "MISMATCH"
    | "NOT_FOUND"
    | "MALFORMED"
    | "TIMEOUT"
    | "RATE_LIMITED"
    | "PROVIDER_ERROR";
  uidMatched: boolean | null;
  nameMatched: boolean | null;
  cantonMatched: boolean | null;
  requestDigest: string;
  responseDigest: string;
  providerReferenceDigest: string | null;
  retryable: boolean;
  failureCode: string | null;
  checkedAt: Date;
  latencyMs: number;
}>;

export type DomainChallengeCheckInput = Readonly<{
  domain: string;
  challengeToken: string;
  presentedProof: string;
  requestKey: string;
}>;

export type DomainChallengeCheckResult = Readonly<{
  contractVersion: typeof COMPANY_VERIFICATION_PROVIDER_CONTRACT_V1;
  result:
    | "EXACT_MATCH"
    | "MISMATCH"
    | "NOT_FOUND"
    | "MALFORMED"
    | "TIMEOUT"
    | "RATE_LIMITED"
    | "PROVIDER_ERROR";
  domainMatched: boolean | null;
  requestDigest: string;
  responseDigest: string;
  retryable: boolean;
  failureCode: string | null;
  checkedAt: Date;
  latencyMs: number;
}>;

export interface CompanyRegisterProvider {
  readonly adapterKey: string;
  readonly adapterVersion: "v1";
  check(input: CompanyRegisterCheckInput): Promise<CompanyRegisterCheckResult>;
}

export interface CompanyDomainChallengeProvider {
  readonly adapterKey: string;
  readonly adapterVersion: "v1";
  check(input: DomainChallengeCheckInput): Promise<DomainChallengeCheckResult>;
}

export function normalizeRegisterCheckInput(
  input: CompanyRegisterCheckInput,
): CompanyRegisterCheckInput | null {
  const parsed = z
    .strictObject({
      uid: uidSchema,
      legalName: normalizedNameSchema,
      cantonCode: cantonCodeSchema,
      requestKey: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{1,159}$/u),
    })
    .safeParse(input);
  if (!parsed.success) return null;
  return Object.freeze({
    uid: parsed.data.uid,
    legalName: normalizeCompanyName(parsed.data.legalName),
    cantonCode: parsed.data.cantonCode,
    requestKey: parsed.data.requestKey,
  });
}

export function normalizeDomainChallengeInput(
  input: DomainChallengeCheckInput,
): DomainChallengeCheckInput | null {
  const parsed = z
    .strictObject({
      domain: domainSchema,
      challengeToken: z.string().min(32).max(128),
      presentedProof: z.string().min(32).max(512),
      requestKey: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{1,159}$/u),
    })
    .safeParse(input);
  if (!parsed.success) return null;
  return Object.freeze(parsed.data);
}

export function providerDigest(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

export function normalizeCompanyName(value: string): string {
  return value
    .normalize("NFKD")
    .replaceAll(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("de-CH")
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim()
    .replaceAll(/\s+/gu, " ");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}
