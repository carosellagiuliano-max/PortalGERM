import "server-only";

import { z } from "zod";

import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  CAPACITY_POLICY_VERSION,
  resolveCapacityBackpressure,
} from "@/lib/ops/capacity-backpressure-policy";

const inputSchema = z.strictObject({
  arrivalP95PerMinute: z.number().finite().nonnegative(),
  databasePoolBasisPoints: z.int().min(0).max(10_000).nullable().default(null),
  deploymentDigest: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,127}$/u),
  downstreamHealthy: z.boolean(),
  environment: z.enum(["local", "ci", "preview", "staging", "production"]),
  handlerKey: z.string().regex(/^[a-z0-9][a-z0-9._:-]{1,95}$/u),
  handlerVersion: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u),
  manualHandlingMinutes: z.int().nonnegative().default(0),
  providerQuotaBasisPoints: z.int().min(0).max(10_000).nullable().default(null),
  queueKey: z.string().regex(/^[a-z0-9][a-z0-9._:-]{1,95}$/u),
  sustainablePerMinute: z.number().finite().nonnegative(),
  unitCostMicros: z.bigint().nonnegative().nullable().default(null),
  unitCostSource: z.string().min(2).max(255).nullable().default(null),
  windowEndedAt: z.date(),
  windowStartedAt: z.date(),
  workerCount: z.int().nonnegative(),
});

type HandlingDistribution = Readonly<{
  handlingP50Milliseconds: number | bigint | null;
  handlingP95Milliseconds: number | bigint | null;
}>;

