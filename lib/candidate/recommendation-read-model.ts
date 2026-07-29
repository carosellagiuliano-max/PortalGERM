import "server-only";

import { ANALYTICS_MINIMUM_COHORT_SIZE_V1 } from "@/lib/analytics/metric-contracts";
import { EMPLOYER_RESPONSE_POLICY_V1 } from "@/lib/analytics/response-policy-v1";
import { companyTrustActivationFromEnvironment } from "@/lib/companies/verification/read-model";
import {
  evaluateCompanyTrust,
  type CompanyTrustDecisionSnapshot,
  type CompanyTrustEvidenceSnapshot,
  type CompanyTrustEvaluation,
  type CompanyTrustProjectionSnapshot,
  type CompanyTrustPublicDescriptor,
} from "@/lib/companies/verification/policy-v2";
import { getServerEnvironment } from "@/lib/config/env";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";
import type {
  ApplicationEffort,
  DataProvenance,
  JobType,
  Language,
  LanguageLevel,
  RemotePreference,
  RemoteType,
  SalaryPeriod,
} from "@/lib/generated/prisma/enums";
import {
  evaluatePublicJobEligibility,
  type PublicEligibilitySnapshot,
} from "@/lib/jobs/public-eligibility";
import { getPublicDataContext } from "@/lib/public/environment";
import type {
  PublicCompanyTrustBadge,
  PublicJobCardModel,
  PublicResponseEvidence,
} from "@/lib/public/types";
import { sanitizePlainText, stripUnsafeHtml } from "@/lib/security/sanitize";

export const CANDIDATE_RECOMMENDATION_QUERY_POLICY_V1 = Object.freeze({
  version: "CANDIDATE_RECOMMENDATION_QUERY_POLICY_V1",
  candidateLimit: 48,
  maximumSqlQueries: 8,
  p95BudgetMs: 300,
});

export type CandidateRecommendationSelection = Readonly<{
  cantonSlug?: string;
  categorySlugs: readonly string[];
  jobTypes: readonly JobType[];
  remoteTypes: readonly RemotePreference[];
}>;

export type CandidateRecommendationProjection = Readonly<{
  job: PublicJobCardModel;
  requiredSkillIds: readonly string[];
  requiredLanguages: readonly Readonly<{
    code: string;
    minLevel: LanguageLevel;
  }>[];
  startDate: Date | null;
}>;

type RecommendationRow = Readonly<{
  id: string;
  slug: string;
  status: string;
  dataProvenance: DataProvenance;
  currentRevisionId: string | null;
  publishedRevisionId: string | null;
  publishedAt: Date | null;
  expiresAt: Date | null;
  companyId: string;
  companySlug: string;
  companyName: string;
  companyStatus: string;
  companyDataProvenance: DataProvenance;
  responseTargetDays: number | null;
  responseSampleSize: number;
  responseWithinTargetBps: number | null;
  revisionId: string;
  title: string;
  description: string;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  validThrough: Date | null;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  categoryIsActive: boolean;
  cantonId: string | null;
  cantonCode: string | null;
  cantonName: string | null;
  cantonSlug: string | null;
  cityId: string | null;
  cityName: string | null;
  citySlug: string | null;
  locationLabel: string | null;
  remoteType: RemoteType;
  jobType: JobType;
  workloadMin: number;
  workloadMax: number;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryPeriod: SalaryPeriod | null;
  applicationEffort: ApplicationEffort;
  contentLanguage: Language;
  fairScore: number | null;
  activeBoost: boolean;
  startDate: Date | null;
  hasEffectivePublicHideRestriction: boolean;
  freshnessState:
    "ACTIVE" | "REVIEW_PENDING" | "HOLD" | "STALE" | "FILLED" | "CLOSED" | null;
  freshnessDueAt: Date | null;
  freshnessEnforceAt: Date | null;
  freshnessReviewDueAt: Date | null;
  skills: unknown;
  languages: unknown;
}>;

