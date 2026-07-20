import { domainToASCII } from "node:url";

import { z } from "zod";

import { slugify } from "@/lib/utils/slug";
import { swissCantonCodeSchema } from "@/lib/validation/common";

export const COMPANY_CLAIM_SIGNAL_CODES_V1 = [
  "UID",
  "EMAIL_DOMAIN",
  "NAME_CANTON",
] as const;

export const PUBLIC_EMAIL_DOMAINS_V1 = Object.freeze([
  "bluewin.ch",
  "gmail.com",
  "gmx.ch",
  "gmx.de",
  "googlemail.com",
  "hotmail.com",
  "icloud.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "yahoo.com",
  "yahoo.de",
] as const);

const PUBLIC_EMAIL_DOMAIN_SET = new Set<string>(PUBLIC_EMAIL_DOMAINS_V1);

export type ClaimSignalCode =
  (typeof COMPANY_CLAIM_SIGNAL_CODES_V1)[number];

export const claimSignalCodeSchema = z.enum(COMPANY_CLAIM_SIGNAL_CODES_V1);

const UUID_SCHEMA = z.uuid();
const NORMALIZED_DOMAIN_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u;
const NORMALIZED_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export type NormalizedEmployerRegistrationSignals = Readonly<{
  emailDomainNormalized: string;
  companyNameNormalized: string;
  uidNormalized: string | null;
  cantonCode: z.infer<typeof swissCantonCodeSchema>;
}>;

export type PersistedCompanyRegistrationSignals = Readonly<{
  registrationEmailDomainNormalized: string | null;
  registrationNameNormalized: string | null;
  registrationCantonId: string | null;
  uid: string | null;
}>;

export function normalizeWorkEmailDomain(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const separator = trimmed.lastIndexOf("@");
  if (separator < 1 || separator === trimmed.length - 1) {
    throw new TypeError("Bitte geben Sie eine gültige geschäftliche E-Mail-Adresse ein.");
  }
  const asciiDomain = domainToASCII(trimmed.slice(separator + 1)).toLowerCase();
  if (
    asciiDomain.length === 0 ||
    asciiDomain.length > 253 ||
    !NORMALIZED_DOMAIN_PATTERN.test(asciiDomain)
  ) {
    throw new TypeError("Bitte geben Sie eine gültige geschäftliche E-Mail-Adresse ein.");
  }
  if (PUBLIC_EMAIL_DOMAIN_SET.has(asciiDomain)) {
    throw new TypeError(
      "Bitte verwenden Sie eine geschäftliche E-Mail-Adresse statt eines öffentlichen E-Mail-Anbieters.",
    );
  }
  return asciiDomain;
}

export function normalizeCompanyNameSignal(companyName: string): string {
  const normalized = slugify(companyName.trim());
  if (
    normalized.length < 2 ||
    normalized.length > 200 ||
    !NORMALIZED_NAME_PATTERN.test(normalized)
  ) {
    throw new TypeError("Bitte geben Sie einen gültigen Firmennamen ein.");
  }
  return normalized;
}

export function normalizeSwissUid(uid: string | null | undefined): string | null {
  if (uid == null || uid.trim().length === 0) return null;
  const compact = uid.trim().toUpperCase().replace(/[.\s-]/gu, "");
  if (!/^CHE\d{9}$/u.test(compact)) {
    throw new TypeError(
      "Bitte geben Sie eine Schweizer UID im Format CHE-123.456.789 ein.",
    );
  }
  const digits = compact.slice(3);
  return `CHE-${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
}

export function normalizeEmployerRegistrationSignals(
  input: Readonly<{
    email: string;
    companyName: string;
    uid?: string | null;
    cantonCode: string;
  }>,
): NormalizedEmployerRegistrationSignals {
  const cantonCode = swissCantonCodeSchema.parse(
    input.cantonCode.trim().toUpperCase(),
  );
  return Object.freeze({
    emailDomainNormalized: normalizeWorkEmailDomain(input.email),
    companyNameNormalized: normalizeCompanyNameSignal(input.companyName),
    uidNormalized: normalizeSwissUid(input.uid),
    cantonCode,
  });
}

export function toPersistedCompanyRegistrationSignals(
  signals: NormalizedEmployerRegistrationSignals,
  registrationCantonId: string,
): PersistedCompanyRegistrationSignals {
  if (!UUID_SCHEMA.safeParse(registrationCantonId).success) {
    throw new TypeError("Der gewählte Kanton ist ungültig.");
  }
  return Object.freeze({
    registrationEmailDomainNormalized: signals.emailDomainNormalized,
    registrationNameNormalized: signals.companyNameNormalized,
    registrationCantonId,
    uid: signals.uidNormalized,
  });
}

export function getCompanyClaimSignalCodes(
  requested: PersistedCompanyRegistrationSignals,
  candidate: PersistedCompanyRegistrationSignals,
): readonly ClaimSignalCode[] {
  const codes: ClaimSignalCode[] = [];
  if (
    requested.uid !== null &&
    candidate.uid !== null &&
    requested.uid === candidate.uid
  ) {
    codes.push("UID");
  }
  if (
    requested.registrationEmailDomainNormalized !== null &&
    candidate.registrationEmailDomainNormalized !== null &&
    requested.registrationEmailDomainNormalized ===
      candidate.registrationEmailDomainNormalized
  ) {
    codes.push("EMAIL_DOMAIN");
  }
  if (
    requested.registrationNameNormalized !== null &&
    candidate.registrationNameNormalized !== null &&
    requested.registrationCantonId !== null &&
    candidate.registrationCantonId !== null &&
    requested.registrationNameNormalized ===
      candidate.registrationNameNormalized &&
    requested.registrationCantonId === candidate.registrationCantonId
  ) {
    codes.push("NAME_CANTON");
  }
  return Object.freeze(codes);
}

export function toClaimSignalAuditMetadata(
  signalCodes: readonly ClaimSignalCode[],
): Readonly<{ signalCodes: readonly ClaimSignalCode[] }> {
  const result = z
    .array(claimSignalCodeSchema)
    .min(1)
    .max(COMPANY_CLAIM_SIGNAL_CODES_V1.length)
    .refine((codes) => new Set(codes).size === codes.length)
    .parse(signalCodes);
  return Object.freeze({ signalCodes: Object.freeze([...result]) });
}
