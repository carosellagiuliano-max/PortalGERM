import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import { writeRequiredAudit, type RequiredAuditInput } from "@/lib/audit/log";
import { getEffectiveBoostStatus } from "@/lib/billing/boosts";
import type { FeatureGateReason } from "@/lib/billing/feature-gates";
import { createPrismaPublishQuotaPort } from "@/lib/billing/prisma-publish-quota";
import { publishWithQuota } from "@/lib/billing/usage";
import type { UpgradePrompt } from "@/lib/billing/upgrade-prompt";
import type { DatabaseClient } from "@/lib/db/factory";
import {
  APPLICATION_CONTACT_KINDS,
  APPLICATION_EFFORTS,
  JOB_BENEFIT_CODES,
  JOB_TYPES,
  LANGUAGE_LEVELS,
  REMOTE_TYPES,
  REQUIRED_DOCUMENT_KINDS,
  SALARY_PERIODS,
} from "@/lib/employer/job-contracts";
import { Prisma } from "@/lib/generated/prisma/client";
import { createJobSlug } from "@/lib/jobs/slug";
import {
  decideJobTransition,
  type JobActorCapability,
  type JobStatus,
} from "@/lib/policies/status/job";
import type { AiProvider } from "@/lib/providers/ai";
import type { JobroomProvider } from "@/lib/providers/jobroom";
import { jobroomReasonCopy } from "@/lib/providers/jobroom/reason-copy";
import {
  buildFairJobInputV2,
  calculateFairJobScoreV2,
  type FairJobResult,
} from "@/lib/scoring/fair-job-score";
import { buildFairJobScoreSnapshotV2 } from "@/lib/scoring/fair-job-snapshot";
import {
  sanitizePlainText,
  stripUnsafeHtml,
} from "@/lib/security/sanitize";
import { createLogger } from "@/lib/utils/logger";
import { trimmedString } from "@/lib/validation/common";

const DAY = 86_400_000;
const AUDIT_RETENTION_DAYS = 365;
const MAX_PUBLICATION_DAYS = 90;
const logger = createLogger();

export {
  APPLICATION_CONTACT_KINDS,
  APPLICATION_EFFORTS,
  JOB_BENEFIT_CODES,
  JOB_TYPES,
  LANGUAGE_LEVELS,
  REMOTE_TYPES,
  REQUIRED_DOCUMENT_KINDS,
  SALARY_PERIODS,
} from "@/lib/employer/job-contracts";

const boundedPlainText = (minimum: number, maximum: number) =>
  trimmedString(minimum, maximum)
    .transform(sanitizePlainText)
    .pipe(z.string().min(minimum).max(maximum));
const optionalPlainText = (maximum: number, minimum = 1) =>
  z.preprocess(
    (value) => value === "" || value === null || value === undefined ? null : value,
    boundedPlainText(minimum, maximum).nullable(),
  );
const optionalDate = z.preprocess(
  (value) => value === "" || value === null || value === undefined ? null : value,
  z.coerce.date().nullable(),
);
const structuredText = boundedPlainText(20, 500);
const idempotencyKey = z.string().trim().min(8).max(96).regex(/^[A-Za-z0-9:._-]+$/u);

export const jobWizardStepOneSchema = z.strictObject({
  title: boundedPlainText(3, 200),
  categoryId: z.uuid(),
  jobType: z.enum(JOB_TYPES),
  workloadMin: z.coerce.number().int().min(1).max(100),
  workloadMax: z.coerce.number().int().min(1).max(100),
  cantonId: z.uuid().nullable(),
  cityId: z.uuid().nullable(),
  locationLabel: optionalPlainText(200),
  remoteType: z.enum(REMOTE_TYPES),
  remoteCountryCode: z.preprocess(
    (value) => value === "" || value === null || value === undefined ? null : value,
    z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/u).nullable(),
  ),
  languages: z.array(z.strictObject({
    code: z.string().trim().toLowerCase().regex(/^[a-z]{2}$/u),
    minLevel: z.enum(LANGUAGE_LEVELS),
  })).min(1).max(8),
  validThrough: optionalDate,
  startDate: optionalDate,
  startByArrangement: z.coerce.boolean(),
}).superRefine((value, context) => {
  if (value.workloadMin > value.workloadMax) {
    context.addIssue({ code: "custom", path: ["workloadMax"], message: "INVALID_WORKLOAD" });
  }
  if (value.startByArrangement === (value.startDate !== null)) {
    context.addIssue({ code: "custom", path: ["startDate"], message: "START_DATE_XOR" });
  }
  if (value.remoteType === "REMOTE") {
    if (value.remoteCountryCode !== "CH") {
      context.addIssue({ code: "custom", path: ["remoteCountryCode"], message: "REMOTE_COUNTRY_MUST_BE_CH" });
    }
    if (value.cantonId !== null || value.cityId !== null) {
      context.addIssue({ code: "custom", path: ["cityId"], message: "REMOTE_LOCATION_MUST_NOT_HAVE_CITY" });
    }
  } else {
    if (value.remoteCountryCode !== null) {
      context.addIssue({ code: "custom", path: ["remoteCountryCode"], message: "LOCAL_LOCATION_MUST_NOT_HAVE_COUNTRY" });
    }
    if (value.cantonId === null || value.cityId === null) {
      context.addIssue({ code: "custom", path: ["cityId"], message: "LOCAL_LOCATION_REQUIRES_CITY" });
    }
  }
  if (new Set(value.languages.map(({ code }) => code)).size !== value.languages.length) {
    context.addIssue({ code: "custom", path: ["languages"], message: "DUPLICATE_LANGUAGE" });
  }
});

export const jobWizardStepTwoSchema = z.strictObject({
  companyIntro: boundedPlainText(20, 1_200),
  tasks: z.array(structuredText).min(1).max(12),
  requirements: z.array(structuredText).min(1).max(12),
  niceToHave: z.array(structuredText).max(12),
  offer: boundedPlainText(20, 5_000),
  skillIds: z.array(z.uuid()).max(20),
  benefits: z.array(z.strictObject({
    benefitCode: z.enum(JOB_BENEFIT_CODES),
    description: boundedPlainText(20, 500),
  })).max(10),
}).superRefine((value, context) => {
  if (new Set(value.skillIds).size !== value.skillIds.length) {
    context.addIssue({ code: "custom", path: ["skillIds"], message: "DUPLICATE_SKILL" });
  }
  if (new Set(value.benefits.map(({ benefitCode }) => benefitCode)).size !== value.benefits.length) {
    context.addIssue({ code: "custom", path: ["benefits"], message: "DUPLICATE_BENEFIT" });
  }
});

export const jobWizardStepThreeSchema = z.strictObject({
  salaryPeriod: z.enum(SALARY_PERIODS).nullable(),
  salaryMin: z.coerce.number().int().nonnegative().nullable(),
  salaryMax: z.coerce.number().int().nonnegative().nullable(),
  responseTargetDays: z.coerce.number().int().min(1).max(30),
  applicationProcessSteps: z.array(boundedPlainText(10, 300)).min(1).max(8),
  applicationEffort: z.enum(APPLICATION_EFFORTS),
  requiredDocumentKinds: z.array(z.enum(REQUIRED_DOCUMENT_KINDS)).min(1).max(7),
  inclusionStatement: optionalPlainText(1_000, 20),
  applicationContactKind: z.enum(APPLICATION_CONTACT_KINDS),
  applicationContactValue: trimmedString(3, 512),
}).superRefine((value, context) => {
  const salaryParts = [value.salaryPeriod, value.salaryMin, value.salaryMax];
  if (salaryParts.some((part) => part !== null) && salaryParts.some((part) => part === null)) {
    context.addIssue({ code: "custom", path: ["salaryPeriod"], message: "SALARY_ALL_OR_NONE" });
  }
  if (value.salaryMin !== null && value.salaryMax !== null && value.salaryMin > value.salaryMax) {
    context.addIssue({ code: "custom", path: ["salaryMax"], message: "INVALID_SALARY_RANGE" });
  }
  if (new Set(value.requiredDocumentKinds).size !== value.requiredDocumentKinds.length) {
    context.addIssue({ code: "custom", path: ["requiredDocumentKinds"], message: "DUPLICATE_DOCUMENT" });
  }
  if (value.requiredDocumentKinds.includes("NONE") && value.requiredDocumentKinds.length !== 1) {
    context.addIssue({ code: "custom", path: ["requiredDocumentKinds"], message: "NONE_MUST_BE_EXCLUSIVE" });
  }
  if (!isValidApplicationContact(value.applicationContactKind, value.applicationContactValue)) {
    context.addIssue({ code: "custom", path: ["applicationContactValue"], message: "INVALID_CONTACT" });
  }
});

export const jobCommandEnvelopeSchema = z.strictObject({
  jobId: z.uuid(),
  expectedJobVersion: z.coerce.number().int().positive(),
  expectedRevisionVersion: z.coerce.number().int().positive(),
  idempotencyKey,
});

export type JobWizardStepOne = z.infer<typeof jobWizardStepOneSchema>;
export type JobWizardStepTwo = z.infer<typeof jobWizardStepTwoSchema>;
export type JobWizardStepThree = z.infer<typeof jobWizardStepThreeSchema>;
export type JobCommandEnvelope = z.infer<typeof jobCommandEnvelopeSchema>;

export type EmployerJobActor = Readonly<{
  userId: string;
  email: string;
  membershipId: string;
  membershipRole: "OWNER" | "ADMIN" | "RECRUITER" | "VIEWER";
  companyId: string;
}>;

export type EmployerJobCapabilities = Readonly<{
  assignmentRole: "EDITOR" | "PIPELINE" | "REVIEWER" | null;
  readSummary: boolean;
  readFullRevision: boolean;
  mutateDraft: boolean;
  manageLifecycle: boolean;
}>;

export function resolveEmployerJobCapabilities(
  membershipRole: EmployerJobActor["membershipRole"],
  assignmentRole: EmployerJobCapabilities["assignmentRole"],
): EmployerJobCapabilities {
  if (membershipRole === "OWNER" || membershipRole === "ADMIN") {
    return Object.freeze({ assignmentRole: null, readSummary: true, readFullRevision: true, mutateDraft: true, manageLifecycle: true });
  }
  if (membershipRole === "VIEWER") {
    return Object.freeze({ assignmentRole: null, readSummary: true, readFullRevision: false, mutateDraft: false, manageLifecycle: false });
  }
  if (assignmentRole === "EDITOR") {
    return Object.freeze({ assignmentRole, readSummary: true, readFullRevision: true, mutateDraft: true, manageLifecycle: false });
  }
  if (assignmentRole === "REVIEWER") {
    return Object.freeze({ assignmentRole, readSummary: true, readFullRevision: true, mutateDraft: false, manageLifecycle: false });
  }
  if (assignmentRole === "PIPELINE") {
    return Object.freeze({ assignmentRole, readSummary: true, readFullRevision: false, mutateDraft: false, manageLifecycle: false });
  }
  return Object.freeze({ assignmentRole: null, readSummary: false, readFullRevision: false, mutateDraft: false, manageLifecycle: false });
}

export function buildEmployerJobScopeWhere(
  actor: EmployerJobActor,
  now: Date,
  options: Readonly<{
    assignmentRoles?: readonly ("EDITOR" | "PIPELINE" | "REVIEWER")[];
    activeCompanyOnly?: boolean;
  }> = {},
): Prisma.JobWhereInput {
  const membership = {
    id: actor.membershipId,
    userId: actor.userId,
    companyId: actor.companyId,
    role: actor.membershipRole,
    status: "ACTIVE" as const,
    removedAt: null,
  };
  const assignmentScope = actor.membershipRole === "RECRUITER"
    ? {
        assignments: {
          some: {
            companyId: actor.companyId,
            membershipId: actor.membershipId,
            userId: actor.userId,
            status: "ACTIVE" as const,
            revokedAt: null,
            validFrom: { lte: now },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            ...(options.assignmentRoles === undefined
              ? {}
              : { role: { in: [...options.assignmentRoles] } }),
          },
        },
      }
    : {};
  return {
    companyId: actor.companyId,
    company: {
      status: options.activeCompanyOnly === true ? "ACTIVE" : { in: ["DRAFT", "ACTIVE"] },
      memberships: { some: membership },
    },
    ...assignmentScope,
  };
}