type TrustRow = Readonly<{
  companyId: string;
  companyStatus: string;
  legacyVerifiedCycleCount: bigint | number | string;
  hasActiveContainment: boolean;
  projectionLevel: CompanyTrustProjectionSnapshot["level"] | null;
  projectionStatus: CompanyTrustProjectionSnapshot["status"] | null;
  projectionRiskState: CompanyTrustProjectionSnapshot["riskState"] | null;
  projectionScope: CompanyTrustProjectionSnapshot["scope"] | null;
  projectionPolicyVersion: string | null;
  projectionEvidenceDigest: string | null;
  projectionVerifiedAt: Date | null;
  projectionExpiresAt: Date | null;
  verificationRequestStatus:
    CompanyTrustProjectionSnapshot["verificationRequestStatus"] | null;
  requestedByUserId: string | null;
  decisionKind: CompanyTrustDecisionSnapshot["kind"] | null;
  decisionScope: CompanyTrustDecisionSnapshot["scope"] | null;
  decisionRiskLevel: CompanyTrustDecisionSnapshot["riskLevel"] | null;
  decisionPolicyVersion: string | null;
  decidedByUserId: string | null;
  approvedByUserId: string | null;
  decisionValidFrom: Date | null;
  decisionValidTo: Date | null;
  decisionDecidedAt: Date | null;
  decisionEvidenceDigest: string | null;
  evidence: unknown;
}>;

type RecommendationSkill = Readonly<{ id: string; required: boolean }>;
type RecommendationLanguage = Readonly<{
  code: string;
  minLevel: LanguageLevel;
}>;

/**
 * One bounded projection query and one batched trust query form the
 * recommendation read model. Eligibility is still decided by the same pure
 * Phase-26/30 policy evaluators used by every public consumer, while the
 * database performs no per-Job or per-relation fan-out.
 */
export async function listCandidateRecommendationProjections(
  database: DatabaseClient,
  selection: CandidateRecommendationSelection,
  now: Date,
): Promise<readonly CandidateRecommendationProjection[]> {
  if (!Number.isFinite(now.getTime())) return Object.freeze([]);
  const dataContext = getPublicDataContext();
  const environment = getServerEnvironment().APP_ENV;
  const trustActivation = companyTrustActivationFromEnvironment();

  return database.$transaction(
    async (transaction) => {
      const rows = await loadRecommendationRows(
        transaction,
        selection,
        now,
        dataContext.liveOnly,
      );
      if (rows.length === 0) return Object.freeze([]);
      const trustRows = await loadTrustRows(
        transaction,
        rows.map(({ companyId }) => companyId),
      );
      const trustByCompanyId = new Map(
        trustRows.map((row) => [
          row.companyId,
          Object.freeze({
            evaluation: evaluateCompanyTrust({
              activation: trustActivation,
              companyStatus: row.companyStatus,
              environment,
              hasActiveContainment: row.hasActiveContainment,
              legacyVerifiedCycleCount: safeCount(row.legacyVerifiedCycleCount),
              now,
              projection: toTrustProjection(row),
            }),
            legacyVerifiedCycleCount: safeCount(row.legacyVerifiedCycleCount),
          }),
        ]),
      );

      return Object.freeze(
        rows.flatMap((row) => {
          const trust = trustByCompanyId.get(row.companyId);
          if (trust === undefined) return [];
          const eligibility = evaluatePublicJobEligibility(
            toEligibilitySnapshot(
              row,
              trust.evaluation,
              trust.legacyVerifiedCycleCount,
            ),
            now,
            dataContext.eligibilityEnvironment,
          );
          return eligibility.eligible
            ? [toRecommendationProjection(row, trust.evaluation.badge)]
            : [];
        }),
      );
    },
    { isolationLevel: "RepeatableRead", timeout: 15_000 },
  );
}

