import { z } from "zod";

import type {
  RadarDistinctFilterBudget,
  RadarDistinctFilterBudgetDecision,
} from "@/lib/auth/rate-limit";
import { getEffectiveEntitlements } from "@/lib/billing/entitlements";
import { createPrismaEntitlementRepository } from "@/lib/billing/prisma-publish-quota";
import type { DatabaseClient } from "@/lib/db/factory";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  toAnonymousCandidate,
  type AnonymousCandidateDto,
} from "@/lib/privacy/anonymize-candidate";
import {
  decryptRadarOpaqueToken,
  type RadarOpaqueKey,
} from "@/lib/privacy/radar-opaque";
import {
  buildRadarCandidateEligibilityPrefilter,
  buildRadarCandidateEligibilitySelect,
  isRadarCandidateEligible,
  toRadarCandidateEligibilityInput,
  type RadarCandidateEligibilityInput,
  type RadarEligibilityEnvironment,
} from "@/lib/talentradar/eligibility";
import {
  getRadarOpaqueEpoch,
  isCurrentRadarOpaqueMapping,
  mintRadarOpaqueIdForAuthorizedDto,
  remintRadarOpaqueIdAfterReoptIn,
  type RadarOpaqueMappingRecord,
} from "@/lib/talentradar/opaque-id";
import {
  RADAR_CANTON_CODES_V1,
  RADAR_PRIVACY_POLICY_V1,
  gateRadarCohortV1,
  getRadarZurichCalendarDateV1,
  normalizeRadarFiltersV1,
  pageRadarDailySampleV1,
  radarLanguageMeetsMinimumV1,
  selectRadarDailySampleV1,
  signRadarCursorV1,
  verifyRadarCursorV1,
  type NormalizedRadarFiltersV1,
  type RadarCohortCountLabelV1,
  type RadarLanguageBucketV1,
  type RadarPrivacyHmacKeyV1,
} from "@/lib/talentradar/privacy-policy-v1";

const UUID = z.string().uuid();
const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const ALLOWED_EMPLOYER_ROLES = new Set(["OWNER", "ADMIN", "RECRUITER"]);
const CANTON_CODES = new Set<string>(RADAR_CANTON_CODES_V1);
const RADAR_SCAN_BATCH_SIZE = 200;

export type RadarEmployerAccessSnapshot = Readonly<{
  membershipId: string;
  membershipUserId: string;
  companyId: string;
  membershipStatus: "ACTIVE" | "SUSPENDED" | "REMOVED";
  membershipRole: "OWNER" | "ADMIN" | "RECRUITER" | "VIEWER";
  userStatus: "ACTIVE" | "SUSPENDED" | "DELETED";
  companyStatus: "DRAFT" | "ACTIVE" | "SUSPENDED" | "CLOSED";
  currentVerifiedEvidenceCount: number;
  talentRadarAccess: boolean;
}>;

export type RadarListCandidateRecord = Readonly<{
  candidateProfileId: string;
  eligibility: RadarCandidateEligibilityInput;
  salaryPeriod: "YEARLY" | "MONTHLY" | "HOURLY" | null;
  radar: Readonly<{
    cantonBucket: string;
    categoryBucket: string;
    workloadMin: number | null;
    workloadMax: number | null;
    salaryYearlyMinChf: number | null;
    salaryYearlyMaxChf: number | null;
    languageCodes: readonly string[];
    skillSlugs: readonly string[];
    remotePreference: "ONSITE" | "HYBRID" | "REMOTE" | "ANY" | null;
    availabilityBucket: string | null;
  }> | null;
  activeCategorySlugs: readonly string[];
  skills: readonly Readonly<{
    skillId: string;
    slug: string;
    active: boolean;
  }>[];
  languages: readonly Readonly<{
    code: string;
    level: "A1" | "A2" | "B1" | "B2" | "C1" | "C2" | "NATIVE";
  }>[];
}>;

export type RadarSearchSessionSnapshot = Readonly<{
  id: string;
  companyId: string;
  membershipId: string;
  requestingUserId: string;
  filterHash: string;
  calendarDate: string;
  policyVersion: "v1";
  expiresAt: Date;
  candidateProfileIds: readonly string[];
}>;

export interface RadarCandidateListRepository {
  getEmployerAccess(input: Readonly<{
    actorUserId: string;
    companyId: string;
    now: Date;
  }>): Promise<RadarEmployerAccessSnapshot | null>;
  findSearchSession(input: Readonly<{
    companyId: string;
    membershipId: string;
    requestingUserId: string;
    filterHash: string;
    calendarDate: string;
    policyVersion: "v1";
  }>): Promise<RadarSearchSessionSnapshot | null>;
  listCandidates(input: Readonly<{
    filters: NormalizedRadarFiltersV1;
    now: Date;
    environment: RadarEligibilityEnvironment;
    afterCandidateProfileId: string | null;
    limit: number;
  }>): Promise<readonly RadarListCandidateRecord[]>;
  persistSearchSession(input: Readonly<{
    companyId: string;
    membershipId: string;
    requestingUserId: string;
    filterHash: string;
    calendarDate: string;
    policyVersion: "v1";
    normalizedFilters: NormalizedRadarFiltersV1;
    resultCount: number;
    expiresAt: Date;
    candidateProfileIds: readonly string[];
  }>): Promise<RadarSearchSessionSnapshot>;
  getOrCreateOpaqueId(input: Readonly<{
    companyId: string;
    candidateProfileId: string;
    now: Date;
    lookupKeyring: readonly RadarOpaqueKey[];
    encryptionKeyring: readonly RadarOpaqueKey[];
  }>): Promise<string>;
}

