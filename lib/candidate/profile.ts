import { createHash } from "node:crypto";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import {
  getAnalyticsRetainUntilV1,
  type AnalyticsEventInputV1,
} from "@/lib/analytics/event-contracts";
import { trackAnalyticsEventV1 } from "@/lib/analytics/track";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  decideCandidateOnboardingTransition,
  type CandidateOnboardingStatus,
} from "@/lib/policies/status/candidate-onboarding";
import {
  toAnonymousCandidate,
  type AnonymousCandidateDto,
} from "@/lib/privacy/anonymize-candidate";
import {
  RADAR_CONSENT_NOTICE_V1,
  radarConsentCommandSchema,
} from "@/lib/privacy/radar-consent";
import {
  normalizeSafeFileName,
  storageProvider,
  type StorageProvider,
} from "@/lib/providers/storage";
import {
  CANDIDATE_LANGUAGE_CODE_PATTERN,
  type SwissJobPassInput,
} from "@/lib/validation/candidate";

const DAY_MILLISECONDS = 86_400_000;
const PROFILE_TRANSACTION_TIMEOUT_MILLISECONDS = 15_000;
const PREVIEW_OPAQUE_ID = Buffer.alloc(16, 42).toString("base64url");

export const CANDIDATE_ONBOARDING_RULE_V1 = Object.freeze({
  version: "candidate-onboarding-v1",
  required: Object.freeze([
    "FIRST_NAME",
    "LAST_NAME",
    "CANTON",
    "TITLE_OR_CATEGORY",
    "SKILL",
    "LANGUAGE",
    "WORKLOAD_RANGE",
    "REMOTE_PREFERENCE",
    "JOB_TYPE",
  ] as const),
});

export const CANDIDATE_RADAR_PROJECTION_V1 = Object.freeze({
  version: "candidate-radar-v1",
});

export const TALENT_RADAR_VISIBILITY_NOTICE_V1 = Object.freeze({
  ...RADAR_CONSENT_NOTICE_V1,
});

export type CandidateRequirementCode =
  (typeof CANDIDATE_ONBOARDING_RULE_V1.required)[number];

export type CandidateProfilePolicyInput = Readonly<{
  firstName: string | null | undefined;
  lastName: string | null | undefined;
  cantonId: string | null | undefined;
  desiredTitles: readonly string[];
  preferredCategoryIds: readonly string[];
  skillIds: readonly string[];
  languages: readonly Readonly<{ code: string; level: string }>[];
  workloadMin: number | null | undefined;
  workloadMax: number | null | undefined;
  remotePreference: string | null | undefined;
  desiredJobTypes: readonly string[];
}>;

export type CandidateOnboardingEvaluation = Readonly<{
  complete: boolean;
  missing: readonly CandidateRequirementCode[];
  ruleVersion: typeof CANDIDATE_ONBOARDING_RULE_V1.version;
}>;

export type CandidateProfileProgress = Readonly<{
  completed: number;
  total: number;
  percentage: number;
}>;

export type CandidateProfileActionState = Readonly<{
  status: "idle" | "success" | "error";
  message: string;
  code?: "PROFILE_CONFLICT";
  fieldErrors?: Readonly<Record<string, readonly string[]>>;
  missingRequirements?: readonly CandidateRequirementCode[];
}>;

export type CandidateProfileWorkspace = Awaited<
  ReturnType<typeof getOwnedCandidateProfileWorkspace>
>;

export class CandidateProfileUnavailableError extends Error {
  constructor() {
    super("The candidate profile is unavailable.");
    this.name = "CandidateProfileUnavailableError";
  }
}

export class CandidateProfileConflictError extends Error {
  constructor() {
    super("The candidate profile changed after the submitted form was loaded.");
    this.name = "CandidateProfileConflictError";
  }
}

export class CandidateProfileReferenceError extends Error {
  readonly field: "cantonId" | "skillIds" | "categoryIds";

  constructor(field: CandidateProfileReferenceError["field"]) {
    super("A candidate profile reference is invalid.");
    this.name = "CandidateProfileReferenceError";
    this.field = field;
  }
}

export function evaluateCandidateOnboarding(
  profile: CandidateProfilePolicyInput,
): CandidateOnboardingEvaluation {
  const missing: CandidateRequirementCode[] = [];
  if (!hasText(profile.firstName)) missing.push("FIRST_NAME");
  if (!hasText(profile.lastName)) missing.push("LAST_NAME");
  if (!hasText(profile.cantonId)) missing.push("CANTON");
  if (
    !profile.desiredTitles.some(hasText) &&
    !profile.preferredCategoryIds.some(hasText)
  ) {
    missing.push("TITLE_OR_CATEGORY");
  }
  if (!profile.skillIds.some(hasText)) missing.push("SKILL");
  if (
    !profile.languages.some(
      ({ code, level }) =>
        CANDIDATE_LANGUAGE_CODE_PATTERN.test(code) && hasText(level),
    )
  ) {
    missing.push("LANGUAGE");
  }
  if (!isValidWorkloadRange(profile.workloadMin, profile.workloadMax)) {
    missing.push("WORKLOAD_RANGE");
  }
  if (!isRemotePreference(profile.remotePreference)) {
    missing.push("REMOTE_PREFERENCE");
  }
  if (!profile.desiredJobTypes.some(hasText)) missing.push("JOB_TYPE");

  return Object.freeze({
    complete: missing.length === 0,
    missing: Object.freeze(missing),
    ruleVersion: CANDIDATE_ONBOARDING_RULE_V1.version,
  });
}