function loadRecommendationRows(
  transaction: Prisma.TransactionClient,
  selection: CandidateRecommendationSelection,
  now: Date,
  liveOnly: boolean,
): Promise<readonly RecommendationRow[]> {
  const categoryPreference = textPreference(
    Prisma.sql`category."slug"`,
    selection.categorySlugs,
  );
  const cantonPreference =
    selection.cantonSlug === undefined
      ? Prisma.sql`TRUE`
      : Prisma.sql`canton."slug" = ${selection.cantonSlug}`;
  const jobTypePreference = textPreference(
    Prisma.sql`revision."jobType"::text`,
    selection.jobTypes,
  );
  const remotePreference = textPreference(
    Prisma.sql`revision."remoteType"::text`,
    selection.remoteTypes.filter((value) => value !== "ANY"),
  );
  const provenancePredicate = liveOnly
    ? Prisma.sql`
        AND job."dataProvenance" = 'LIVE'::"DataProvenance"
        AND company."dataProvenance" = 'LIVE'::"DataProvenance"
      `
    : Prisma.empty;

  return transaction.$queryRaw<readonly RecommendationRow[]>(Prisma.sql`
    SELECT
      job."id",
      job."slug",
      job."status"::text AS "status",
      job."dataProvenance",
      job."currentRevisionId",
      job."publishedRevisionId",
      job."publishedAt",
      job."expiresAt",
      company."id" AS "companyId",
      company."slug" AS "companySlug",
      company."name" AS "companyName",
      company."status"::text AS "companyStatus",
      company."dataProvenance" AS "companyDataProvenance",
      company."responseTargetDays",
      company."responseSampleSize",
      company."responseWithinTargetBps",
      revision."id" AS "revisionId",
      revision."title",
      revision."description",
      revision."approvedAt",
      revision."rejectedAt",
      revision."validThrough",
      category."id" AS "categoryId",
      category."name" AS "categoryName",
      category."slug" AS "categorySlug",
      category."isActive" AS "categoryIsActive",
      canton."id" AS "cantonId",
      canton."code" AS "cantonCode",
      canton."name" AS "cantonName",
      canton."slug" AS "cantonSlug",
      city."id" AS "cityId",
      city."name" AS "cityName",
      city."slug" AS "citySlug",
      revision."locationLabel",
      revision."remoteType",
      revision."jobType",
      revision."workloadMin",
      revision."workloadMax",
      revision."salaryMin",
      revision."salaryMax",
      revision."salaryPeriod",
      revision."applicationEffort",
      revision."contentLanguage",
      CASE
        WHEN (
          SELECT COUNT(*)
          FROM "JobScoreSnapshot" AS score_count
          WHERE score_count."jobRevisionId" = revision."id"
            AND score_count."scoreVersion" = 'v2'
        ) = 1
        THEN (
          SELECT score."scorePoints"
          FROM "JobScoreSnapshot" AS score
          WHERE score."jobRevisionId" = revision."id"
            AND score."scoreVersion" = 'v2'
          LIMIT 1
        )
        ELSE NULL
      END AS "fairScore",
      EXISTS (
        SELECT 1
        FROM "JobBoost" AS boost
        WHERE boost."jobId" = job."id"
          AND boost."companyId" = job."companyId"
          AND boost."status" <> 'CANCELLED'
          AND boost."startsAt" <= ${now}
          AND boost."endsAt" > ${now}
      ) AS "activeBoost",
      revision."startDate",
      EXISTS (
        SELECT 1
        FROM "ModerationRestriction" AS restriction
        WHERE restriction."status" = 'ACTIVE'
          AND restriction."startsAt" <= ${now}
          AND restriction."liftedAt" IS NULL
          AND (restriction."endsAt" IS NULL OR restriction."endsAt" > ${now})
          AND (
            (
              restriction."targetType" = 'HIDE_JOB'
              AND restriction."targetId" = job."id"
            )
            OR (
              restriction."targetType" = 'PAUSE_COMPANY'
              AND restriction."targetId" = company."id"
            )
          )
      ) AS "hasEffectivePublicHideRestriction",
      freshness."state"::text AS "freshnessState",
      freshness."dueAt" AS "freshnessDueAt",
      freshness."enforceAt" AS "freshnessEnforceAt",
      freshness."reviewDueAt" AS "freshnessReviewDueAt",
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', skill."id",
              'required', revision_skill."required"
            )
            ORDER BY revision_skill."id"
          )
          FROM "JobRevisionSkill" AS revision_skill
          INNER JOIN "Skill" AS skill
            ON skill."id" = revision_skill."skillId"
          WHERE revision_skill."jobRevisionId" = revision."id"
        ),
        '[]'::jsonb
      ) AS "skills",
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'code', lower(revision_language."code"),
              'minLevel', revision_language."minLevel"
            )
            ORDER BY revision_language."code"
          )
          FROM "JobRevisionLanguage" AS revision_language
          WHERE revision_language."jobRevisionId" = revision."id"
        ),
        '[]'::jsonb
      ) AS "languages"
    FROM "Job" AS job
    INNER JOIN "Company" AS company ON company."id" = job."companyId"
    INNER JOIN "JobRevision" AS revision
      ON revision."id" = job."publishedRevisionId"
      AND revision."jobId" = job."id"
    INNER JOIN "Category" AS category
      ON category."id" = revision."categoryId"
    LEFT JOIN "Canton" AS canton ON canton."id" = revision."cantonId"
    LEFT JOIN "City" AS city ON city."id" = revision."cityId"
    LEFT JOIN "JobFreshnessProjection" AS freshness
      ON freshness."jobId" = job."id"
    WHERE job."status" = 'PUBLISHED'
      AND job."currentRevisionId" = job."publishedRevisionId"
      AND job."publishedAt" <= ${now}
      AND job."expiresAt" > ${now}
      AND revision."approvedAt" IS NOT NULL
      AND revision."rejectedAt" IS NULL
      AND revision."validThrough" > ${now}
      AND job."expiresAt" = revision."validThrough"
      AND company."status" = 'ACTIVE'
      AND category."isActive"
      ${provenancePredicate}
    ORDER BY
      CASE WHEN (
        ${categoryPreference}
        AND ${cantonPreference}
        AND ${jobTypePreference}
        AND ${remotePreference}
      ) THEN 0 ELSE 1 END,
      job."publishedAt" DESC,
      job."id" ASC
    LIMIT ${CANDIDATE_RECOMMENDATION_QUERY_POLICY_V1.candidateLimit}
  `);
}