export interface RadarMembershipListRateLimit {
  consume(input: Readonly<{
    membershipId: string;
    now: Date;
  }>): Promise<
    | Readonly<{ allowed: true }>
    | Readonly<{ allowed: false; retryAfterSeconds: number }>
  >;
}

export type RadarListCandidatesInput = Readonly<{
  actorUserId: string;
  companyId: string;
  filters: unknown;
  cursor?: string | null;
  now: Date;
  environment: RadarEligibilityEnvironment;
}>;

export type RadarListCandidatesResult =
  | Readonly<{
      status: "LOCKED";
      reason:
        | "NO_ACTIVE_MEMBERSHIP"
        | "USER_INACTIVE"
        | "COMPANY_INACTIVE"
        | "COMPANY_UNVERIFIED"
        | "TALENT_RADAR_NOT_INCLUDED";
      suggestedPlanSlug?: "pro";
    }>
  | Readonly<{ status: "INVALID_FILTER" }>
  | Readonly<{ status: "INVALID_CURSOR" }>
  | Readonly<{
      status: "LIMIT";
      limit: "MEMBERSHIP_RATE" | "DISTINCT_FILTERS";
      retryAfterSeconds: number;
    }>
  | Readonly<{ status: "INSUFFICIENT_COHORT" }>
  | Readonly<{
      status: "AVAILABLE";
      countLabel: RadarCohortCountLabelV1;
      candidates: readonly AnonymousCandidateDto[];
      nextCursor: string | null;
      searchSessionId: string;
      searchSessionExpiresAt: Date;
      filterHash: string;
    }>;

export type RadarListCandidatesDependencies = Readonly<{
  repository: RadarCandidateListRepository;
  membershipRateLimit: RadarMembershipListRateLimit;
  distinctFilterBudget: RadarDistinctFilterBudget;
  samplingKey: RadarPrivacyHmacKeyV1;
  cursorKeyring: readonly RadarPrivacyHmacKeyV1[];
  opaqueLookupKeyring: readonly RadarOpaqueKey[];
  opaqueEncryptionKeyring: readonly RadarOpaqueKey[];
}>;

/**
 * Produces one privacy-bounded page. Authorization, both enumeration limits,
 * cursor scope and member-scoped session ownership are resolved before the
 * repository is permitted to issue its CandidateProfile query.
 */
