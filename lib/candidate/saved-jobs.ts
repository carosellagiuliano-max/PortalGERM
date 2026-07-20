import "server-only";

import { z } from "zod";

import { trackAnalyticsEventV1 } from "@/lib/analytics/track";
import {
  verifyJobIntent,
  type SignedJobIntentKey,
} from "@/lib/auth/signed-intent";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import {
  Prisma,
} from "@/lib/generated/prisma/client";
import {
  filterPubliclyEligibleJobsInTransaction,
  isJobPubliclyEligibleInTransaction,
  type PublicEligibilityEnvironment,
} from "@/lib/jobs/public-eligibility";
import { getPublicDataContext } from "@/lib/public/environment";
import { stripUnsafeHtml } from "@/lib/security/sanitize";

const uuidSchema = z.uuid();
export const MAXIMUM_SAVED_JOBS = 100;
const SERIALIZABLE_ATTEMPTS = 3;
const ALTERNATIVE_SCAN_PER_CATEGORY = 50;
const PUBLIC_ELIGIBILITY_BATCH_SIZE = 500;
const SAVED_JOB_READ_TRANSACTION_TIMEOUT_MS = 30_000;

export type SavedJobListItem = Readonly<{
  savedJobId: string;
  savedAt: Date;
  current: boolean;
  job: Readonly<{
    slug: string;
    title: string;
    companyName: string;
    contextLabel: string;
  }>;
  alternatives: readonly Readonly<{
    slug: string;
    title: string;
    companyName: string;
  }>[];
}>;

export type SaveJobResult =
  | Readonly<{
      ok: true;
      savedJobId: string;
      duplicate: boolean;
      jobSlug: string;
    }>
  | Readonly<{
      ok: false;
      code:
        | "INVALID_INTENT"
        | "LIMIT_REACHED"
        | "NOT_ELIGIBLE"
        | "PROFILE_MISSING"
        | "WRITE_FAILED";
    }>;