function loadTrustRows(
  transaction: Prisma.TransactionClient,
  companyIds: readonly string[],
): Promise<readonly TrustRow[]> {
  const ids = uuidList(companyIds);
  return transaction.$queryRaw<readonly TrustRow[]>(Prisma.sql`
    SELECT
      company."id" AS "companyId",
      company."status"::text AS "companyStatus",
      (
        SELECT COUNT(*)
        FROM "CompanyVerificationRequest" AS legacy_verification
        WHERE legacy_verification."companyId" = company."id"
          AND legacy_verification."status" = 'VERIFIED'
          AND NOT EXISTS (
            SELECT 1
            FROM "CompanyVerificationRequest" AS superseding
            WHERE superseding."supersedesRequestId" = legacy_verification."id"
          )
      ) AS "legacyVerifiedCycleCount",
      EXISTS (
        SELECT 1
        FROM "TrustSafetyContainmentEffect" AS containment
        WHERE containment."targetType" = 'COMPANY'
          AND containment."targetId" = company."id"::text
          AND containment."reversedAt" IS NULL
      ) AS "hasActiveContainment",
      projection."level"::text AS "projectionLevel",
      projection."status"::text AS "projectionStatus",
      projection."riskState"::text AS "projectionRiskState",
      projection."scope"::text AS "projectionScope",
      projection."policyVersion" AS "projectionPolicyVersion",
      projection."evidenceDigest" AS "projectionEvidenceDigest",
      projection."verifiedAt" AS "projectionVerifiedAt",
      projection."expiresAt" AS "projectionExpiresAt",
      verification."status"::text AS "verificationRequestStatus",
      verification."requestedByUserId",
      decision."kind"::text AS "decisionKind",
      decision."scope"::text AS "decisionScope",
      decision."riskLevel"::text AS "decisionRiskLevel",
      decision."policyVersion" AS "decisionPolicyVersion",
      decision."decidedByUserId",
      decision."approvedByUserId",
      decision."validFrom" AS "decisionValidFrom",
      decision."validTo" AS "decisionValidTo",
      decision."decidedAt" AS "decisionDecidedAt",
      decision."evidenceDigest" AS "decisionEvidenceDigest",
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'type', evidence."type",
              'scope', evidence."scope",
              'status', evidence."status",
              'source', evidence."source",
              'checkedAt', evidence."checkedAt",
              'validFrom', evidence."validFrom",
              'validTo', evidence."validTo",
              'revokedAt', evidence."revokedAt",
              'responseDigest', evidence."responseDigest"
            )
            ORDER BY evidence."createdAt", evidence."id"
          )
          FROM "CompanyVerificationEvidence" AS evidence
          WHERE evidence."verificationRequestId" = verification."id"
        ),
        '[]'::jsonb
      ) AS "evidence"
    FROM "Company" AS company
    LEFT JOIN "CompanyTrustProjection" AS projection
      ON projection."companyId" = company."id"
      AND projection."scope" = 'COMPANY_IDENTITY'
    LEFT JOIN "CompanyVerificationRequest" AS verification
      ON verification."id" = projection."verificationRequestId"
      AND verification."companyId" = company."id"
    LEFT JOIN "CompanyVerificationDecision" AS decision
      ON decision."id" = projection."decisionId"
      AND decision."companyId" = company."id"
    WHERE company."id" IN (${ids})
  `);
}