export async function listRadarCandidates(
  input: RadarListCandidatesInput,
  dependencies: RadarListCandidatesDependencies,
): Promise<RadarListCandidatesResult> {
  if (!isValidDate(input.now)) return Object.freeze({ status: "INVALID_FILTER" });

  let normalized: ReturnType<typeof normalizeRadarFiltersV1>;
  try {
    normalized = normalizeRadarFiltersV1(input.filters);
  } catch {
    return Object.freeze({ status: "INVALID_FILTER" });
  }

  if (!UUID.safeParse(input.actorUserId).success || !UUID.safeParse(input.companyId).success) {
    return locked("NO_ACTIVE_MEMBERSHIP");
  }

  const access = await dependencies.repository.getEmployerAccess({
    actorUserId: input.actorUserId,
    companyId: input.companyId,
    now: input.now,
  });
  const lock = employerLockReason(access, input);
  if (lock !== null) return lock;
  if (access === null) return locked("NO_ACTIVE_MEMBERSHIP");

  const membershipLimit = await dependencies.membershipRateLimit.consume({
    membershipId: access.membershipId,
    now: input.now,
  });
  if (!membershipLimit.allowed) {
    return Object.freeze({
      status: "LIMIT",
      limit: "MEMBERSHIP_RATE",
      retryAfterSeconds: safeRetryAfter(membershipLimit.retryAfterSeconds),
    });
  }

  const distinctBudget = await dependencies.distinctFilterBudget.consume({
    companyId: input.companyId,
    filterHash: normalized.filterHash,
    now: input.now,
  });
  if (!distinctBudget.allowed) return distinctFilterLimit(distinctBudget);

  const calendarDate = getRadarZurichCalendarDateV1(input.now);
  const dailySampleId = selectRadarDailySampleV1({
    companyId: input.companyId,
    filterHash: normalized.filterHash,
    calendarDate,
    candidateProfileIds: [],
  }, dependencies.samplingKey).sampleId;
  const sessionScope = {
    companyId: input.companyId,
    membershipId: access.membershipId,
    requestingUserId: input.actorUserId,
    filterHash: normalized.filterHash,
    calendarDate,
    policyVersion: RADAR_PRIVACY_POLICY_V1.version,
  } as const;
  const existingSession = await dependencies.repository.findSearchSession(sessionScope);

  let position: 0 | 10 = 0;
  if (input.cursor !== undefined && input.cursor !== null) {
    if (input.cursor.length === 0) return Object.freeze({ status: "INVALID_CURSOR" });
    const payload = verifyRadarCursorV1(input.cursor, {
      companyId: input.companyId,
      filterHash: normalized.filterHash,
      dailySampleId,
      now: input.now,
    }, dependencies.cursorKeyring);
    if (
      payload === null ||
      existingSession === null ||
      !isCurrentScopedSession(existingSession, sessionScope, input.now) ||
      !isValidSessionSample(existingSession.candidateProfileIds)
    ) {
      return Object.freeze({ status: "INVALID_CURSOR" });
    }
    position = payload.position;
  }

  const scanned = await scanRadarCandidateCohort({
    repository: dependencies.repository,
    filters: normalized.filters,
    now: input.now,
    environment: input.environment,
    companyId: input.companyId,
    filterHash: normalized.filterHash,
    calendarDate,
    samplingKey: dependencies.samplingKey,
    retainedCandidateProfileIds: existingSession?.candidateProfileIds ?? [],
  });
  const cohort = gateRadarCohortV1(scanned.eligibleCount);
  if (cohort.status === "INSUFFICIENT_COHORT") return cohort;

  const desiredSample = existingSession === null
    ? scanned.computedSampleCandidateProfileIds
    : requireValidSessionSample(existingSession.candidateProfileIds);
  const expiresAt = new Date(
    input.now.getTime() + RADAR_PRIVACY_POLICY_V1.cursor.ttlMilliseconds,
  );
  const persistedSession = await dependencies.repository.persistSearchSession({
    ...sessionScope,
    normalizedFilters: normalized.filters,
    resultCount: scanned.eligibleCount,
    expiresAt,
    candidateProfileIds: desiredSample,
  });
  if (!isCurrentScopedSession(persistedSession, sessionScope, input.now)) {
    throw new Error("Radar repository returned an invalid scoped search session.");
  }
  const persistedSample = requireValidSessionSample(
    persistedSession.candidateProfileIds,
  );
  const page = pageRadarDailySampleV1(persistedSample, position);
  const pageRows = page.candidateProfileIds.flatMap((candidateProfileId) => {
    const candidate = scanned.retainedCandidates.get(candidateProfileId);
    return candidate === undefined ? [] : [candidate];
  });
  const candidates = await Promise.all(pageRows.map(async (candidate) => {
    const opaqueId = await dependencies.repository.getOrCreateOpaqueId({
      companyId: input.companyId,
      candidateProfileId: candidate.candidateProfileId,
      now: input.now,
      lookupKeyring: dependencies.opaqueLookupKeyring,
      encryptionKeyring: dependencies.opaqueEncryptionKeyring,
    });
    const dto = toSafeRadarCard(candidate, normalized.filters, opaqueId);
    if (dto === null) {
      throw new Error("An eligible Radar candidate could not be mapped to a Safe DTO.");
    }
    return dto;
  }));

  const nextCursor = page.nextPosition === null
    ? null
    : signRadarCursorV1({
        companyId: input.companyId,
        filterHash: normalized.filterHash,
        dailySampleId,
        now: input.now,
      }, requireWriterKey(dependencies.cursorKeyring));

  return Object.freeze({
    status: "AVAILABLE",
    countLabel: cohort.countLabel,
    candidates: Object.freeze(candidates),
    nextCursor,
    searchSessionId: persistedSession.id,
    searchSessionExpiresAt: new Date(persistedSession.expiresAt),
    filterHash: normalized.filterHash,
  });
}

function employerLockReason(
  access: RadarEmployerAccessSnapshot | null,
  input: Pick<RadarListCandidatesInput, "actorUserId" | "companyId">,
): Extract<RadarListCandidatesResult, { status: "LOCKED" }> | null {
  if (
    access === null ||
    access.membershipUserId !== input.actorUserId ||
    access.companyId !== input.companyId ||
    access.membershipStatus !== "ACTIVE" ||
    !ALLOWED_EMPLOYER_ROLES.has(access.membershipRole)
  ) return locked("NO_ACTIVE_MEMBERSHIP");
  if (access.userStatus !== "ACTIVE") return locked("USER_INACTIVE");
  if (access.companyStatus !== "ACTIVE") return locked("COMPANY_INACTIVE");
  if (access.currentVerifiedEvidenceCount !== 1) return locked("COMPANY_UNVERIFIED");
  if (!access.talentRadarAccess) {
    return Object.freeze({
      status: "LOCKED",
      reason: "TALENT_RADAR_NOT_INCLUDED",
      suggestedPlanSlug: "pro",
    });
  }
  return null;
}

function locked(
  reason: Extract<RadarListCandidatesResult, { status: "LOCKED" }>["reason"],
): Extract<RadarListCandidatesResult, { status: "LOCKED" }> {
  return Object.freeze({ status: "LOCKED", reason });
}

function distinctFilterLimit(
  decision: Extract<RadarDistinctFilterBudgetDecision, { allowed: false }>,
): Extract<RadarListCandidatesResult, { status: "LIMIT" }> {
  return Object.freeze({
    status: "LIMIT",
    limit: "DISTINCT_FILTERS",
    retryAfterSeconds: safeRetryAfter(decision.retryAfterSeconds),
  });
}