/** Informational only. This value never drives the onboarding state machine. */
export function calculateCandidateProfileProgress(
  input: Readonly<{
    firstName?: string | null;
    lastName?: string | null;
    publicDisplayName?: string | null;
    phone?: string | null;
    cantonId?: string | null;
    cityLabel?: string | null;
    summary?: string | null;
    desiredTitles: readonly string[];
    preferredCategoryIds: readonly string[];
    skillIds: readonly string[];
    languages: readonly unknown[];
    salaryMin?: number | null;
    salaryMax?: number | null;
    salaryPeriod?: string | null;
    workloadMin?: number | null;
    workloadMax?: number | null;
    remotePreference?: string | null;
    mobilityRadiusKm?: number | null;
    availableFrom?: Date | string | null;
    workPermitType?: string | null;
    desiredJobTypes: readonly string[];
    hasActiveCv: boolean;
  }>,
): CandidateProfileProgress {
  const checks = [
    hasText(input.firstName),
    hasText(input.lastName),
    hasText(input.publicDisplayName),
    hasText(input.phone),
    hasText(input.cantonId),
    hasText(input.cityLabel),
    hasText(input.summary),
    input.desiredTitles.length > 0 || input.preferredCategoryIds.length > 0,
    input.skillIds.length > 0,
    input.languages.length > 0,
    input.salaryMin != null &&
      input.salaryMax != null &&
      hasText(input.salaryPeriod),
    isValidWorkloadRange(input.workloadMin, input.workloadMax),
    isRemotePreference(input.remotePreference),
    input.mobilityRadiusKm != null,
    input.availableFrom != null,
    hasText(input.workPermitType),
    input.desiredJobTypes.length > 0,
    input.hasActiveCv,
  ];
  const completed = checks.filter(Boolean).length;
  return Object.freeze({
    completed,
    total: checks.length,
    percentage: Math.round((completed / checks.length) * 100),
  });
}

export function buildAnonymousProfilePreview(
  input: SafeRadarSource,
  now: Date = new Date(),
): AnonymousCandidateDto | null {
  const safe = deriveSafeRadarFields(input, now);
  if (safe === null) return null;
  return toAnonymousCandidate({
    opaqueId: PREVIEW_OPAQUE_ID,
    cantonBucket: safe.cantonBucket,
    categoryBucket: safe.categoryBucket,
    skillSlugs: safe.skillSlugs,
    workloadBucket: safe.workloadBucket,
    salaryBucket: safe.salaryBucket,
    salaryPeriod: input.salaryPeriod,
    languageCodes: safe.languageCodes,
    remotePreference: input.remotePreference,
    availabilityBucket: safe.availabilityBucket,
    // This is the candidate-owned preview, not an employer search result.
    radarConsentGranted: true,
    policy: {
      exposeSkills: true,
      exposeWorkload: true,
      exposeSalary: true,
      exposeLanguages: true,
      exposeRemotePreference: true,
      exposeAvailability: true,
      allowedCategoryBuckets: [safe.categoryBucket],
      allowedSkillSlugs: safe.skillSlugs,
      allowedLanguageCodes: safe.languageCodes,
    },
  });
}

export async function getOwnedCandidateProfileWorkspace(
  database: DatabaseClient,
  actorUserId: string,
  now: Date = new Date(),
) {
  const [profile, cantons, skills, categories] = await Promise.all([
    database.candidateProfile.findFirst({
      where: { userId: actorUserId },
      select: candidateWorkspaceSelect(now),
    }),
    database.canton.findMany({
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, code: true, name: true },
    }),
    database.skill.findMany({
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, slug: true },
    }),
    database.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, slug: true },
    }),
  ]);
  if (profile === null) throw new CandidateProfileUnavailableError();

  const policyInput = toPolicyInput(profile);
  const requirements = evaluateCandidateOnboarding(policyInput);
  const radarConsentGranted = hasCurrentRadarVisibilityConsent(
    profile.radarConsents,
    now,
  );
  const safeSource = toSafeRadarSource(profile);
  const preview = buildAnonymousProfilePreview(safeSource, now);
  const progress = calculateCandidateProfileProgress({
    firstName: profile.firstName,
    lastName: profile.lastName,
    publicDisplayName: profile.publicDisplayName,
    phone: profile.phone,
    cantonId: profile.cantonId,
    cityLabel: profile.cityLabel,
    summary: profile.summary,
    desiredTitles: profile.preference?.desiredTitles ?? [],
    preferredCategoryIds:
      profile.preference?.categories.map(({ categoryId }) => categoryId) ?? [],
    skillIds: profile.skills.map(({ skillId }) => skillId),
    languages: profile.languages,
    salaryMin: profile.preference?.salaryMinChf,
    salaryMax: profile.preference?.salaryMaxChf,
    salaryPeriod: profile.preference?.salaryPeriod,
    workloadMin: profile.preference?.workloadMin,
    workloadMax: profile.preference?.workloadMax,
    remotePreference: profile.preference?.remotePreference,
    mobilityRadiusKm: profile.preference?.mobilityRadiusKm,
    availableFrom: profile.preference?.availableFrom,
    workPermitType: profile.workPermitType,
    desiredJobTypes: profile.preference?.desiredJobTypes ?? [],
    hasActiveCv: profile.documents.length > 0,
  });

  return Object.freeze({
    profile,
    cantons: Object.freeze(cantons),
    skills: Object.freeze(skills),
    categories: Object.freeze(categories),
    requirements,
    progress,
    preview,
    radarConsentGranted,
    radarState: deriveRadarState({
      consentGranted: radarConsentGranted,
      onboardingStatus: profile.onboardingStatus,
      requirementsComplete: requirements.complete,
      publishedAt: profile.radarProfile?.publishedAt ?? null,
      withdrawnAt: profile.radarProfile?.withdrawnAt ?? null,
    }),
  });
}