function toTrustProjection(
  row: TrustRow,
): CompanyTrustProjectionSnapshot | null {
  if (
    row.projectionLevel === null ||
    row.projectionStatus === null ||
    row.projectionRiskState === null ||
    row.projectionScope === null ||
    row.projectionPolicyVersion === null ||
    row.projectionEvidenceDigest === null ||
    row.verificationRequestStatus === null
  ) {
    return null;
  }
  return Object.freeze({
    level: row.projectionLevel,
    status: row.projectionStatus,
    riskState: row.projectionRiskState,
    scope: row.projectionScope,
    policyVersion: row.projectionPolicyVersion,
    verifiedAt: row.projectionVerifiedAt,
    expiresAt: row.projectionExpiresAt,
    evidenceDigest: row.projectionEvidenceDigest,
    verificationRequestStatus: row.verificationRequestStatus,
    evidence: parseEvidence(row.evidence),
    decision: toTrustDecision(row),
  });
}

function toTrustDecision(row: TrustRow): CompanyTrustDecisionSnapshot | null {
  if (
    row.decisionKind === null ||
    row.decisionScope === null ||
    row.decisionRiskLevel === null ||
    row.decisionPolicyVersion === null ||
    row.requestedByUserId === null ||
    row.decidedByUserId === null ||
    row.decisionDecidedAt === null ||
    row.decisionEvidenceDigest === null
  ) {
    return null;
  }
  return Object.freeze({
    kind: row.decisionKind,
    scope: row.decisionScope,
    riskLevel: row.decisionRiskLevel,
    policyVersion: row.decisionPolicyVersion,
    requestedByUserId: row.requestedByUserId,
    decidedByUserId: row.decidedByUserId,
    approvedByUserId: row.approvedByUserId,
    validFrom: row.decisionValidFrom,
    validTo: row.decisionValidTo,
    decidedAt: row.decisionDecidedAt,
    evidenceDigest: row.decisionEvidenceDigest,
  });
}

function parseEvidence(
  value: unknown,
): readonly CompanyTrustEvidenceSnapshot[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(
    value.flatMap((item) => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        return [];
      }
      const record = item as Record<string, unknown>;
      if (
        typeof record.type !== "string" ||
        typeof record.scope !== "string" ||
        typeof record.status !== "string" ||
        typeof record.source !== "string" ||
        typeof record.responseDigest !== "string"
      ) {
        return [];
      }
      return [
        Object.freeze({
          type: record.type as CompanyTrustEvidenceSnapshot["type"],
          scope: record.scope as CompanyTrustEvidenceSnapshot["scope"],
          status: record.status as CompanyTrustEvidenceSnapshot["status"],
          source: record.source,
          checkedAt: nullableDate(record.checkedAt),
          validFrom: nullableDate(record.validFrom),
          validTo: nullableDate(record.validTo),
          revokedAt: nullableDate(record.revokedAt),
          responseDigest: record.responseDigest,
        }),
      ];
    }),
  );
}