export type EmployerJobListItem = Readonly<{
  id: string;
  slug: string;
  status: JobStatus;
  version: number;
  revisionId: string | null;
  revisionVersion: number | null;
  title: string;
  location: string;
  applications: number;
  views: number;
  saves: number;
  score: Readonly<{ points: number; maxPoints: number }> | null;
  boostStatus: "ACTIVE" | "SCHEDULED" | "EXPIRED" | "CANCELLED" | null;
  capabilities: EmployerJobCapabilities;
}>;

export async function listEmployerJobs(
  actor: EmployerJobActor,
  database: DatabaseClient,
  now = new Date(),
): Promise<readonly EmployerJobListItem[]> {
  const assignmentWhere = currentAssignmentWhere(actor, now);
  const rows = await database.job.findMany({
    where: {
      ...buildEmployerJobScopeWhere(actor, now),
      status: { not: "REMOVED" },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      slug: true,
      status: true,
      version: true,
      currentRevision: {
        select: {
          id: true,
          version: true,
          title: true,
          locationLabel: true,
          canton: { select: { name: true } },
          city: { select: { name: true } },
          scoreSnapshots: {
            orderBy: [{ calculatedAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { scorePoints: true, maxPoints: true },
          },
        },
      },
      assignments: {
        where: assignmentWhere,
        take: 1,
        select: { role: true },
      },
      _count: { select: { applications: true, savedBy: true } },
      viewAggregates: { select: { viewCount: true } },
      boosts: {
        orderBy: [{ startsAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { status: true, startsAt: true, endsAt: true },
      },
    },
  });

  return Object.freeze(rows.map((row) => {
    const revision = row.currentRevision;
    const assignmentRole = actor.membershipRole === "RECRUITER"
      ? row.assignments[0]?.role ?? null
      : null;
    const latestBoost = row.boosts[0];
    const score = revision?.scoreSnapshots[0];
    return Object.freeze({
      id: row.id,
      slug: row.slug,
      status: row.status as JobStatus,
      version: row.version,
      revisionId: revision?.id ?? null,
      revisionVersion: revision?.version ?? null,
      title: revision?.title ?? "Unbenanntes Inserat",
      location: revision?.locationLabel ?? revision?.city?.name ?? revision?.canton?.name ?? "Remote / offen",
      applications: row._count.applications,
      views: row.viewAggregates.reduce((sum, aggregate) => sum + aggregate.viewCount, 0),
      saves: row._count.savedBy,
      score: score === undefined ? null : Object.freeze({ points: score.scorePoints, maxPoints: score.maxPoints }),
      boostStatus: effectiveBoostStatus(latestBoost, now),
      capabilities: resolveEmployerJobCapabilities(actor.membershipRole, assignmentRole),
    });
  }));
}

export type EmployerJobCatalog = Readonly<{
  categories: readonly Readonly<{ id: string; name: string }>[];
  cantons: readonly Readonly<{ id: string; code: string; name: string }>[];
  cities: readonly Readonly<{ id: string; cantonId: string; name: string }>[];
  skills: readonly Readonly<{ id: string; name: string }>[];
  occupations: readonly Readonly<{ id: string; code: string; label: string; result: string }>[];
}>;

export async function getEmployerJobCatalog(
  actor: EmployerJobActor,
  database: DatabaseClient,
  now = new Date(),
): Promise<EmployerJobCatalog | null> {
  const membership = await database.companyMembership.findFirst({
    where: {
      id: actor.membershipId,
      companyId: actor.companyId,
      userId: actor.userId,
      role: actor.membershipRole,
      status: "ACTIVE",
      removedAt: null,
      company: { status: { in: ["DRAFT", "ACTIVE"] } },
    },
    select: { id: true },
  });
  if (membership === null) return null;
  const [categories, cantons, cities, skills, occupations] = await Promise.all([
    database.category.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    database.canton.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, code: true, name: true } }),
    database.city.findMany({ where: { isActive: true, canton: { isActive: true } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, cantonId: true, name: true } }),
    database.skill.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    database.occupationCode.findMany({
      where: {
        occupationCodeVersion: {
          validFrom: { lte: now },
          OR: [{ validTo: null }, { validTo: { gt: now } }],
        },
        OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }],
        AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }],
      },
      orderBy: [{ code: "asc" }, { id: "asc" }],
      select: { id: true, code: true, label: true, result: true },
    }),
  ]);
  return Object.freeze({ categories: Object.freeze(categories), cantons: Object.freeze(cantons), cities: Object.freeze(cities), skills: Object.freeze(skills), occupations: Object.freeze(occupations) });
}

type EmployerJobSummaryDetail = Readonly<{
  access: "SUMMARY";
  id: string;
  slug: string;
  status: JobStatus;
  version: number;
  title: string;
  location: string;
  applications: number;
  views: number;
  saves: number;
  capabilities: EmployerJobCapabilities;
}>;

export type EmployerJobRevisionDetail = Readonly<{
  id: string;
  revisionNumber: number;
  version: number;
  contentLanguage: string;
  title: string;
  companyIntro: string | null;
  description: string;
  tasks: readonly string[];
  requirements: readonly string[];
  niceToHave: readonly string[];
  offer: string | null;
  applicationProcessSteps: readonly string[];
  requiredDocumentKinds: readonly string[];
  jobType: string;
  remoteType: string;
  remoteCountryCode: string | null;
  categoryId: string;
  cantonId: string | null;
  cityId: string | null;
  locationLabel: string | null;
  workloadMin: number;
  workloadMax: number;
  salaryPeriod: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  startDate: Date | null;
  startByArrangement: boolean;
  validThrough: Date | null;
  responseTargetDays: number;
  applicationEffort: string;
  inclusionStatement: string | null;
  applicationContactKind: string;
  applicationContactValue: string;
  submittedAt: Date | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  languages: readonly Readonly<{ code: string; minLevel: string }>[];
  skills: readonly Readonly<{ id: string; name: string; required: boolean }>[];
  benefits: readonly Readonly<{ benefitCode: string; description: string; sortOrder: number }>[];
  reportingCheck: Readonly<{
    id: string;
    result: string;
    reason: string;
    disclaimer: string;
    source: string;
    datasetVersion: string;
    dataYear: number;
    referenceUrl: string | null;
    occupationCode: string | null;
    occupationLabel: string | null;
    checkedAt: Date;
  }> | null;
}>;

export type EmployerJobFullDetail = Readonly<{
  access: "FULL";
  id: string;
  slug: string;
  status: JobStatus;
  version: number;
  currentRevisionId: string | null;
  publishedRevisionId: string | null;
  publishedAt: Date | null;
  expiresAt: Date | null;
  revision: EmployerJobRevisionDetail | null;
  applications: number;
  views: number;
  saves: number;
  boostStatus: EmployerJobListItem["boostStatus"];
  capabilities: EmployerJobCapabilities;
  score: FairJobResult | null;
  latestScoreSnapshot: Readonly<{ points: number; maxPoints: number; calculatedAt: Date }> | null;
  statusEvents: readonly Readonly<{ kind: string; fromStatus: string | null; toStatus: string; createdAt: Date; reasonCode: string | null }>[];
  auditEvents: readonly Readonly<{ action: string; result: string; reasonCode: string | null; createdAt: Date }>[];
}>;

export type EmployerJobDetail = EmployerJobSummaryDetail | EmployerJobFullDetail;