export async function saveOwnedCandidateProfile(
  database: DatabaseClient,
  command: Readonly<{
    actorUserId: string;
    correlationId: string;
    expectedUpdatedAt: Date;
    now: Date;
    profile: SwissJobPassInput;
  }>,
  storage: StorageProvider = storageProvider,
) {
  if (
    !(command.expectedUpdatedAt instanceof Date) ||
    !Number.isFinite(command.expectedUpdatedAt.getTime())
  ) {
    throw new TypeError("Candidate profile revision is invalid.");
  }

  let uploaded:
    | Readonly<{
        storageKey: string;
        safeFilename: string;
        mimeType: string;
        sizeBytes: number;
      }>
    | undefined;

  if (command.profile.cv !== undefined) {
    const safeFilename = normalizeSafeFileName(command.profile.cv.fileName);
    const stored = await storage.upload({
      fileName: safeFilename,
      mimeType: command.profile.cv.mimeType,
      size: command.profile.cv.sizeBytes,
    });
    uploaded = Object.freeze({
      storageKey: stored.storageKey,
      safeFilename,
      mimeType: command.profile.cv.mimeType,
      sizeBytes: command.profile.cv.sizeBytes,
    });
  }

  try {
    const result = await database.$transaction(async (transaction) => {
      const current = await lockAndLoadOwnedProfile(
        transaction,
        command.actorUserId,
        command.now,
      );
      if (current.updatedAt.getTime() !== command.expectedUpdatedAt.getTime()) {
        throw new CandidateProfileConflictError();
      }
      await assertProfileReferences(transaction, command.profile);
      const previousDocumentKeys = current.documents.map(
        ({ storageKey }) => storageKey,
      );

      await persistProfileDraft(
        transaction,
        current,
        command.profile,
        uploaded,
        command.now,
      );
      const updated = await loadProfileForMutation(
        transaction,
        current.id,
        command.now,
      );
      const requirements = evaluateCandidateOnboarding(toPolicyInput(updated));
      let onboardingStatus: CandidateOnboardingStatus =
        updated.onboardingStatus;
      let reopened = false;

      if (updated.onboardingStatus === "COMPLETE" && !requirements.complete) {
        const decision = decideCandidateOnboardingTransition({
          action: "REOPEN_AFTER_REQUIRED_DATA_REMOVAL",
          actor: "CANDIDATE_OWNER",
          currentStatus: updated.onboardingStatus,
          onboardingRequirementsComplete: false,
        });
        if (decision.type !== "OK") {
          throw new TypeError(
            "Candidate reopen policy rejected a valid command.",
          );
        }
        onboardingStatus = decision.value.nextStatus;
        reopened = true;
        await transaction.candidateProfile.update({
          where: { id: updated.id },
          data: { onboardingStatus },
        });
        await transaction.candidateOnboardingEvent.create({
          data: {
            candidateProfileId: updated.id,
            kind: "REOPENED",
            actorUserId: command.actorUserId,
            reasonCode: "REQUIRED_PROFILE_DATA_REMOVED",
            correlationId: command.correlationId,
            createdAt: command.now,
          },
        });
        await writeCandidateAudit(transaction, {
          action: "CANDIDATE_ONBOARDING_REOPENED",
          actorUserId: command.actorUserId,
          correlationId: command.correlationId,
          capability: "CANDIDATE_ONBOARDING_REOPEN",
          targetId: command.actorUserId,
          targetType: "USER",
          now: command.now,
        });
      }

      const previousConsent = hasCurrentRadarVisibilityConsent(
        updated.radarConsents,
        command.now,
      );
      const consentChanged = previousConsent !== command.profile.radarVisible;
      if (consentChanged) {
        await appendRadarConsent(transaction, {
          actorUserId: command.actorUserId,
          candidateProfileId: updated.id,
          correlationId: command.correlationId,
          granted: command.profile.radarVisible,
          now: command.now,
          actorProvenance: updated.user.dataProvenance,
        });
      }

      const radar = await syncRadarProjection(transaction, {
        current: updated,
        consentGranted: command.profile.radarVisible,
        onboardingStatus,
        requirementsComplete: requirements.complete,
        now: command.now,
      });

      return Object.freeze({
        outcome: "SAVED" as const,
        onboardingStatus,
        reopened,
        consentChanged,
        radarState: radar.state,
        previousDocumentKeys:
          uploaded !== undefined || command.profile.removeCv
            ? Object.freeze(previousDocumentKeys)
            : Object.freeze([] as string[]),
        activeDocumentName:
          uploaded?.safeFilename ?? updated.documents[0]?.safeFilename ?? null,
      });
    }, transactionOptions);

    await Promise.allSettled(
      result.previousDocumentKeys
        .filter((storageKey) => storageKey !== uploaded?.storageKey)
        .map((storageKey) => storage.delete(storageKey)),
    );
    return result;
  } catch (error) {
    if (uploaded !== undefined) {
      await storage.delete(uploaded.storageKey).catch(() => undefined);
    }
    throw error;
  }
}