function toEligibilitySnapshot(
  row: RecommendationRow,
  trust: CompanyTrustEvaluation,
  legacyVerifiedCycleCount: number,
): PublicEligibilitySnapshot {
  const freshness =
    row.freshnessState === null ||
    row.freshnessDueAt === null ||
    row.freshnessEnforceAt === null
      ? null
      : Object.freeze({
          state: row.freshnessState,
          dueAt: row.freshnessDueAt,
          enforceAt: row.freshnessEnforceAt,
          reviewDueAt: row.freshnessReviewDueAt,
        });
  return Object.freeze({
    id: row.id,
    slug: row.slug,
    companyId: row.companyId,
    status: row.status,
    dataProvenance: row.dataProvenance,
    currentRevisionId: row.currentRevisionId,
    publishedRevisionId: row.publishedRevisionId,
    publishedAt: row.publishedAt,
    expiresAt: row.expiresAt,
    company: Object.freeze({
      name: row.companyName,
      status: row.companyStatus,
      dataProvenance: row.companyDataProvenance,
      hasCurrentVerifiedCycle: legacyVerifiedCycleCount === 1,
      hasCurrentTrustEligibility: trust.publicEligible,
    }),
    revision: Object.freeze({
      id: row.revisionId,
      title: row.title,
      description: row.description,
      approvedAt: row.approvedAt,
      rejectedAt: row.rejectedAt,
      validThrough: row.validThrough,
      categoryId: row.categoryId,
      categoryIsActive: row.categoryIsActive,
      cantonId: row.cantonId,
      cityId: row.cityId,
      salaryMin: row.salaryMin,
      salaryMax: row.salaryMax,
      salaryPeriod: row.salaryPeriod,
      responseTargetDays: row.responseTargetDays ?? 7,
      remoteType: row.remoteType,
      jobType: row.jobType,
      workloadMin: row.workloadMin,
      workloadMax: row.workloadMax,
      fairScore: row.fairScore,
    }),
    hasEffectivePublicHideRestriction: row.hasEffectivePublicHideRestriction,
    freshness,
  });
}

function toRecommendationProjection(
  row: RecommendationRow,
  trustDescriptor: CompanyTrustPublicDescriptor | null,
): CandidateRecommendationProjection {
  const skills = parseSkills(row.skills);
  const languages = parseLanguages(row.languages);
  const trust = toPublicTrustBadge(trustDescriptor);
  return Object.freeze({
    job: Object.freeze({
      id: row.id,
      slug: row.slug,
      title: sanitizePlainText(row.title),
      description: sanitizePlainText(row.description),
      company: Object.freeze({
        id: row.companyId,
        slug: row.companySlug,
        name: stripUnsafeHtml(row.companyName),
        verified: trust !== null,
        trust,
      }),
      category: Object.freeze({
        id: row.categoryId,
        name: row.categoryName,
        slug: row.categorySlug,
      }),
      canton:
        row.cantonId === null ||
        row.cantonCode === null ||
        row.cantonName === null ||
        row.cantonSlug === null
          ? null
          : Object.freeze({
              id: row.cantonId,
              code: row.cantonCode,
              name: row.cantonName,
              slug: row.cantonSlug,
            }),
      city:
        row.cityId === null || row.cityName === null || row.citySlug === null
          ? null
          : Object.freeze({
              id: row.cityId,
              name: row.cityName,
              slug: row.citySlug,
            }),
      locationLabel: cleanOptional(row.locationLabel),
      remoteType: row.remoteType,
      jobType: row.jobType,
      workloadMin: row.workloadMin,
      workloadMax: row.workloadMax,
      salaryMin: row.salaryMin,
      salaryMax: row.salaryMax,
      salaryPeriod: row.salaryPeriod,
      applicationEffort: row.applicationEffort,
      contentLanguage: row.contentLanguage,
      fairScore: row.fairScore,
      response: responseEvidence(row),
      publishedAt: new Date(row.publishedAt!),
      expiresAt: new Date(row.expiresAt!),
      dataProvenance: row.dataProvenance,
      activeBoost: row.activeBoost,
      sponsored: false,
    }),
    requiredSkillIds: Object.freeze(
      skills.filter(({ required }) => required).map(({ id }) => id),
    ),
    requiredLanguages: Object.freeze(languages),
    startDate: row.startDate === null ? null : new Date(row.startDate),
  });
}