function safeRetryAfter(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

async function scanRadarCandidateCohort(input: Readonly<{
  repository: RadarCandidateListRepository;
  filters: NormalizedRadarFiltersV1;
  now: Date;
  environment: RadarEligibilityEnvironment;
  companyId: string;
  filterHash: string;
  calendarDate: string;
  samplingKey: RadarPrivacyHmacKeyV1;
  retainedCandidateProfileIds: readonly string[];
}>): Promise<Readonly<{
  eligibleCount: number;
  computedSampleCandidateProfileIds: readonly string[];
  retainedCandidates: ReadonlyMap<string, RadarListCandidateRecord>;
}>> {
  const retainedSessionIds = new Set(input.retainedCandidateProfileIds);
  const retainedCandidates = new Map<string, RadarListCandidateRecord>();
  let computedSampleCandidateProfileIds: readonly string[] = Object.freeze([]);
  let eligibleCount = 0;
  let afterCandidateProfileId: string | null = null;

  for (;;) {
    const rows = await input.repository.listCandidates({
      filters: input.filters,
      now: input.now,
      environment: input.environment,
      afterCandidateProfileId,
      limit: RADAR_SCAN_BATCH_SIZE,
    });
    if (rows.length > RADAR_SCAN_BATCH_SIZE) {
      throw new Error("Radar repository exceeded the bounded scan batch size.");
    }
    const orderedRows = [...rows].sort((left, right) =>
      left.candidateProfileId.localeCompare(right.candidateProfileId));
    assertStrictRadarBatchOrder(orderedRows, afterCandidateProfileId);
    const eligible = distinctEligibleCandidates(
      orderedRows,
      input.filters,
      input.now,
      input.environment,
    );
    eligibleCount += eligible.length;
    const sample = selectRadarDailySampleV1({
      companyId: input.companyId,
      filterHash: input.filterHash,
      calendarDate: input.calendarDate,
      candidateProfileIds: [
        ...computedSampleCandidateProfileIds,
        ...eligible.map(({ candidateProfileId }) => candidateProfileId),
      ],
    }, input.samplingKey);
    computedSampleCandidateProfileIds = sample.candidateProfileIds;
    const retainedIds = new Set([
      ...retainedSessionIds,
      ...computedSampleCandidateProfileIds,
    ]);
    for (const candidate of eligible) {
      if (retainedIds.has(candidate.candidateProfileId)) {
        retainedCandidates.set(candidate.candidateProfileId, candidate);
      }
    }
    for (const candidateProfileId of retainedCandidates.keys()) {
      if (!retainedIds.has(candidateProfileId)) {
        retainedCandidates.delete(candidateProfileId);
      }
    }
    if (rows.length < RADAR_SCAN_BATCH_SIZE) break;
    afterCandidateProfileId =
      orderedRows[orderedRows.length - 1]!.candidateProfileId;
  }

  return Object.freeze({
    eligibleCount,
    computedSampleCandidateProfileIds,
    retainedCandidates,
  });
}

function assertStrictRadarBatchOrder(
  rows: readonly RadarListCandidateRecord[],
  afterCandidateProfileId: string | null,
): void {
  let previous = afterCandidateProfileId;
  for (const row of rows) {
    if (
      !UUID.safeParse(row.candidateProfileId).success ||
      (previous !== null && row.candidateProfileId.localeCompare(previous) <= 0)
    ) {
      throw new Error("Radar repository returned an invalid candidate scan page.");
    }
    previous = row.candidateProfileId;
  }
}

function distinctEligibleCandidates(
  rows: readonly RadarListCandidateRecord[],
  filters: NormalizedRadarFiltersV1,
  now: Date,
  environment: RadarEligibilityEnvironment,
): readonly RadarListCandidateRecord[] {
  const distinct = new Map<string, RadarListCandidateRecord>();
  for (const row of rows) {
    if (
      UUID.safeParse(row.candidateProfileId).success &&
      !distinct.has(row.candidateProfileId) &&
      isRadarCandidateEligible(row.eligibility, now, environment) &&
      hasSafeRadarProjection(row) &&
      matchesAllFilters(row, filters)
    ) {
      distinct.set(row.candidateProfileId, row);
    }
  }
  return Object.freeze([...distinct.values()]);
}

function hasSafeRadarProjection(row: RadarListCandidateRecord): boolean {
  const radar = row.radar;
  if (
    radar === null ||
    !CANTON_CODES.has(radar.cantonBucket) ||
    !SAFE_SLUG.test(radar.categoryBucket) ||
    !row.activeCategorySlugs.includes(radar.categoryBucket)
  ) return false;
  return true;
}

function matchesAllFilters(
  row: RadarListCandidateRecord,
  filters: NormalizedRadarFiltersV1,
): boolean {
  const radar = row.radar;
  if (radar === null) return false;
  if (
    filters.skillId !== null &&
    !row.skills.some((skill) =>
      skill.active &&
      skill.skillId === filters.skillId &&
      SAFE_SLUG.test(skill.slug) &&
      radar.skillSlugs.includes(skill.slug))
  ) return false;
  if (filters.cantonCode !== null && radar.cantonBucket !== filters.cantonCode) {
    return false;
  }
  if (
    filters.salaryBudgetCeilingChf !== null &&
    (row.salaryPeriod !== "YEARLY" ||
      radar.salaryYearlyMinChf === null ||
      !Number.isSafeInteger(radar.salaryYearlyMinChf) ||
      radar.salaryYearlyMinChf < 0 ||
      radar.salaryYearlyMinChf > filters.salaryBudgetCeilingChf)
  ) return false;
  if (
    filters.workloadMinimumPercent !== null &&
    (radar.workloadMax === null ||
      !Number.isSafeInteger(radar.workloadMax) ||
      radar.workloadMax < filters.workloadMinimumPercent ||
      workloadBucket(radar.workloadMin, radar.workloadMax) === null)
  ) return false;
  if (
    filters.languageCode !== null &&
    filters.languageMinimumLevel !== null &&
    !row.languages.some((language) =>
      language.code.trim().toLowerCase() === filters.languageCode &&
      radar.languageCodes.includes(filters.languageCode!) &&
      radarLanguageMeetsMinimumV1(language.level, filters.languageMinimumLevel!))
  ) return false;
  if (
    filters.remotePreference !== null &&
    radar.remotePreference !== filters.remotePreference
  ) return false;
  return true;
}

function toSafeRadarCard(
  row: RadarListCandidateRecord,
  filters: NormalizedRadarFiltersV1,
  opaqueId: string,
): AnonymousCandidateDto | null {
  const radar = row.radar;
  if (radar === null) return null;
  const selectedSkills = filters.skillId === null
    ? []
    : row.skills
        .filter(({ skillId, active }) => skillId === filters.skillId && active)
        .map(({ slug }) => slug)
        .filter((slug) => radar.skillSlugs.includes(slug));
  const selectedLanguages = filters.languageCode === null
    ? []
    : radar.languageCodes.filter((code) => code === filters.languageCode);
  return toAnonymousCandidate({
    opaqueId,
    cantonBucket: radar.cantonBucket,
    categoryBucket: radar.categoryBucket,
    skillSlugs: selectedSkills,
    workloadBucket: workloadBucket(radar.workloadMin, radar.workloadMax),
    salaryBucket: salaryBucket(
      row.salaryPeriod === "YEARLY" ? radar.salaryYearlyMinChf : null,
    ),
    salaryPeriod:
      row.salaryPeriod === "YEARLY" && radar.salaryYearlyMinChf !== null
        ? "YEARLY"
        : null,
    languageCodes: selectedLanguages,
    remotePreference: radar.remotePreference,
    availabilityBucket: null,
    radarConsentGranted: true,
    policy: {
      exposeSkills: filters.skillId !== null,
      exposeWorkload: filters.workloadMinimumPercent !== null,
      exposeSalary: filters.salaryBudgetCeilingChf !== null,
      exposeLanguages: filters.languageCode !== null,
      exposeRemotePreference: filters.remotePreference !== null,
      exposeAvailability: false,
      allowedCategoryBuckets: [radar.categoryBucket],
      allowedSkillSlugs: selectedSkills,
      allowedLanguageCodes: selectedLanguages,
    },
  });
}

function workloadBucket(minimum: number | null, maximum: number | null): string | null {
  if (
    minimum === null || maximum === null ||
    !Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) ||
    minimum < 0 || maximum > 100 || minimum > maximum
  ) return null;
  const midpoint = (minimum + maximum) / 2;
  return String([20, 40, 60, 80, 100].reduce((closest, bucket) =>
    Math.abs(bucket - midpoint) < Math.abs(closest - midpoint) ? bucket : closest));
}

