import type { Prisma } from "@/lib/generated/prisma/client";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import {
  AlertFrequency,
  ApplicationContactKind,
  ApplicationEffort,
  ApplicationEventKind,
  ApplicationRejectionReason,
  ApplicationStatus,
  CandidateOnboardingEventKind,
  ContactRequestEventKind,
  ContactRequestStatus,
  ConversationKind,
  ConversationParticipantKind,
  CreditFundingSource,
  CreditLedgerKind,
  CreditType,
  DataProvenance,
  IdentityRevealRevokeReason,
  JobAlertEventKind,
  JobAlertStatus,
  LanguageLevel,
  OnboardingStatus,
  PrivacyCorrectionFieldCode,
  PrivacyRequestEventKind,
  PrivacyRequestStatus,
  PrivacyRequestType,
  RadarConsentKind,
  RemotePreference,
  RequiredDocumentKind,
  RevealField,
  Role,
  Seniority,
  UserConsentKind,
  UserStatus,
} from "@/lib/generated/prisma/enums";
import {
  applicationSubmissionPayloadHash,
  buildApplicationConfirmationProjection,
} from "@/lib/applications/integrity";
import { RADAR_CONSENT_NOTICE_V1 } from "@/lib/privacy/radar-consent";
import {
  createJobAlertUnsubscribeToken,
  defaultJobAlertQuery,
  firstJobAlertDueAt,
  jobAlertConsentNoticeHash,
  JOB_ALERT_DELIVERY_NOTICE_V1,
  JOB_ALERT_POLICY_V1,
  nextJobAlertDueAt,
} from "@/lib/candidate/job-alert-policy";
import { renderEmailTemplate } from "@/lib/providers/email/templates";
import {
  buildRadarOpaqueLookup,
  decryptRadarOpaqueToken,
  encryptRadarOpaqueToken,
  type RadarOpaqueKey,
} from "@/lib/privacy/radar-opaque";
import {
  buildRevealPreview,
  decryptRevealValue,
  encryptRevealValues,
  REVEAL_SNAPSHOT_POLICY_V1,
  type RevealKey,
  type RevealValue,
} from "@/lib/privacy/reveal-dto";
import {
  sha256CanonicalJson,
  sha256Utf8,
  type CanonicalJsonValue,
} from "@/prisma/seed/canonical-json";
import {
  assertSeedProjection,
  createOrVerifySeedRecord,
} from "@/prisma/seed/create-or-verify";
import {
  APPLICATION_FIXTURES,
  applicationTransitionFixtures,
  CANDIDATE_FIXTURES,
  CANDIDATE_WORKFLOW_BLOCK_DIGEST,
  CONTACT_REQUEST_FIXTURES,
  JOB_ALERT_FIXTURES,
  PRIVACY_REQUEST_FIXTURES,
  RADAR_COMPANY_SLOTS,
  SAVED_JOB_FIXTURES,
} from "@/prisma/seed/fixtures/candidate-workflows";
import { stableSeedId } from "@/prisma/seed/ids";

const DAY_MS = 24 * 60 * 60 * 1_000;
const HOUR_MS = 60 * 60 * 1_000;

export type CandidateWorkflowCompanyHandle = Readonly<{
  id: string;
  slug: string;
  name: string;
  planCode: string;
  ownerUserId: string;
  ownerMembershipId: string;
}>;

export type CandidateWorkflowJobHandle = Readonly<{
  id: string;
  slug: string;
  companyId: string;
  revisionId: string;
  status: string;
  publishedRevisionId: string | null;
}>;

export type CandidateWorkflowDependencies = Readonly<{
  companies: readonly CandidateWorkflowCompanyHandle[];
  jobs: readonly CandidateWorkflowJobHandle[];
}>;

export type CandidateWorkflowCandidateHandle = Readonly<{
  id: string;
  key: string;
  userId: string;
}>;

export type CandidateWorkflowSeedResult = Readonly<{
  applications: readonly Readonly<{
    id: string;
    jobId: string;
    candidateProfileId: string;
  }>[];
  blockDigest: typeof CANDIDATE_WORKFLOW_BLOCK_DIGEST;
  candidates: readonly CandidateWorkflowCandidateHandle[];
  contactRequests: readonly Readonly<{ id: string; status: string }>[];
  conversations: readonly Readonly<{ id: string; kind: string }>[];
}>;

export type CandidateWorkflowSeedCryptoConfig = Readonly<{
  radarLookupKeys: readonly RadarOpaqueKey[];
  radarEncryptionKeys: readonly RadarOpaqueKey[];
  revealConfirmationKeys: readonly RevealKey[];
  piiRevealKeys: readonly RevealKey[];
}>;

/**
 * Deterministic demo key material for direct block and isolated integration
 * tests only. Runtime callers must inject environment-backed keyrings.
 */
export const DEMO_ONLY_CANDIDATE_WORKFLOW_CRYPTO = Object.freeze({
  radarLookupKeys: Object.freeze([
    Object.freeze({
      version: "demo-radar-lookup-v1",
      secret: Buffer.alloc(32, 0x31).toString("base64"),
    }),
  ]),
  radarEncryptionKeys: Object.freeze([
    Object.freeze({
      version: "demo-radar-encryption-v1",
      secret: Buffer.alloc(32, 0x32).toString("base64"),
    }),
  ]),
  revealConfirmationKeys: Object.freeze([
    Object.freeze({
      version: "demo-reveal-confirmation-v1",
      secret: Buffer.alloc(32, 0x33).toString("base64"),
    }),
  ]),
  piiRevealKeys: Object.freeze([
    Object.freeze({
      version: "demo-pii-reveal-v1",
      secret: Buffer.alloc(32, 0x34).toString("base64"),
    }),
  ]),
}) satisfies CandidateWorkflowSeedCryptoConfig;

/** Resolves secret handles without ever stringifying or logging key material. */
export function candidateWorkflowSeedCryptoFromEnvironment(
  environment: Pick<ServerEnvironment, "secrets">,
): CandidateWorkflowSeedCryptoConfig {
  const unwrap = <
    TPurpose extends keyof ServerEnvironment["secrets"]["keyrings"],
  >(
    purpose: TPurpose,
  ): readonly Readonly<{ version: string; secret: string }>[] =>
    Object.freeze(
      environment.secrets.keyrings[purpose].map(({ version, key }) =>
        key.withValue((secret) => Object.freeze({ version, secret })),
      ),
    );

  return Object.freeze({
    radarLookupKeys: unwrap("RADAR_OPAQUE_LOOKUP_KEYS"),
    radarEncryptionKeys: unwrap("RADAR_OPAQUE_ENCRYPTION_KEYS"),
    revealConfirmationKeys: unwrap("REVEAL_CONFIRMATION_KEYS"),
    piiRevealKeys: unwrap("PII_REVEAL_KEYS"),
  });
}

type WriteClient = Prisma.TransactionClient;

type EnsureRowInput<TRecord extends object> = Readonly<{
  create: () => Promise<TRecord>;
  entity: string;
  expected: Readonly<Record<string, unknown>>;
  findExisting: () => Promise<TRecord | null>;
  naturalKey: string;
}>;

async function ensureRow<TRecord extends object>(
  input: EnsureRowInput<TRecord>,
): Promise<TRecord> {
  const expected = toCanonicalValue(input.expected);
  const keys = Object.keys(input.expected);
  const result = await createOrVerifySeedRecord({
    create: input.create,
    entity: input.entity,
    expected,
    findExisting: input.findExisting,
    naturalKey: input.naturalKey,
    project: (record) =>
      toCanonicalValue(
        Object.fromEntries(
          keys.map((key) => [key, (record as Record<string, unknown>)[key]]),
        ),
      ),
  });
  return result.record;
}

function verifyRow<TRecord extends object>(
  entity: string,
  naturalKey: string,
  record: TRecord,
  expected: Readonly<Record<string, unknown>>,
): void {
  const keys = Object.keys(expected);
  assertSeedProjection(
    {
      entity,
      expected: toCanonicalValue(expected),
      naturalKey,
      project: (candidate) =>
        toCanonicalValue(
          Object.fromEntries(
            keys.map((key) => [
              key,
              (candidate as Record<string, unknown>)[key],
            ]),
          ),
        ),
    },
    record,
  );
}

function toCanonicalValue(value: unknown): CanonicalJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("hex");
  }
  if (Array.isArray(value)) {
    return value.map(toCanonicalValue);
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        toCanonicalValue(entry),
      ]),
    );
  }
  throw new TypeError(
    "Seed projections may contain only canonical data values.",
  );
}

function dateAt(anchorAt: Date, offsetMs: number): Date {
  return new Date(anchorAt.getTime() + offsetMs);
}