function parseSkills(value: unknown): readonly RecommendationSkill[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(
    value.flatMap((item) => {
      if (
        item === null ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        typeof (item as { id?: unknown }).id !== "string" ||
        typeof (item as { required?: unknown }).required !== "boolean"
      ) {
        return [];
      }
      return [
        Object.freeze({
          id: (item as { id: string }).id,
          required: (item as { required: boolean }).required,
        }),
      ];
    }),
  );
}

function parseLanguages(value: unknown): readonly RecommendationLanguage[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const levels = new Set<LanguageLevel>([
    "A1",
    "A2",
    "B1",
    "B2",
    "C1",
    "C2",
    "NATIVE",
  ]);
  return Object.freeze(
    value.flatMap((item) => {
      if (
        item === null ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        typeof (item as { code?: unknown }).code !== "string" ||
        !levels.has((item as { minLevel?: LanguageLevel }).minLevel!)
      ) {
        return [];
      }
      return [
        Object.freeze({
          code: (item as { code: string }).code.toLowerCase(),
          minLevel: (item as { minLevel: LanguageLevel }).minLevel,
        }),
      ];
    }),
  );
}

function responseEvidence(
  company: Pick<
    RecommendationRow,
    "responseTargetDays" | "responseSampleSize" | "responseWithinTargetBps"
  >,
): PublicResponseEvidence {
  const known =
    Number.isSafeInteger(company.responseSampleSize) &&
    company.responseSampleSize >= ANALYTICS_MINIMUM_COHORT_SIZE_V1 &&
    Number.isInteger(company.responseTargetDays) &&
    company.responseTargetDays !== null &&
    company.responseTargetDays >=
      EMPLOYER_RESPONSE_POLICY_V1.validResponseTargetDays.min &&
    company.responseTargetDays <=
      EMPLOYER_RESPONSE_POLICY_V1.validResponseTargetDays.max &&
    Number.isInteger(company.responseWithinTargetBps) &&
    company.responseWithinTargetBps !== null &&
    company.responseWithinTargetBps >= 0 &&
    company.responseWithinTargetBps <= 10_000;
  return Object.freeze({
    known,
    targetDays: known ? company.responseTargetDays : null,
    onTimeRateBps: known ? company.responseWithinTargetBps : null,
    sampleSizeBucket: known
      ? company.responseSampleSize >= 50
        ? "50+"
        : "20–49"
      : null,
  });
}

function toPublicTrustBadge(
  badge: CompanyTrustPublicDescriptor | null,
): PublicCompanyTrustBadge | null {
  return badge === null
    ? null
    : Object.freeze({
        label: badge.label,
        scopeLabel: badge.scopeLabel,
        method: badge.method,
        policyVersion: badge.policyVersion,
        verifiedAt: new Date(badge.verifiedAt),
        validUntil: new Date(badge.validUntil),
      });
}

function textPreference(column: Prisma.Sql, values: readonly string[]) {
  if (values.length === 0) return Prisma.sql`TRUE`;
  return Prisma.sql`${column} IN (${Prisma.join(values.map((value) => Prisma.sql`${value}`))})`;
}

function uuidList(values: readonly string[]) {
  const unique = [...new Set(values)];
  if (unique.length === 0) {
    throw new RangeError("A recommendation trust query requires company IDs.");
  }
  return Prisma.join(unique.map((value) => Prisma.sql`${value}::uuid`));
}

function safeCount(value: bigint | number | string) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function nullableDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const parsed =
    value instanceof Date ? new Date(value) : new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function cleanOptional(value: string | null): string | null {
  if (value === null) return null;
  const cleaned = sanitizePlainText(value);
  return cleaned.length === 0 ? null : cleaned;
}