export async function completeOwnedCandidateOnboarding(
  database: DatabaseClient,
  command: Readonly<{
    actorUserId: string;
    correlationId: string;
    now: Date;
  }>,
) {
  return database.$transaction(async (transaction) => {
    const current = await lockAndLoadOwnedProfile(
      transaction,
      command.actorUserId,
      command.now,
    );
    const requirements = evaluateCandidateOnboarding(toPolicyInput(current));
    if (current.onboardingStatus === "COMPLETE") {
      return Object.freeze({
        outcome: "ALREADY_COMPLETE" as const,
        missing: Object.freeze([] as CandidateRequirementCode[]),
        radarState: deriveRadarState({
          consentGranted: hasCurrentRadarVisibilityConsent(
            current.radarConsents,
            command.now,
          ),
          onboardingStatus: current.onboardingStatus,
          requirementsComplete: requirements.complete,
          publishedAt: current.radarProfile?.publishedAt ?? null,
          withdrawnAt: current.radarProfile?.withdrawnAt ?? null,
        }),
      });
    }

    const decision = decideCandidateOnboardingTransition({
      action: "COMPLETE",
      actor: "CANDIDATE_OWNER",
      currentStatus: current.onboardingStatus,
      onboardingRequirementsComplete: requirements.complete,
    });
    if (decision.type !== "OK") {
      return Object.freeze({
        outcome: "INCOMPLETE" as const,
        missing: requirements.missing,
        radarState: "INCOMPLETE" as const,
      });
    }

    await transaction.candidateProfile.update({
      where: { id: current.id },
      data: {
        onboardingStatus: decision.value.nextStatus,
        updatedAt: nextProfileRevision(current.updatedAt, command.now),
      },
    });
    await transaction.candidateOnboardingEvent.create({
      data: {
        candidateProfileId: current.id,
        kind: "COMPLETED",
        actorUserId: command.actorUserId,
        reasonCode: "REQUIREMENTS_COMPLETE",
        correlationId: command.correlationId,
        createdAt: command.now,
      },
    });
    await writeCandidateAudit(transaction, {
      action: "CANDIDATE_ONBOARDING_COMPLETED",
      actorUserId: command.actorUserId,
      correlationId: command.correlationId,
      capability: "CANDIDATE_ONBOARDING_COMPLETE",
      targetId: command.actorUserId,
      targetType: "USER",
      now: command.now,
    });
    await writeCandidateAnalytics(transaction, {
      event: {
        kind: "CANDIDATE_PROFILE_COMPLETED",
        schemaVersion: "1",
        producerEventId: `candidate-profile-completed:${current.id}`,
        occurredAt: command.now,
        properties: {
          onboardingRuleVersion: CANDIDATE_ONBOARDING_RULE_V1.version,
        },
      },
      actorProvenance: current.user.dataProvenance,
    });

    const radar = await syncRadarProjection(transaction, {
      current,
      consentGranted: hasCurrentRadarVisibilityConsent(
        current.radarConsents,
        command.now,
      ),
      onboardingStatus: "COMPLETE",
      requirementsComplete: true,
      now: command.now,
    });
    return Object.freeze({
      outcome: "COMPLETED" as const,
      missing: Object.freeze([] as CandidateRequirementCode[]),
      radarState: radar.state,
    });
  }, transactionOptions);
}

export async function setOwnedTalentRadarVisibility(
  database: DatabaseClient,
  command: Readonly<{
    actorUserId: string;
    correlationId: string;
    granted: boolean;
    now: Date;
  }>,
) {
  return database.$transaction(async (transaction) => {
    const current = await lockAndLoadOwnedProfile(
      transaction,
      command.actorUserId,
      command.now,
    );
    const previous = hasCurrentRadarVisibilityConsent(
      current.radarConsents,
      command.now,
    );
    const requirements = evaluateCandidateOnboarding(toPolicyInput(current));
    if (previous !== command.granted) {
      await appendRadarConsent(transaction, {
        actorUserId: command.actorUserId,
        actorProvenance: current.user.dataProvenance,
        candidateProfileId: current.id,
        correlationId: command.correlationId,
        granted: command.granted,
        now: command.now,
      });
      await transaction.candidateProfile.update({
        where: { id: current.id },
        data: {
          updatedAt: nextProfileRevision(current.updatedAt, command.now),
        },
      });
    }
    const radar = await syncRadarProjection(transaction, {
      current,
      consentGranted: command.granted,
      onboardingStatus: current.onboardingStatus,
      requirementsComplete: requirements.complete,
      now: command.now,
    });
    return Object.freeze({
      outcome:
        previous === command.granted
          ? ("UNCHANGED" as const)
          : ("CHANGED" as const),
      granted: command.granted,
      radarState: radar.state,
    });
  }, transactionOptions);
}

export function deriveRadarState(
  input: Readonly<{
    consentGranted: boolean;
    onboardingStatus: CandidateOnboardingStatus;
    requirementsComplete: boolean;
    publishedAt: Date | null;
    withdrawnAt: Date | null;
  }>,
): "CURRENT" | "PAUSED" | "OFF" | "INCOMPLETE" {
  if (!input.consentGranted) return "OFF";
  if (input.onboardingStatus !== "COMPLETE" || !input.requirementsComplete) {
    return "INCOMPLETE";
  }
  return input.publishedAt !== null && input.withdrawnAt === null
    ? "CURRENT"
    : "PAUSED";
}