function salaryBucket(minimum: number | null): string | null {
  if (minimum === null || !Number.isSafeInteger(minimum) || minimum < 0) return null;
  const bounded = Math.min(250_000, Math.max(40_000, Math.floor(minimum / 10_000) * 10_000));
  return `CHF_${bounded}`;
}

function isCurrentScopedSession(
  session: RadarSearchSessionSnapshot,
  scope: Omit<Parameters<RadarCandidateListRepository["findSearchSession"]>[0], never>,
  now: Date,
): boolean {
  return (
    session.companyId === scope.companyId &&
    session.membershipId === scope.membershipId &&
    session.requestingUserId === scope.requestingUserId &&
    session.filterHash === scope.filterHash &&
    session.calendarDate === scope.calendarDate &&
    session.policyVersion === scope.policyVersion &&
    isValidDate(session.expiresAt) &&
    session.expiresAt.getTime() > now.getTime()
  );
}

function isValidSessionSample(candidateProfileIds: readonly string[]): boolean {
  return (
    Array.isArray(candidateProfileIds) &&
    candidateProfileIds.length <= RADAR_PRIVACY_POLICY_V1.discovery.maximumSampleSize &&
    new Set(candidateProfileIds).size === candidateProfileIds.length &&
    candidateProfileIds.every((candidateProfileId) => UUID.safeParse(candidateProfileId).success)
  );
}

function requireValidSessionSample(
  candidateProfileIds: readonly string[],
): readonly string[] {
  if (!isValidSessionSample(candidateProfileIds)) {
    throw new Error("Radar search session contains an invalid bounded sample.");
  }
  return Object.freeze([...candidateProfileIds]);
}

function requireWriterKey(
  keyring: readonly RadarPrivacyHmacKeyV1[],
): RadarPrivacyHmacKeyV1 {
  const writer = keyring[0];
  if (writer === undefined) throw new TypeError("Radar cursor keyring requires a writer.");
  return writer;
}

function isValidDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/**
 * Production PostgreSQL adapter. Its CandidateProfile projection is an
 * explicit allowlist and contains no name, email, phone, address, document,
 * storage-key or other identity-bearing field.
 */