export async function saveJobFromSignedIntent(
  input: Readonly<{ signedIntent: string; candidateUserId: string }>,
  dependencies: Readonly<{
    database: DatabaseClient;
    environment: ServerEnvironment;
    signingKey: SignedJobIntentKey;
    now?: Date;
  }>,
): Promise<SaveJobResult> {
  const now = dependencies.now ?? new Date();
  if (
    !Number.isFinite(now.getTime()) ||
    !uuidSchema.safeParse(input.candidateUserId).success
  ) {
    return Object.freeze({ ok: false, code: "INVALID_INTENT" });
  }
  const intent = verifyJobIntent(
    input.signedIntent,
    { action: "SAVE", now },
    dependencies.signingKey,
  );
  if (intent === null)
    return Object.freeze({ ok: false, code: "INVALID_INTENT" });

  for (let attempt = 1; attempt <= SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      const result = await dependencies.database.$transaction(
        async (transaction) => {
          const profiles = await transaction.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "CandidateProfile"
            WHERE "userId" = ${input.candidateUserId}::uuid
            FOR UPDATE
          `;
          const profile = profiles[0] ?? null;
          const job = await transaction.job.findUnique({
            where: { slug: intent.jobSlug },
            select: { id: true, slug: true, dataProvenance: true },
          });
          if (profile === null) {
            return Object.freeze({ kind: "PROFILE_MISSING" as const });
          }
          if (job === null) {
            return Object.freeze({ kind: "NOT_ELIGIBLE" as const });
          }
          const environment =
            dependencies.environment.APP_ENV === "production" ||
            dependencies.environment.APP_ENV === "staging"
              ? "production"
              : "non-production";
          const eligible = await isJobPubliclyEligibleInTransaction(
            job.id,
            now,
            environment,
            transaction,
          );
          if (!eligible.eligible) {
            return Object.freeze({ kind: "NOT_ELIGIBLE" as const });
          }
          const existing = await transaction.savedJob.findUnique({
            where: {
              candidateProfileId_jobId: {
                candidateProfileId: profile.id,
                jobId: job.id,
              },
            },
            select: { id: true },
          });
          if (existing === null) {
            const savedJobCount = await transaction.savedJob.count({
              where: { candidateProfileId: profile.id },
            });
            if (savedJobCount >= MAXIMUM_SAVED_JOBS) {
              return Object.freeze({ kind: "LIMIT_REACHED" as const });
            }
          }
          const saved = await transaction.savedJob.upsert({
            where: {
              candidateProfileId_jobId: {
                candidateProfileId: profile.id,
                jobId: job.id,
              },
            },
            update: {},
            create: {
              candidateProfileId: profile.id,
              jobId: job.id,
              createdAt: now,
            },
            select: { id: true },
          });
          await recordSavedAnalytics(transaction, {
            savedJobId: saved.id,
            jobId: job.id,
            occurredAt: now,
            jobProvenance: job.dataProvenance,
          });
          return Object.freeze({
            kind: "SAVED" as const,
            id: saved.id,
            duplicate: existing !== null,
            jobSlug: job.slug,
          });
        },
        { isolationLevel: "Serializable" },
      );
      if (result.kind === "PROFILE_MISSING") {
        return Object.freeze({ ok: false, code: "PROFILE_MISSING" });
      }
      if (result.kind === "NOT_ELIGIBLE") {
        return Object.freeze({ ok: false, code: "NOT_ELIGIBLE" });
      }
      if (result.kind === "LIMIT_REACHED") {
        return Object.freeze({ ok: false, code: "LIMIT_REACHED" });
      }
      return Object.freeze({
        ok: true,
        savedJobId: result.id,
        duplicate: result.duplicate,
        jobSlug: result.jobSlug,
      });
    } catch (error) {
      const code = databaseErrorCode(error);
      if (
        (code === "P2034" || code === "P2002") &&
        attempt < SERIALIZABLE_ATTEMPTS
      ) {
        continue;
      }
      return Object.freeze({ ok: false, code: "WRITE_FAILED" });
    }
  }
  return Object.freeze({ ok: false, code: "WRITE_FAILED" });
}

export async function removeSavedJob(
  input: Readonly<{ savedJobId: string; candidateUserId: string }>,
  database: DatabaseClient,
): Promise<Readonly<{ ok: boolean; removed: boolean }>> {
  const parsed = z
    .strictObject({ savedJobId: z.uuid(), candidateUserId: z.uuid() })
    .safeParse(input);
  if (!parsed.success) return Object.freeze({ ok: false, removed: false });
  try {
    const result = await database.savedJob.deleteMany({
      where: {
        id: parsed.data.savedJobId,
        candidateProfile: { userId: parsed.data.candidateUserId },
      },
    });
    return Object.freeze({ ok: true, removed: result.count === 1 });
  } catch {
    return Object.freeze({ ok: false, removed: false });
  }
}

export async function listCandidateSavedJobs(
  candidateUserId: string,
  database: DatabaseClient,
  options: Readonly<{
    now?: Date;
    environment?: PublicEligibilityEnvironment;
  }> = {},
): Promise<readonly SavedJobListItem[]> {
  if (!uuidSchema.safeParse(candidateUserId).success) return Object.freeze([]);
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) return Object.freeze([]);
  const environment =
    options.environment ?? getPublicDataContext().eligibilityEnvironment;
  return database.$transaction(
    async (transaction) => {
      const rows = await transaction.savedJob.findMany({
        where: { candidateProfile: { userId: candidateUserId } },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: MAXIMUM_SAVED_JOBS,
        select: {
          id: true,
          createdAt: true,
          job: {
            select: {
              id: true,
              slug: true,
              status: true,
              expiresAt: true,
              company: { select: { name: true } },
              publishedCategory: { select: { id: true } },
              publishedRevision: { select: { title: true } },
            },
          },
        },
      });
      const savedJobIds = rows.map((row) => row.job.id);
      const eligibleJobs = await filterPubliclyEligibleJobsInTransaction(
        savedJobIds,
        now,
        environment,
        transaction,
      );
      const eligibleById = new Map(eligibleJobs.map((job) => [job.id, job]));
      const staleCategoryIds = [
        ...new Set(
          rows.flatMap((row) =>
            !eligibleById.has(row.job.id) && row.job.publishedCategory !== null
              ? [row.job.publishedCategory.id]
              : [],
          ),
        ),
      ];
      const alternatives = await loadEligibleAlternativesByCategory(
        transaction,
        staleCategoryIds,
        savedJobIds,
        now,
        environment,
      );

      return Object.freeze(
        rows.map((row) => {
          const current = eligibleById.get(row.job.id);
          const fallbackTitle = stripUnsafeHtml(
            row.job.publishedRevision?.title ?? "Nicht mehr verfügbare Stelle",
          );
          const fallbackCompany = stripUnsafeHtml(row.job.company.name);
          const categoryId = row.job.publishedCategory?.id;
          const suggested =
            categoryId === undefined ? [] : (alternatives.get(categoryId) ?? []);
          return Object.freeze({
            savedJobId: row.id,
            savedAt: new Date(row.createdAt),
            current: current !== undefined,
            job: Object.freeze({
              slug: row.job.slug,
              title:
                current === undefined
                  ? fallbackTitle
                  : stripUnsafeHtml(current.title),
              companyName:
                current === undefined
                  ? fallbackCompany
                  : stripUnsafeHtml(current.companyName),
              contextLabel:
                current === undefined
                  ? staleContextLabel(row.job.status, row.job.expiresAt, now)
                  : "Aktuell offen",
            }),
            alternatives: Object.freeze(
              suggested.slice(0, 2).map((alternative) =>
                Object.freeze({
                  slug: alternative.slug,
                  title: stripUnsafeHtml(alternative.title),
                  companyName: stripUnsafeHtml(alternative.companyName),
                }),
              ),
            ),
          });
        }),
      );
    },
    {
      isolationLevel: "RepeatableRead",
      timeout: SAVED_JOB_READ_TRANSACTION_TIMEOUT_MS,
    },
  );
}

async function loadEligibleAlternativesByCategory(
  transaction: Prisma.TransactionClient,
  categoryIds: readonly string[],
  excludedJobIds: readonly string[],
  now: Date,
  environment: PublicEligibilityEnvironment,
) {
  if (categoryIds.length === 0) {
    return new Map<string, readonly EligibleAlternative[]>();
  }
  const candidates = await transaction.$queryRaw<AlternativeCandidateRow[]>(
    Prisma.sql`
      WITH ranked AS (
        SELECT
          job.id,
          job."publishedCategoryId" AS "categoryId",
          row_number() OVER (
            PARTITION BY job."publishedCategoryId"
            ORDER BY job."publishedAt" DESC NULLS LAST, job.id ASC
          ) AS position
        FROM "Job" AS job
        WHERE job."publishedCategoryId" IN (${Prisma.join(categoryIds)})
          AND job.id NOT IN (${Prisma.join(excludedJobIds)})
          AND job.status = 'PUBLISHED'
          AND job."publishedAt" <= ${now}
          AND job."expiresAt" > ${now}
      )
      SELECT id, "categoryId"
      FROM ranked
      WHERE position <= ${ALTERNATIVE_SCAN_PER_CATEGORY}
      ORDER BY "categoryId" ASC, position ASC
    `,
  );
  const candidateCategoryById = new Map(
    candidates.map((candidate) => [candidate.id, candidate.categoryId]),
  );
  const eligible = [];
  for (
    let offset = 0;
    offset < candidates.length;
    offset += PUBLIC_ELIGIBILITY_BATCH_SIZE
  ) {
    eligible.push(
      ...(await filterPubliclyEligibleJobsInTransaction(
        candidates
          .slice(offset, offset + PUBLIC_ELIGIBILITY_BATCH_SIZE)
          .map((candidate) => candidate.id),
        now,
        environment,
        transaction,
      )),
    );
  }
  const alternatives = new Map<string, EligibleAlternative[]>();
  for (const job of eligible) {
    const categoryId = candidateCategoryById.get(job.id);
    if (categoryId === undefined) continue;
    const bucket = alternatives.get(categoryId) ?? [];
    if (bucket.length >= 2) continue;
    bucket.push({
      slug: job.slug,
      title: job.title,
      companyName: job.companyName,
    });
    alternatives.set(categoryId, bucket);
  }
  return alternatives;
}

type AlternativeCandidateRow = Readonly<{
  id: string;
  categoryId: string;
}>;

type EligibleAlternative = Readonly<{
  slug: string;
  title: string;
  companyName: string;
}>;

function staleContextLabel(
  status: string,
  expiresAt: Date | null,
  now: Date,
): string {
  if (status === "CLOSED") return "Geschlossen";
  if (status === "EXPIRED" || (expiresAt !== null && expiresAt <= now)) {
    return "Abgelaufen";
  }
  return "Nicht mehr öffentlich";
}

async function recordSavedAnalytics(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    savedJobId: string;
    jobId: string;
    occurredAt: Date;
    jobProvenance: "LIVE" | "DEMO" | "TEST";
  }>,
): Promise<void> {
  await trackAnalyticsEventV1(
    {
      kind: "JOB_SAVED",
      schemaVersion: "1",
      producerEventId: `JOB_SAVED:${input.savedJobId}`,
      occurredAt: input.occurredAt,
      jobId: input.jobId,
      properties: { surface: "JOB_DETAIL", intent: "SAVE" },
    },
    {
      producer: "candidate-saved-job",
      productAnalyticsEnabled: false,
      provenance: { job: input.jobProvenance },
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

function databaseErrorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : null;
}