export async function getEmployerJobDetail(
  actor: EmployerJobActor,
  jobId: string,
  database: DatabaseClient,
  now = new Date(),
): Promise<EmployerJobDetail | null> {
  if (!z.uuid().safeParse(jobId).success) return null;
  const assignmentWhere = currentAssignmentWhere(actor, now);
  const summary = await database.job.findFirst({
    where: { id: jobId, ...buildEmployerJobScopeWhere(actor, now), status: { not: "REMOVED" } },
    select: {
      id: true,
      slug: true,
      status: true,
      version: true,
      currentRevision: { select: { id: true, title: true, locationLabel: true, canton: { select: { name: true } }, city: { select: { name: true } } } },
      assignments: { where: assignmentWhere, take: 1, select: { role: true } },
      _count: { select: { applications: true, savedBy: true } },
      viewAggregates: { select: { viewCount: true } },
    },
  });
  if (summary === null) return null;
  const assignmentRole = actor.membershipRole === "RECRUITER" ? summary.assignments[0]?.role ?? null : null;
  const capabilities = resolveEmployerJobCapabilities(actor.membershipRole, assignmentRole);
  if (!capabilities.readFullRevision) {
    return Object.freeze({
      access: "SUMMARY",
      id: summary.id,
      slug: summary.slug,
      status: summary.status as JobStatus,
      version: summary.version,
      title: summary.currentRevision?.title ?? "Unbenanntes Inserat",
      location: summary.currentRevision?.locationLabel ?? summary.currentRevision?.city?.name ?? summary.currentRevision?.canton?.name ?? "Remote / offen",
      applications: summary._count.applications,
      views: summary.viewAggregates.reduce((sum, row) => sum + row.viewCount, 0),
      saves: summary._count.savedBy,
      capabilities,
    });
  }

  const fullAssignmentRoles = actor.membershipRole === "RECRUITER" ? ["EDITOR", "REVIEWER"] as const : undefined;
  const [job, auditEvents] = await Promise.all([
    database.job.findFirst({
      where: { id: jobId, ...buildEmployerJobScopeWhere(actor, now, { assignmentRoles: fullAssignmentRoles }), status: { not: "REMOVED" } },
      select: fullJobSelect(actor, now),
    }),
    database.auditLog.findMany({
      where: {
        companyId: actor.companyId,
        OR: [
          { targetType: "JOB", targetId: jobId },
          ...(summary.currentRevision === null ? [] : [{ targetType: "JOB_REVISION" as const, targetId: summary.currentRevision.id }]),
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10,
      select: { action: true, result: true, reasonCode: true, createdAt: true },
    }),
  ]);
  if (job === null) return null;
  const revision = job.currentRevision;
  const score = revision === null ? null : calculateFairJobScoreV2(
    buildFairJobInputV2({ job: { id: job.id }, revision: toFairJobRevision(revision) }),
    { now },
  );
  const scoreSnapshot = revision?.scoreSnapshots[0];
  return Object.freeze({
    access: "FULL",
    id: job.id,
    slug: job.slug,
    status: job.status as JobStatus,
    version: job.version,
    currentRevisionId: job.currentRevisionId,
    publishedRevisionId: job.publishedRevisionId,
    publishedAt: job.publishedAt,
    expiresAt: job.expiresAt,
    revision: revision === null ? null : toRevisionDetail(revision),
    applications: job._count.applications,
    views: job.viewAggregates.reduce((sum, row) => sum + row.viewCount, 0),
    saves: job._count.savedBy,
    boostStatus: effectiveBoostStatus(job.boosts[0], now),
    capabilities,
    score,
    latestScoreSnapshot: scoreSnapshot === undefined ? null : Object.freeze({ points: scoreSnapshot.scorePoints, maxPoints: scoreSnapshot.maxPoints, calculatedAt: scoreSnapshot.calculatedAt }),
    statusEvents: Object.freeze(job.statusEvents),
    auditEvents: Object.freeze(auditEvents),
  });
}

export type EmployerJobCommandCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CONFLICT"
  | "INCOMPLETE"
  | "PROVIDER_MISMATCH"
  | "QUOTA_EXCEEDED"
  | "VERIFICATION_REQUIRED"
  | "RESTRICTED"
  | "WRITE_FAILED";

export type EmployerJobQuotaReason = Extract<
  FeatureGateReason,
  | "ACTIVE_JOB_LIMIT_REACHED"
  | "ADDITIONAL_JOB_PERMIT_REQUIRED"
  | "ADDITIONAL_JOB_PERMIT_INVALID"
>;

export type EmployerJobCommandResult<TValue> =
  | Readonly<{ ok: true; value: TValue; replay?: boolean }>
  | Readonly<{
      ok: false;
      code: EmployerJobCommandCode;
      issues?: readonly string[];
      quotaReason?: EmployerJobQuotaReason;
      suggestedPlanSlug?: string;
    }>;

export type EmployerJobCommandDependencies = Readonly<{
  actor: EmployerJobActor;
  correlationId: string;
  database: DatabaseClient;
  now?: Date;
  aiProvider?: AiProvider;
  jobroomProvider?: JobroomProvider;
}>;

export type EmployerJobFormState = Readonly<{
  status: "idle" | "success" | "error" | "conflict";
  message?: string;
  nextIdempotencyKey?: string;
  suggestion?: string;
  upgradePrompt?: UpgradePrompt;
}>;

export const INITIAL_EMPLOYER_JOB_FORM_STATE: EmployerJobFormState = Object.freeze({ status: "idle" });

type JobVersionValue = Readonly<{
  jobId: string;
  revisionId: string;
  jobVersion: number;
  revisionVersion: number;
}>;

export async function createEmployerJobDraft(
  input: JobWizardStepOne & Readonly<{ idempotencyKey: string }>,
  dependencies: EmployerJobCommandDependencies,
): Promise<EmployerJobCommandResult<JobVersionValue>> {
  const { idempotencyKey: rawIdempotencyKey, ...draftInput } = input;
  const parsed = jobWizardStepOneSchema.safeParse(draftInput);
  const key = idempotencyKey.safeParse(rawIdempotencyKey);
  if (!parsed.success || !key.success) return failure("INVALID_INPUT", zodIssues(parsed));
  const now = validNow(dependencies.now);
  const actor = dependencies.actor;
  if (actor.membershipRole === "VIEWER") return failure("FORBIDDEN");
  if (parsed.data.validThrough !== null && !isFuturePublicationDate(parsed.data.validThrough, now)) {
    return failure("INVALID_INPUT", ["validThrough"]);
  }
  const eventKey = operationKey("job-create", key.data);
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      const membership = await transaction.companyMembership.findFirst({
        where: {
          id: actor.membershipId,
          userId: actor.userId,
          companyId: actor.companyId,
          role: actor.membershipRole,
          status: "ACTIVE",
          removedAt: null,
          company: { status: "ACTIVE" },
        },
        select: { id: true, company: { select: { slug: true } } },
      });
      if (membership === null) return failure("NOT_FOUND");
      if (actor.membershipRole === "RECRUITER") {
        const activeRecruiter = await transaction.companyMembership.findFirst({
          where: { id: actor.membershipId, companyId: actor.companyId, userId: actor.userId, role: "RECRUITER", status: "ACTIVE", removedAt: null },
          select: { id: true },
        });
        if (activeRecruiter === null) return failure("NOT_FOUND");
      }
      const replay = await transaction.jobStatusEvent.findFirst({
        where: { idempotencyKey: eventKey, job: buildEmployerJobScopeWhere(actor, now, { activeCompanyOnly: true }) },
        select: { job: { select: { id: true, version: true, currentRevision: { select: { id: true, version: true } } } } },
      });
      if (replay?.job.currentRevision !== null && replay?.job.currentRevision !== undefined) {
        return success({
          jobId: replay.job.id,
          revisionId: replay.job.currentRevision.id,
          jobVersion: replay.job.version,
          revisionVersion: replay.job.currentRevision.version,
        }, true);
      }
      const catalogValid = await validateStepOneCatalog(transaction, parsed.data);
      if (!catalogValid) return failure("INVALID_INPUT", ["catalog"]);

      const jobId = randomUUID();
      const revisionId = randomUUID();
      const revisionNumber = 1;
      const validThrough = parsed.data.validThrough ?? new Date(now.getTime() + 30 * DAY);
      const initialRevision = initialRevisionSnapshot(jobId, revisionId, revisionNumber, parsed.data, actor, validThrough);
      await transaction.job.create({
        data: {
          id: jobId,
          companyId: actor.companyId,
          slug: createJobSlug({
            title: parsed.data.title,
            companyShortRef: membership.company.slug,
            jobId,
          }),
          status: "DRAFT",
          origin: "MANUAL",
          sourceReference: `employer:${actor.membershipId}`,
          version: 1,
          createdByUserId: actor.userId,
        },
        select: { id: true },
      });
      await transaction.jobRevision.create({ data: initialRevision, select: { id: true } });
      if (parsed.data.languages.length > 0) {
        await transaction.jobRevisionLanguage.createMany({
          data: parsed.data.languages.map((language) => ({ jobRevisionId: revisionId, ...language })),
        });
      }
      await transaction.job.update({ where: { id: jobId }, data: { currentRevisionId: revisionId }, select: { id: true } });
      await transaction.jobStatusEvent.create({
        data: {
          jobId,
          jobRevisionId: revisionId,
          kind: "DRAFT_CREATED",
          fromStatus: null,
          toStatus: "DRAFT",
          actorUserId: actor.userId,
          idempotencyKey: eventKey,
          correlationId: dependencies.correlationId,
        },
      });
      await writeJobAudit(transaction, dependencies, now, "JOB_DRAFT_UPDATED", "JOB", jobId, "EMPLOYER_JOB_CREATE");
      if (actor.membershipRole === "RECRUITER") {
        const assignment = await transaction.jobAssignment.create({
          data: {
            membershipId: actor.membershipId,
            companyId: actor.companyId,
            jobId,
            userId: actor.userId,
            role: "EDITOR",
            status: "ACTIVE",
            assignedByUserId: actor.userId,
            validFrom: now,
          },
          select: { id: true },
        });
        await transaction.jobAssignmentEvent.create({
          data: {
            jobAssignmentId: assignment.id,
            kind: "ASSIGNED",
            toRole: "EDITOR",
            actorUserId: actor.userId,
            correlationId: dependencies.correlationId,
          },
        });
        await writeJobAudit(transaction, dependencies, now, "JOB_ASSIGNMENT_CREATED", "JOB_ASSIGNMENT", assignment.id, "EMPLOYER_JOB_SELF_ASSIGN");
      }
      return success({ jobId, revisionId, jobVersion: 1, revisionVersion: 1 });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    return commandFailureFromError(error);
  }
}

export async function duplicateEmployerJob(
  input: JobCommandEnvelope,
  dependencies: EmployerJobCommandDependencies,
): Promise<EmployerJobCommandResult<JobVersionValue>> {
  const parsed = jobCommandEnvelopeSchema.safeParse(input);
  if (!parsed.success) return failure("INVALID_INPUT");
  const actor = dependencies.actor;
  const now = validNow(dependencies.now);
  const eventKey = operationKey("job-duplicate", parsed.data.idempotencyKey);
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      const replay = await transaction.jobStatusEvent.findFirst({
        where: {
          idempotencyKey: eventKey,
          reasonCode: "DUPLICATED",
          job: buildEmployerJobScopeWhere(actor, now, {
            assignmentRoles: actor.membershipRole === "RECRUITER" ? ["EDITOR"] : undefined,
            activeCompanyOnly: true,
          }),
        },
        select: { job: { select: { id: true, version: true, currentRevision: { select: { id: true, version: true } } } } },
      });
      if (replay?.job.currentRevision !== null && replay?.job.currentRevision !== undefined) {
        return success({
          jobId: replay.job.id,
          revisionId: replay.job.currentRevision.id,
          jobVersion: replay.job.version,
          revisionVersion: replay.job.currentRevision.version,
        }, true);
      }

      const source = await loadLockedMutationJob(transaction, actor, parsed.data.jobId, now, ["EDITOR"], eventKey);
      if (source === null || source.currentRevision === null || source.status === "REMOVED") return failure("NOT_FOUND");
      const sourceCapabilities = resolveEmployerJobCapabilities(actor.membershipRole, source.assignments[0]?.role ?? null);
      if (!sourceCapabilities.manageLifecycle && !sourceCapabilities.mutateDraft) return failure("NOT_FOUND");
      if (source.version !== parsed.data.expectedJobVersion || source.currentRevision.version !== parsed.data.expectedRevisionVersion) {
        return failure("CONFLICT");
      }

      const jobId = randomUUID();
      const revisionId = randomUUID();
      const validThrough = isFuturePublicationDate(source.currentRevision.validThrough, now)
        ? source.currentRevision.validThrough
        : new Date(now.getTime() + 30 * DAY);
      const revisionData = {
        ...cloneRevisionScalarData(source.currentRevision),
        jobId,
        validThrough,
      };
      await transaction.job.create({
        data: {
          id: jobId,
          companyId: actor.companyId,
          slug: createJobSlug({
            title: source.currentRevision.title,
            companyShortRef: source.company.slug,
            jobId,
          }),
          status: "DRAFT",
          origin: "MANUAL",
          sourceReference: `duplicate:${source.id}`,
          version: 1,
          createdByUserId: actor.userId,
        },
        select: { id: true },
      });
      await transaction.jobRevision.create({
        data: {
          ...revisionData,
          id: revisionId,
          revisionNumber: 1,
          authoredByUserId: actor.userId,
          contentChecksum: checksumRevision({
            ...revisionChecksumInput(source.currentRevision),
            jobId,
            revisionNumber: 1,
            validThrough,
          }),
          version: 1,
          submittedAt: null,
          approvedAt: null,
          rejectedAt: null,
        },
      });
      await copyRevisionChildren(transaction, source.currentRevision, revisionId);
      await transaction.job.update({ where: { id: jobId }, data: { currentRevisionId: revisionId }, select: { id: true } });
      await transaction.jobStatusEvent.create({
        data: {
          jobId,
          jobRevisionId: revisionId,
          kind: "DRAFT_CREATED",
          fromStatus: null,
          toStatus: "DRAFT",
          actorUserId: actor.userId,
          reasonCode: "DUPLICATED",
          idempotencyKey: eventKey,
          correlationId: dependencies.correlationId,
        },
      });
      await writeJobAudit(transaction, dependencies, now, "JOB_DRAFT_UPDATED", "JOB", jobId, "EMPLOYER_JOB_DUPLICATE");

      if (actor.membershipRole === "RECRUITER") {
        const assignment = await transaction.jobAssignment.create({
          data: {
            membershipId: actor.membershipId,
            companyId: actor.companyId,
            jobId,
            userId: actor.userId,
            role: "EDITOR",
            status: "ACTIVE",
            assignedByUserId: actor.userId,
            validFrom: now,
          },
          select: { id: true },
        });
        await transaction.jobAssignmentEvent.create({
          data: {
            jobAssignmentId: assignment.id,
            kind: "ASSIGNED",
            toRole: "EDITOR",
            actorUserId: actor.userId,
            reasonCode: "DUPLICATED_JOB_SELF_ASSIGN",
            correlationId: dependencies.correlationId,
          },
        });
        await writeJobAudit(transaction, dependencies, now, "JOB_ASSIGNMENT_CREATED", "JOB_ASSIGNMENT", assignment.id, "EMPLOYER_JOB_SELF_ASSIGN");
      }
      return success({ jobId, revisionId, jobVersion: 1, revisionVersion: 1 });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    return commandFailureFromError(error);
  }
}

export type SaveEmployerJobStepInput = JobCommandEnvelope & Readonly<{
  step: 1 | 2 | 3;
  data: JobWizardStepOne | JobWizardStepTwo | JobWizardStepThree;
}>;