export function createPrismaRadarCandidateListRepository(
  database: DatabaseClient,
): RadarCandidateListRepository {
  const repository: RadarCandidateListRepository = {
    async getEmployerAccess(input) {
      const membership = await database.companyMembership.findUnique({
        where: {
          companyId_userId: {
            companyId: input.companyId,
            userId: input.actorUserId,
          },
        },
        select: {
          id: true,
          userId: true,
          companyId: true,
          role: true,
          status: true,
          user: { select: { status: true } },
          company: {
            select: {
              status: true,
              verificationRequests: {
                where: { status: "VERIFIED", supersededBy: null },
                take: 2,
                select: { id: true },
              },
            },
          },
        },
      });
      if (membership === null) return null;
      const entitlements = await getEffectiveEntitlements(
        membership.companyId,
        input.now,
        createPrismaEntitlementRepository(database),
      );
      return Object.freeze({
        membershipId: membership.id,
        membershipUserId: membership.userId,
        companyId: membership.companyId,
        membershipStatus: membership.status,
        membershipRole: membership.role,
        userStatus: membership.user.status,
        companyStatus: membership.company.status,
        currentVerifiedEvidenceCount:
          membership.company.verificationRequests.length,
        talentRadarAccess:
          entitlements.ok && entitlements.value.rights.TALENT_RADAR_ACCESS,
      });
    },

    async findSearchSession(input) {
      const session = await database.radarSearchSession.findUnique({
        where: {
          companyId_membershipId_filterHash_calendarDate_policyVersion: {
            companyId: input.companyId,
            membershipId: input.membershipId,
            filterHash: input.filterHash,
            calendarDate: calendarDateToDatabase(input.calendarDate),
            policyVersion: input.policyVersion,
          },
        },
        select: {
          id: true,
          companyId: true,
          membershipId: true,
          requestingUserId: true,
          filterHash: true,
          calendarDate: true,
          policyVersion: true,
          expiresAt: true,
          candidates: {
            orderBy: { position: "asc" },
            select: { candidateProfileId: true },
          },
        },
      });
      return session === null ? null : toSessionSnapshot(session);
    },

    async listCandidates(input) {
      const rows = await database.candidateProfile.findMany({
        where: buildPrismaRadarCandidateWhere(input.filters, input.now, input.environment),
        orderBy: { id: "asc" },
        take: input.limit,
        ...(input.afterCandidateProfileId === null
          ? {}
          : {
              cursor: { id: input.afterCandidateProfileId },
              skip: 1,
            }),
        select: buildPrismaRadarCandidateSelect(input.now),
      });
      return Object.freeze(rows.map(toRadarListCandidateRecord));
    },

    async persistSearchSession(input) {
      return database.$transaction(async (transaction) => {
        const calendarDate = calendarDateToDatabase(input.calendarDate);
        const session = await transaction.radarSearchSession.upsert({
          where: {
            companyId_membershipId_filterHash_calendarDate_policyVersion: {
              companyId: input.companyId,
              membershipId: input.membershipId,
              filterHash: input.filterHash,
              calendarDate,
              policyVersion: input.policyVersion,
            },
          },
          create: {
            companyId: input.companyId,
            membershipId: input.membershipId,
            requestingUserId: input.requestingUserId,
            filterHash: input.filterHash,
            calendarDate,
            policyVersion: input.policyVersion,
            normalizedFilters: input.normalizedFilters as Prisma.InputJsonValue,
            resultCount: input.resultCount,
            expiresAt: input.expiresAt,
          },
          update: {
            normalizedFilters: input.normalizedFilters as Prisma.InputJsonValue,
            resultCount: input.resultCount,
            expiresAt: input.expiresAt,
          },
          select: { id: true },
        });
        await transaction.radarSearchSessionCandidate.createMany({
          data: input.candidateProfileIds.map((candidateProfileId, position) => ({
            radarSearchSessionId: session.id,
            candidateProfileId,
            position,
          })),
          skipDuplicates: true,
        });
        const persisted = await transaction.radarSearchSession.findUniqueOrThrow({
          where: { id: session.id },
          select: {
            id: true,
            companyId: true,
            membershipId: true,
            requestingUserId: true,
            filterHash: true,
            calendarDate: true,
            policyVersion: true,
            expiresAt: true,
            candidates: {
              orderBy: { position: "asc" },
              select: { candidateProfileId: true },
            },
          },
        });
        return toSessionSnapshot(persisted);
      });
    },

    async getOrCreateOpaqueId(input) {
      const epoch = getRadarOpaqueEpoch(input.now);
      return database.$transaction(async (transaction) => {
        await transaction.$queryRawUnsafe(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS "locked"',
          `v1:radar-opaque:${input.companyId}:${input.candidateProfileId}:${epoch.epoch.toISOString()}`,
        );
        const existing = await transaction.radarOpaqueMapping.findUnique({
          where: {
            candidateProfileId_companyId_epoch: {
              candidateProfileId: input.candidateProfileId,
              companyId: input.companyId,
              epoch: epoch.epoch,
            },
          },
          select: opaqueMappingSelect,
        });
        if (existing !== null && isCurrentRadarOpaqueMapping(
          existing,
          input.companyId,
          input.now,
        )) {
          return decryptMapping(existing, input.lookupKeyring, input.encryptionKeyring);
        }

        if (existing !== null && existing.revokedAt === null) {
          throw new Error("Radar opaque mapping is not current and cannot be reused.");
        }
        const issued = existing === null
          ? mintRadarOpaqueIdForAuthorizedDto({
              candidateProfileId: input.candidateProfileId,
              companyId: input.companyId,
              now: input.now,
              lookupKeyring: input.lookupKeyring,
              encryptionKeyring: input.encryptionKeyring,
            })
          : remintRadarOpaqueIdAfterReoptIn({
              previous: existing,
              now: input.now,
              lookupKeyring: input.lookupKeyring,
              encryptionKeyring: input.encryptionKeyring,
            });
        await transaction.radarOpaqueMapping.upsert({
          where: {
            candidateProfileId_companyId_epoch: {
              candidateProfileId: input.candidateProfileId,
              companyId: input.companyId,
              epoch: epoch.epoch,
            },
          },
          create: opaqueMappingCreate(issued.mapping),
          update: opaqueMappingUpdate(issued.mapping),
        });
        return issued.opaqueId;
      });
    },
  };
  return Object.freeze(repository);
}

