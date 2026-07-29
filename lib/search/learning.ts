import "server-only";

import { createHash, createHmac, randomUUID } from "node:crypto";

import { z } from "zod";

import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import { writeRequiredAudit } from "@/lib/audit/log";
import type { DatabaseClient } from "@/lib/db/factory";
import {
  SEARCH_POLICY_RELEASE_V2,
  resolveSearchConceptKeysV2,
} from "@/lib/search/concepts-v2";

const DAY_MS = 86_400_000;
const SEARCH_LEARNING_TRANSACTION_ATTEMPTS = 5;
export const SEARCH_LEARNING_K_THRESHOLD_V1 = 10;
export const SEARCH_LEARNING_WORKING_RETENTION_DAYS_V1 = 30;

const resultBucketSchema = z.enum(["0", "1-9", "10-24", "25-49", "50+"]);
const localeSchema = z.literal("de-CH");
const rawQuerySchema = z.string().min(1).max(160);
const digestSecretSchema = z.string().min(32);
const tokenListSchema = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[A-Za-z0-9,._-]+$/u);
const searchLearningFiltersSchema = z.strictObject({
  canton: tokenListSchema.optional(),
  city: tokenListSchema.optional(),
  radius: z.number().int().min(1).max(200).optional(),
  category: tokenListSchema.optional(),
  workloadMin: z.number().int().min(0).max(100).optional(),
  workloadMax: z.number().int().min(0).max(100).optional(),
  jobType: tokenListSchema.optional(),
  remoteType: tokenListSchema.optional(),
  language: tokenListSchema.optional(),
  applicationEffort: tokenListSchema.optional(),
  salaryPeriod: tokenListSchema.optional(),
  salaryDisclosed: z.boolean().optional(),
  evidence: tokenListSchema.optional(),
  companyVerified: z.boolean().optional(),
  sort: tokenListSchema.optional(),
});
const reviewInputSchema = z.strictObject({
  aggregateId: z.uuid(),
  reviewerUserId: z.uuid(),
  idempotencyKey: z
    .string()
    .min(8)
    .max(96)
    .regex(/^[A-Za-z0-9:._-]+$/u),
  action: z.enum(["REVIEW", "PROMOTE", "REJECT"]),
  reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/u),
  releaseOutcomeCode: z
    .string()
    .regex(/^[A-Z][A-Z0-9_.-]{1,63}$/u)
    .optional(),
});

export type SearchLearningRecordResult =
  | Readonly<{ recorded: false; reason: "PII_OR_SECRET" | "INVALID" }>
  | Readonly<{
      recorded: true;
      aggregateId: string;
      observationCount: number;
      actionable: boolean;
    }>;

/**
 * Persists only an HMAC bucket and allowlisted dimensions. The raw query is
 * never part of a Prisma input, log or returned value.
 */