export async function saveEmployerJobStep(
  input: SaveEmployerJobStepInput,
  dependencies: EmployerJobCommandDependencies,
): Promise<EmployerJobCommandResult<JobVersionValue>> {
  const envelope = jobCommandEnvelopeSchema.safeParse({
    jobId: input.jobId,
    expectedJobVersion: input.expectedJobVersion,
    expectedRevisionVersion: input.expectedRevisionVersion,
    idempotencyKey: input.idempotencyKey,
  });
  const dataResult = input.step === 1
    ? jobWizardStepOneSchema.safeParse(input.data)
    : input.step === 2
      ? jobWizardStepTwoSchema.safeParse(input.data)
      : jobWizardStepThreeSchema.safeParse(input.data);
  if (!envelope.success || !dataResult.success) return failure("INVALID_INPUT", zodIssues(dataResult));
  const now = validNow(dependencies.now);
  const eventKey = operationKey(`job-step-${input.step}`, envelope.data.idempotencyKey);
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      const loaded = await loadLockedMutationJob(transaction, dependencies.actor, envelope.data.jobId, now, ["EDITOR"], eventKey);
      if (loaded === null) return failure("NOT_FOUND");
      if (!canMutateJob(dependencies.actor, loaded.assignments[0]?.role ?? null)) return failure("NOT_FOUND");
      if (loaded.status !== "DRAFT" && loaded.status !== "CHANGES_REQUESTED") return failure("CONFLICT");
      if (loaded.statusEvents.length > 0) return currentVersionSuccess(loaded, true);
      const revision = loaded.currentRevision;
      if (revision === null) return failure("CONFLICT");
      if (loaded.version !== envelope.data.expectedJobVersion || revision.version !== envelope.data.expectedRevisionVersion) {
        return failure("CONFLICT");
      }
      if (input.step === 1) {
        const step = jobWizardStepOneSchema.parse(input.data);
        if (step.validThrough !== null && !isFuturePublicationDate(step.validThrough, now)) return failure("INVALID_INPUT", ["validThrough"]);
        if (!await validateStepOneCatalog(transaction, step)) return failure("INVALID_INPUT", ["catalog"]);
      }
      if (input.step === 2) {
        const step = jobWizardStepTwoSchema.parse(input.data);
        if (!await validateSkillCatalog(transaction, step.skillIds)) return failure("INVALID_INPUT", ["skillIds"]);
      }

      if (revision.submittedAt !== null) {
        if (loaded.status !== "CHANGES_REQUESTED") return failure("CONFLICT");
        const cloned = await createEditableClone(transaction, loaded, dependencies.actor.userId, input.step, dataResult.data);
        const updated = await transaction.job.updateMany({
          where: { id: loaded.id, version: loaded.version, currentRevisionId: revision.id },
          data: { currentRevisionId: cloned.id, version: { increment: 1 } },
        });
        if (updated.count !== 1) throw new EmployerJobCommandError("CONFLICT");
        await writeDraftUpdatedEvidence(transaction, dependencies, now, loaded, cloned.id, eventKey);
        return success({ jobId: loaded.id, revisionId: cloned.id, jobVersion: loaded.version + 1, revisionVersion: 1 });
      }

      const nextRevision = applyStepToRevision(revision, input.step, dataResult.data);
      const revisionUpdate = await transaction.jobRevision.updateMany({
        where: { id: revision.id, jobId: loaded.id, version: revision.version, submittedAt: null },
        data: { ...nextRevision.data, contentChecksum: checksumRevision(nextRevision.checksum), version: { increment: 1 } },
      });
      if (revisionUpdate.count !== 1) return failure("CONFLICT");
      await replaceStepChildren(transaction, revision.id, input.step, dataResult.data);
      const jobUpdate = await transaction.job.updateMany({
        where: { id: loaded.id, version: loaded.version, currentRevisionId: revision.id },
        data: { version: { increment: 1 } },
      });
      if (jobUpdate.count !== 1) throw new EmployerJobCommandError("CONFLICT");
      await writeDraftUpdatedEvidence(transaction, dependencies, now, loaded, revision.id, eventKey);
      return success({ jobId: loaded.id, revisionId: revision.id, jobVersion: loaded.version + 1, revisionVersion: revision.version + 1 });
    });
  } catch (error) {
    return commandFailureFromError(error);
  }
}

export async function runEmployerJobReportingCheck(
  input: JobCommandEnvelope & Readonly<{ occupationCodeId: string }>,
  dependencies: EmployerJobCommandDependencies,
): Promise<EmployerJobCommandResult<JobVersionValue & Readonly<{ checkId: string }>>> {
  const parsed = jobCommandEnvelopeSchema.extend({ occupationCodeId: z.uuid() }).safeParse(input);
  if (!parsed.success || dependencies.jobroomProvider === undefined) return failure("INVALID_INPUT");
  const now = validNow(dependencies.now);
  const actor = dependencies.actor;
  const eventKey = operationKey("job-reporting", parsed.data.idempotencyKey);
  const preflight = await dependencies.database.job.findFirst({
    where: { id: parsed.data.jobId, ...buildEmployerJobScopeWhere(actor, now, { assignmentRoles: ["EDITOR"], activeCompanyOnly: true }) },
    select: {
      id: true,
      status: true,
      currentRevision: { select: { id: true, canton: { select: { code: true } }, reportingChecks: { orderBy: [{ checkedAt: "desc" }, { id: "desc" }], take: 1, select: { id: true } } } },
      statusEvents: { where: { idempotencyKey: eventKey }, take: 1, select: { id: true } },
      assignments: { where: currentAssignmentWhere(actor, now), take: 1, select: { role: true } },
    },
  });
  if (preflight === null || !canMutateJob(actor, preflight.assignments[0]?.role ?? null)) return failure("NOT_FOUND");
  if (preflight.statusEvents.length > 0 && preflight.currentRevision?.reportingChecks[0] !== undefined) {
    const versioned = await dependencies.database.job.findFirst({
      where: { id: parsed.data.jobId, ...buildEmployerJobScopeWhere(actor, now, { assignmentRoles: ["EDITOR"] }) },
      select: { id: true, version: true, currentRevision: { select: { id: true, version: true } } },
    });
    if (versioned?.currentRevision === null || versioned?.currentRevision === undefined) return failure("CONFLICT");
    return success({ jobId: versioned.id, revisionId: versioned.currentRevision.id, jobVersion: versioned.version, revisionVersion: versioned.currentRevision.version, checkId: preflight.currentRevision.reportingChecks[0].id }, true);
  }
  const selectedOccupation = await dependencies.database.occupationCode.findFirst({
    where: { id: parsed.data.occupationCodeId },
    select: { code: true },
  });
  if (selectedOccupation === null) return failure("PROVIDER_MISMATCH");
  const providerResult = await dependencies.jobroomProvider.checkReportingObligation({
    occupationCode: selectedOccupation.code,
    cantonCode: preflight.currentRevision?.canton?.code,
  });
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      const loaded = await loadLockedMutationJob(transaction, actor, parsed.data.jobId, now, ["EDITOR"], eventKey);
      if (loaded === null || !canMutateJob(actor, loaded.assignments[0]?.role ?? null)) return failure("NOT_FOUND");
      if (loaded.status !== "DRAFT" && loaded.status !== "CHANGES_REQUESTED") return failure("CONFLICT");
      if (loaded.statusEvents.length > 0) {
        const check = loaded.currentRevision?.reportingChecks[0];
        return check === undefined ? failure("CONFLICT") : success({ jobId: loaded.id, revisionId: loaded.currentRevision!.id, jobVersion: loaded.version, revisionVersion: loaded.currentRevision!.version, checkId: check.id }, true);
      }
      const revision = loaded.currentRevision;
      if (revision === null || revision.submittedAt !== null) return failure("CONFLICT");
      if (loaded.version !== parsed.data.expectedJobVersion || revision.version !== parsed.data.expectedRevisionVersion) return failure("CONFLICT");
      const code = await transaction.occupationCode.findFirst({
        where: {
          id: parsed.data.occupationCodeId,
          occupationCodeVersion: { version: providerResult.datasetVersion, datasetYear: providerResult.dataYear },
        },
        select: {
          id: true,
          code: true,
          label: true,
          result: true,
          occupationCodeVersion: { select: { id: true, version: true, datasetYear: true, source: true, referenceUrl: true, disclaimer: true } },
        },
      });
      if (
        code === null ||
        code.code !== selectedOccupation.code ||
        code.result !== providerResult.result ||
        code.occupationCodeVersion.disclaimer !== providerResult.disclaimer ||
        code.occupationCodeVersion.referenceUrl !== providerResult.sourceUrl
      ) {
        return failure("PROVIDER_MISMATCH");
      }
      const checkId = randomUUID();
      await transaction.jobReportingCheck.create({
        data: {
          id: checkId,
          jobRevisionId: revision.id,
          occupationCodeVersionId: code.occupationCodeVersion.id,
          occupationCodeId: code.id,
          occupationCodeSnapshot: code.code,
          occupationLabelSnapshot: code.label,
          result: providerResult.result,
          reasonSnapshot: jobroomReasonCopy(providerResult.reasonCode),
          disclaimerSnapshot: providerResult.disclaimer,
          sourceSnapshot: code.occupationCodeVersion.source,
          datasetVersionSnapshot: providerResult.datasetVersion,
          dataYearSnapshot: providerResult.dataYear,
          referenceUrlSnapshot: providerResult.sourceUrl,
          checkedByUserId: actor.userId,
          checkedAt: now,
        },
      });
      const revisionUpdate = await transaction.jobRevision.updateMany({ where: { id: revision.id, version: revision.version, submittedAt: null }, data: { version: { increment: 1 } } });
      const jobUpdate = await transaction.job.updateMany({ where: { id: loaded.id, version: loaded.version, currentRevisionId: revision.id }, data: { version: { increment: 1 } } });
      if (revisionUpdate.count !== 1 || jobUpdate.count !== 1) throw new EmployerJobCommandError("CONFLICT");
      await transaction.jobStatusEvent.create({ data: { jobId: loaded.id, jobRevisionId: revision.id, kind: "DRAFT_UPDATED", fromStatus: loaded.status, toStatus: loaded.status, actorUserId: actor.userId, reasonCode: "REPORTING_CHECK", idempotencyKey: eventKey, correlationId: dependencies.correlationId } });
      await writeJobAudit(transaction, dependencies, now, "JOB_REPORTING_CHECKED", "JOB_REVISION", revision.id, "EMPLOYER_JOB_REPORTING_CHECK");
      return success({ jobId: loaded.id, revisionId: revision.id, jobVersion: loaded.version + 1, revisionVersion: revision.version + 1, checkId });
    });
  } catch (error) {
    logger.error(
      "employer_job.reporting_check_write_failed",
      {
        error,
        errorCode: databaseErrorCode(error),
        operation: "EMPLOYER_JOB_REPORTING_CHECK",
      },
      dependencies.correlationId,
    );
    return commandFailureFromError(error);
  }
}

export const EMPLOYER_JOB_AI_OPERATIONS = ["IMPROVE", "INCLUSIVE", "SHORTEN_REQUIREMENTS", "SALARY_TRANSPARENCY"] as const;
export const employerJobAiSuggestionSchema = z.strictObject({
  jobId: z.uuid(),
  operation: z.enum(EMPLOYER_JOB_AI_OPERATIONS),
  text: trimmedString(0, 5_000),
});
export type EmployerJobAiOperation = (typeof EMPLOYER_JOB_AI_OPERATIONS)[number];

export async function getEmployerJobAiSuggestion(
  input: Readonly<{ jobId: string; operation: EmployerJobAiOperation; text: string }>,
  dependencies: EmployerJobCommandDependencies,
): Promise<EmployerJobCommandResult<Readonly<{ suggestion: string }>>> {
  const parsed = employerJobAiSuggestionSchema.safeParse(input);
  if (!parsed.success || dependencies.aiProvider === undefined) return failure("INVALID_INPUT");
  const detail = await getEmployerJobDetail(dependencies.actor, parsed.data.jobId, dependencies.database, validNow(dependencies.now));
  if (detail === null || detail.access !== "FULL" || !detail.capabilities.mutateDraft || detail.revision === null) return failure("NOT_FOUND");
  if (detail.status !== "DRAFT" && detail.status !== "CHANGES_REQUESTED") return failure("CONFLICT");
  const text = stripUnsafeHtml(parsed.data.text);
  let suggestion: string;
  if (parsed.data.operation === "IMPROVE") suggestion = await dependencies.aiProvider.improveJobText(text);
  else if (parsed.data.operation === "INCLUSIVE") suggestion = await dependencies.aiProvider.rewriteInclusive(text);
  else if (parsed.data.operation === "SHORTEN_REQUIREMENTS") suggestion = await dependencies.aiProvider.shortenRequirements(text);
  else {
    const revision = detail.revision;
    const suggestions = await dependencies.aiProvider.suggestFairScoreImprovements({
      title: revision.title,
      tasks: revision.tasks.join("\n"),
      requirements: revision.requirements.join("\n"),
      offer: revision.offer ?? "",
      ...(revision.salaryMin === null ? {} : { salaryMin: revision.salaryMin }),
      ...(revision.salaryMax === null ? {} : { salaryMax: revision.salaryMax }),
    });
    suggestion = suggestions.find((item) => /Lohnspanne|Lohntransparenz/iu.test(item)) ?? "Die aktuelle Lohnspanne ist vollständig; es wurde kein zusätzlicher Hinweis erzeugt.";
  }
  return success(Object.freeze({ suggestion }));
}