type SafeRadarSource = Readonly<{
  cantonCode: string | null;
  categorySlugs: readonly string[];
  skillSlugs: readonly string[];
  workloadMin: number | null;
  workloadMax: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryPeriod: "YEARLY" | "MONTHLY" | "HOURLY" | null;
  languageCodes: readonly string[];
  remotePreference: "ONSITE" | "HYBRID" | "REMOTE" | "ANY" | null;
  availableFrom: Date | null;
}>;

function candidateWorkspaceSelect(now: Date) {
  return {
    id: true,
    userId: true,
    cantonId: true,
    firstName: true,
    lastName: true,
    publicDisplayName: true,
    phone: true,
    cityLabel: true,
    summary: true,
    workPermitType: true,
    onboardingStatus: true,
    updatedAt: true,
    user: { select: { email: true, dataProvenance: true } },
    canton: { select: { code: true, name: true } },
    preference: {
      select: {
        desiredTitles: true,
        desiredJobTypes: true,
        salaryPeriod: true,
        salaryMinChf: true,
        salaryMaxChf: true,
        workloadMin: true,
        workloadMax: true,
        remotePreference: true,
        mobilityRadiusKm: true,
        availableFrom: true,
        categories: {
          orderBy: { categoryId: "asc" as const },
          select: {
            categoryId: true,
            category: { select: { slug: true, name: true, isActive: true } },
          },
        },
      },
    },
    skills: {
      orderBy: { skillId: "asc" as const },
      select: {
        skillId: true,
        skill: { select: { slug: true, name: true } },
      },
    },
    languages: {
      orderBy: { code: "asc" as const },
      select: { code: true, level: true },
    },
    documents: {
      where: { status: "ACTIVE" as const, purpose: "CV" as const },
      orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
      take: 100,
      select: {
        id: true,
        storageKey: true,
        safeFilename: true,
        mimeType: true,
        sizeBytes: true,
        createdAt: true,
      },
    },
    radarConsents: {
      where: {
        kind: "TALENT_RADAR_VISIBILITY" as const,
        effectiveAt: { lte: now },
      },
      orderBy: [
        { effectiveAt: "desc" as const },
        { createdAt: "desc" as const },
      ],
      take: 1,
      select: {
        id: true,
        granted: true,
        noticeVersion: true,
        noticeHash: true,
        effectiveAt: true,
      },
    },
    radarProfile: {
      select: { id: true, publishedAt: true, withdrawnAt: true },
    },
  } satisfies Prisma.CandidateProfileSelect;
}

type MutationProfile = Prisma.CandidateProfileGetPayload<{
  select: ReturnType<typeof candidateWorkspaceSelect>;
}>;

async function lockAndLoadOwnedProfile(
  transaction: Prisma.TransactionClient,
  actorUserId: string,
  now: Date,
): Promise<MutationProfile> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "CandidateProfile"
    WHERE "userId" = ${actorUserId}::uuid
    FOR UPDATE
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new CandidateProfileUnavailableError();
  return loadProfileForMutation(transaction, id, now);
}

async function loadProfileForMutation(
  transaction: Prisma.TransactionClient,
  candidateProfileId: string,
  now: Date,
): Promise<MutationProfile> {
  const profile = await transaction.candidateProfile.findUnique({
    where: { id: candidateProfileId },
    select: candidateWorkspaceSelect(now),
  });
  if (profile === null) throw new CandidateProfileUnavailableError();
  return profile;
}

async function assertProfileReferences(
  transaction: Prisma.TransactionClient,
  profile: SwissJobPassInput,
) {
  if (profile.cantonId !== undefined) {
    const canton = await transaction.canton.findUnique({
      where: { id: profile.cantonId },
      select: { id: true },
    });
    if (canton === null) throw new CandidateProfileReferenceError("cantonId");
  }
  if (profile.skillIds.length > 0) {
    const count = await transaction.skill.count({
      where: { id: { in: profile.skillIds } },
    });
    if (count !== profile.skillIds.length) {
      throw new CandidateProfileReferenceError("skillIds");
    }
  }
  if (profile.categoryIds.length > 0) {
    const count = await transaction.category.count({
      where: { id: { in: profile.categoryIds }, isActive: true },
    });
    if (count !== profile.categoryIds.length) {
      throw new CandidateProfileReferenceError("categoryIds");
    }
  }
}