export async function recordSearchLearningObservation(
  raw: unknown,
  dependencies: Readonly<{
    database: DatabaseClient;
    digestSecret: string;
    now?: Date;
  }>,
): Promise<SearchLearningRecordResult> {
  const parsed = z
    .strictObject({
      query: rawQuerySchema,
      contributorId: z.uuid(),
      locale: localeSchema,
      resultBucket: resultBucketSchema,
      filters: searchLearningFiltersSchema.default({}),
    })
    .safeParse(raw);
  const secret = digestSecretSchema.safeParse(dependencies.digestSecret);
  const now = dependencies.now ?? new Date();
  if (!parsed.success || !secret.success || !Number.isFinite(now.getTime())) {
    return Object.freeze({ recorded: false, reason: "INVALID" });
  }
  const normalized = normalizeLearningQuery(parsed.data.query);
  if (normalized === null) {
    return Object.freeze({ recorded: false, reason: "PII_OR_SECRET" });
  }
  const windowStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const tokenBucket = createHmac("sha256", secret.data)
    .update(`search-learning-v1\0${normalized}`, "utf8")
    .digest("hex");
  const contributorBucket = createHmac("sha256", secret.data)
    .update(
      `search-learning-contributor-v1\0${parsed.data.contributorId}`,
      "utf8",
    )
    .digest("hex");
  const filterFingerprint = createHash("sha256")
    .update(JSON.stringify(Object.entries(parsed.data.filters).sort()), "utf8")
    .digest("hex");
  const conceptKeys = resolveSearchConceptKeysV2(normalized);
  const expiresAt = new Date(
    windowStart.getTime() + SEARCH_LEARNING_WORKING_RETENTION_DAYS_V1 * DAY_MS,
  );
  const aggregateLockKey = [
    windowStart.toISOString(),
    parsed.data.locale,
    SEARCH_POLICY_RELEASE_V2.searchPolicyVersion,
    tokenBucket,
    filterFingerprint,
    parsed.data.resultBucket,
  ].join(":");

  return withSearchLearningTransactionRetry(() =>
    dependencies.database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          SELECT 1 AS "locked"
          FROM pg_advisory_xact_lock(hashtextextended(${aggregateLockKey}, 0))
        `;
        const where = {
          windowStart_locale_searchPolicyVersion_tokenBucket_filterFingerprint_resultBucket:
            {
              windowStart,
              locale: parsed.data.locale,
              searchPolicyVersion: SEARCH_POLICY_RELEASE_V2.searchPolicyVersion,
              tokenBucket,
              filterFingerprint,
              resultBucket: parsed.data.resultBucket,
            },
        } as const;
        const aggregateIdentity =
          await transaction.searchLearningAggregate.upsert({
            where,
            create: {
              id: randomUUID(),
              windowStart,
              locale: parsed.data.locale,
              searchPolicyVersion: SEARCH_POLICY_RELEASE_V2.searchPolicyVersion,
              tokenBucket,
              filterFingerprint,
              resultBucket: parsed.data.resultBucket,
              conceptKeys: [...conceptKeys],
              reviewLabel: null,
              observationCount: 0,
              status: "HIDDEN",
              expiresAt,
              createdAt: now,
              updatedAt: now,
            },
            update: { updatedAt: now },
            select: { id: true },
          });
        const contribution =
          await transaction.searchLearningContribution.createMany({
            data: [
              {
                id: randomUUID(),
                aggregateId: aggregateIdentity.id,
                contributorBucket,
                createdAt: now,
              },
            ],
            skipDuplicates: true,
          });
        const aggregate =
          contribution.count === 1
            ? await transaction.searchLearningAggregate.update({
                where: { id: aggregateIdentity.id },
                data: { observationCount: { increment: 1 }, updatedAt: now },
                select: { id: true, observationCount: true, status: true },
              })
            : await transaction.searchLearningAggregate.findUniqueOrThrow({
                where: { id: aggregateIdentity.id },
                select: { id: true, observationCount: true, status: true },
              });
        const becomesActionable =
          aggregate.status === "HIDDEN" &&
          aggregate.observationCount >= SEARCH_LEARNING_K_THRESHOLD_V1;
        if (becomesActionable) {
          await transaction.searchLearningAggregate.update({
            where: { id: aggregate.id },
            data: {
              status: "ACTIONABLE",
              reviewLabel: normalized,
              actionableAt: now,
              updatedAt: now,
            },
          });
          await transaction.searchLearningEvent.create({
            data: {
              id: randomUUID(),
              aggregateId: aggregate.id,
              kind: "BECAME_ACTIONABLE",
              actorUserId: null,
              reasonCode: "K_THRESHOLD_REACHED",
              idempotencyKey: `search-learning:actionable:${aggregate.id}`,
              createdAt: now,
            },
          });
        }
        return Object.freeze({
          recorded: true,
          aggregateId: aggregate.id,
          observationCount: aggregate.observationCount,
          actionable: becomesActionable || aggregate.status !== "HIDDEN",
        });
      },
      { isolationLevel: "ReadCommitted" },
    ),
  );
}

export async function reviewSearchLearningAggregate(
  raw: unknown,
  dependencies: Readonly<{
    audit?: Readonly<{
      actorUserId: string;
      capability: string;
      correlationId: string;
    }>;
    database: DatabaseClient;
    now?: Date;
  }>,
) {
  const parsed = reviewInputSchema.safeParse(raw);
  const now = dependencies.now ?? new Date();
  if (
    !parsed.success ||
    !Number.isFinite(now.getTime()) ||
    (dependencies.audit !== undefined &&
      dependencies.audit.actorUserId !== parsed.data.reviewerUserId)
  ) {
    return Object.freeze({ ok: false, code: "INVALID_INPUT" as const });
  }
  return withSearchLearningTransactionRetry(() =>
    dependencies.database.$transaction(
      async (transaction) => {
        const replay = await transaction.searchLearningEvent.findUnique({
          where: { idempotencyKey: parsed.data.idempotencyKey },
          select: { aggregate: { select: { id: true, status: true } } },
        });
        if (replay !== null) {
          return Object.freeze({
            ok: true,
            aggregateId: replay.aggregate.id,
            status: replay.aggregate.status,
            replay: true,
          });
        }
        const aggregate = await transaction.searchLearningAggregate.findUnique({
          where: { id: parsed.data.aggregateId },
          select: {
            id: true,
            status: true,
            observationCount: true,
            expiresAt: true,
          },
        });
        if (aggregate === null) {
          return Object.freeze({ ok: false, code: "NOT_FOUND" as const });
        }
        const rule = transitionForReview(
          aggregate.status,
          parsed.data.action,
          aggregate.observationCount,
          aggregate.expiresAt,
          now,
          parsed.data.releaseOutcomeCode,
        );
        if (rule === null) {
          return Object.freeze({ ok: false, code: "CONFLICT" as const });
        }
        await transaction.searchLearningAggregate.update({
          where: { id: aggregate.id },
          data: {
            status: rule.status,
            reviewedAt: now,
            reviewedByUserId: parsed.data.reviewerUserId,
            releaseOutcomeCode: parsed.data.releaseOutcomeCode ?? null,
            updatedAt: now,
          },
        });
        await transaction.searchLearningEvent.create({
          data: {
            id: randomUUID(),
            aggregateId: aggregate.id,
            kind: rule.kind,
            actorUserId: parsed.data.reviewerUserId,
            reasonCode: parsed.data.reasonCode,
            idempotencyKey: parsed.data.idempotencyKey,
            createdAt: now,
          },
        });
        if (dependencies.audit !== undefined) {
          await writeRequiredAudit(
            createPrismaTransactionAuditPort(transaction),
            {
              action: "TAXONOMY_CHANGED",
              actorKind: "USER",
              actorUserId: dependencies.audit.actorUserId,
              capability: dependencies.audit.capability,
              companyId: null,
              correlationId: dependencies.audit.correlationId,
              reasonCode: parsed.data.reasonCode,
              result: "SUCCEEDED",
              retainUntil: new Date(now.getTime() + 400 * DAY_MS),
              targetId: aggregate.id,
              targetType: "TAXONOMY",
            },
          );
        }
        return Object.freeze({
          ok: true,
          aggregateId: aggregate.id,
          status: rule.status,
        });
      },
      { isolationLevel: "Serializable" },
    ),
  );
}

export async function expireSearchLearningWorkingState(
  database: DatabaseClient,
  now = new Date(),
) {
  if (!Number.isFinite(now.getTime()))
    throw new TypeError("Invalid expiry clock.");
  const due = await database.searchLearningAggregate.findMany({
    where: {
      expiresAt: { lte: now },
      status: {
        in: ["HIDDEN", "ACTIONABLE", "REVIEWED", "REJECTED", "PROMOTED"],
      },
    },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
    take: 500,
    select: { id: true },
  });
  let expired = 0;
  for (const row of due) {
    expired += await database.$transaction(
      async (transaction) => {
        const changed = await transaction.searchLearningAggregate.updateMany({
          where: {
            id: row.id,
            expiresAt: { lte: now },
            status: {
              in: ["HIDDEN", "ACTIONABLE", "REVIEWED", "REJECTED", "PROMOTED"],
            },
          },
          data: { status: "EXPIRED", reviewLabel: null, updatedAt: now },
        });
        if (changed.count !== 1) return 0;
        await transaction.searchLearningEvent.upsert({
          where: { idempotencyKey: `search-learning:expired:${row.id}` },
          create: {
            id: randomUUID(),
            aggregateId: row.id,
            kind: "EXPIRED",
            actorUserId: null,
            reasonCode: "WORKING_RETENTION_EXPIRED",
            idempotencyKey: `search-learning:expired:${row.id}`,
            createdAt: now,
          },
          update: {},
        });
        await transaction.searchLearningContribution.deleteMany({
          where: { aggregateId: row.id },
        });
        return 1;
      },
      { isolationLevel: "Serializable" },
    );
  }
  return Object.freeze({ expired });
}

function normalizeLearningQuery(value: string): string | null {
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (
    /(?:[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/iu.test(normalized) ||
    /(?:\+?\d[\d ()/.-]{7,}\d)/u.test(normalized) ||
    /(?:bearer|api[_ -]?key|password|passwort|token|secret)\s*[:=]/iu.test(
      normalized,
    )
  ) {
    return null;
  }
  const allowlisted = normalized
    .replaceAll(/[^\p{L}\p{N} .+#/-]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .slice(0, 160)
    .trim();
  return allowlisted.length === 0 ? null : allowlisted;
}

function transitionForReview(
  current: string,
  action: "REVIEW" | "PROMOTE" | "REJECT",
  count: number,
  expiresAt: Date,
  now: Date,
  releaseOutcomeCode: string | undefined,
) {
  if (count < SEARCH_LEARNING_K_THRESHOLD_V1 || expiresAt <= now) return null;
  if (action === "REVIEW" && current === "ACTIONABLE") {
    return Object.freeze({
      status: "REVIEWED" as const,
      kind: "REVIEWED" as const,
    });
  }
  if (
    action === "PROMOTE" &&
    current === "REVIEWED" &&
    releaseOutcomeCode !== undefined
  ) {
    return Object.freeze({
      status: "PROMOTED" as const,
      kind: "PROMOTED" as const,
    });
  }
  if (action === "REJECT" && ["ACTIONABLE", "REVIEWED"].includes(current)) {
    return Object.freeze({
      status: "REJECTED" as const,
      kind: "REJECTED" as const,
    });
  }
  return null;
}

async function withSearchLearningTransactionRetry<T>(
  operation: () => Promise<T>,
): Promise<T> {
  for (
    let attempt = 1;
    attempt <= SEARCH_LEARNING_TRANSACTION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await operation();
    } catch (error) {
      if (
        attempt >= SEARCH_LEARNING_TRANSACTION_ATTEMPTS ||
        !isSearchLearningRetryable(error)
      ) {
        throw error;
      }
    }
  }
  throw new Error("Search-learning transaction retry budget exhausted.");
}

function isSearchLearningRetryable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as Readonly<{
    code?: unknown;
    message?: unknown;
    meta?: Readonly<{ code?: unknown; message?: unknown }>;
  }>;
  const code = typeof candidate.code === "string" ? candidate.code : "";
  if (
    code === "P2002" ||
    code === "P2034" ||
    code === "40001" ||
    code === "40P01"
  ) {
    return true;
  }
  const databaseCode =
    typeof candidate.meta?.code === "string" ? candidate.meta.code : "";
  if (databaseCode === "40001" || databaseCode === "40P01") return true;
  return /could not serialize access|deadlock detected|write conflict/iu.test(
    [
      typeof candidate.message === "string" ? candidate.message : "",
      typeof candidate.meta?.message === "string" ? candidate.meta.message : "",
    ].join("\n"),
  );
}