export async function submitEmployerJobForReview(
  input: JobCommandEnvelope,
  dependencies: EmployerJobCommandDependencies,
): Promise<EmployerJobCommandResult<JobVersionValue>> {
  const parsed = jobCommandEnvelopeSchema.safeParse(input);
  if (!parsed.success) return failure("INVALID_INPUT");
  const now = validNow(dependencies.now);
  const eventKey = operationKey("job-submit", parsed.data.idempotencyKey);
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      const loaded = await loadLockedMutationJob(transaction, dependencies.actor, parsed.data.jobId, now, ["EDITOR"], eventKey);
      if (loaded === null || !canMutateJob(dependencies.actor, loaded.assignments[0]?.role ?? null)) return failure("NOT_FOUND");
      if (loaded.statusEvents.length > 0 && loaded.status === "SUBMITTED") return currentVersionSuccess(loaded, true);
      const revision = loaded.currentRevision;
      if (revision === null || revision.submittedAt !== null) return failure("CONFLICT");
      if (loaded.version !== parsed.data.expectedJobVersion || revision.version !== parsed.data.expectedRevisionVersion) return failure("CONFLICT");
      const actorCapability = jobActorCapability(dependencies.actor, loaded.assignments[0]?.role ?? null);
      if (actorCapability === null) return failure("NOT_FOUND");
      const decision = decideJobTransition({ action: "SUBMIT", actor: actorCapability, currentStatus: loaded.status as JobStatus });
      if (decision.type !== "OK") return failure(decision.type === "CONFLICT" ? "CONFLICT" : "FORBIDDEN");
      const issues = validateCompleteRevision(loaded, now);
      if (issues.length > 0) return failure("INCOMPLETE", issues);
      const snapshot = buildFairJobScoreSnapshotV2({ job: { id: loaded.id }, revision: toFairJobRevision(revision), clock: { now } });
      await transaction.jobScoreSnapshot.create({
        data: {
          jobRevisionId: snapshot.jobRevisionId,
          scoreVersion: snapshot.scoreVersion,
          scorePoints: snapshot.scorePoints,
          maxPoints: snapshot.maxPoints,
          inputSnapshot: snapshot.inputSnapshot as Prisma.InputJsonValue,
          evidence: snapshot.evidence as Prisma.InputJsonValue,
          factorBreakdown: snapshot.factorBreakdown as Prisma.InputJsonValue,
          evidenceHash: snapshot.evidenceHash,
          calculatedAt: snapshot.calculatedAt,
        },
      });
      const revisionUpdate = await transaction.jobRevision.updateMany({ where: { id: revision.id, jobId: loaded.id, version: revision.version, submittedAt: null }, data: { submittedAt: now, version: { increment: 1 } } });
      const jobUpdate = await transaction.job.updateMany({ where: { id: loaded.id, version: loaded.version, currentRevisionId: revision.id, status: loaded.status }, data: { status: "SUBMITTED", version: { increment: 1 } } });
      if (revisionUpdate.count !== 1 || jobUpdate.count !== 1) throw new EmployerJobCommandError("CONFLICT");
      await transaction.jobStatusEvent.create({ data: { jobId: loaded.id, jobRevisionId: revision.id, kind: "SUBMITTED", fromStatus: loaded.status, toStatus: "SUBMITTED", actorUserId: dependencies.actor.userId, idempotencyKey: eventKey, correlationId: dependencies.correlationId } });
      await writeJobAudit(transaction, dependencies, now, "JOB_SUBMITTED", "JOB", loaded.id, "EMPLOYER_JOB_SUBMIT");
      return success({ jobId: loaded.id, revisionId: revision.id, jobVersion: loaded.version + 1, revisionVersion: revision.version + 1 });
    });
  } catch (error) {
    return commandFailureFromError(error);
  }
}

export async function pauseEmployerJob(
  input: JobCommandEnvelope,
  dependencies: EmployerJobCommandDependencies,
): Promise<EmployerJobCommandResult<JobVersionValue>> {
  return transitionManagedJob(input, dependencies, {
    action: "PAUSE_UNCHANGED",
    eventKind: "PAUSED",
    auditAction: "JOB_PAUSED",
    auditCapability: "EMPLOYER_JOB_PAUSE",
    toStatus: "PAUSED",
    operation: "job-pause",
  });
}

export async function closeEmployerJob(
  input: JobCommandEnvelope,
  dependencies: EmployerJobCommandDependencies,
): Promise<EmployerJobCommandResult<JobVersionValue>> {
  return transitionManagedJob(input, dependencies, {
    action: "CLOSE",
    eventKind: "CLOSED",
    auditAction: "JOB_CLOSED",
    auditCapability: "EMPLOYER_JOB_CLOSE",
    toStatus: "CLOSED",
    operation: "job-close",
  });
}

export async function pauseAndCreateEmployerJobRevision(
  input: JobCommandEnvelope,
  dependencies: EmployerJobCommandDependencies,
): Promise<EmployerJobCommandResult<JobVersionValue>> {
  const parsed = jobCommandEnvelopeSchema.safeParse(input);
  if (!parsed.success) return failure("INVALID_INPUT");
  const now = validNow(dependencies.now);
  const pauseEventKey = operationKey("job-pause-edit", parsed.data.idempotencyKey);
  const draftEventKey = operationKey("job-pause-edit-draft", parsed.data.idempotencyKey);
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      const loaded = await loadLockedMutationJob(transaction, dependencies.actor, parsed.data.jobId, now, [], draftEventKey, true);
      if (loaded === null || !canManageJobLifecycle(dependencies.actor)) return failure("NOT_FOUND");
      if (loaded.statusEvents.length > 0 && loaded.status === "DRAFT") return currentVersionSuccess(loaded, true);
      const revision = loaded.currentRevision;
      if (revision === null || loaded.currentRevisionId !== loaded.publishedRevisionId) return failure("CONFLICT");
      if (loaded.version !== parsed.data.expectedJobVersion || revision.version !== parsed.data.expectedRevisionVersion) return failure("CONFLICT");
      const actorCapability = jobActorCapability(dependencies.actor, null);
      if (actorCapability === null) return failure("FORBIDDEN");
      const pauseDecision = decideJobTransition({ action: "PAUSE_FOR_MATERIAL_EDIT", actor: actorCapability, currentStatus: loaded.status as JobStatus });
      if (pauseDecision.type !== "OK") return failure("CONFLICT");
      const draftDecision = decideJobTransition({ action: "CREATE_REVISION_FROM_PAUSED", actor: actorCapability, currentStatus: "PAUSED" });
      if (draftDecision.type !== "OK") return failure("CONFLICT");
      const cloned = await cloneRevision(transaction, loaded, dependencies.actor.userId);
      const updated = await transaction.job.updateMany({
        where: { id: loaded.id, version: loaded.version, currentRevisionId: revision.id, publishedRevisionId: revision.id, status: "PUBLISHED" },
        data: { status: "DRAFT", currentRevisionId: cloned.id, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new EmployerJobCommandError("CONFLICT");
      await transaction.jobStatusEvent.createMany({ data: [
        { jobId: loaded.id, jobRevisionId: revision.id, kind: "PAUSED", fromStatus: "PUBLISHED", toStatus: "PAUSED", actorUserId: dependencies.actor.userId, reasonCode: "MATERIAL_EDIT", idempotencyKey: pauseEventKey, correlationId: dependencies.correlationId },
        { jobId: loaded.id, jobRevisionId: cloned.id, kind: "REVISION_REOPENED", fromStatus: "PAUSED", toStatus: "DRAFT", actorUserId: dependencies.actor.userId, reasonCode: "MATERIAL_EDIT", idempotencyKey: draftEventKey, correlationId: dependencies.correlationId },
      ] });
      await writeJobAudit(transaction, dependencies, now, "JOB_PAUSED", "JOB", loaded.id, "EMPLOYER_JOB_PAUSE_EDIT");
      await writeJobAudit(transaction, dependencies, now, "JOB_DRAFT_UPDATED", "JOB_REVISION", cloned.id, "EMPLOYER_JOB_REVISION_CREATE");
      return success({ jobId: loaded.id, revisionId: cloned.id, jobVersion: loaded.version + 1, revisionVersion: 1 });
    });
  } catch (error) {
    return commandFailureFromError(error);
  }
}

export async function createEmployerJobRevisionFromPaused(
  input: JobCommandEnvelope,
  dependencies: EmployerJobCommandDependencies,
): Promise<EmployerJobCommandResult<JobVersionValue>> {
  return createEmployerJobRevisionFromTerminal(input, dependencies, "PAUSED");
}

export async function createEmployerJobRevisionFromRejected(
  input: JobCommandEnvelope,
  dependencies: EmployerJobCommandDependencies,
): Promise<EmployerJobCommandResult<JobVersionValue>> {
  return createEmployerJobRevisionFromTerminal(input, dependencies, "REJECTED");
}

async function createEmployerJobRevisionFromTerminal(
  input: JobCommandEnvelope,
  dependencies: EmployerJobCommandDependencies,
  sourceStatus: "PAUSED" | "REJECTED",
): Promise<EmployerJobCommandResult<JobVersionValue>> {
  const parsed = jobCommandEnvelopeSchema.safeParse(input);
  if (!parsed.success) return failure("INVALID_INPUT");
  const now = validNow(dependencies.now);
  const eventKey = operationKey(sourceStatus === "PAUSED" ? "job-clone-paused" : "job-clone-rejected", parsed.data.idempotencyKey);
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      const loaded = await loadLockedMutationJob(transaction, dependencies.actor, parsed.data.jobId, now, [], eventKey, true);
      if (loaded === null || !canManageJobLifecycle(dependencies.actor)) return failure("NOT_FOUND");
      if (loaded.statusEvents.length > 0 && loaded.status === "DRAFT") return currentVersionSuccess(loaded, true);
      const revision = loaded.currentRevision;
      if (revision === null || loaded.status !== sourceStatus) return failure("CONFLICT");
      if (loaded.version !== parsed.data.expectedJobVersion || revision.version !== parsed.data.expectedRevisionVersion) return failure("CONFLICT");
      if (sourceStatus === "PAUSED" && loaded.currentRevisionId !== loaded.publishedRevisionId) return failure("CONFLICT");
      const actorCapability = jobActorCapability(dependencies.actor, null);
      if (actorCapability === null) return failure("FORBIDDEN");
      const decision = decideJobTransition({
        action: sourceStatus === "PAUSED" ? "CREATE_REVISION_FROM_PAUSED" : "CLONE_REJECTED_REVISION",
        actor: actorCapability,
        currentStatus: loaded.status as JobStatus,
      });
      if (decision.type !== "OK") return failure("CONFLICT");
      const cloned = await cloneRevision(transaction, loaded, dependencies.actor.userId);
      const updated = await transaction.job.updateMany({
        where: { id: loaded.id, version: loaded.version, currentRevisionId: revision.id, status: sourceStatus },
        data: { status: "DRAFT", currentRevisionId: cloned.id, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new EmployerJobCommandError("CONFLICT");
      await transaction.jobStatusEvent.create({ data: { jobId: loaded.id, jobRevisionId: cloned.id, kind: "REVISION_REOPENED", fromStatus: sourceStatus, toStatus: "DRAFT", actorUserId: dependencies.actor.userId, reasonCode: sourceStatus === "REJECTED" ? "REJECTED_REVISION_CLONED" : "PAUSED_REVISION_CLONED", idempotencyKey: eventKey, correlationId: dependencies.correlationId } });
      await writeJobAudit(transaction, dependencies, now, "JOB_DRAFT_UPDATED", "JOB_REVISION", cloned.id, "EMPLOYER_JOB_REVISION_CREATE");
      return success({ jobId: loaded.id, revisionId: cloned.id, jobVersion: loaded.version + 1, revisionVersion: 1 });
    });
  } catch (error) {
    return commandFailureFromError(error);
  }
}

