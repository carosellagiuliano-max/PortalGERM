import "server-only";

import { z } from "zod";

import {
  adminFailure,
  adminNow,
  adminSuccess,
  requireCapability,
  type AdminDependencies,
} from "@/lib/admin/common";
import { reviewSearchLearningAggregate } from "@/lib/search/learning";

const reviewSchema = z.strictObject({
  aggregateId: z.uuid(),
  action: z.enum(["REVIEW", "PROMOTE", "REJECT"]),
  reasonCode: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_]{1,63}$/u),
  releaseOutcomeCode: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_.-]{1,63}$/u)
    .nullish()
    .transform((value) => value ?? undefined),
  idempotencyKey: z
    .string()
    .min(8)
    .max(96)
    .regex(/^[A-Za-z0-9:._-]+$/u),
});

export async function listAdminSearchLearning(dependencies: AdminDependencies) {
  if (!(await requireCapability(dependencies, "ADMIN_TAXONOMY_MANAGE"))) {
    return null;
  }
  const now = adminNow(dependencies.now);
  const rows = await dependencies.database.searchLearningAggregate.findMany({
    where: {
      status: { in: ["ACTIONABLE", "REVIEWED"] },
      expiresAt: { gt: now },
    },
    orderBy: [
      { actionableAt: "asc" },
      { observationCount: "desc" },
      { id: "asc" },
    ],
    take: 100,
    select: {
      id: true,
      windowStart: true,
      locale: true,
      searchPolicyVersion: true,
      conceptKeys: true,
      reviewLabel: true,
      resultBucket: true,
      observationCount: true,
      status: true,
      actionableAt: true,
      expiresAt: true,
      releaseOutcomeCode: true,
    },
  });
  return rows.flatMap((row) =>
    row.status === "ACTIONABLE" || row.status === "REVIEWED"
      ? [Object.freeze({ ...row, status: row.status })]
      : [],
  );
}

export async function reviewAdminSearchLearning(
  raw: unknown,
  dependencies: AdminDependencies,
) {
  const parsed = reviewSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!(await requireCapability(dependencies, "ADMIN_TAXONOMY_MANAGE"))) {
    return adminFailure("FORBIDDEN");
  }
  const now = adminNow(dependencies.now);
  const result = await reviewSearchLearningAggregate(
    {
      ...parsed.data,
      reviewerUserId: dependencies.actor.userId,
    },
    {
      audit: {
        actorUserId: dependencies.actor.userId,
        capability: "ADMIN_TAXONOMY_MANAGE",
        correlationId: dependencies.correlationId,
      },
      database: dependencies.database,
      now,
    },
  );
  if (!result.ok) {
    return adminFailure(result.code);
  }
  return adminSuccess(
    {
      aggregateId: result.aggregateId,
      status: result.status,
    },
    "replay" in result && result.replay === true,
  );
}