function buildPrismaRadarCandidateWhere(
  filters: NormalizedRadarFiltersV1,
  now: Date,
  environment: RadarEligibilityEnvironment,
): Prisma.CandidateProfileWhereInput {
  const predicates: Prisma.CandidateProfileWhereInput[] = [
    buildRadarCandidateEligibilityPrefilter(now, environment),
  ];
  const radar: Prisma.RadarProfileWhereInput = {};
  if (filters.cantonCode !== null) radar.cantonBucket = filters.cantonCode;
  if (filters.salaryBudgetCeilingChf !== null) {
    radar.salaryYearlyMinChf = { not: null, lte: filters.salaryBudgetCeilingChf };
    predicates.push({ preference: { is: { salaryPeriod: "YEARLY" } } });
  }
  if (filters.workloadMinimumPercent !== null) {
    radar.workloadMax = { gte: filters.workloadMinimumPercent };
  }
  if (filters.remotePreference !== null) {
    radar.remotePreference = filters.remotePreference;
  }
  if (Object.keys(radar).length > 0) predicates.push({ radarProfile: { is: radar } });
  if (filters.skillId !== null) {
    predicates.push({
      skills: { some: { skillId: filters.skillId, skill: { isActive: true } } },
    });
  }
  if (filters.languageCode !== null && filters.languageMinimumLevel !== null) {
    predicates.push({
      languages: {
        some: {
          code: filters.languageCode,
          level: { in: [...languageLevelsAtLeast(filters.languageMinimumLevel)] },
        },
      },
    });
  }
  return { AND: predicates };
}

export function buildPrismaRadarCandidateSelect(now: Date) {
  return {
    ...buildRadarCandidateEligibilitySelect(now),
    radarProfile: {
      select: {
        cantonBucket: true,
        categoryBucket: true,
        workloadMin: true,
        workloadMax: true,
        salaryYearlyMinChf: true,
        salaryYearlyMaxChf: true,
        languageCodes: true,
        skillSlugs: true,
        remotePreference: true,
        availabilityBucket: true,
        publishedAt: true,
        withdrawnAt: true,
      },
    },
    preference: {
      select: {
        salaryPeriod: true,
        categories: {
          where: { category: { isActive: true } },
          select: { category: { select: { slug: true } } },
        },
      },
    },
    skills: {
      select: {
        skillId: true,
        skill: { select: { slug: true, isActive: true } },
      },
    },
    languages: { select: { code: true, level: true } },
  } as const satisfies Prisma.CandidateProfileSelect;
}

type PrismaRadarCandidateRow = Prisma.CandidateProfileGetPayload<{
  select: ReturnType<typeof buildPrismaRadarCandidateSelect>;
}>;

function toRadarListCandidateRecord(
  row: PrismaRadarCandidateRow,
): RadarListCandidateRecord {
  return Object.freeze({
    candidateProfileId: row.id,
    eligibility: toRadarCandidateEligibilityInput(row),
    salaryPeriod: row.preference?.salaryPeriod ?? null,
    radar: row.radarProfile === null ? null : Object.freeze({
      cantonBucket: row.radarProfile.cantonBucket,
      categoryBucket: row.radarProfile.categoryBucket,
      workloadMin: row.radarProfile.workloadMin,
      workloadMax: row.radarProfile.workloadMax,
      salaryYearlyMinChf: row.radarProfile.salaryYearlyMinChf,
      salaryYearlyMaxChf: row.radarProfile.salaryYearlyMaxChf,
      languageCodes: Object.freeze([...row.radarProfile.languageCodes]),
      skillSlugs: Object.freeze([...row.radarProfile.skillSlugs]),
      remotePreference: row.radarProfile.remotePreference,
      availabilityBucket: row.radarProfile.availabilityBucket,
    }),
    activeCategorySlugs: Object.freeze(
      row.preference?.categories.map(({ category }) => category.slug) ?? [],
    ),
    skills: Object.freeze(row.skills.map(({ skillId, skill }) => Object.freeze({
      skillId,
      slug: skill.slug,
      active: skill.isActive,
    }))),
    languages: Object.freeze(row.languages.map(({ code, level }) =>
      Object.freeze({ code, level }))),
  });
}