async function persistProfileDraft(
  transaction: Prisma.TransactionClient,
  current: MutationProfile,
  profile: SwissJobPassInput,
  uploaded:
    | Readonly<{
        storageKey: string;
        safeFilename: string;
        mimeType: string;
        sizeBytes: number;
      }>
    | undefined,
  now: Date,
) {
  const publicDisplayName =
    profile.publicDisplayName ??
    deriveDefaultDisplayName(profile.firstName, profile.lastName);
  await transaction.candidateProfile.update({
    where: { id: current.id },
    data: {
      firstName: profile.firstName ?? null,
      lastName: profile.lastName ?? null,
      publicDisplayName,
      phone: profile.phone ?? null,
      cantonId: profile.cantonId ?? null,
      cityLabel: profile.cityLabel ?? null,
      summary: profile.summary ?? null,
      workPermitType: profile.workPermitType ?? null,
      updatedAt: nextProfileRevision(current.updatedAt, now),
    },
  });

  const preference = await transaction.candidatePreference.upsert({
    where: { candidateProfileId: current.id },
    create: {
      candidateProfileId: current.id,
      desiredTitles: profile.desiredTitles,
      desiredJobTypes: profile.jobTypes,
      salaryPeriod: profile.desiredSalaryPeriod ?? null,
      salaryMinChf: profile.desiredSalaryMin ?? null,
      salaryMaxChf: profile.desiredSalaryMax ?? null,
      workloadMin: profile.workloadMin ?? null,
      workloadMax: profile.workloadMax ?? null,
      remotePreference: profile.remotePreference ?? null,
      mobilityRadiusKm: profile.mobilityRadiusKm ?? null,
      availableFrom: profile.availabilityDate ?? null,
    },
    update: {
      desiredTitles: profile.desiredTitles,
      desiredJobTypes: profile.jobTypes,
      salaryPeriod: profile.desiredSalaryPeriod ?? null,
      salaryMinChf: profile.desiredSalaryMin ?? null,
      salaryMaxChf: profile.desiredSalaryMax ?? null,
      workloadMin: profile.workloadMin ?? null,
      workloadMax: profile.workloadMax ?? null,
      remotePreference: profile.remotePreference ?? null,
      mobilityRadiusKm: profile.mobilityRadiusKm ?? null,
      availableFrom: profile.availabilityDate ?? null,
    },
    select: { id: true },
  });
  await transaction.candidatePreferenceCategory.deleteMany({
    where: { candidatePreferenceId: preference.id },
  });
  if (profile.categoryIds.length > 0) {
    await transaction.candidatePreferenceCategory.createMany({
      data: profile.categoryIds.map((categoryId) => ({
        candidatePreferenceId: preference.id,
        categoryId,
      })),
    });
  }

  await transaction.candidateSkill.deleteMany({
    where: {
      candidateProfileId: current.id,
      ...(profile.skillIds.length === 0
        ? {}
        : { skillId: { notIn: profile.skillIds } }),
    },
  });
  for (const skillId of profile.skillIds) {
    await transaction.candidateSkill.upsert({
      where: {
        candidateProfileId_skillId: {
          candidateProfileId: current.id,
          skillId,
        },
      },
      update: {},
      create: { candidateProfileId: current.id, skillId },
    });
  }

  await transaction.candidateLanguage.deleteMany({
    where: {
      candidateProfileId: current.id,
      ...(profile.languages.length === 0
        ? {}
        : { code: { notIn: profile.languages.map(({ code }) => code) } }),
    },
  });
  for (const { code, level } of profile.languages) {
    await transaction.candidateLanguage.upsert({
      where: {
        candidateProfileId_code: {
          candidateProfileId: current.id,
          code,
        },
      },
      update: { level },
      create: { candidateProfileId: current.id, code, level },
    });
  }

  if (uploaded !== undefined || profile.removeCv) {
    await transaction.candidateDocumentMetadata.updateMany({
      where: {
        candidateProfileId: current.id,
        purpose: "CV",
        status: "ACTIVE",
      },
      data: { status: "REMOVED", removedAt: now },
    });
  }
  if (uploaded !== undefined) {
    await transaction.candidateDocumentMetadata.create({
      data: {
        candidateProfileId: current.id,
        storageKey: uploaded.storageKey,
        safeFilename: uploaded.safeFilename,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.sizeBytes,
        purpose: "CV",
        status: "ACTIVE",
        createdAt: now,
      },
    });
  }
}