function utcDateOnly(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

function enumValue<T extends Readonly<Record<string, string>>>(
  values: T,
  value: string,
): T[keyof T] {
  const resolved = values[value as keyof T];
  if (resolved === undefined) {
    throw new Error(`Unknown seed enum value: ${value}`);
  }
  return resolved;
}

function requireValidAnchor(anchorAt: Date): Date {
  const normalized = new Date(anchorAt);
  if (!Number.isFinite(normalized.getTime())) {
    throw new TypeError("Candidate workflow seed anchor must be a valid Date.");
  }
  return normalized;
}

function requireValidCryptoConfig(
  config: CandidateWorkflowSeedCryptoConfig,
): CandidateWorkflowSeedCryptoConfig {
  const keyrings = [
    ["Radar lookup", config.radarLookupKeys],
    ["Radar encryption", config.radarEncryptionKeys],
    ["Reveal confirmation", config.revealConfirmationKeys],
    ["PII reveal", config.piiRevealKeys],
  ] as const;

  for (const [label, keyring] of keyrings) {
    if (keyring.length === 0) {
      throw new TypeError(
        `${label} seed keyring requires an active writer key.`,
      );
    }
    const versions = new Set<string>();
    for (const key of keyring) {
      const decoded = Buffer.from(key.secret, "base64");
      if (
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(key.version) ||
        versions.has(key.version) ||
        decoded.byteLength !== 32 ||
        decoded.toString("base64") !== key.secret
      ) {
        throw new TypeError(`${label} seed keyring is invalid.`);
      }
      versions.add(key.version);
    }
  }
  return config;
}

function resolveDependencies(dependencies: CandidateWorkflowDependencies) {
  const companies = RADAR_COMPANY_SLOTS.map((slug) => {
    const company = dependencies.companies.find(
      (candidate) => candidate.slug === slug,
    );
    if (company === undefined) {
      throw new Error(`Candidate workflow seed requires company ${slug}.`);
    }
    return company;
  });
  const publishedJobs = dependencies.jobs.filter(
    (job) => job.status === "PUBLISHED" && job.publishedRevisionId !== null,
  );
  if (publishedJobs.length !== 100) {
    throw new Error(
      `Candidate workflow seed requires exactly 100 published jobs; received ${publishedJobs.length}.`,
    );
  }
  const expiredJobs = dependencies.jobs.filter(
    (job) => job.status === "EXPIRED" && job.publishedRevisionId !== null,
  );
  if (expiredJobs.length !== 1) {
    throw new Error(
      `Candidate workflow seed requires exactly one expired saved-job fixture target; received ${expiredJobs.length}.`,
    );
  }
  return { companies, expiredJobs, publishedJobs };
}

async function loadReferenceMaps(db: DatabaseClient) {
  const [cantons, categories, skills] = await Promise.all([
    db.canton.findMany({ select: { code: true, id: true } }),
    db.category.findMany({ select: { id: true, slug: true } }),
    db.skill.findMany({ select: { id: true, slug: true } }),
  ]);
  const cantonByCode = new Map(cantons.map((row) => [row.code, row.id]));
  const categoryBySlug = new Map(categories.map((row) => [row.slug, row.id]));
  const skillBySlug = new Map(skills.map((row) => [row.slug, row.id]));

  for (const fixture of CANDIDATE_FIXTURES) {
    if (!cantonByCode.has(fixture.cantonCode)) {
      throw new Error(`Missing seeded canton ${fixture.cantonCode}.`);
    }
    if (!categoryBySlug.has(fixture.categorySlug)) {
      throw new Error(`Missing seeded category ${fixture.categorySlug}.`);
    }
    for (const skillSlug of fixture.skillSlugs) {
      if (!skillBySlug.has(skillSlug)) {
        throw new Error(`Missing seeded skill ${skillSlug}.`);
      }
    }
  }
  return { cantonByCode, categoryBySlug, skillBySlug };
}

async function seedCandidate(
  tx: WriteClient,
  anchorAt: Date,
  fixture: (typeof CANDIDATE_FIXTURES)[number],
  fixtureIndex: number,
  references: Awaited<ReturnType<typeof loadReferenceMaps>>,
): Promise<CandidateWorkflowCandidateHandle> {
  const userId = stableSeedId("user", fixture.email);
  const candidateProfileId = stableSeedId("candidate-profile", fixture.email);
  const cantonId = references.cantonByCode.get(fixture.cantonCode) as string;
  const categoryId = references.categoryBySlug.get(
    fixture.categorySlug,
  ) as string;
  const userCreatedAt = dateAt(anchorAt, (-120 + fixtureIndex) * DAY_MS);
  const profileCreatedAt = dateAt(anchorAt, (-100 + fixtureIndex) * DAY_MS);

  const userExpected = {
    id: userId,
    email: fixture.email,
    emailNormalized: fixture.email.toLowerCase(),
    role: Role.CANDIDATE,
    status: enumValue(UserStatus, fixture.userStatus),
    dataProvenance: DataProvenance.DEMO,
  };
  const existingUser = await tx.user.findUnique({ where: { id: userId } });
  if (
    fixture.userStatus === "SUSPENDED" &&
    existingUser?.status === UserStatus.ACTIVE &&
    existingUser.role === Role.CANDIDATE &&
    existingUser.dataProvenance === DataProvenance.DEMO &&
    existingUser.emailNormalized === fixture.email.toLowerCase()
  ) {
    // Phase 09 adds one deterministic suspended-candidate fixture. This
    // one-way reconciliation upgrades the previous sealed dataset once; every
    // subsequent run remains projection-verification-only.
    await tx.user.update({
      where: { id: userId },
      data: { status: UserStatus.SUSPENDED },
    });
  }
  await ensureRow({
    entity: "User",
    naturalKey: fixture.email,
    expected: userExpected,
    findExisting: () => tx.user.findUnique({ where: { id: userId } }),
    create: () =>
      tx.user.create({
        data: {
          ...userExpected,
          name:
            fixture.firstName === null
              ? fixture.lastName
              : `${fixture.firstName} ${fixture.lastName}`,
          emailVerifiedAt: userCreatedAt,
          createdAt: userCreatedAt,
        },
      }),
  });

  const profileExpected = {
    id: candidateProfileId,
    userId,
    cantonId,
    firstName: fixture.firstName,
    lastName: fixture.lastName,
    publicDisplayName: fixture.publicDisplayName,
    phone: `+41 79 000 ${String(fixtureIndex).padStart(2, "0")} 00`,
    postalCode: fixture.postalCode,
    cityLabel: fixture.cityLabel,
    summary: fixture.summary,
  };
  await ensureRow({
    entity: "CandidateProfile",
    naturalKey: fixture.email,
    expected: profileExpected,
    findExisting: () =>
      tx.candidateProfile.findUnique({ where: { id: candidateProfileId } }),
    create: () =>
      tx.candidateProfile.create({
        data: {
          ...profileExpected,
          onboardingStatus: OnboardingStatus.DRAFT,
          createdAt: profileCreatedAt,
        },
      }),
  });

  const preferenceId = stableSeedId("candidate-preference", fixture.key);
  const preferenceExpected = {
    id: preferenceId,
    candidateProfileId,
    desiredTitles: [...fixture.desiredTitles],
    desiredJobTypes: [...fixture.desiredJobTypes],
    salaryPeriod: "YEARLY",
    salaryMinChf: fixture.salaryMinChf,
    salaryMaxChf: fixture.salaryMaxChf,
    workloadMin: fixture.workloadMin,
    workloadMax: fixture.workloadMax,
    remotePreference: enumValue(RemotePreference, fixture.remotePreference),
    mobilityRadiusKm: fixture.mobilityRadiusKm,
    availableFrom: dateAt(utcDateOnly(anchorAt), (fixtureIndex % 20) * DAY_MS),
  };
  await ensureRow({
    entity: "CandidatePreference",
    naturalKey: fixture.key,
    expected: preferenceExpected,
    findExisting: () =>
      tx.candidatePreference.findUnique({ where: { id: preferenceId } }),
    create: () =>
      tx.candidatePreference.create({
        data: {
          ...preferenceExpected,
          desiredJobTypes: preferenceExpected.desiredJobTypes as never,
          salaryPeriod: "YEARLY",
          createdAt: profileCreatedAt,
        },
      }),
  });

  await ensureRow({
    entity: "CandidatePreferenceCategory",
    naturalKey: fixture.key,
    expected: { candidatePreferenceId: preferenceId, categoryId },
    findExisting: () =>
      tx.candidatePreferenceCategory.findUnique({
        where: {
          candidatePreferenceId_categoryId: {
            candidatePreferenceId: preferenceId,
            categoryId,
          },
        },
      }),
    create: () =>
      tx.candidatePreferenceCategory.create({
        data: { candidatePreferenceId: preferenceId, categoryId },
      }),
  });

  for (const [skillIndex, skillSlug] of fixture.skillSlugs.entries()) {
    const id = stableSeedId("candidate-skill", `${fixture.key}:${skillSlug}`);
    const skillId = references.skillBySlug.get(skillSlug) as string;
    const expected = {
      id,
      candidateProfileId,
      skillId,
      level: 1 + ((fixtureIndex + skillIndex) % 5),
      years: 1 + ((fixtureIndex * 2 + skillIndex) % 12),
    };
    await ensureRow({
      entity: "CandidateSkill",
      naturalKey: `${fixture.key}:${skillSlug}`,
      expected,
      findExisting: () => tx.candidateSkill.findUnique({ where: { id } }),
      create: () => tx.candidateSkill.create({ data: expected }),
    });
  }

  for (const language of fixture.languages) {
    const id = stableSeedId(
      "candidate-language",
      `${fixture.key}:${language.code}`,
    );
    const expected = {
      id,
      candidateProfileId,
      code: language.code,
      level: enumValue(LanguageLevel, language.level),
    };
    await ensureRow({
      entity: "CandidateLanguage",
      naturalKey: `${fixture.key}:${language.code}`,
      expected,
      findExisting: () => tx.candidateLanguage.findUnique({ where: { id } }),
      create: () => tx.candidateLanguage.create({ data: expected }),
    });
  }

  if (fixtureIndex === 0) {
    const id = stableSeedId("candidate-document", `${fixture.key}:cv`);
    const expected = {
      id,
      candidateProfileId,
      storageKey: `mock-storage/${candidateProfileId}/lebenslauf.pdf`,
      safeFilename: "lebenslauf.pdf",
      mimeType: "application/pdf",
      sizeBytes: 123_456,
      purpose: "CV",
      status: "ACTIVE",
      removedAt: null,
    };
    await ensureRow({
      entity: "CandidateDocumentMetadata",
      naturalKey: `${fixture.key}:cv`,
      expected,
      findExisting: () =>
        tx.candidateDocumentMetadata.findUnique({ where: { id } }),
      create: () =>
        tx.candidateDocumentMetadata.create({
          data: {
            ...expected,
            purpose: "CV",
            status: "ACTIVE",
            createdAt: profileCreatedAt,
          },
        }),
    });
  }

  if (fixture.finalOnboardingStatus === "COMPLETE") {
    await tx.candidateProfile.updateMany({
      where: {
        id: candidateProfileId,
        onboardingStatus: OnboardingStatus.DRAFT,
      },
      data: { onboardingStatus: OnboardingStatus.COMPLETE },
    });
  }
  const finalProfile = await tx.candidateProfile.findUniqueOrThrow({
    where: { id: candidateProfileId },
  });
  verifyRow("CandidateProfile", fixture.email, finalProfile, {
    ...profileExpected,
    onboardingStatus: enumValue(
      OnboardingStatus,
      fixture.finalOnboardingStatus,
    ),
  });

  for (const [eventIndex, kind] of fixture.onboardingHistory.entries()) {
    const naturalKey = `${fixture.key}:${String(eventIndex).padStart(2, "0")}:${kind}`;
    const id = stableSeedId("candidate-onboarding-event", naturalKey);
    const createdAt = dateAt(profileCreatedAt, (eventIndex + 1) * 10 * DAY_MS);
    const expected = {
      id,
      candidateProfileId,
      kind: enumValue(CandidateOnboardingEventKind, kind),
      actorUserId: userId,
      reasonCode: kind === "REOPENED" ? "candidate-edit" : null,
      correlationId: `seed:candidate:${fixture.key}:${eventIndex}`,
      createdAt,
    };
    await ensureRow({
      entity: "CandidateOnboardingEvent",
      naturalKey,
      expected,
      findExisting: () =>
        tx.candidateOnboardingEvent.findUnique({ where: { id } }),
      create: () => tx.candidateOnboardingEvent.create({ data: expected }),
    });
  }

  return Object.freeze({ id: candidateProfileId, key: fixture.key, userId });
}

async function seedRadarProfilesAndConsents(
  db: DatabaseClient,
  anchorAt: Date,
  candidates: readonly CandidateWorkflowCandidateHandle[],
): Promise<void> {
  for (const [index, fixture] of CANDIDATE_FIXTURES.entries()) {
    if (fixture.radarConsent === null) {
      continue;
    }
    const candidate = candidates[index] as CandidateWorkflowCandidateHandle;
    const naturalKey = `${fixture.key}:${fixture.radarConsent}`;
    const id = stableSeedId("candidate-consent", naturalKey);
    const effectiveAt = dateAt(anchorAt, (-25 + index) * HOUR_MS);
    const expected = {
      id,
      candidateProfileId: candidate.id,
      kind: RadarConsentKind.TALENT_RADAR_VISIBILITY,
      granted: fixture.radarConsent === "GRANTED",
      noticeVersion: RADAR_CONSENT_NOTICE_V1.noticeVersion,
      noticeHash: RADAR_CONSENT_NOTICE_V1.hash,
      actorUserId: candidate.userId,
      effectiveAt,
      createdAt: effectiveAt,
    };
    await ensureRow({
      entity: "CandidateConsent",
      naturalKey,
      expected,
      findExisting: () => db.candidateConsent.findUnique({ where: { id } }),
      create: () => db.candidateConsent.create({ data: expected }),
    });
  }

  for (let index = 0; index < 10; index += 1) {
    const fixture = CANDIDATE_FIXTURES[
      index
    ] as (typeof CANDIDATE_FIXTURES)[number];
    const candidate = candidates[index] as CandidateWorkflowCandidateHandle;
    const publishedAt = dateAt(anchorAt, (-20 + index) * HOUR_MS);
    const projection = {
      displayLabel: `Talentpool ${fixture.seniority}`,
      cantonBucket: fixture.cantonCode,
      categoryBucket: fixture.categorySlug,
      seniority: enumValue(Seniority, fixture.seniority),
      remotePreference: enumValue(RemotePreference, fixture.remotePreference),
      workloadMin: fixture.workloadMin,
      workloadMax: fixture.workloadMax,
      salaryYearlyMinChf: fixture.salaryMinChf,
      salaryYearlyMaxChf: fixture.salaryMaxChf,
      languageCodes: fixture.languages.map((language) => language.code),
      skillSlugs: [...fixture.skillSlugs],
    };
    const id = stableSeedId("radar-profile", fixture.key);
    const expected = {
      id,
      candidateProfileId: candidate.id,
      ...projection,
      publishedAt,
      withdrawnAt: null,
      projectionVersion: "radar-projection-v1",
      projectionHash: sha256CanonicalJson(projection),
    };
    await ensureRow({
      entity: "RadarProfile",
      naturalKey: fixture.key,
      expected,
      findExisting: () => db.radarProfile.findUnique({ where: { id } }),
      create: () =>
        db.radarProfile.create({
          data: { ...expected, createdAt: publishedAt },
        }),
    });
  }
}

async function seedRadarMappingsAndSearchEvidence(
  db: DatabaseClient,
  anchorAt: Date,
  candidates: readonly CandidateWorkflowCandidateHandle[],
  companies: readonly CandidateWorkflowCompanyHandle[],
  crypto: CandidateWorkflowSeedCryptoConfig,
): Promise<void> {
  const currentEpochStart = utcDateOnly(anchorAt);
  const epochStarts = [
    dateAt(currentEpochStart, -30 * DAY_MS),
    currentEpochStart,
  ] as const;
  const epochLabels = ["previous", "current"] as const;

  for (const [companyIndex, company] of companies.entries()) {
    for (const [epochIndex, epochStart] of epochStarts.entries()) {
      const epochLabel = epochLabels[epochIndex] as string;
      const validTo = dateAt(epochStart, 30 * DAY_MS);
      for (let candidateIndex = 0; candidateIndex < 10; candidateIndex += 1) {
        const candidate = candidates[
          candidateIndex
        ] as CandidateWorkflowCandidateHandle;
        const naturalKey = `${company.slug}:${epochLabel}:${candidate.key}`;
        const id = stableSeedId("radar-opaque-mapping", naturalKey);
        const revoked = epochIndex === 0 && candidateIndex === companyIndex;
        const binding = {
          mappingId: id,
          candidateProfileId: candidate.id,
          companyId: company.id,
          epoch: epochStart,
        };
        const expected = {
          id,
          candidateProfileId: candidate.id,
          companyId: company.id,
          epoch: epochStart,
          validFrom: epochStart,
          validTo,
          revokedAt: revoked ? dateAt(epochStart, 15 * DAY_MS) : null,
          revocationReason: revoked ? "EPOCH_ROTATED" : null,
        };
        const mapping = await ensureRow({
          entity: "RadarOpaqueMapping",
          naturalKey,
          expected,
          findExisting: () =>
            db.radarOpaqueMapping.findUnique({ where: { id } }),
          create: () => {
            const { envelope } = encryptRadarOpaqueToken(
              crypto.radarLookupKeys,
              crypto.radarEncryptionKeys,
              binding,
            );
            return db.radarOpaqueMapping.create({
              data: {
                ...expected,
                ...envelope,
                encryptedToken: Uint8Array.from(envelope.encryptedToken),
                nonce: Uint8Array.from(envelope.nonce),
                authTag: Uint8Array.from(envelope.authTag),
              },
            });
          },
        });
        const token = decryptRadarOpaqueToken(
          {
            lookupHmac: mapping.lookupHmac,
            encryptedToken: mapping.encryptedToken,
            nonce: mapping.nonce,
            authTag: mapping.authTag,
            lookupKeyVersion: mapping.lookupKeyVersion,
            encryptionKeyVersion: mapping.encryptionKeyVersion,
          },
          crypto.radarLookupKeys,
          crypto.radarEncryptionKeys,
          binding,
        );
        const lookupKey = crypto.radarLookupKeys.find(
          ({ version }) => version === mapping.lookupKeyVersion,
        );
        if (lookupKey === undefined) {
          throw new Error(
            `RadarOpaqueMapping ${naturalKey} has no readable lookup key.`,
          );
        }
        const lookup = buildRadarOpaqueLookup(token, [lookupKey], binding);
        if (
          lookup.lookupKeyVersion !== mapping.lookupKeyVersion ||
          lookup.lookupHmac !== mapping.lookupHmac
        ) {
          throw new Error(
            `RadarOpaqueMapping ${naturalKey} failed semantic verification.`,
          );
        }
      }

      const searchNaturalKey = `${company.slug}:${epochLabel}`;
      const filterHash = sha256Utf8(`radar-filter:${searchNaturalKey}`);
      const budgetId = stableSeedId("radar-search-budget", searchNaturalKey);
      const firstUsedAt = dateAt(epochStart, HOUR_MS);
      const budgetExpected = {
        id: budgetId,
        companyId: company.id,
        calendarDate: epochStart,
        filterHash,
        firstUsedAt,
        lastUsedAt: dateAt(firstUsedAt, 10 * 60 * 1_000),
      };
      await ensureRow({
        entity: "RadarSearchBudget",
        naturalKey: searchNaturalKey,
        expected: budgetExpected,
        findExisting: () =>
          db.radarSearchBudget.findUnique({ where: { id: budgetId } }),
        create: () => db.radarSearchBudget.create({ data: budgetExpected }),
      });

      const sessionId = stableSeedId("radar-search-session", searchNaturalKey);
      const sessionExpected = {
        id: sessionId,
        companyId: company.id,
        membershipId: company.ownerMembershipId,
        requestingUserId: company.ownerUserId,
        filterHash,
        calendarDate: epochStart,
        policyVersion: "radar-enumeration-v1",
        normalizedFilters: {
          cantonBucket: companyIndex === 0 ? "ZH" : "BE",
          remotePreference: "ANY",
        },
        resultCount: 5,
        expiresAt: dateAt(firstUsedAt, 30 * 60 * 1_000),
        createdAt: firstUsedAt,
      };
      await ensureRow({
        entity: "RadarSearchSession",
        naturalKey: searchNaturalKey,
        expected: sessionExpected,
        findExisting: () =>
          db.radarSearchSession.findUnique({ where: { id: sessionId } }),
        create: () => db.radarSearchSession.create({ data: sessionExpected }),
      });

      for (let position = 0; position < 5; position += 1) {
        const candidateIndex =
          (companyIndex * 3 + epochIndex * 2 + position) % 10;
        const candidate = candidates[
          candidateIndex
        ] as CandidateWorkflowCandidateHandle;
        const candidateNaturalKey = `${company.slug}:${epochLabel}:${position}`;
        const id = stableSeedId(
          "radar-search-session-candidate",
          candidateNaturalKey,
        );
        const expected = {
          id,
          radarSearchSessionId: sessionId,
          candidateProfileId: candidate.id,
          position,
        };
        await ensureRow({
          entity: "RadarSearchSessionCandidate",
          naturalKey: candidateNaturalKey,
          expected,
          findExisting: () =>
            db.radarSearchSessionCandidate.findUnique({ where: { id } }),
          create: () =>
            db.radarSearchSessionCandidate.create({ data: expected }),
        });
      }
    }
  }
}

type PublishedRevisionSnapshot = Readonly<{
  id: string;
  jobId: string;
  title: string;
  applicationContactKind: ApplicationContactKind;
  applicationContactValue: string;
  applicationEffort: ApplicationEffort;
  requiredDocumentKinds: readonly RequiredDocumentKind[];
  responseTargetDays: number;
}>;

async function loadPublishedRevisionSnapshots(
  db: DatabaseClient,
  publishedJobs: readonly CandidateWorkflowJobHandle[],
): Promise<ReadonlyMap<string, PublishedRevisionSnapshot>> {
  const revisionIds = publishedJobs.map(
    (job) => job.publishedRevisionId as string,
  );
  const revisions = await db.jobRevision.findMany({
    where: { id: { in: revisionIds } },
    select: {
      id: true,
      jobId: true,
      title: true,
      applicationContactKind: true,
      applicationContactValue: true,
      applicationEffort: true,
      requiredDocumentKinds: true,
      responseTargetDays: true,
    },
  });
  if (revisions.length !== publishedJobs.length) {
    throw new Error(
      "Candidate workflow seed could not resolve every published revision.",
    );
  }
  const revisionById = new Map<string, PublishedRevisionSnapshot>();
  for (const revision of revisions) {
    revisionById.set(revision.id, revision);
  }
  for (const job of publishedJobs) {
    const revision = revisionById.get(job.publishedRevisionId as string);
    if (revision === undefined || revision.jobId !== job.id) {
      throw new Error(`Published revision scope mismatch for job ${job.slug}.`);
    }
  }
  return revisionById;
}

async function seedApplication(
  tx: WriteClient,
  anchorAt: Date,
  fixture: (typeof APPLICATION_FIXTURES)[number],
  applicationIndex: number,
  candidates: readonly CandidateWorkflowCandidateHandle[],
  publishedJobs: readonly CandidateWorkflowJobHandle[],
  companiesById: ReadonlyMap<string, CandidateWorkflowCompanyHandle>,
  revisionsById: ReadonlyMap<string, PublishedRevisionSnapshot>,
): Promise<
  Readonly<{
    id: string;
    jobId: string;
    candidateProfileId: string;
    conversationId: string;
  }>
> {
  const candidate = candidates[
    fixture.candidateIndex
  ] as CandidateWorkflowCandidateHandle;
  const candidateFixture = CANDIDATE_FIXTURES[
    fixture.candidateIndex
  ] as (typeof CANDIDATE_FIXTURES)[number];
  if (candidateFixture.firstName === null) {
    throw new Error(
      `Application fixture ${fixture.key} uses an incomplete identity.`,
    );
  }
  const job = publishedJobs[fixture.jobIndex] as CandidateWorkflowJobHandle;
  const revisionId = job.publishedRevisionId as string;
  const revision = revisionsById.get(revisionId);
  const company = companiesById.get(job.companyId);
  if (revision === undefined || company === undefined) {
    throw new Error(
      `Application fixture ${fixture.key} has unresolved job scope.`,
    );
  }
  const id = stableSeedId("application", fixture.key);
  const submittedAt = dateAt(anchorAt, (-70 + applicationIndex * 0.5) * DAY_MS);
  const coverLetter = `Fiktives Motivationsschreiben für Demo-Bewerbung ${String(applicationIndex + 1).padStart(3, "0")}.`;
  const confirmation = buildApplicationConfirmationProjection({
    candidate: {
      firstName: candidateFixture.firstName,
      lastName: candidateFixture.lastName,
      email: candidateFixture.email,
    },
    recipient: {
      companyName: company.name,
      contactKind: revision.applicationContactKind,
      contactValue: revision.applicationContactValue,
    },
    job: {
      revisionId,
      slug: job.slug,
      title: revision.title,
      responseTargetDays: revision.responseTargetDays,
      applicationEffort: revision.applicationEffort,
      requiredDocumentKinds: revision.requiredDocumentKinds,
    },
  });
  const selectedDocumentIds = fixture.linksCv
    ? [stableSeedId("candidate-document", `${candidateFixture.key}:cv`)]
    : [];
  const status = enumValue(ApplicationStatus, fixture.status);
  const rejected = fixture.status === "REJECTED";
  const applicationExpected = {
    id,
    jobId: job.id,
    submittedJobRevisionId: revisionId,
    candidateProfileId: candidate.id,
    status,
    coverLetter,
    rejectionReason: rejected ? ApplicationRejectionReason.NOT_A_MATCH : null,
    rejectionNote: rejected ? "Fiktive, sachliche Demo-Absage." : null,
    submittedAt,
  };
  await ensureRow({
    entity: "Application",
    naturalKey: fixture.key,
    expected: applicationExpected,
    findExisting: () => tx.application.findUnique({ where: { id } }),
    create: () =>
      tx.application.create({
        data: {
          ...applicationExpected,
          idempotencyKey: `seed:application:${fixture.key}`,
          submissionPayloadHash: applicationSubmissionPayloadHash({
            confirmationSnapshotHash: confirmation.confirmationSnapshotHash,
            coverLetter,
            selectedDocumentIds,
          }),
        },
      }),
  });

  const snapshotId = stableSeedId("application-snapshot", fixture.key);
  const snapshotExpected = {
    id: snapshotId,
    applicationId: id,
    jobRevisionId: revisionId,
    candidateFirstName: candidateFixture.firstName,
    candidateLastName: candidateFixture.lastName,
    candidateEmail: candidateFixture.email,
    coverLetterSnapshot: coverLetter,
    recipientCompanyName: company.name,
    applicationContactKind: revision.applicationContactKind,
    applicationContactValue: revision.applicationContactValue,
    responseTargetDays: revision.responseTargetDays,
    applicationEffort: revision.applicationEffort,
    requiredDocumentKinds: revision.requiredDocumentKinds,
    confirmationNoticeVersion: confirmation.confirmationVersion,
    confirmationNoticeHash: confirmation.confirmationNoticeHash,
    submittedAt,
  };
  await ensureRow({
    entity: "ApplicationSubmissionSnapshot",
    naturalKey: fixture.key,
    expected: snapshotExpected,
    findExisting: () =>
      tx.applicationSubmissionSnapshot.findUnique({
        where: { id: snapshotId },
      }),
    create: () =>
      tx.applicationSubmissionSnapshot.create({
        data: {
          ...snapshotExpected,
          applicationContactKind:
            snapshotExpected.applicationContactKind as never,
          applicationEffort: snapshotExpected.applicationEffort as never,
          requiredDocumentKinds:
            snapshotExpected.requiredDocumentKinds as never,
          confirmationSnapshotHash: confirmation.confirmationSnapshotHash,
        },
      }),
  });

  if (fixture.linksCv) {
    const documentMetadataId = selectedDocumentIds[0] as string;
    const documentId = stableSeedId("application-document", fixture.key);
    const documentExpected = {
      id: documentId,
      applicationId: id,
      documentMetadataId,
    };
    await ensureRow({
      entity: "ApplicationSubmissionDocument",
      naturalKey: fixture.key,
      expected: documentExpected,
      findExisting: () =>
        tx.applicationSubmissionDocument.findUnique({
          where: { id: documentId },
        }),
      create: () =>
        tx.applicationSubmissionDocument.create({
          data: {
            ...documentExpected,
            safeFilenameSnapshot: "lebenslauf.pdf",
            mimeTypeSnapshot: "application/pdf",
            sizeBytesSnapshot: 123_456,
            storageKeyHash: sha256Utf8(
              `mock-storage/${candidate.id}/lebenslauf.pdf`,
            ),
            createdAt: submittedAt,
          },
        }),
    });
  }

  const submittedEventNaturalKey = `${fixture.key}:submitted`;
  const submittedEventId = stableSeedId(
    "application-event",
    submittedEventNaturalKey,
  );
  const submittedEventExpected = {
    id: submittedEventId,
    applicationId: id,
    actorUserId: candidate.userId,
    kind: ApplicationEventKind.STATUS_CHANGE,
    fromStatus: null,
    toStatus: ApplicationStatus.SUBMITTED,
    metadata: { source: "demo-seed" },
    createdAt: submittedAt,
  };
  await ensureRow({
    entity: "ApplicationEvent",
    naturalKey: submittedEventNaturalKey,
    expected: submittedEventExpected,
    findExisting: () =>
      tx.applicationEvent.findUnique({ where: { id: submittedEventId } }),
    create: () =>
      tx.applicationEvent.create({
        data: {
          ...submittedEventExpected,
          idempotencyKey: `seed:application-event:${submittedEventNaturalKey}`,
          correlationId: `seed:application:${fixture.key}`,
        },
      }),
  });

  for (const transition of applicationTransitionFixtures(fixture)) {
    const eventId = stableSeedId("application-event", transition.naturalKey);
    const eventExpected = {
      id: eventId,
      applicationId: id,
      actorUserId:
        transition.actor === "CANDIDATE"
          ? candidate.userId
          : company.ownerUserId,
      kind: ApplicationEventKind.STATUS_CHANGE,
      fromStatus: enumValue(ApplicationStatus, transition.fromStatus),
      toStatus: enumValue(ApplicationStatus, transition.toStatus),
      metadata: { source: "phase-09-demo-status-chain-v1" },
      createdAt: dateAt(
        submittedAt,
        Math.round((2 * DAY_MS * transition.stepIndex) / transition.stepCount),
      ),
    };
    await ensureRow({
      entity: "ApplicationEvent",
      naturalKey: transition.naturalKey,
      expected: eventExpected,
      findExisting: () =>
        tx.applicationEvent.findUnique({ where: { id: eventId } }),
      create: () =>
        tx.applicationEvent.create({
          data: {
            ...eventExpected,
            idempotencyKey: `seed:application-event:${transition.naturalKey}`,
            correlationId: `seed:application:${fixture.key}`,
          },
        }),
    });
  }

  const conversationNaturalKey = `${fixture.key}:conversation`;
  const conversationId = stableSeedId("conversation", conversationNaturalKey);
  const conversationExpected = {
    id: conversationId,
    companyId: company.id,
    kind: ConversationKind.APPLICATION,
    applicationId: id,
    contactRequestId: null,
    subject: `Bewerbung: ${job.slug}`,
    createdAt: submittedAt,
  };
  await ensureRow({
    entity: "Conversation",
    naturalKey: conversationNaturalKey,
    expected: conversationExpected,
    findExisting: () =>
      tx.conversation.findUnique({ where: { id: conversationId } }),
    create: () => tx.conversation.create({ data: conversationExpected }),
  });

  const candidateParticipantNaturalKey = `${fixture.key}:candidate`;
  const candidateParticipantId = stableSeedId(
    "conversation-participant",
    candidateParticipantNaturalKey,
  );
  const candidateParticipantExpected = {
    id: candidateParticipantId,
    conversationId,
    kind: ConversationParticipantKind.USER,
    userId: candidate.userId,
    companyId: null,
    joinedAt: submittedAt,
    leftAt: null,
    lastReadAt: dateAt(submittedAt, DAY_MS),
  };
  await ensureRow({
    entity: "ConversationParticipant",
    naturalKey: candidateParticipantNaturalKey,
    expected: candidateParticipantExpected,
    findExisting: () =>
      tx.conversationParticipant.findUnique({
        where: { id: candidateParticipantId },
      }),
    create: () =>
      tx.conversationParticipant.create({ data: candidateParticipantExpected }),
  });

  const companyParticipantNaturalKey = `${fixture.key}:company`;
  const companyParticipantId = stableSeedId(
    "conversation-participant",
    companyParticipantNaturalKey,
  );
  const companyParticipantExpected = {
    id: companyParticipantId,
    conversationId,
    kind: ConversationParticipantKind.COMPANY_PRINCIPAL,
    userId: null,
    companyId: company.id,
    joinedAt: submittedAt,
    leftAt: null,
    lastReadAt: dateAt(submittedAt, DAY_MS),
  };
  await ensureRow({
    entity: "ConversationParticipant",
    naturalKey: companyParticipantNaturalKey,
    expected: companyParticipantExpected,
    findExisting: () =>
      tx.conversationParticipant.findUnique({
        where: { id: companyParticipantId },
      }),
    create: () =>
      tx.conversationParticipant.create({ data: companyParticipantExpected }),
  });

  if (fixture.hasConversationMessages) {
    const candidateMessageNaturalKey = `${fixture.key}:candidate-message`;
    const candidateMessageId = stableSeedId(
      "message",
      candidateMessageNaturalKey,
    );
    const candidateMessageExpected = {
      id: candidateMessageId,
      conversationId,
      senderUserId: candidate.userId,
      body: "Guten Tag, dies ist eine fiktive Nachricht zur Demo-Bewerbung.",
      createdAt: dateAt(submittedAt, 2 * HOUR_MS),
      editedAt: null,
    };
    await ensureRow({
      entity: "Message",
      naturalKey: candidateMessageNaturalKey,
      expected: candidateMessageExpected,
      findExisting: () =>
        tx.message.findUnique({ where: { id: candidateMessageId } }),
      create: () => tx.message.create({ data: candidateMessageExpected }),
    });

    const employerMessageNaturalKey = `${fixture.key}:employer-message`;
    const employerMessageId = stableSeedId(
      "message",
      employerMessageNaturalKey,
    );
    const employerMessageExpected = {
      id: employerMessageId,
      conversationId,
      senderUserId: company.ownerUserId,
      body: "Vielen Dank. Wir prüfen die fiktive Demo-Bewerbung sorgfältig.",
      createdAt: dateAt(submittedAt, 6 * HOUR_MS),
      editedAt: null,
    };
    await ensureRow({
      entity: "Message",
      naturalKey: employerMessageNaturalKey,
      expected: employerMessageExpected,
      findExisting: () =>
        tx.message.findUnique({ where: { id: employerMessageId } }),
      create: () => tx.message.create({ data: employerMessageExpected }),
    });
  }

  return Object.freeze({
    id,
    jobId: job.id,
    candidateProfileId: candidate.id,
    conversationId,
  });
}

async function seedSavedJobs(
  db: DatabaseClient,
  anchorAt: Date,
  candidates: readonly CandidateWorkflowCandidateHandle[],
  publishedJobs: readonly CandidateWorkflowJobHandle[],
  expiredJobs: readonly CandidateWorkflowJobHandle[],
): Promise<void> {
  for (const [index, fixture] of SAVED_JOB_FIXTURES.entries()) {
    const id = stableSeedId("saved-job", fixture.key);
    const candidate = candidates[
      fixture.candidateIndex
    ] as CandidateWorkflowCandidateHandle;
    const jobPool = fixture.jobPool === "EXPIRED" ? expiredJobs : publishedJobs;
    const job = jobPool[fixture.jobIndex] as CandidateWorkflowJobHandle;
    const expected = {
      id,
      candidateProfileId: candidate.id,
      jobId: job.id,
      createdAt: dateAt(anchorAt, (-30 + index * 0.5) * DAY_MS),
    };
    await ensureRow({
      entity: "SavedJob",
      naturalKey: fixture.key,
      expected,
      findExisting: () => db.savedJob.findUnique({ where: { id } }),
      create: () => db.savedJob.create({ data: expected }),
    });
  }
}

async function seedJobAlerts(
  db: DatabaseClient,
  anchorAt: Date,
  candidates: readonly CandidateWorkflowCandidateHandle[],
  publishedJobs: readonly CandidateWorkflowJobHandle[],
): Promise<void> {
  const digestJobIds = [
    ...new Set(
      JOB_ALERT_FIXTURES.flatMap((fixture) =>
        fixture.jobIndices.map(
          (jobIndex) =>
            (publishedJobs[jobIndex] as CandidateWorkflowJobHandle).id,
        ),
      ),
    ),
  ];
  const digestJobReferences = await db.job.findMany({
    where: { id: { in: digestJobIds } },
    select: { id: true, publishedCategoryId: true, publishedCantonId: true },
  });
  const firstDigestJob = digestJobReferences[0];
  if (
    firstDigestJob === undefined ||
    firstDigestJob.publishedCategoryId === null ||
    firstDigestJob.publishedCantonId === null ||
    digestJobReferences.length !== digestJobIds.length ||
    digestJobReferences.some(
      (job) =>
        job.publishedCategoryId !== firstDigestJob.publishedCategoryId ||
        job.publishedCantonId !== firstDigestJob.publishedCantonId,
    )
  ) {
    throw new Error(
      "JobAlert demo digest fixtures must share one published category and Canton.",
    );
  }
  const alertQuery = Object.freeze({
    ...defaultJobAlertQuery(),
    categoryId: firstDigestJob.publishedCategoryId,
    cantonId: firstDigestJob.publishedCantonId,
  });

  for (const [index, fixture] of JOB_ALERT_FIXTURES.entries()) {
    const candidate = candidates[
      fixture.candidateIndex
    ] as CandidateWorkflowCandidateHandle;
    const candidateFixture = CANDIDATE_FIXTURES[
      fixture.candidateIndex
    ] as (typeof CANDIDATE_FIXTURES)[number];
    const recipient = candidateFixture.email;
    const id = stableSeedId("job-alert", fixture.key);
    const createdAt = dateAt(anchorAt, (-45 + index) * DAY_MS);
    const consentAt = dateAt(createdAt, -HOUR_MS);
    const scheduledFor = firstJobAlertDueAt(
      createdAt,
      enumValue(AlertFrequency, fixture.frequency),
    );
    const runAt = dateAt(anchorAt, -2 * HOUR_MS);
    const terminalAt = dateAt(runAt, 30 * 60 * 1_000);
    const nextDueAt = nextJobAlertDueAt(
      runAt,
      enumValue(AlertFrequency, fixture.frequency),
    );
    const alertExpected = {
      id,
      candidateProfileId: candidate.id,
      query: alertQuery,
      frequency: enumValue(AlertFrequency, fixture.frequency),
      status: enumValue(JobAlertStatus, fixture.status),
      nextDueAt,
      lastSuccessfulCutoffAt: runAt,
      createdAt,
      updatedAt: fixture.status === "ACTIVE" ? runAt : terminalAt,
    };
    const digestId = stableSeedId("job-alert-digest", fixture.key);
    const digestExpected = {
      id: digestId,
      jobAlertId: id,
      policyVersion: JOB_ALERT_POLICY_V1.version,
      alertNameSnapshot: "Dein Jobabo",
      recipientEmailSnapshot: recipient,
      windowStart: createdAt,
      windowEnd: runAt,
      scheduledFor,
      runAt,
      itemCount: 2,
      createdAt: runAt,
    };
    const tokenId = stableSeedId("job-alert-unsubscribe-token", fixture.key);
    const token = buildDemoJobAlertUnsubscribeToken(fixture.key, runAt);
    const tokenExpected = {
      id: tokenId,
      jobAlertId: id,
      digestId,
      tokenHash: token.tokenHash,
      issuedAt: token.issuedAt,
      expiresAt: token.expiresAt,
      usedAt:
        fixture.status === "UNSUBSCRIBED" || fixture.status === "DELETED"
          ? terminalAt
          : null,
    };
    const persistedEmail = renderEmailTemplate("job_alert_digest_mock", {
      alertName: "Dein Jobabo",
      jobCount: digestExpected.itemCount,
    });
    const emailNaturalKey = `${fixture.key}:digest-recorded`;
    const emailId = stableSeedId("email-log", emailNaturalKey);
    const emailExpected = {
      id: emailId,
      recipient,
      purpose: "job_alert_digest_mock",
      templateKey: "job_alert_digest_mock",
      payload: {
        schemaVersion: "1",
        deliveryStatus: "mock_recorded",
        externalDeliveryClaimed: false,
        subject: persistedEmail.subject,
        body: persistedEmail.body,
      },
      status: "MOCK_RECORDED" as const,
      providerReference: `mock-email-v2:seed:${sha256Utf8(emailNaturalKey)}`,
      errorCode: null,
      createdAt: runAt,
    };

    await db.$transaction(async (transaction) => {
      await reconcileLegacyDemoJobAlertProjection(transaction, {
        current: alertExpected,
        legacyQuery: {
          category: candidateFixture.categorySlug,
          canton: candidateFixture.cantonCode,
          page: 1,
        },
        legacyLastSuccessfulCutoffAt: dateAt(anchorAt, -2 * DAY_MS),
        legacyNextDueAt: dateAt(anchorAt, (1 + (index % 7)) * DAY_MS),
      });
      const consentNaturalKey = `${fixture.key}:delivery-granted`;
      const consentId = stableSeedId("user-consent-event", consentNaturalKey);
      const consentExpected = {
        id: consentId,
        userId: candidate.userId,
        kind: UserConsentKind.JOB_ALERT_DELIVERY,
        granted: true,
        purpose: JOB_ALERT_DELIVERY_NOTICE_V1.purpose,
        noticeVersion: JOB_ALERT_DELIVERY_NOTICE_V1.version,
        noticeHash: jobAlertConsentNoticeHash(),
        actorUserId: candidate.userId,
        effectiveAt: consentAt,
        createdAt: consentAt,
      };
      await ensureRow({
        entity: "UserConsentEvent",
        naturalKey: consentNaturalKey,
        expected: consentExpected,
        findExisting: () =>
          transaction.userConsentEvent.findUnique({ where: { id: consentId } }),
        create: () =>
          transaction.userConsentEvent.create({ data: consentExpected }),
      });

      await ensureRow({
        entity: "JobAlert",
        naturalKey: fixture.key,
        expected: alertExpected,
        findExisting: () => transaction.jobAlert.findUnique({ where: { id } }),
        create: () => transaction.jobAlert.create({ data: alertExpected }),
      });

      const createdEventNaturalKey = `${fixture.key}:created`;
      const createdEventId = stableSeedId(
        "job-alert-event",
        createdEventNaturalKey,
      );
      const createdEventExpected = {
        id: createdEventId,
        jobAlertId: id,
        kind: JobAlertEventKind.CREATED,
        actorUserId: candidate.userId,
        reasonCode: "EXPLICIT_ACTIVATION",
        createdAt,
      };
      await ensureRow({
        entity: "JobAlertEvent",
        naturalKey: createdEventNaturalKey,
        expected: createdEventExpected,
        findExisting: () =>
          transaction.jobAlertEvent.findUnique({
            where: { id: createdEventId },
          }),
        create: () =>
          transaction.jobAlertEvent.create({ data: createdEventExpected }),
      });

      await ensureRow({
        entity: "JobAlertDigest",
        naturalKey: fixture.key,
        expected: digestExpected,
        findExisting: () =>
          transaction.jobAlertDigest.findUnique({ where: { id: digestId } }),
        create: () =>
          transaction.jobAlertDigest.create({ data: digestExpected }),
      });

      for (const [itemIndex, jobIndex] of fixture.jobIndices.entries()) {
        const itemNaturalKey = `${fixture.key}:${itemIndex}`;
        const itemId = stableSeedId("job-alert-digest-item", itemNaturalKey);
        const job = publishedJobs[jobIndex] as CandidateWorkflowJobHandle;
        const itemExpected = {
          id: itemId,
          digestId,
          jobAlertId: id,
          jobId: job.id,
          sortOrder: itemIndex,
          createdAt: runAt,
        };
        await ensureRow({
          entity: "JobAlertDigestItem",
          naturalKey: itemNaturalKey,
          expected: itemExpected,
          findExisting: () =>
            transaction.jobAlertDigestItem.findUnique({
              where: { id: itemId },
            }),
          create: () =>
            transaction.jobAlertDigestItem.create({ data: itemExpected }),
        });
      }

      await ensureRow({
        entity: "JobAlertUnsubscribeToken",
        naturalKey: fixture.key,
        expected: tokenExpected,
        findExisting: () =>
          transaction.jobAlertUnsubscribeToken.findUnique({
            where: { id: tokenId },
          }),
        create: () =>
          transaction.jobAlertUnsubscribeToken.create({ data: tokenExpected }),
      });

      await ensureRow({
        entity: "EmailLog",
        naturalKey: emailNaturalKey,
        expected: emailExpected,
        findExisting: () =>
          transaction.emailLog.findUnique({ where: { id: emailId } }),
        create: () => transaction.emailLog.create({ data: emailExpected }),
      });

      const digestEventNaturalKey = `${fixture.key}:digest-recorded`;
      const digestEventId = stableSeedId(
        "job-alert-event",
        digestEventNaturalKey,
      );
      const digestEventExpected = {
        id: digestEventId,
        jobAlertId: id,
        kind: JobAlertEventKind.DIGEST_MOCK_RECORDED,
        actorUserId: null,
        reasonCode: JOB_ALERT_POLICY_V1.version,
        createdAt: runAt,
      };
      await ensureRow({
        entity: "JobAlertEvent",
        naturalKey: digestEventNaturalKey,
        expected: digestEventExpected,
        findExisting: () =>
          transaction.jobAlertEvent.findUnique({
            where: { id: digestEventId },
          }),
        create: () =>
          transaction.jobAlertEvent.create({ data: digestEventExpected }),
      });

      if (fixture.status !== "ACTIVE") {
        const terminal = terminalJobAlertEvent(
          fixture.status,
          candidate.userId,
        );
        const eventNaturalKey = `${fixture.key}:${fixture.status.toLowerCase()}`;
        const eventId = stableSeedId("job-alert-event", eventNaturalKey);
        const eventExpected = {
          id: eventId,
          jobAlertId: id,
          ...terminal,
          createdAt: terminalAt,
        };
        await ensureRow({
          entity: "JobAlertEvent",
          naturalKey: eventNaturalKey,
          expected: eventExpected,
          findExisting: () =>
            transaction.jobAlertEvent.findUnique({ where: { id: eventId } }),
          create: () =>
            transaction.jobAlertEvent.create({ data: eventExpected }),
        });
      }
    });
  }
}

async function reconcileLegacyDemoJobAlertProjection(
  db: WriteClient,
  input: Readonly<{
    current: Readonly<{
      id: string;
      candidateProfileId: string;
      query: Readonly<Record<string, unknown>>;
      frequency: AlertFrequency;
      status: JobAlertStatus;
      nextDueAt: Date;
      lastSuccessfulCutoffAt: Date;
      createdAt: Date;
      updatedAt: Date;
    }>;
    legacyQuery: Readonly<Record<string, unknown>>;
    legacyLastSuccessfulCutoffAt: Date;
    legacyNextDueAt: Date;
  }>,
) {
  await db.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "JobAlert"
    WHERE "id" = ${input.current.id}::uuid
    FOR UPDATE
  `;
  const existing = await db.jobAlert.findUnique({
    where: { id: input.current.id },
    select: {
      candidateProfileId: true,
      query: true,
      frequency: true,
      status: true,
      nextDueAt: true,
      lastSuccessfulCutoffAt: true,
      createdAt: true,
      updatedAt: true,
      candidateProfile: {
        select: { user: { select: { dataProvenance: true } } },
      },
    },
  });
  if (existing === null) return;

  const commonProjectionMatches =
    existing.candidateProfileId === input.current.candidateProfileId &&
    existing.candidateProfile.user.dataProvenance === DataProvenance.DEMO &&
    existing.frequency === input.current.frequency &&
    existing.status === input.current.status &&
    existing.createdAt.getTime() === input.current.createdAt.getTime();
  const currentQueryMatches =
    sha256CanonicalJson(existing.query as CanonicalJsonValue) ===
    sha256CanonicalJson(input.current.query as CanonicalJsonValue);
  const currentProjectionMatches =
    commonProjectionMatches &&
    currentQueryMatches &&
    existing.nextDueAt.getTime() === input.current.nextDueAt.getTime() &&
    existing.lastSuccessfulCutoffAt?.getTime() ===
      input.current.lastSuccessfulCutoffAt.getTime() &&
    existing.updatedAt.getTime() === input.current.updatedAt.getTime();
  if (currentProjectionMatches) return;

  const legacyQueryMatches =
    sha256CanonicalJson(existing.query as CanonicalJsonValue) ===
    sha256CanonicalJson(input.legacyQuery as CanonicalJsonValue);
  const legacyProjectionMatches =
    commonProjectionMatches &&
    legacyQueryMatches &&
    existing.nextDueAt.getTime() === input.legacyNextDueAt.getTime() &&
    existing.lastSuccessfulCutoffAt?.getTime() ===
      input.legacyLastSuccessfulCutoffAt.getTime();
  if (!legacyProjectionMatches) return;

  await db.jobAlert.update({
    where: { id: input.current.id },
    data: {
      query: input.current.query as Prisma.InputJsonValue,
      nextDueAt: input.current.nextDueAt,
      lastSuccessfulCutoffAt: input.current.lastSuccessfulCutoffAt,
      updatedAt: input.current.updatedAt,
    },
  });
}

export function buildDemoJobAlertUnsubscribeToken(
  fixtureKey: string,
  issuedAt: Date,
) {
  const entropy = Buffer.from(
    sha256Utf8(`phase-09-demo-job-alert-token-v1:${fixtureKey}`),
    "hex",
  );
  return createJobAlertUnsubscribeToken(issuedAt, () => entropy);
}

function terminalJobAlertEvent(status: string, candidateUserId: string) {
  switch (status) {
    case "PAUSED":
      return Object.freeze({
        kind: JobAlertEventKind.PAUSED,
        actorUserId: candidateUserId,
        reasonCode: "EXPLICIT_ALERT_ACTION",
      });
    case "UNSUBSCRIBED":
      return Object.freeze({
        kind: JobAlertEventKind.UNSUBSCRIBED,
        actorUserId: null,
        reasonCode: "ONE_CLICK_TOKEN",
      });
    case "DELETED":
      return Object.freeze({
        kind: JobAlertEventKind.DELETED,
        actorUserId: candidateUserId,
        reasonCode: "EXPLICIT_DELETE",
      });
    default:
      throw new Error(`Missing JobAlert event mapping for ${status}.`);
  }
}

function contactTiming(anchorAt: Date, key: string) {
  const values: Readonly<
    Record<string, Readonly<{ createdAt: Date; terminalAt: Date | null }>>
  > = {
    "contact-accepted-a": {
      createdAt: dateAt(anchorAt, -2 * DAY_MS),
      terminalAt: dateAt(anchorAt, -2 * DAY_MS + 2 * HOUR_MS),
    },
    "contact-accepted-b": {
      createdAt: dateAt(anchorAt, -4 * DAY_MS),
      terminalAt: dateAt(anchorAt, -4 * DAY_MS + 3 * HOUR_MS),
    },
    "contact-pending-a": {
      createdAt: dateAt(anchorAt, -2 * DAY_MS + 4 * HOUR_MS),
      terminalAt: null,
    },
    "contact-pending-b": {
      createdAt: dateAt(anchorAt, -DAY_MS + 4 * HOUR_MS),
      terminalAt: null,
    },
    "contact-declined-a": {
      createdAt: dateAt(anchorAt, -42 * DAY_MS),
      terminalAt: dateAt(anchorAt, -32 * DAY_MS),
    },
    "contact-declined-b": {
      createdAt: dateAt(anchorAt, -44 * DAY_MS),
      terminalAt: dateAt(anchorAt, -34 * DAY_MS),
    },
  };
  const timing = values[key];
  if (timing === undefined) {
    throw new Error(`Missing contact timing fixture for ${key}.`);
  }
  return timing;
}

async function seedContactCreditFunding(
  db: DatabaseClient,
  anchorAt: Date,
  companies: readonly CandidateWorkflowCompanyHandle[],
): Promise<ReadonlyMap<number, string>> {
  const accountIds = new Map<number, string>();
  const periodStart = dateAt(anchorAt, -60 * DAY_MS);
  const periodEnd = dateAt(anchorAt, 60 * DAY_MS);

  for (const [companyIndex, company] of companies.entries()) {
    const naturalKey = `candidate-workflows:${company.slug}:talent-contact`;
    const id = stableSeedId("credit-account", naturalKey);
    const expected = {
      id,
      companyId: company.id,
      creditType: CreditType.TALENT_CONTACT,
      fundingSource: CreditFundingSource.ADMIN_GRANT,
      periodStart,
      periodEnd,
    };
    await ensureRow({
      entity: "CreditAccount",
      naturalKey,
      expected,
      findExisting: () => db.creditAccount.findUnique({ where: { id } }),
      create: () =>
        db.creditAccount.create({
          data: { ...expected, createdAt: dateAt(periodStart, HOUR_MS) },
        }),
    });
    accountIds.set(companyIndex, id);

    const grantNaturalKey = `candidate-workflows:${company.slug}:grant`;
    const grantId = stableSeedId("credit-ledger-entry", grantNaturalKey);
    const grantExpected = {
      id: grantId,
      accountId: id,
      fundingSource: CreditFundingSource.ADMIN_GRANT,
      kind: CreditLedgerKind.GRANT,
      amount: 3,
      sourcePlanVersionId: null,
      sourceSubscriptionId: null,
      sourceOrderLineId: null,
      consumedGrantEntryId: null,
      reversalOfEntryId: null,
      validFrom: periodStart,
      validTo: periodEnd,
      idempotencyKey: `seed:${grantNaturalKey}`,
      reasonCode: "DEMO_CONTACT_REQUESTS",
      actorUserId: company.ownerUserId,
      createdAt: dateAt(periodStart, HOUR_MS),
    };
    await ensureRow({
      entity: "CreditLedgerEntry",
      naturalKey: grantNaturalKey,
      expected: grantExpected,
      findExisting: () =>
        db.creditLedgerEntry.findUnique({ where: { id: grantId } }),
      create: () => db.creditLedgerEntry.create({ data: grantExpected }),
    });
  }

  for (const request of CONTACT_REQUEST_FIXTURES) {
    const company = companies[
      request.companySlot
    ] as CandidateWorkflowCompanyHandle;
    const accountId = accountIds.get(request.companySlot) as string;
    const naturalKey = `candidate-workflows:${request.key}:consume`;
    const id = stableSeedId("credit-ledger-entry", naturalKey);
    const timing = contactTiming(anchorAt, request.key);
    const expected = {
      id,
      accountId,
      fundingSource: CreditFundingSource.ADMIN_GRANT,
      kind: CreditLedgerKind.CONSUME,
      amount: -1,
      sourcePlanVersionId: null,
      sourceSubscriptionId: null,
      sourceOrderLineId: null,
      consumedGrantEntryId: stableSeedId(
        "credit-ledger-entry",
        `candidate-workflows:${company.slug}:grant`,
      ),
      reversalOfEntryId: null,
      validFrom: periodStart,
      validTo: periodEnd,
      idempotencyKey: `seed:${naturalKey}`,
      reasonCode: "TALENT_RADAR_CONTACT",
      actorUserId: company.ownerUserId,
      createdAt: timing.createdAt,
    };
    await ensureRow({
      entity: "CreditLedgerEntry",
      naturalKey,
      expected,
      findExisting: () => db.creditLedgerEntry.findUnique({ where: { id } }),
      create: () => db.creditLedgerEntry.create({ data: expected }),
    });
  }
  return accountIds;
}

type AcceptedContactScope = Readonly<{
  candidate: CandidateWorkflowCandidateHandle;
  company: CandidateWorkflowCompanyHandle;
  contactRequestId: string;
  conversationId: string;
  fixtureKey: string;
  revealedAt: Date;
}>;

async function seedContactRequestsAndConversations(
  db: DatabaseClient,
  anchorAt: Date,
  candidates: readonly CandidateWorkflowCandidateHandle[],
  companies: readonly CandidateWorkflowCompanyHandle[],
): Promise<
  Readonly<{
    requests: readonly Readonly<{ id: string; status: string }>[];
    conversations: readonly Readonly<{ id: string; kind: string }>[];
    acceptedScopes: readonly AcceptedContactScope[];
  }>
> {
  const requests: Array<Readonly<{ id: string; status: string }>> = [];
  const conversations: Array<Readonly<{ id: string; kind: string }>> = [];
  const acceptedScopes: AcceptedContactScope[] = [];

  for (const request of CONTACT_REQUEST_FIXTURES) {
    const company = companies[
      request.companySlot
    ] as CandidateWorkflowCompanyHandle;
    const candidate = candidates[
      request.candidateIndex
    ] as CandidateWorkflowCandidateHandle;
    const candidateFixture = CANDIDATE_FIXTURES[
      request.candidateIndex
    ] as (typeof CANDIDATE_FIXTURES)[number];
    const id = stableSeedId("employer-contact-request", request.key);
    const consumeId = stableSeedId(
      "credit-ledger-entry",
      `candidate-workflows:${request.key}:consume`,
    );
    const timing = contactTiming(anchorAt, request.key);
    const status = enumValue(ContactRequestStatus, request.status);
    const expected = {
      id,
      companyId: company.id,
      candidateProfileId: candidate.id,
      requestingUserId: company.ownerUserId,
      creditLedgerEntryId: consumeId,
      messagePreview:
        "Fiktive Kontaktanfrage: Wir würden gerne über eine passende Demo-Rolle sprechen.",
      idempotencyKey: `seed:${request.key}`,
      status,
      fundingSource: CreditFundingSource.ADMIN_GRANT,
      clusterPolicyVersion: "radar-cluster-v1",
      cantonBucketSnapshot: candidateFixture.cantonCode,
      categoryBucketSnapshot: candidateFixture.categorySlug,
      expiresAt: dateAt(timing.createdAt, 14 * DAY_MS),
      terminalAt: timing.terminalAt,
      createdAt: timing.createdAt,
    };
    await ensureRow({
      entity: "EmployerContactRequest",
      naturalKey: request.key,
      expected,
      findExisting: () =>
        db.employerContactRequest.findUnique({ where: { id } }),
      create: () => db.employerContactRequest.create({ data: expected }),
    });
    requests.push(Object.freeze({ id, status: request.status }));

    const createdEventNaturalKey = `${request.key}:created`;
    const createdEventId = stableSeedId(
      "contact-request-event",
      createdEventNaturalKey,
    );
    const createdEventExpected = {
      id: createdEventId,
      contactRequestId: id,
      kind: ContactRequestEventKind.CREATED,
      actorUserId: company.ownerUserId,
      reasonCode: null,
      correlationId: `seed:contact:${request.key}:created`,
      createdAt: timing.createdAt,
    };
    await ensureRow({
      entity: "ContactRequestEvent",
      naturalKey: createdEventNaturalKey,
      expected: createdEventExpected,
      findExisting: () =>
        db.contactRequestEvent.findUnique({ where: { id: createdEventId } }),
      create: () =>
        db.contactRequestEvent.create({ data: createdEventExpected }),
    });

    if (request.status !== "PENDING") {
      const terminalEventNaturalKey = `${request.key}:${request.status.toLowerCase()}`;
      const terminalEventId = stableSeedId(
        "contact-request-event",
        terminalEventNaturalKey,
      );
      const terminalEventExpected = {
        id: terminalEventId,
        contactRequestId: id,
        kind: enumValue(ContactRequestEventKind, request.status),
        actorUserId: candidate.userId,
        reasonCode:
          request.status === "DECLINED"
            ? "DEMO_NOT_AVAILABLE"
            : "DEMO_ACCEPTED",
        correlationId: `seed:contact:${request.key}:terminal`,
        createdAt: timing.terminalAt as Date,
      };
      await ensureRow({
        entity: "ContactRequestEvent",
        naturalKey: terminalEventNaturalKey,
        expected: terminalEventExpected,
        findExisting: () =>
          db.contactRequestEvent.findUnique({ where: { id: terminalEventId } }),
        create: () =>
          db.contactRequestEvent.create({ data: terminalEventExpected }),
      });
    }

    if (request.status !== "ACCEPTED") {
      continue;
    }

    const conversationNaturalKey = `${request.key}:conversation`;
    const conversationId = stableSeedId("conversation", conversationNaturalKey);
    const conversationExpected = {
      id: conversationId,
      companyId: company.id,
      kind: ConversationKind.TALENT_RADAR,
      applicationId: null,
      contactRequestId: id,
      subject: "Talent-Radar Kontakt",
      createdAt: timing.terminalAt as Date,
    };
    await ensureRow({
      entity: "Conversation",
      naturalKey: conversationNaturalKey,
      expected: conversationExpected,
      findExisting: () =>
        db.conversation.findUnique({ where: { id: conversationId } }),
      create: () => db.conversation.create({ data: conversationExpected }),
    });
    conversations.push(
      Object.freeze({ id: conversationId, kind: "TALENT_RADAR" }),
    );

    const candidateParticipantNaturalKey = `${request.key}:candidate`;
    const candidateParticipantId = stableSeedId(
      "conversation-participant",
      candidateParticipantNaturalKey,
    );
    const candidateParticipantExpected = {
      id: candidateParticipantId,
      conversationId,
      kind: ConversationParticipantKind.USER,
      userId: candidate.userId,
      companyId: null,
      joinedAt: timing.terminalAt as Date,
      leftAt: null,
      lastReadAt: dateAt(timing.terminalAt as Date, HOUR_MS),
    };
    await ensureRow({
      entity: "ConversationParticipant",
      naturalKey: candidateParticipantNaturalKey,
      expected: candidateParticipantExpected,
      findExisting: () =>
        db.conversationParticipant.findUnique({
          where: { id: candidateParticipantId },
        }),
      create: () =>
        db.conversationParticipant.create({
          data: candidateParticipantExpected,
        }),
    });

    const companyParticipantNaturalKey = `${request.key}:company`;
    const companyParticipantId = stableSeedId(
      "conversation-participant",
      companyParticipantNaturalKey,
    );
    const companyParticipantExpected = {
      id: companyParticipantId,
      conversationId,
      kind: ConversationParticipantKind.COMPANY_PRINCIPAL,
      userId: null,
      companyId: company.id,
      joinedAt: timing.terminalAt as Date,
      leftAt: null,
      lastReadAt: dateAt(timing.terminalAt as Date, HOUR_MS),
    };
    await ensureRow({
      entity: "ConversationParticipant",
      naturalKey: companyParticipantNaturalKey,
      expected: companyParticipantExpected,
      findExisting: () =>
        db.conversationParticipant.findUnique({
          where: { id: companyParticipantId },
        }),
      create: () =>
        db.conversationParticipant.create({ data: companyParticipantExpected }),
    });

    for (const sender of ["employer", "candidate"] as const) {
      const messageNaturalKey = `${request.key}:${sender}-message`;
      const messageId = stableSeedId("message", messageNaturalKey);
      const employer = sender === "employer";
      const messageExpected = {
        id: messageId,
        conversationId,
        senderUserId: employer ? company.ownerUserId : candidate.userId,
        body: employer
          ? "Guten Tag, diese Nachricht gehört zu einer fiktiven Talent-Radar-Anfrage."
          : "Danke, ich bestätige den fiktiven Kontakt und die gewählten Freigabefelder.",
        createdAt: dateAt(
          timing.terminalAt as Date,
          employer ? HOUR_MS : 2 * HOUR_MS,
        ),
        editedAt: null,
      };
      await ensureRow({
        entity: "Message",
        naturalKey: messageNaturalKey,
        expected: messageExpected,
        findExisting: () => db.message.findUnique({ where: { id: messageId } }),
        create: () => db.message.create({ data: messageExpected }),
      });
    }

    const revealEventNaturalKey = `${request.key}:reveal-granted`;
    const revealEventId = stableSeedId(
      "contact-request-event",
      revealEventNaturalKey,
    );
    const revealedAt = dateAt(timing.terminalAt as Date, 3 * HOUR_MS);
    const revealEventExpected = {
      id: revealEventId,
      contactRequestId: id,
      kind: ContactRequestEventKind.REVEAL_GRANTED,
      actorUserId: candidate.userId,
      reasonCode: "CANDIDATE_CONFIRMED_FIELDS",
      correlationId: `seed:contact:${request.key}:reveal`,
      createdAt: revealedAt,
    };
    await ensureRow({
      entity: "ContactRequestEvent",
      naturalKey: revealEventNaturalKey,
      expected: revealEventExpected,
      findExisting: () =>
        db.contactRequestEvent.findUnique({ where: { id: revealEventId } }),
      create: () =>
        db.contactRequestEvent.create({ data: revealEventExpected }),
    });

    acceptedScopes.push(
      Object.freeze({
        candidate,
        company,
        contactRequestId: id,
        conversationId,
        fixtureKey: request.key,
        revealedAt,
      }),
    );
  }

  return Object.freeze({ requests, conversations, acceptedScopes });
}

async function seedIdentityRevealGrant(
  db: DatabaseClient,
  scope: AcceptedContactScope,
  crypto: CandidateWorkflowSeedCryptoConfig,
): Promise<void> {
  const revokedFixture = scope.fixtureKey === "contact-accepted-b";
  const grantId = stableSeedId("identity-reveal-grant", scope.fixtureKey);
  const revokedAt = revokedFixture ? dateAt(scope.revealedAt, DAY_MS) : null;
  const finalGrantExpected = {
    id: grantId,
    candidateProfileId: scope.candidate.id,
    companyId: scope.company.id,
    contactRequestId: scope.contactRequestId,
    conversationId: scope.conversationId,
    noticeVersion: REVEAL_SNAPSHOT_POLICY_V1.noticeVersion,
    confirmationSnapshotHash: sha256Utf8(
      `identity-reveal-confirmation:${scope.fixtureKey}`,
    ),
    revealedAt: scope.revealedAt,
    revokedAt,
    revokedByUserId: revokedFixture ? scope.candidate.userId : null,
    revokeReason: revokedFixture
      ? IdentityRevealRevokeReason.PRIVACY_CHOICE
      : null,
  };
  const existing = await db.identityRevealGrant.findUnique({
    where: { id: grantId },
  });

  await db.$transaction(
    async (tx) => {
      const initialGrantExpected =
        existing === null
          ? {
              ...finalGrantExpected,
              revokedAt: null,
              revokedByUserId: null,
              revokeReason: null,
            }
          : finalGrantExpected;
      await ensureRow({
        entity: "IdentityRevealGrant",
        naturalKey: scope.fixtureKey,
        expected: initialGrantExpected,
        findExisting: () =>
          tx.identityRevealGrant.findUnique({ where: { id: grantId } }),
        create: () =>
          tx.identityRevealGrant.create({ data: initialGrantExpected }),
      });

      type RevealFieldName = "DISPLAY_NAME" | "EMAIL" | "PHONE";

      const candidate = await tx.candidateProfile.findUniqueOrThrow({
        where: { id: scope.candidate.id },
        select: {
          firstName: true,
          lastName: true,
          phone: true,
          user: { select: { emailNormalized: true } },
        },
      });
      const displayName = [candidate.firstName, candidate.lastName]
        .filter(
          (part): part is string => part !== null && part.trim().length > 0,
        )
        .join(" ");
      const phone = candidate.phone?.replace(/[^+\d]/g, "") ?? "";
      const revealValue = (fieldName: RevealFieldName): RevealValue => {
        switch (fieldName) {
          case "DISPLAY_NAME":
            return Object.freeze({ field: fieldName, value: displayName });
          case "EMAIL":
            return Object.freeze({
              field: fieldName,
              value: candidate.user.emailNormalized,
            });
          case "PHONE":
            return Object.freeze({ field: fieldName, value: phone });
        }
      };
      const binding = Object.freeze({
        grantId,
        candidateProfileId: scope.candidate.id,
        companyId: scope.company.id,
        contactRequestId: scope.contactRequestId,
      });
      const previewScope = Object.freeze({
        contactRequestId: scope.contactRequestId,
        conversationId: scope.conversationId,
        candidateProfileId: scope.candidate.id,
        companyId: scope.company.id,
      });

      const ensureField = async (fieldName: RevealFieldName) => {
        const naturalKey = `${scope.fixtureKey}:${fieldName}`;
        const id = stableSeedId("identity-reveal-grant-field", naturalKey);
        const value = revealValue(fieldName);
        const expected = {
          id,
          grantId,
          field: enumValue(RevealField, fieldName),
          createdAt: scope.revealedAt,
        };
        const encryptedField = await ensureRow({
          entity: "IdentityRevealGrantField",
          naturalKey,
          expected,
          findExisting: () =>
            tx.identityRevealGrantField.findUnique({ where: { id } }),
          create: () => {
            const encrypted = encryptRevealValues(
              [value],
              crypto.piiRevealKeys,
              binding,
            )[0];
            if (encrypted === undefined) {
              throw new Error(
                `IdentityRevealGrantField ${naturalKey} was not encrypted.`,
              );
            }
            return tx.identityRevealGrantField.create({
              data: {
                ...expected,
                ...encrypted,
                ciphertext: Uint8Array.from(encrypted.ciphertext),
                nonce: Uint8Array.from(encrypted.nonce),
                authTag: Uint8Array.from(encrypted.authTag),
              },
            });
          },
        });
        const decrypted = decryptRevealValue(
          {
            field: encryptedField.field,
            ciphertext: encryptedField.ciphertext,
            nonce: encryptedField.nonce,
            authTag: encryptedField.authTag,
            encryptionKeyVersion: encryptedField.encryptionKeyVersion,
            schemaVersion: encryptedField.schemaVersion as "v1",
            integrityHmac: encryptedField.integrityHmac,
          },
          crypto.piiRevealKeys,
          binding,
        );
        verifyRow(
          "IdentityRevealGrantField plaintext",
          naturalKey,
          decrypted,
          value,
        );
      };

      const ensureConfirmation = async (
        suffix: "initial" | "add-fields",
        completeFieldNames: readonly RevealFieldName[],
        newlyAddedFieldNames: readonly RevealFieldName[],
        createdAt: Date,
      ) => {
        const naturalKey = `${scope.fixtureKey}:${suffix}`;
        const id = stableSeedId("identity-reveal-confirmation", naturalKey);
        const values = completeFieldNames.map(revealValue);
        const preview = buildRevealPreview(
          values,
          previewScope,
          crypto.revealConfirmationKeys,
          createdAt,
        );
        const expected = {
          id,
          grantId,
          actorUserId: scope.candidate.userId,
          contactRequestId: scope.contactRequestId,
          conversationId: scope.conversationId,
          completeFieldSet: completeFieldNames.map((field) =>
            enumValue(RevealField, field),
          ),
          newlyAddedFields: newlyAddedFieldNames.map((field) =>
            enumValue(RevealField, field),
          ),
          noticeVersion: REVEAL_SNAPSHOT_POLICY_V1.noticeVersion,
          idempotencyKey: `seed:identity-reveal:${scope.fixtureKey}:${suffix}`,
          createdAt,
        };
        const confirmation = await ensureRow({
          entity: "IdentityRevealConfirmation",
          naturalKey,
          expected,
          findExisting: () =>
            tx.identityRevealConfirmation.findUnique({ where: { id } }),
          create: () =>
            tx.identityRevealConfirmation.create({
              data: { ...expected, previewHmac: preview.evidence.previewHmac },
            }),
        });
        const validPreviewHmac = crypto.revealConfirmationKeys.some(
          (key) =>
            buildRevealPreview(values, previewScope, [key], createdAt).evidence
              .previewHmac === confirmation.previewHmac,
        );
        if (!validPreviewHmac) {
          throw new Error(
            `IdentityRevealConfirmation ${naturalKey} failed preview verification.`,
          );
        }
      };

      if (revokedFixture) {
        await ensureField("DISPLAY_NAME");
        await ensureConfirmation(
          "initial",
          ["DISPLAY_NAME"],
          ["DISPLAY_NAME"],
          scope.revealedAt,
        );
        await ensureField("EMAIL");
        await ensureField("PHONE");
        await ensureConfirmation(
          "add-fields",
          ["DISPLAY_NAME", "EMAIL", "PHONE"],
          ["EMAIL", "PHONE"],
          dateAt(scope.revealedAt, HOUR_MS),
        );
      } else {
        await ensureField("DISPLAY_NAME");
        await ensureField("EMAIL");
        await ensureConfirmation(
          "initial",
          ["DISPLAY_NAME", "EMAIL"],
          ["DISPLAY_NAME", "EMAIL"],
          scope.revealedAt,
        );
      }

      if (revokedFixture && existing === null) {
        const transition = await tx.identityRevealGrant.updateMany({
          where: { id: grantId, revokedAt: null },
          data: {
            revokedAt,
            revokedByUserId: scope.candidate.userId,
            revokeReason: IdentityRevealRevokeReason.PRIVACY_CHOICE,
          },
        });
        if (transition.count !== 1) {
          throw new Error(
            `Reveal Grant ${scope.fixtureKey} revocation did not apply.`,
          );
        }
      }

      const finalGrant = await tx.identityRevealGrant.findUniqueOrThrow({
        where: { id: grantId },
      });
      verifyRow(
        "IdentityRevealGrant",
        scope.fixtureKey,
        finalGrant,
        finalGrantExpected,
      );
    },
    { timeout: 20_000 },
  );
}

async function seedPrivacyRequests(
  db: DatabaseClient,
  anchorAt: Date,
  candidates: readonly CandidateWorkflowCandidateHandle[],
): Promise<void> {
  for (const [index, fixture] of PRIVACY_REQUEST_FIXTURES.entries()) {
    const candidate = candidates[
      fixture.candidateIndex
    ] as CandidateWorkflowCandidateHandle;
    const createdAt = dateAt(anchorAt, (-6 + index) * HOUR_MS);
    const requestId = stableSeedId("privacy-request", fixture.key);
    const requestExpected = {
      id: requestId,
      requesterUserId: candidate.userId,
      type: enumValue(PrivacyRequestType, fixture.type),
      status: PrivacyRequestStatus.PENDING,
      version: 1,
      dueAt: dateAt(createdAt, 30 * DAY_MS),
      idempotencyKey: `seed:privacy-request:${fixture.key}`,
      deletionDependencies: [],
      createdAt,
    };

    await db.$transaction(async (transaction) => {
      await ensureRow({
        entity: "PrivacyRequest",
        naturalKey: fixture.key,
        expected: requestExpected,
        findExisting: () =>
          transaction.privacyRequest.findUnique({ where: { id: requestId } }),
        create: () =>
          transaction.privacyRequest.create({ data: requestExpected }),
      });

      const eventExpected = {
        id: stableSeedId("privacy-request-event", `${fixture.key}:created`),
        privacyRequestId: requestId,
        kind: PrivacyRequestEventKind.CREATED,
        fromStatus: null,
        toStatus: PrivacyRequestStatus.PENDING,
        actorUserId: candidate.userId,
        reasonCode: "candidate-self-service",
        safeNote: null,
        idempotencyKey: `seed:privacy-request-event:${fixture.key}:created`,
        correlationId: `seed:privacy-request:${fixture.key}`,
        createdAt,
      };
      await ensureRow({
        entity: "PrivacyRequestEvent",
        naturalKey: `${fixture.key}:created`,
        expected: eventExpected,
        findExisting: () =>
          transaction.privacyRequestEvent.findUnique({
            where: { id: eventExpected.id },
          }),
        create: () =>
          transaction.privacyRequestEvent.create({ data: eventExpected }),
      });

      for (const field of fixture.correctionFields) {
        const fieldCode = enumValue(PrivacyCorrectionFieldCode, field);
        const fieldExpected = {
          privacyRequestId: requestId,
          fieldCode,
          correctionText:
            "Bitte diese fiktiven Profildaten anhand der Demo-Unterlagen korrigieren.",
        };
        await ensureRow({
          entity: "PrivacyRequestCorrectionField",
          naturalKey: `${fixture.key}:${field}`,
          expected: fieldExpected,
          findExisting: () =>
            transaction.privacyRequestCorrectionField.findUnique({
              where: {
                privacyRequestId_fieldCode: {
                  privacyRequestId: requestId,
                  fieldCode,
                },
              },
            }),
          create: () =>
            transaction.privacyRequestCorrectionField.create({
              data: fieldExpected,
            }),
        });
      }
    });
  }
}

export async function seedCandidateWorkflows(
  db: DatabaseClient,
  anchorAtInput: Date,
  dependencies: CandidateWorkflowDependencies,
  cryptoInput: CandidateWorkflowSeedCryptoConfig = DEMO_ONLY_CANDIDATE_WORKFLOW_CRYPTO,
): Promise<CandidateWorkflowSeedResult> {
  const anchorAt = requireValidAnchor(anchorAtInput);
  const crypto = requireValidCryptoConfig(cryptoInput);
  const { companies, expiredJobs, publishedJobs } =
    resolveDependencies(dependencies);
  const references = await loadReferenceMaps(db);
  const companiesById = new Map(
    dependencies.companies.map((company) => [company.id, company]),
  );
  const revisionsById = await loadPublishedRevisionSnapshots(db, publishedJobs);

  const candidates: CandidateWorkflowCandidateHandle[] = [];
  for (const [index, fixture] of CANDIDATE_FIXTURES.entries()) {
    const candidate = await db.$transaction(
      (tx) => seedCandidate(tx, anchorAt, fixture, index, references),
      { timeout: 20_000 },
    );
    candidates.push(candidate);
  }

  await seedRadarProfilesAndConsents(db, anchorAt, candidates);
  await seedRadarMappingsAndSearchEvidence(
    db,
    anchorAt,
    candidates,
    companies,
    crypto,
  );

  const applications: Array<
    Readonly<{
      id: string;
      jobId: string;
      candidateProfileId: string;
      conversationId: string;
    }>
  > = [];
  for (const [index, fixture] of APPLICATION_FIXTURES.entries()) {
    const application = await db.$transaction(
      (tx) =>
        seedApplication(
          tx,
          anchorAt,
          fixture,
          index,
          candidates,
          publishedJobs,
          companiesById,
          revisionsById,
        ),
      { timeout: 20_000 },
    );
    applications.push(application);
  }

  await seedSavedJobs(db, anchorAt, candidates, publishedJobs, expiredJobs);
  await seedJobAlerts(db, anchorAt, candidates, publishedJobs);
  await seedPrivacyRequests(db, anchorAt, candidates);
  await seedContactCreditFunding(db, anchorAt, companies);
  const contactResult = await seedContactRequestsAndConversations(
    db,
    anchorAt,
    candidates,
    companies,
  );
  for (const scope of contactResult.acceptedScopes) {
    await seedIdentityRevealGrant(db, scope, crypto);
  }

  const applicationConversations = applications.map((application) =>
    Object.freeze({ id: application.conversationId, kind: "APPLICATION" }),
  );
  const conversations = Object.freeze([
    ...applicationConversations,
    ...contactResult.conversations,
  ]);
  if (
    candidates.length !== 30 ||
    applications.length !== 80 ||
    conversations.length !== 82 ||
    contactResult.requests.length !== 6
  ) {
    throw new Error(
      "Candidate workflow seed result violates its exact count contract.",
    );
  }

  return Object.freeze({
    applications: Object.freeze(
      applications.map(({ id, jobId, candidateProfileId }) =>
        Object.freeze({ id, jobId, candidateProfileId }),
      ),
    ),
    blockDigest: CANDIDATE_WORKFLOW_BLOCK_DIGEST,
    candidates: Object.freeze(candidates),
    contactRequests: contactResult.requests,
    conversations,
  });
}