export async function reactivateEmployerJob(
  input: JobCommandEnvelope,
  dependencies: EmployerJobCommandDependencies,
): Promise<EmployerJobCommandResult<JobVersionValue>> {
  const parsed = jobCommandEnvelopeSchema.safeParse(input);
  if (!parsed.success) return failure("INVALID_INPUT");
  if (!canManageJobLifecycle(dependencies.actor)) return failure("NOT_FOUND");
  const now = validNow(dependencies.now);
  const eventKey = operationKey("job-reactivate", parsed.data.idempotencyKey);
  const preflight = await dependencies.database.job.findFirst({
    where: { id: parsed.data.jobId, ...buildEmployerJobScopeWhere(dependencies.actor, now, { activeCompanyOnly: true }) },
    select: {
      id: true,
      status: true,
      version: true,
      currentRevisionId: true,
      publishedRevisionId: true,
      currentRevision: { select: { id: true, version: true, validThrough: true } },
      statusEvents: { where: { idempotencyKey: eventKey }, take: 1, select: { id: true } },
    },
  });
  if (preflight === null || preflight.currentRevision === null) return failure("NOT_FOUND");
  if (preflight.statusEvents.length > 0 && preflight.status === "PUBLISHED") {
    return success({ jobId: preflight.id, revisionId: preflight.currentRevision.id, jobVersion: preflight.version, revisionVersion: preflight.currentRevision.version }, true);
  }
  if (preflight.status !== "PAUSED" || preflight.currentRevisionId !== preflight.publishedRevisionId) return failure("CONFLICT");
  const port = createPrismaPublishQuotaPort(dependencies.database, async (transaction) => {
    const loaded = await loadLockedMutationJob(transaction, dependencies.actor, parsed.data.jobId, now, [], eventKey, true);
    if (loaded === null || !canManageJobLifecycle(dependencies.actor)) return failure("NOT_FOUND");
    if (loaded.statusEvents.length > 0 && loaded.status === "PUBLISHED") return currentVersionSuccess(loaded, true);
    const revision = loaded.currentRevision;
    if (revision === null || loaded.status !== "PAUSED" || loaded.currentRevisionId !== loaded.publishedRevisionId) return failure("CONFLICT");
    if (loaded.version !== parsed.data.expectedJobVersion || revision.version !== parsed.data.expectedRevisionVersion) return failure("CONFLICT");
    if (revision.approvedAt === null || revision.rejectedAt !== null || !isFuturePublicationDate(revision.validThrough, now)) return failure("CONFLICT");
    const verifiedCount = await transaction.companyVerificationRequest.count({ where: { companyId: dependencies.actor.companyId, status: "VERIFIED", supersededBy: null } });
    if (verifiedCount !== 1) return failure("VERIFICATION_REQUIRED");
    const restrictionCount = await transaction.moderationRestriction.count({
      where: {
        status: "ACTIVE",
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        AND: [{ OR: [
          { targetType: "HIDE_JOB", targetId: loaded.id },
          { targetType: "PAUSE_COMPANY", targetId: dependencies.actor.companyId },
        ] }],
      },
    });
    if (restrictionCount > 0) return failure("RESTRICTED");
    const actorCapability = jobActorCapability(dependencies.actor, null);
    if (actorCapability === null) return failure("FORBIDDEN");
    const decision = decideJobTransition({ action: "REACTIVATE_UNCHANGED", actor: actorCapability, currentStatus: "PAUSED" });
    if (decision.type !== "OK") return failure("CONFLICT");
    const updated = await transaction.job.updateMany({
      where: { id: loaded.id, status: "PAUSED", version: loaded.version, currentRevisionId: revision.id, publishedRevisionId: revision.id },
      data: { status: "PUBLISHED", expiresAt: revision.validThrough, version: { increment: 1 } },
    });
    if (updated.count !== 1) return failure("CONFLICT");
    await transaction.jobStatusEvent.create({ data: { jobId: loaded.id, jobRevisionId: revision.id, kind: "REACTIVATED", fromStatus: "PAUSED", toStatus: "PUBLISHED", actorUserId: dependencies.actor.userId, idempotencyKey: eventKey, correlationId: dependencies.correlationId } });
    await writeJobAudit(transaction, dependencies, now, "JOB_REACTIVATED", "JOB", loaded.id, "EMPLOYER_JOB_REACTIVATE");
    return success({ jobId: loaded.id, revisionId: revision.id, jobVersion: loaded.version + 1, revisionVersion: revision.version });
  });
  try {
    const result = await publishWithQuota({ companyId: dependencies.actor.companyId, jobId: preflight.id, revisionId: preflight.currentRevision.id, revisionValidThrough: preflight.currentRevision.validThrough, now }, port);
    if (!result.ok) {
      return isEmployerJobQuotaReason(result.reason)
        ? failure(
            "QUOTA_EXCEEDED",
            undefined,
            result.reason,
            result.suggestedPlanSlug,
          )
        : failure("CONFLICT");
    }
    return result.value;
  } catch (error) {
    return commandFailureFromError(error);
  }
}

async function transitionManagedJob(
  input: JobCommandEnvelope,
  dependencies: EmployerJobCommandDependencies,
  transition: Readonly<{
    action: "PAUSE_UNCHANGED" | "CLOSE";
    eventKind: "PAUSED" | "CLOSED";
    auditAction: "JOB_PAUSED" | "JOB_CLOSED";
    auditCapability: string;
    toStatus: "PAUSED" | "CLOSED";
    operation: string;
  }>,
): Promise<EmployerJobCommandResult<JobVersionValue>> {
  const parsed = jobCommandEnvelopeSchema.safeParse(input);
  if (!parsed.success) return failure("INVALID_INPUT");
  const now = validNow(dependencies.now);
  const eventKey = operationKey(transition.operation, parsed.data.idempotencyKey);
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      const loaded = await loadLockedMutationJob(transaction, dependencies.actor, parsed.data.jobId, now, [], eventKey, true);
      if (loaded === null || !canManageJobLifecycle(dependencies.actor)) return failure("NOT_FOUND");
      if (loaded.statusEvents.length > 0 && loaded.status === transition.toStatus) return currentVersionSuccess(loaded, true);
      const revision = loaded.currentRevision;
      if (revision === null) return failure("CONFLICT");
      if (loaded.version !== parsed.data.expectedJobVersion || revision.version !== parsed.data.expectedRevisionVersion) return failure("CONFLICT");
      const actorCapability = jobActorCapability(dependencies.actor, null);
      if (actorCapability === null) return failure("FORBIDDEN");
      const decision = decideJobTransition({ action: transition.action, actor: actorCapability, currentStatus: loaded.status as JobStatus });
      if (decision.type !== "OK") return failure("CONFLICT");
      const updated = await transaction.job.updateMany({ where: { id: loaded.id, version: loaded.version, status: loaded.status, currentRevisionId: revision.id }, data: { status: transition.toStatus, version: { increment: 1 } } });
      if (updated.count !== 1) return failure("CONFLICT");
      await transaction.jobStatusEvent.create({ data: { jobId: loaded.id, jobRevisionId: revision.id, kind: transition.eventKind, fromStatus: loaded.status, toStatus: transition.toStatus, actorUserId: dependencies.actor.userId, idempotencyKey: eventKey, correlationId: dependencies.correlationId } });
      await writeJobAudit(transaction, dependencies, now, transition.auditAction, "JOB", loaded.id, transition.auditCapability);
      return success({ jobId: loaded.id, revisionId: revision.id, jobVersion: loaded.version + 1, revisionVersion: revision.version });
    });
  } catch (error) {
    return commandFailureFromError(error);
  }
}

const JOB_REVISION_SELECT = {
  id: true,
  jobId: true,
  revisionNumber: true,
  version: true,
  contentLanguage: true,
  title: true,
  companyIntro: true,
  description: true,
  tasks: true,
  requirements: true,
  niceToHave: true,
  offer: true,
  applicationProcessSteps: true,
  requiredDocumentKinds: true,
  jobType: true,
  remoteType: true,
  remoteCountryCode: true,
  categoryId: true,
  cantonId: true,
  cityId: true,
  locationLabel: true,
  workloadMin: true,
  workloadMax: true,
  salaryPeriod: true,
  salaryMin: true,
  salaryMax: true,
  startDate: true,
  startByArrangement: true,
  validThrough: true,
  responseTargetDays: true,
  applicationEffort: true,
  inclusionStatement: true,
  applicationContactKind: true,
  applicationContactValue: true,
  authoredByUserId: true,
  contentChecksum: true,
  submittedAt: true,
  approvedAt: true,
  rejectedAt: true,
  languages: { orderBy: [{ code: "asc" as const }, { id: "asc" as const }], select: { code: true, minLevel: true } },
  skills: { orderBy: [{ skill: { name: "asc" as const } }, { id: "asc" as const }], select: { skillId: true, required: true, skill: { select: { name: true } } } },
  benefits: { orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }], select: { benefitCode: true, description: true, sortOrder: true } },
  reportingChecks: {
    orderBy: [{ checkedAt: "desc" as const }, { id: "desc" as const }],
    take: 1,
    select: {
      id: true,
      result: true,
      reasonSnapshot: true,
      disclaimerSnapshot: true,
      sourceSnapshot: true,
      datasetVersionSnapshot: true,
      dataYearSnapshot: true,
      referenceUrlSnapshot: true,
      occupationCodeSnapshot: true,
      occupationLabelSnapshot: true,
      checkedAt: true,
    },
  },
  scoreSnapshots: {
    orderBy: [{ calculatedAt: "desc" as const }, { id: "desc" as const }],
    take: 1,
    select: { scorePoints: true, maxPoints: true, calculatedAt: true },
  },
} as const satisfies Prisma.JobRevisionSelect;

type JobRevisionRow = Prisma.JobRevisionGetPayload<{ select: typeof JOB_REVISION_SELECT }>;

function fullJobSelect(actor: EmployerJobActor, now: Date) {
  return {
    id: true,
    slug: true,
    status: true,
    version: true,
    currentRevisionId: true,
    publishedRevisionId: true,
    publishedAt: true,
    expiresAt: true,
    currentRevision: { select: JOB_REVISION_SELECT },
    assignments: { where: currentAssignmentWhere(actor, now), take: 1, select: { role: true } },
    _count: { select: { applications: true, savedBy: true } },
    viewAggregates: { select: { viewCount: true } },
    boosts: { orderBy: [{ startsAt: "desc" as const }, { id: "desc" as const }], take: 1, select: { status: true, startsAt: true, endsAt: true } },
    statusEvents: { orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }], take: 10, select: { kind: true, fromStatus: true, toStatus: true, createdAt: true, reasonCode: true } },
  } as const satisfies Prisma.JobSelect;
}

function mutationJobSelect(actor: EmployerJobActor, now: Date, eventKey: string) {
  return {
    id: true,
    status: true,
    version: true,
    currentRevisionId: true,
    publishedRevisionId: true,
    publishedAt: true,
    expiresAt: true,
    company: { select: { slug: true } },
    currentRevision: { select: JOB_REVISION_SELECT },
    revisions: { orderBy: [{ revisionNumber: "desc" as const }, { id: "desc" as const }], take: 1, select: { revisionNumber: true } },
    assignments: { where: currentAssignmentWhere(actor, now), take: 1, select: { role: true } },
    statusEvents: { where: { idempotencyKey: eventKey }, take: 1, select: { id: true } },
  } as const satisfies Prisma.JobSelect;
}

type MutationJobRow = Prisma.JobGetPayload<{ select: ReturnType<typeof mutationJobSelect> }>;