/** Replays the exact filter, target-fit and cohort-floor contract in bounded pages. */
export async function isCurrentRadarContactCohortAuthorized(
  database: DatabaseClient | Prisma.TransactionClient,
  input: Readonly<{
    filters: NormalizedRadarFiltersV1;
    now: Date;
    environment: RadarEligibilityEnvironment;
    candidateProfileId: string;
  }>,
): Promise<boolean> {
  if (!UUID.safeParse(input.candidateProfileId).success) return false;
  const baseWhere = buildPrismaRadarCandidateWhere(
    input.filters,
    input.now,
    input.environment,
  );
  const target = await database.candidateProfile.findMany({
    where: { AND: [baseWhere, { id: input.candidateProfileId }] },
    take: 1,
    select: buildPrismaRadarCandidateSelect(input.now),
  });
  if (distinctEligibleCandidates(
    target.map(toRadarListCandidateRecord),
    input.filters,
    input.now,
    input.environment,
  ).length !== 1) return false;

  let eligibleCount = 0;
  let afterCandidateProfileId: string | null = null;
  while (eligibleCount < RADAR_PRIVACY_POLICY_V1.cohort.minimumSize) {
    const rows: readonly PrismaRadarCandidateRow[] =
      await database.candidateProfile.findMany({
      where: baseWhere,
      orderBy: { id: "asc" },
      take: RADAR_SCAN_BATCH_SIZE,
      ...(afterCandidateProfileId === null
        ? {}
        : { cursor: { id: afterCandidateProfileId }, skip: 1 }),
      select: buildPrismaRadarCandidateSelect(input.now),
    });
    if (rows.length === 0) return false;
    const records = rows.map(toRadarListCandidateRecord);
    assertStrictRadarBatchOrder(records, afterCandidateProfileId);
    eligibleCount += distinctEligibleCandidates(
      records,
      input.filters,
      input.now,
      input.environment,
    ).length;
    if (rows.length < RADAR_SCAN_BATCH_SIZE) break;
    afterCandidateProfileId = rows[rows.length - 1]!.id;
  }
  return eligibleCount >= RADAR_PRIVACY_POLICY_V1.cohort.minimumSize;
}

function languageLevelsAtLeast(
  minimum: RadarLanguageBucketV1,
): readonly ("A1" | "A2" | "B1" | "B2" | "C1" | "C2" | "NATIVE")[] {
  switch (minimum) {
    case "BASIC": return ["A1", "A2", "B1", "B2", "C1", "C2", "NATIVE"];
    case "WORKING": return ["B1", "B2", "C1", "C2", "NATIVE"];
    case "ADVANCED": return ["C1", "C2", "NATIVE"];
  }
}

type PrismaSessionRow = Readonly<{
  id: string;
  companyId: string;
  membershipId: string;
  requestingUserId: string;
  filterHash: string;
  calendarDate: Date;
  policyVersion: string;
  expiresAt: Date;
  candidates: readonly Readonly<{ candidateProfileId: string }>[];
}>;

function toSessionSnapshot(row: PrismaSessionRow): RadarSearchSessionSnapshot {
  if (row.policyVersion !== RADAR_PRIVACY_POLICY_V1.version) {
    throw new Error("Unknown persisted Radar policy version.");
  }
  return Object.freeze({
    id: row.id,
    companyId: row.companyId,
    membershipId: row.membershipId,
    requestingUserId: row.requestingUserId,
    filterHash: row.filterHash,
    calendarDate: row.calendarDate.toISOString().slice(0, 10),
    policyVersion: row.policyVersion,
    expiresAt: new Date(row.expiresAt),
    candidateProfileIds: Object.freeze(
      row.candidates.map(({ candidateProfileId }) => candidateProfileId),
    ),
  });
}

function calendarDateToDatabase(calendarDate: string): Date {
  const date = new Date(`${calendarDate}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(calendarDate) || date.toISOString().slice(0, 10) !== calendarDate) {
    throw new TypeError("Radar calendar date is invalid.");
  }
  return date;
}

const opaqueMappingSelect = {
  id: true,
  candidateProfileId: true,
  companyId: true,
  epoch: true,
  lookupHmac: true,
  encryptedToken: true,
  nonce: true,
  authTag: true,
  lookupKeyVersion: true,
  encryptionKeyVersion: true,
  validFrom: true,
  validTo: true,
  revokedAt: true,
  revocationReason: true,
} as const satisfies Prisma.RadarOpaqueMappingSelect;

function decryptMapping(
  mapping: RadarOpaqueMappingRecord,
  lookupKeyring: readonly RadarOpaqueKey[],
  encryptionKeyring: readonly RadarOpaqueKey[],
): string {
  return decryptRadarOpaqueToken({
    lookupHmac: mapping.lookupHmac,
    encryptedToken: mapping.encryptedToken,
    nonce: mapping.nonce,
    authTag: mapping.authTag,
    lookupKeyVersion: mapping.lookupKeyVersion,
    encryptionKeyVersion: mapping.encryptionKeyVersion,
  }, lookupKeyring, encryptionKeyring, {
    mappingId: mapping.id,
    candidateProfileId: mapping.candidateProfileId,
    companyId: mapping.companyId,
    epoch: mapping.epoch,
  });
}

function opaqueMappingUpdate(mapping: RadarOpaqueMappingRecord) {
  return {
    lookupHmac: mapping.lookupHmac,
    encryptedToken: Uint8Array.from(mapping.encryptedToken),
    nonce: Uint8Array.from(mapping.nonce),
    authTag: Uint8Array.from(mapping.authTag),
    lookupKeyVersion: mapping.lookupKeyVersion,
    encryptionKeyVersion: mapping.encryptionKeyVersion,
    validFrom: mapping.validFrom,
    validTo: mapping.validTo,
    revokedAt: mapping.revokedAt,
    revocationReason: mapping.revocationReason,
  };
}

function opaqueMappingCreate(mapping: RadarOpaqueMappingRecord) {
  return {
    id: mapping.id,
    candidateProfileId: mapping.candidateProfileId,
    companyId: mapping.companyId,
    epoch: mapping.epoch,
    ...opaqueMappingUpdate(mapping),
  };
}