async function appendRadarConsent(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    actorUserId: string;
    actorProvenance: MutationProfile["user"]["dataProvenance"];
    candidateProfileId: string;
    correlationId: string;
    granted: boolean;
    now: Date;
  }>,
) {
  const consent = radarConsentCommandSchema.parse({
    candidateProfileId: input.candidateProfileId,
    actorUserId: input.actorUserId,
    granted: input.granted,
    noticeVersion: TALENT_RADAR_VISIBILITY_NOTICE_V1.noticeVersion,
    noticeHash: TALENT_RADAR_VISIBILITY_NOTICE_V1.hash,
    effectiveAt: input.now,
  });
  const latestRecordedConsent = await transaction.candidateConsent.findFirst({
    where: {
      candidateProfileId: input.candidateProfileId,
      kind: TALENT_RADAR_VISIBILITY_NOTICE_V1.kind,
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const createdAt = nextConsentCreatedAt(
    latestRecordedConsent?.createdAt ?? null,
    input.now,
  );
  await transaction.candidateConsent.create({
    data: {
      ...consent,
      kind: TALENT_RADAR_VISIBILITY_NOTICE_V1.kind,
      createdAt,
    },
  });
  await writeCandidateAudit(transaction, {
    action: "RADAR_CONSENT_CHANGED",
    actorUserId: input.actorUserId,
    correlationId: input.correlationId,
    capability: "CANDIDATE_RADAR_VISIBILITY",
    targetId: input.actorUserId,
    targetType: "USER",
    now: input.now,
  });
  if (input.granted) {
    await writeCandidateAnalytics(transaction, {
      event: {
        kind: "RADAR_OPTED_IN",
        schemaVersion: "1",
        producerEventId: `radar-opted-in:${input.candidateProfileId}:${createdAt.getTime()}`,
        occurredAt: input.now,
        properties: {
          onboardingRuleVersion: CANDIDATE_ONBOARDING_RULE_V1.version,
        },
      },
      actorProvenance: input.actorProvenance,
    });
  }
}

async function syncRadarProjection(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    current: MutationProfile;
    consentGranted: boolean;
    onboardingStatus: CandidateOnboardingStatus;
    requirementsComplete: boolean;
    now: Date;
  }>,
) {
  const source = toSafeRadarSource(input.current);
  const safe = deriveSafeRadarFields(source, input.now);
  const shouldPublish =
    input.consentGranted &&
    input.onboardingStatus === "COMPLETE" &&
    input.requirementsComplete &&
    safe !== null;

  if (safe === null) {
    if (input.current.radarProfile !== null) {
      await transaction.radarProfile.update({
        where: { candidateProfileId: input.current.id },
        data: { withdrawnAt: input.now },
      });
    }
    return Object.freeze({
      state: input.consentGranted ? ("INCOMPLETE" as const) : ("OFF" as const),
    });
  }

  const projection = {
    displayLabel:
      `${humanizeSlug(safe.categoryBucket)} · ${safe.cantonBucket}`.slice(
        0,
        160,
      ),
    cantonBucket: safe.cantonBucket,
    categoryBucket: safe.categoryBucket,
    remotePreference: source.remotePreference,
    availabilityBucket: safe.availabilityBucket,
    workloadMin: source.workloadMin,
    workloadMax: source.workloadMax,
    salaryYearlyMinChf:
      source.salaryPeriod === "YEARLY" ? source.salaryMin : null,
    salaryYearlyMaxChf:
      source.salaryPeriod === "YEARLY" ? source.salaryMax : null,
    languageCodes: [...safe.languageCodes],
    skillSlugs: [...safe.skillSlugs],
    projectionVersion: CANDIDATE_RADAR_PROJECTION_V1.version,
  };
  const projectionHash = createHash("sha256")
    .update(JSON.stringify(projection), "utf8")
    .digest("hex");
  await transaction.radarProfile.upsert({
    where: { candidateProfileId: input.current.id },
    create: {
      candidateProfileId: input.current.id,
      ...projection,
      projectionHash,
      publishedAt: shouldPublish ? input.now : null,
      withdrawnAt: shouldPublish ? null : input.now,
    },
    update: {
      ...projection,
      projectionHash,
      publishedAt: shouldPublish
        ? input.current.radarProfile?.publishedAt === null ||
          input.current.radarProfile?.publishedAt === undefined ||
          input.current.radarProfile.withdrawnAt !== null
          ? input.now
          : input.current.radarProfile.publishedAt
        : undefined,
      withdrawnAt: shouldPublish ? null : input.now,
    },
  });
  return Object.freeze({
    state: shouldPublish
      ? ("CURRENT" as const)
      : input.consentGranted
        ? ("INCOMPLETE" as const)
        : ("OFF" as const),
  });
}

async function writeCandidateAudit(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    action:
      | "CANDIDATE_ONBOARDING_COMPLETED"
      | "CANDIDATE_ONBOARDING_REOPENED"
      | "RADAR_CONSENT_CHANGED";
    actorUserId: string;
    correlationId: string;
    capability: string;
    targetId: string;
    targetType: "USER" | "RADAR_PROFILE";
    now: Date;
  }>,
) {
  await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
    action: input.action,
    actorKind: "USER",
    actorUserId: input.actorUserId,
    capability: input.capability,
    correlationId: input.correlationId,
    metadata: {},
    result: "SUCCEEDED",
    retainUntil: new Date(input.now.getTime() + 400 * DAY_MILLISECONDS),
    targetId: input.targetId,
    targetType: input.targetType,
  });
}

async function writeCandidateAnalytics(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    event: AnalyticsEventInputV1;
    actorProvenance: MutationProfile["user"]["dataProvenance"];
  }>,
) {
  await trackAnalyticsEventV1(
    input.event,
    {
      producer: "candidate-profile",
      productAnalyticsEnabled: false,
      provenance: { actor: input.actorProvenance },
    },
    {
      async create(record) {
        const result = await transaction.analyticsEvent.createMany({
          data: [record],
          skipDuplicates: true,
        });
        return result.count === 0 ? "DUPLICATE" : "CREATED";
      },
      async expire(retainUntilInclusive) {
        const result = await transaction.analyticsEvent.deleteMany({
          where: { retainUntil: { lte: retainUntilInclusive } },
        });
        return result.count;
      },
    },
  );
}

function toPolicyInput(profile: MutationProfile): CandidateProfilePolicyInput {
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    cantonId: profile.cantonId,
    desiredTitles: profile.preference?.desiredTitles ?? [],
    preferredCategoryIds:
      profile.preference?.categories.map(({ categoryId }) => categoryId) ?? [],
    skillIds: profile.skills.map(({ skillId }) => skillId),
    languages: profile.languages,
    workloadMin: profile.preference?.workloadMin,
    workloadMax: profile.preference?.workloadMax,
    remotePreference: profile.preference?.remotePreference,
    desiredJobTypes: profile.preference?.desiredJobTypes ?? [],
  };
}