async function loadLockedMutationJob(
  transaction: Prisma.TransactionClient,
  actor: EmployerJobActor,
  jobId: string,
  now: Date,
  assignmentRoles: readonly ("EDITOR" | "PIPELINE" | "REVIEWER")[],
  eventKey: string,
  activeCompanyOnly = true,
): Promise<MutationJobRow | null> {
  const where = {
    id: jobId,
    ...buildEmployerJobScopeWhere(actor, now, {
      assignmentRoles: actor.membershipRole === "RECRUITER" ? assignmentRoles : undefined,
      activeCompanyOnly,
    }),
  };
  const first = await transaction.job.findFirst({ where, select: mutationJobSelect(actor, now, eventKey) });
  if (first === null) return null;
  await transaction.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${jobId}::uuid FOR UPDATE`;
  return transaction.job.findFirst({ where, select: mutationJobSelect(actor, now, eventKey) });
}

function currentAssignmentWhere(actor: EmployerJobActor, now: Date) {
  return {
    membershipId: actor.membershipId,
    companyId: actor.companyId,
    userId: actor.userId,
    status: "ACTIVE" as const,
    revokedAt: null,
    validFrom: { lte: now },
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}

function initialRevisionSnapshot(
  jobId: string,
  revisionId: string,
  revisionNumber: number,
  step: JobWizardStepOne,
  actor: EmployerJobActor,
  validThrough: Date,
) {
  const checksum = checksumRevision({ revisionNumber, ...step, description: "", companyIntro: null, tasks: [], requirements: [], niceToHave: [], offer: null, benefits: [], skillIds: [], applicationProcessSteps: [], requiredDocumentKinds: ["NONE"], salaryPeriod: null, salaryMin: null, salaryMax: null, responseTargetDays: 10, applicationEffort: "SIMPLE", inclusionStatement: null, applicationContactKind: "EMAIL", applicationContactValue: actor.email });
  return {
    id: revisionId,
    jobId,
    revisionNumber,
    contentLanguage: "DE" as const,
    title: step.title,
    companyIntro: null,
    description: "",
    tasks: [],
    requirements: [],
    niceToHave: [],
    offer: null,
    applicationProcessSteps: [],
    requiredDocumentKinds: ["NONE" as const],
    jobType: step.jobType,
    remoteType: step.remoteType,
    remoteCountryCode: step.remoteCountryCode,
    categoryId: step.categoryId,
    cantonId: step.cantonId,
    cityId: step.cityId,
    locationLabel: step.locationLabel,
    workloadMin: step.workloadMin,
    workloadMax: step.workloadMax,
    salaryPeriod: null,
    salaryMin: null,
    salaryMax: null,
    startDate: step.startDate,
    startByArrangement: step.startByArrangement,
    validThrough,
    responseTargetDays: 10,
    applicationEffort: "SIMPLE" as const,
    inclusionStatement: null,
    applicationContactKind: "EMAIL" as const,
    applicationContactValue: actor.email,
    authoredByUserId: actor.userId,
    contentChecksum: checksum,
    version: 1,
  };
}

function applyStepToRevision(
  revision: JobRevisionRow,
  stepNumber: 1 | 2 | 3,
  rawStep: JobWizardStepOne | JobWizardStepTwo | JobWizardStepThree,
) {
  let data: Record<string, unknown> = {};
  let languages = revision.languages;
  let skills = revision.skills.map((row) => ({ skillId: row.skillId, required: row.required }));
  let benefits = revision.benefits.map(({ benefitCode, description, sortOrder }) => ({ benefitCode, description, sortOrder }));
  if (stepNumber === 1) {
    const step = jobWizardStepOneSchema.parse(rawStep);
    data = {
      title: step.title,
      categoryId: step.categoryId,
      jobType: step.jobType,
      workloadMin: step.workloadMin,
      workloadMax: step.workloadMax,
      cantonId: step.cantonId,
      cityId: step.cityId,
      locationLabel: step.locationLabel,
      remoteType: step.remoteType,
      remoteCountryCode: step.remoteCountryCode,
      validThrough: step.validThrough,
      startDate: step.startDate,
      startByArrangement: step.startByArrangement,
    };
    languages = step.languages;
  } else if (stepNumber === 2) {
    const step = jobWizardStepTwoSchema.parse(rawStep);
    data = {
      companyIntro: step.companyIntro,
      description: step.companyIntro,
      tasks: step.tasks,
      requirements: step.requirements,
      niceToHave: step.niceToHave,
      offer: step.offer,
    };
    skills = step.skillIds.map((skillId) => ({ skillId, required: true }));
    benefits = step.benefits.map((benefit, sortOrder) => ({ ...benefit, sortOrder }));
  } else {
    const step = jobWizardStepThreeSchema.parse(rawStep);
    data = {
      salaryPeriod: step.salaryPeriod,
      salaryMin: step.salaryMin,
      salaryMax: step.salaryMax,
      responseTargetDays: step.responseTargetDays,
      applicationProcessSteps: step.applicationProcessSteps,
      applicationEffort: step.applicationEffort,
      requiredDocumentKinds: step.requiredDocumentKinds,
      inclusionStatement: step.inclusionStatement,
      applicationContactKind: step.applicationContactKind,
      applicationContactValue: step.applicationContactValue,
    };
  }
  return {
    data,
    checksum: {
      revisionNumber: revision.revisionNumber,
      title: revision.title,
      companyIntro: revision.companyIntro,
      description: revision.description,
      tasks: revision.tasks,
      requirements: revision.requirements,
      niceToHave: revision.niceToHave,
      offer: revision.offer,
      applicationProcessSteps: revision.applicationProcessSteps,
      requiredDocumentKinds: revision.requiredDocumentKinds,
      jobType: revision.jobType,
      remoteType: revision.remoteType,
      remoteCountryCode: revision.remoteCountryCode,
      categoryId: revision.categoryId,
      cantonId: revision.cantonId,
      cityId: revision.cityId,
      locationLabel: revision.locationLabel,
      workloadMin: revision.workloadMin,
      workloadMax: revision.workloadMax,
      salaryPeriod: revision.salaryPeriod,
      salaryMin: revision.salaryMin,
      salaryMax: revision.salaryMax,
      startDate: revision.startDate,
      startByArrangement: revision.startByArrangement,
      validThrough: revision.validThrough,
      responseTargetDays: revision.responseTargetDays,
      applicationEffort: revision.applicationEffort,
      inclusionStatement: revision.inclusionStatement,
      applicationContactKind: revision.applicationContactKind,
      applicationContactValue: revision.applicationContactValue,
      languages,
      skills,
      benefits,
      ...data,
    },
  };
}

async function replaceStepChildren(
  transaction: Prisma.TransactionClient,
  revisionId: string,
  stepNumber: 1 | 2 | 3,
  rawStep: JobWizardStepOne | JobWizardStepTwo | JobWizardStepThree,
) {
  if (stepNumber === 1) {
    const step = jobWizardStepOneSchema.parse(rawStep);
    await transaction.jobRevisionLanguage.deleteMany({ where: { jobRevisionId: revisionId } });
    if (step.languages.length > 0) await transaction.jobRevisionLanguage.createMany({ data: step.languages.map((language) => ({ jobRevisionId: revisionId, ...language })) });
  }
  if (stepNumber === 2) {
    const step = jobWizardStepTwoSchema.parse(rawStep);
    await transaction.jobRevisionBenefit.deleteMany({ where: { jobRevisionId: revisionId } });
    await transaction.jobRevisionSkill.deleteMany({ where: { jobRevisionId: revisionId } });
    if (step.benefits.length > 0) await transaction.jobRevisionBenefit.createMany({ data: step.benefits.map((benefit, sortOrder) => ({ jobRevisionId: revisionId, ...benefit, sortOrder })) });
    if (step.skillIds.length > 0) await transaction.jobRevisionSkill.createMany({ data: step.skillIds.map((skillId) => ({ jobRevisionId: revisionId, skillId, required: true })) });
  }
}

async function createEditableClone(
  transaction: Prisma.TransactionClient,
  job: MutationJobRow,
  actorUserId: string,
  stepNumber: 1 | 2 | 3,
  step: JobWizardStepOne | JobWizardStepTwo | JobWizardStepThree,
) {
  const source = job.currentRevision!;
  const nextRevisionNumber = (job.revisions[0]?.revisionNumber ?? source.revisionNumber) + 1;
  const applied = applyStepToRevision(source, stepNumber, step);
  const id = randomUUID();
  await transaction.jobRevision.create({
    data: {
      ...cloneRevisionScalarData(source),
      ...applied.data,
      id,
      revisionNumber: nextRevisionNumber,
      authoredByUserId: actorUserId,
      contentChecksum: checksumRevision({ ...applied.checksum, revisionNumber: nextRevisionNumber }),
      version: 1,
      submittedAt: null,
      approvedAt: null,
      rejectedAt: null,
    },
  });
  await copyRevisionChildren(transaction, source, id, stepNumber, step);
  return { id };
}

async function cloneRevision(
  transaction: Prisma.TransactionClient,
  job: MutationJobRow,
  actorUserId: string,
) {
  const source = job.currentRevision!;
  const revisionNumber = (job.revisions[0]?.revisionNumber ?? source.revisionNumber) + 1;
  const id = randomUUID();
  await transaction.jobRevision.create({
    data: {
      ...cloneRevisionScalarData(source),
      id,
      revisionNumber,
      authoredByUserId: actorUserId,
      contentChecksum: checksumRevision({ ...revisionChecksumInput(source), revisionNumber }),
      version: 1,
      submittedAt: null,
      approvedAt: null,
      rejectedAt: null,
    },
  });
  await copyRevisionChildren(transaction, source, id);
  return { id };
}

function cloneRevisionScalarData(source: JobRevisionRow) {
  return {
    jobId: source.jobId,
    contentLanguage: source.contentLanguage,
    title: source.title,
    companyIntro: source.companyIntro,
    description: source.description,
    tasks: source.tasks,
    requirements: source.requirements,
    niceToHave: source.niceToHave,
    offer: source.offer,
    applicationProcessSteps: source.applicationProcessSteps,
    requiredDocumentKinds: source.requiredDocumentKinds,
    jobType: source.jobType,
    remoteType: source.remoteType,
    remoteCountryCode: source.remoteCountryCode,
    categoryId: source.categoryId,
    cantonId: source.cantonId,
    cityId: source.cityId,
    locationLabel: source.locationLabel,
    workloadMin: source.workloadMin,
    workloadMax: source.workloadMax,
    salaryPeriod: source.salaryPeriod,
    salaryMin: source.salaryMin,
    salaryMax: source.salaryMax,
    startDate: source.startDate,
    startByArrangement: source.startByArrangement,
    validThrough: source.validThrough,
    responseTargetDays: source.responseTargetDays,
    applicationEffort: source.applicationEffort,
    inclusionStatement: source.inclusionStatement,
    applicationContactKind: source.applicationContactKind,
    applicationContactValue: source.applicationContactValue,
  };
}

async function copyRevisionChildren(
  transaction: Prisma.TransactionClient,
  source: JobRevisionRow,
  targetRevisionId: string,
  stepNumber?: 1 | 2 | 3,
  rawStep?: JobWizardStepOne | JobWizardStepTwo | JobWizardStepThree,
) {
  const languages = stepNumber === 1
    ? jobWizardStepOneSchema.parse(rawStep).languages
    : source.languages;
  const benefits = stepNumber === 2
    ? jobWizardStepTwoSchema.parse(rawStep).benefits.map((benefit, sortOrder) => ({ ...benefit, sortOrder }))
    : source.benefits;
  const skills = stepNumber === 2
    ? jobWizardStepTwoSchema.parse(rawStep).skillIds.map((skillId) => ({ skillId, required: true }))
    : source.skills;
  if (languages.length > 0) await transaction.jobRevisionLanguage.createMany({ data: languages.map(({ code, minLevel }) => ({ jobRevisionId: targetRevisionId, code, minLevel })) });
  if (benefits.length > 0) await transaction.jobRevisionBenefit.createMany({ data: benefits.map(({ benefitCode, description, sortOrder }) => ({ jobRevisionId: targetRevisionId, benefitCode, description, sortOrder })) });
  if (skills.length > 0) await transaction.jobRevisionSkill.createMany({ data: skills.map((row) => ({ jobRevisionId: targetRevisionId, skillId: row.skillId, required: row.required })) });
}

function revisionChecksumInput(revision: JobRevisionRow) {
  return {
    revisionNumber: revision.revisionNumber,
    ...cloneRevisionScalarData(revision),
    languages: revision.languages,
    skills: revision.skills.map(({ skillId, required }) => ({ skillId, required })),
    benefits: revision.benefits,
  };
}

function checksumRevision(value: unknown) {
  return createHash("sha256").update(stableSerialize({ schema: "employer-job-revision/v1", value })).digest("hex");
}

function stableSerialize(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function validateStepOneCatalog(transaction: Prisma.TransactionClient, step: JobWizardStepOne) {
  const [category, canton, city] = await Promise.all([
    transaction.category.findFirst({ where: { id: step.categoryId, isActive: true }, select: { id: true } }),
    step.cantonId === null ? Promise.resolve(null) : transaction.canton.findFirst({ where: { id: step.cantonId, isActive: true }, select: { id: true } }),
    step.cityId === null ? Promise.resolve(null) : transaction.city.findFirst({ where: { id: step.cityId, cantonId: step.cantonId ?? undefined, isActive: true, canton: { isActive: true } }, select: { id: true } }),
  ]);
  return category !== null && (step.cantonId === null || canton !== null) && (step.cityId === null || city !== null);
}

async function validateSkillCatalog(transaction: Prisma.TransactionClient, skillIds: readonly string[]) {
  if (skillIds.length === 0) return true;
  return await transaction.skill.count({ where: { id: { in: [...skillIds] } } }) === skillIds.length;
}

function validateCompleteRevision(job: MutationJobRow, now: Date): readonly string[] {
  const revision = job.currentRevision;
  if (revision === null) return ["revision"];
  const issues = new Set<string>();
  const stepOne = jobWizardStepOneSchema.safeParse({
    title: revision.title,
    categoryId: revision.categoryId,
    jobType: revision.jobType,
    workloadMin: revision.workloadMin,
    workloadMax: revision.workloadMax,
    cantonId: revision.cantonId,
    cityId: revision.cityId,
    locationLabel: revision.locationLabel,
    remoteType: revision.remoteType,
    remoteCountryCode: revision.remoteCountryCode,
    languages: revision.languages,
    validThrough: revision.validThrough,
    startDate: revision.startDate,
    startByArrangement: revision.startByArrangement,
  });
  const stepTwo = jobWizardStepTwoSchema.safeParse({
    companyIntro: revision.companyIntro,
    tasks: revision.tasks,
    requirements: revision.requirements,
    niceToHave: revision.niceToHave,
    offer: revision.offer,
    skillIds: revision.skills.map(({ skillId }) => skillId),
    benefits: revision.benefits.map(({ benefitCode, description }) => ({
      benefitCode,
      description,
    })),
  });
  const stepThree = jobWizardStepThreeSchema.safeParse({
    salaryPeriod: revision.salaryPeriod,
    salaryMin: revision.salaryMin,
    salaryMax: revision.salaryMax,
    responseTargetDays: revision.responseTargetDays,
    applicationProcessSteps: revision.applicationProcessSteps,
    applicationEffort: revision.applicationEffort,
    requiredDocumentKinds: revision.requiredDocumentKinds,
    inclusionStatement: revision.inclusionStatement,
    applicationContactKind: revision.applicationContactKind,
    applicationContactValue: revision.applicationContactValue,
  });
  for (const result of [stepOne, stepTwo, stepThree]) {
    if (!result.success) for (const issue of result.error.issues) issues.add(issue.path.join(".") || "revision");
  }
  if (!isFuturePublicationDate(revision.validThrough, now)) issues.add("validThrough");
  if (revision.reportingChecks.length === 0) issues.add("reportingCheck");
  return Object.freeze([...issues]);
}

function toFairJobRevision(revision: JobRevisionRow) {
  return {
    id: revision.id,
    jobId: revision.jobId,
    salaryPeriod: revision.salaryPeriod,
    salaryMin: revision.salaryMin,
    salaryMax: revision.salaryMax,
    tasks: revision.tasks,
    requirements: revision.requirements,
    workloadMin: revision.workloadMin,
    workloadMax: revision.workloadMax,
    jobType: revision.jobType,
    startDate: revision.startDate,
    startByArrangement: revision.startByArrangement,
    remoteType: revision.remoteType,
    cantonId: revision.cantonId,
    cityId: revision.cityId,
    remoteCountryCode: revision.remoteCountryCode,
    applicationEffort: revision.applicationEffort,
    applicationProcessSteps: revision.applicationProcessSteps,
    requiredDocumentKinds: revision.requiredDocumentKinds,
    responseTargetDays: revision.responseTargetDays,
    benefits: revision.benefits.map(({ benefitCode, description }) => ({ benefitCode, description })),
    inclusionStatement: revision.inclusionStatement,
    applicationContactKind: revision.applicationContactKind,
    applicationContactValue: revision.applicationContactValue,
    validThrough: revision.validThrough,
  };
}

function toRevisionDetail(revision: JobRevisionRow): EmployerJobRevisionDetail {
  const check = revision.reportingChecks[0];
  return Object.freeze({
    id: revision.id,
    revisionNumber: revision.revisionNumber,
    version: revision.version,
    contentLanguage: revision.contentLanguage,
    title: revision.title,
    companyIntro: revision.companyIntro,
    description: revision.description,
    tasks: Object.freeze(revision.tasks),
    requirements: Object.freeze(revision.requirements),
    niceToHave: Object.freeze(revision.niceToHave),
    offer: revision.offer,
    applicationProcessSteps: Object.freeze(revision.applicationProcessSteps),
    requiredDocumentKinds: Object.freeze(revision.requiredDocumentKinds),
    jobType: revision.jobType,
    remoteType: revision.remoteType,
    remoteCountryCode: revision.remoteCountryCode,
    categoryId: revision.categoryId,
    cantonId: revision.cantonId,
    cityId: revision.cityId,
    locationLabel: revision.locationLabel,
    workloadMin: revision.workloadMin,
    workloadMax: revision.workloadMax,
    salaryPeriod: revision.salaryPeriod,
    salaryMin: revision.salaryMin,
    salaryMax: revision.salaryMax,
    startDate: revision.startDate,
    startByArrangement: revision.startByArrangement,
    validThrough: revision.validThrough,
    responseTargetDays: revision.responseTargetDays,
    applicationEffort: revision.applicationEffort,
    inclusionStatement: revision.inclusionStatement,
    applicationContactKind: revision.applicationContactKind,
    applicationContactValue: revision.applicationContactValue,
    submittedAt: revision.submittedAt,
    approvedAt: revision.approvedAt,
    rejectedAt: revision.rejectedAt,
    languages: Object.freeze(revision.languages),
    skills: Object.freeze(revision.skills.map(({ skillId, skill, required }) => ({ id: skillId, name: skill.name, required }))),
    benefits: Object.freeze(revision.benefits),
    reportingCheck: check === undefined ? null : Object.freeze({
      id: check.id,
      result: check.result,
      reason: check.reasonSnapshot,
      disclaimer: check.disclaimerSnapshot,
      source: check.sourceSnapshot,
      datasetVersion: check.datasetVersionSnapshot,
      dataYear: check.dataYearSnapshot,
      referenceUrl: check.referenceUrlSnapshot,
      occupationCode: check.occupationCodeSnapshot,
      occupationLabel: check.occupationLabelSnapshot,
      checkedAt: check.checkedAt,
    }),
  });
}

async function writeDraftUpdatedEvidence(
  transaction: Prisma.TransactionClient,
  dependencies: EmployerJobCommandDependencies,
  now: Date,
  job: MutationJobRow,
  revisionId: string,
  eventKey: string,
) {
  await transaction.jobStatusEvent.create({ data: { jobId: job.id, jobRevisionId: revisionId, kind: "DRAFT_UPDATED", fromStatus: job.status, toStatus: job.status, actorUserId: dependencies.actor.userId, idempotencyKey: eventKey, correlationId: dependencies.correlationId } });
  await writeJobAudit(transaction, dependencies, now, "JOB_DRAFT_UPDATED", "JOB_REVISION", revisionId, "EMPLOYER_JOB_DRAFT_SAVE");
}

async function writeJobAudit(
  transaction: Prisma.TransactionClient,
  dependencies: EmployerJobCommandDependencies,
  now: Date,
  action: RequiredAuditInput["action"],
  targetType: "JOB" | "JOB_REVISION" | "JOB_ASSIGNMENT",
  targetId: string,
  capability: string,
) {
  await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
    action,
    actorKind: "USER",
    actorUserId: dependencies.actor.userId,
    capability,
    companyId: dependencies.actor.companyId,
    correlationId: dependencies.correlationId,
    result: "SUCCEEDED",
    retainUntil: new Date(now.getTime() + AUDIT_RETENTION_DAYS * DAY),
    targetId,
    targetType,
  });
}

function currentVersionSuccess(job: MutationJobRow, replay: boolean): EmployerJobCommandResult<JobVersionValue> {
  const revision = job.currentRevision;
  return revision === null
    ? failure("CONFLICT")
    : success({ jobId: job.id, revisionId: revision.id, jobVersion: job.version, revisionVersion: revision.version }, replay);
}

function canMutateJob(actor: EmployerJobActor, assignmentRole: string | null) {
  return actor.membershipRole === "OWNER" || actor.membershipRole === "ADMIN" || (actor.membershipRole === "RECRUITER" && assignmentRole === "EDITOR");
}

function canManageJobLifecycle(actor: EmployerJobActor) {
  return actor.membershipRole === "OWNER" || actor.membershipRole === "ADMIN";
}

function jobActorCapability(actor: EmployerJobActor, assignmentRole: string | null): JobActorCapability | null {
  if (actor.membershipRole === "OWNER") return "COMPANY_OWNER";
  if (actor.membershipRole === "ADMIN") return "COMPANY_ADMIN";
  if (actor.membershipRole === "RECRUITER" && assignmentRole === "EDITOR") return "RECRUITER_EDITOR";
  return null;
}

function effectiveBoostStatus(
  boost: Readonly<{ status: "SCHEDULED" | "ACTIVE" | "EXPIRED" | "CANCELLED"; startsAt: Date; endsAt: Date }> | undefined,
  now: Date,
) {
  if (boost === undefined) return null;
  return getEffectiveBoostStatus(boost, now);
}

function isFuturePublicationDate(value: Date | null, now: Date): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime()) && value.getTime() > now.getTime() && value.getTime() <= now.getTime() + MAX_PUBLICATION_DAYS * DAY;
}

function validNow(value: Date | undefined) {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : new Date();
}

function operationKey(operation: string, key: string) {
  return `${operation}:${key}`.slice(0, 128);
}

function isValidApplicationContact(kind: string, rawValue: string) {
  const value = rawValue.trim();
  if (kind === "EMAIL") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
  if (kind === "PHONE") return /^\+[1-9][0-9]{7,14}$/u.test(value);
  if (kind === "APPLY_URL") {
    try {
      const url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:") && url.username === "" && url.password === "";
    } catch {
      return false;
    }
  }
  return false;
}

function zodIssues(result: { success: boolean; error?: z.ZodError }) {
  return result.success ? undefined : result.error?.issues.map((issue) => issue.path.join(".") || "input");
}

function success<TValue>(value: TValue, replay = false): EmployerJobCommandResult<TValue> {
  return Object.freeze({ ok: true, value: Object.freeze(value), ...(replay ? { replay: true } : {}) });
}

class EmployerJobCommandError extends Error {
  constructor(readonly code: EmployerJobCommandCode) {
    super(code);
    this.name = "EmployerJobCommandError";
  }
}

function commandFailureFromError<TValue>(error: unknown): EmployerJobCommandResult<TValue> {
  return error instanceof EmployerJobCommandError ? failure(error.code) : failure("WRITE_FAILED");
}

function databaseErrorCode(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

function failure<TValue = never>(
  code: EmployerJobCommandCode,
  issues?: readonly string[],
  quotaReason?: EmployerJobQuotaReason,
  suggestedPlanSlug?: string,
): EmployerJobCommandResult<TValue> {
  return Object.freeze({
    ok: false,
    code,
    ...(issues === undefined ? {} : { issues: Object.freeze([...issues]) }),
    ...(quotaReason === undefined ? {} : { quotaReason }),
    ...(suggestedPlanSlug === undefined ? {} : { suggestedPlanSlug }),
  });
}

function isEmployerJobQuotaReason(
  reason: FeatureGateReason | "ENTITLEMENT_RESOLUTION_FAILED",
): reason is EmployerJobQuotaReason {
  return (
    reason === "ACTIVE_JOB_LIMIT_REACHED" ||
    reason === "ADDITIONAL_JOB_PERMIT_REQUIRED" ||
    reason === "ADDITIONAL_JOB_PERMIT_INVALID"
  );
}