export async function recordOperationalCapacitySample(
  database: DatabaseClient,
  raw: z.input<typeof inputSchema>,
) {
  const input = inputSchema.parse(raw);
  if (
    !Number.isFinite(input.windowStartedAt.getTime()) ||
    !Number.isFinite(input.windowEndedAt.getTime()) ||
    input.windowStartedAt.getTime() >= input.windowEndedAt.getTime() ||
    (input.unitCostMicros === null) !== (input.unitCostSource === null)
  ) {
    throw new TypeError("Operational capacity window or cost evidence is invalid.");
  }

  const [
    arrivalCount,
    completionCount,
    failureCount,
    retryCount,
    deadLetterCount,
    backlog,
    distributionRows,
  ] = await Promise.all([
    database.workItem.count({
      where: {
        handlerKey: input.handlerKey,
        handlerVersion: input.handlerVersion,
        createdAt: {
          gte: input.windowStartedAt,
          lt: input.windowEndedAt,
        },
      },
    }),
    database.workAttempt.count({
      where: {
        workItem: {
          handlerKey: input.handlerKey,
          handlerVersion: input.handlerVersion,
        },
        outcome: { in: ["SUCCEEDED", "EFFECT_ALREADY_APPLIED"] },
        completedAt: {
          gte: input.windowStartedAt,
          lt: input.windowEndedAt,
        },
      },
    }),
    database.workAttempt.count({
      where: {
        workItem: {
          handlerKey: input.handlerKey,
          handlerVersion: input.handlerVersion,
        },
        outcome: { in: ["RETRY_SCHEDULED", "DEAD_LETTERED", "PAUSED"] },
        completedAt: {
          gte: input.windowStartedAt,
          lt: input.windowEndedAt,
        },
      },
    }),
    database.workAttempt.count({
      where: {
        workItem: {
          handlerKey: input.handlerKey,
          handlerVersion: input.handlerVersion,
        },
        outcome: "RETRY_SCHEDULED",
        completedAt: {
          gte: input.windowStartedAt,
          lt: input.windowEndedAt,
        },
      },
    }),
    database.workAttempt.count({
      where: {
        workItem: {
          handlerKey: input.handlerKey,
          handlerVersion: input.handlerVersion,
        },
        outcome: "DEAD_LETTERED",
        completedAt: {
          gte: input.windowStartedAt,
          lt: input.windowEndedAt,
        },
      },
    }),
    database.workItem.aggregate({
      where: {
        handlerKey: input.handlerKey,
        handlerVersion: input.handlerVersion,
        status: { in: ["PENDING", "RETRY", "LEASED", "PAUSED"] },
      },
      _count: { _all: true },
      _min: { availableAt: true },
    }),
    database.$queryRaw<HandlingDistribution[]>(Prisma.sql`
      SELECT
        COALESCE(
          round(
            percentile_cont(0.50) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (
                attempt."completedAt" - attempt."startedAt"
              )) * 1000
            )
          ),
          0
        )::bigint AS "handlingP50Milliseconds",
        COALESCE(
          round(
            percentile_cont(0.95) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (
                attempt."completedAt" - attempt."startedAt"
              )) * 1000
            )
          ),
          0
        )::bigint AS "handlingP95Milliseconds"
      FROM "WorkAttempt" AS attempt
      JOIN "WorkItem" AS item ON item."id" = attempt."workItemId"
      WHERE item."handlerKey" = ${input.handlerKey}
        AND item."handlerVersion" = ${input.handlerVersion}
        AND attempt."completedAt" >= ${input.windowStartedAt}
        AND attempt."completedAt" < ${input.windowEndedAt}
    `),
  ]);
  const decision = resolveCapacityBackpressure({
    arrivalP95PerMinute: input.arrivalP95PerMinute,
    sustainablePerMinute: input.sustainablePerMinute,
    providerQuotaBasisPoints: input.providerQuotaBasisPoints,
    databasePoolBasisPoints: input.databasePoolBasisPoints,
    downstreamHealthy: input.downstreamHealthy,
  });
  const distribution = distributionRows[0];
  const oldestAgeMilliseconds =
    backlog._min.availableAt === null
      ? 0
      : Math.max(
          0,
          input.windowEndedAt.getTime() -
            backlog._min.availableAt.getTime(),
        );

  return database.operationalCapacitySample.create({
    data: {
      environment: input.environment,
      queueKey: input.queueKey,
      handlerKey: input.handlerKey,
      handlerVersion: input.handlerVersion,
      deploymentDigest: input.deploymentDigest,
      windowStartedAt: input.windowStartedAt,
      windowEndedAt: input.windowEndedAt,
      arrivalCount,
      completionCount,
      failureCount,
      retryCount,
      deadLetterCount,
      backlogCount: backlog._count._all,
      oldestAgeMilliseconds,
      sustainablePerMinute: input.sustainablePerMinute,
      arrivalP95PerMinute: input.arrivalP95PerMinute,
      handlingP50Milliseconds: Number(
        distribution?.handlingP50Milliseconds ?? 0,
      ),
      handlingP95Milliseconds: Number(
        distribution?.handlingP95Milliseconds ?? 0,
      ),
      utilizationBasisPoints: decision.utilizationBasisPoints,
      providerQuotaBasisPoints: input.providerQuotaBasisPoints,
      databasePoolBasisPoints: input.databasePoolBasisPoints,
      workerCount: input.workerCount,
      unitCostMicros: input.unitCostMicros,
      unitCostSource: input.unitCostSource,
      manualHandlingMinutes: input.manualHandlingMinutes,
      state: decision.state,
      policyVersion: CAPACITY_POLICY_VERSION,
    },
  });
}

export async function getOperationalCapacityOverview(
  database: DatabaseClient,
  environment: string,
) {
  return database.operationalCapacitySample.findMany({
    where: { environment },
    distinct: ["handlerKey", "handlerVersion"],
    orderBy: [
      { handlerKey: "asc" },
      { handlerVersion: "asc" },
      { windowEndedAt: "desc" },
    ],
    select: {
      handlerKey: true,
      handlerVersion: true,
      windowEndedAt: true,
      state: true,
      backlogCount: true,
      oldestAgeMilliseconds: true,
      arrivalP95PerMinute: true,
      sustainablePerMinute: true,
      utilizationBasisPoints: true,
      unitCostMicros: true,
      unitCostSource: true,
    },
  });
}