function toSafeRadarSource(profile: MutationProfile): SafeRadarSource {
  return {
    cantonCode: profile.canton?.code.trim() ?? null,
    categorySlugs:
      profile.preference?.categories
        .filter(({ category }) => category.isActive)
        .map(({ category }) => category.slug) ?? [],
    skillSlugs: profile.skills.map(({ skill }) => skill.slug),
    workloadMin: profile.preference?.workloadMin ?? null,
    workloadMax: profile.preference?.workloadMax ?? null,
    salaryMin: profile.preference?.salaryMinChf ?? null,
    salaryMax: profile.preference?.salaryMaxChf ?? null,
    salaryPeriod: profile.preference?.salaryPeriod ?? null,
    languageCodes: profile.languages.map(({ code }) =>
      code.trim().toLowerCase(),
    ),
    remotePreference: profile.preference?.remotePreference ?? null,
    availableFrom: profile.preference?.availableFrom ?? null,
  };
}

function deriveSafeRadarFields(input: SafeRadarSource, now: Date) {
  const cantonBucket = input.cantonCode?.trim().toUpperCase() ?? "";
  const categoryBucket = input.categorySlugs.map(slugify).find(hasText) ?? "";
  if (!/^[A-Z]{2}$/u.test(cantonBucket) || !hasText(categoryBucket))
    return null;

  const skillSlugs = Object.freeze(
    [...new Set(input.skillSlugs.map(slugify).filter(hasText))]
      .sort()
      .slice(0, 20),
  );
  const languageCodes = Object.freeze(
    [...new Set(input.languageCodes.map((code) => code.trim().toLowerCase()))]
      .filter((code) => /^[a-z]{2}$/u.test(code))
      .sort()
      .slice(0, 8),
  );
  return Object.freeze({
    cantonBucket,
    categoryBucket,
    skillSlugs,
    languageCodes,
    workloadBucket: workloadBucket(input.workloadMin, input.workloadMax),
    salaryBucket: salaryBucket(input.salaryMin, input.salaryPeriod),
    availabilityBucket: availabilityBucket(input.availableFrom, now),
  });
}

function deriveDefaultDisplayName(
  firstName: string | undefined,
  lastName: string | undefined,
): string | null {
  if (!hasText(firstName)) return null;
  if (!hasText(lastName)) return firstName.trim();
  return `${firstName.trim()} ${lastName.trim().slice(0, 1).toLocaleUpperCase("de-CH")}.`;
}

function workloadBucket(minimum: number | null, maximum: number | null) {
  if (minimum === null || maximum === null) return null;
  const midpoint = (minimum + maximum) / 2;
  const buckets = [20, 40, 60, 80, 100] as const;
  return String(
    buckets.reduce((closest, bucket) =>
      Math.abs(bucket - midpoint) < Math.abs(closest - midpoint)
        ? bucket
        : closest,
    ),
  );
}

function salaryBucket(
  minimum: number | null,
  period: SafeRadarSource["salaryPeriod"],
) {
  if (minimum === null || period !== "YEARLY") return null;
  const bounded = Math.min(
    250_000,
    Math.max(40_000, Math.floor(minimum / 10_000) * 10_000),
  );
  return `CHF_${bounded}`;
}

function availabilityBucket(value: Date | null, now: Date) {
  if (value === null) return null;
  const days = Math.ceil((value.getTime() - now.getTime()) / DAY_MILLISECONDS);
  if (days <= 0) return "NOW";
  if (days <= 30) return "WITHIN_30_DAYS";
  if (days <= 90) return "WITHIN_90_DAYS";
  return "LATER";
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120);
}

function humanizeSlug(value: string) {
  return value
    .split("-")
    .filter(Boolean)
    .map(
      (part) =>
        `${part.slice(0, 1).toLocaleUpperCase("de-CH")}${part.slice(1)}`,
    )
    .join(" ");
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function nextProfileRevision(current: Date, requested: Date): Date {
  return new Date(Math.max(requested.getTime(), current.getTime() + 1));
}

function nextConsentCreatedAt(previous: Date | null, requested: Date): Date {
  return new Date(
    Math.max(requested.getTime(), (previous?.getTime() ?? -1) + 1),
  );
}

function hasCurrentRadarVisibilityConsent(
  events: readonly Readonly<{
    granted: boolean;
    noticeVersion: string;
    noticeHash: string;
    effectiveAt: Date;
  }>[],
  now: Date,
): boolean {
  const current = events.find(
    ({ effectiveAt }) => effectiveAt.getTime() <= now.getTime(),
  );
  return (
    current?.granted === true &&
    current.noticeVersion === TALENT_RADAR_VISIBILITY_NOTICE_V1.noticeVersion &&
    current.noticeHash === TALENT_RADAR_VISIBILITY_NOTICE_V1.hash
  );
}

function isValidWorkloadRange(
  minimum: number | null | undefined,
  maximum: number | null | undefined,
) {
  return (
    Number.isInteger(minimum) &&
    Number.isInteger(maximum) &&
    (minimum as number) >= 1 &&
    (maximum as number) >= 1 &&
    (maximum as number) <= 100 &&
    (minimum as number) <= (maximum as number)
  );
}

function isRemotePreference(
  value: unknown,
): value is SafeRadarSource["remotePreference"] {
  return ["ONSITE", "HYBRID", "REMOTE", "ANY"].includes(String(value));
}

const transactionOptions = Object.freeze({
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  maxWait: PROFILE_TRANSACTION_TIMEOUT_MILLISECONDS,
  timeout: PROFILE_TRANSACTION_TIMEOUT_MILLISECONDS,
});

// Compile-time guard: candidate activation analytics keeps the canonical
// retention contract even though the writer itself is transaction-scoped.
void getAnalyticsRetainUntilV1;
