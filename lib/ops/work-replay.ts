import "server-only";

import { z } from "zod";

import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";

const inputSchema = z.strictObject({
  actorReference: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+ -]{1,127}$/u),
  addedAttemptBudget: z.int().min(1).max(8),
  capability: z.literal("OPS_SANDBOX_DLQ_REPLAY"),
  now: z.date(),
  reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u),
  stepUpEvidenceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  workItemId: z.uuid(),
});

export async function replayDeadLetterInSandbox(
  raw: z.input<typeof inputSchema>,
  dependencies: Readonly<{
    database: DatabaseClient;
    environment: ServerEnvironment;
  }>,
) {
  const input = inputSchema.parse(raw);
  if (
    !Number.isFinite(input.now.getTime()) ||
    !dependencies.environment.WORKER_SANDBOX_REPLAY ||
    dependencies.environment.WORKER_RUNTIME !== "sandbox_command" ||
    (
      dependencies.environment.APP_ENV !== "local" &&
      dependencies.environment.APP_ENV !== "ci"
    )
  ) {
    return Object.freeze({ ok: false as const, code: "FORBIDDEN" as const });
  }

  return dependencies.database.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<
      Array<{
        attemptCount: number;
        deadLetterId: string;
        effectKey: string;
        maxAttempts: number;
        status: string;
      }>
    >(Prisma.sql`
      SELECT
        item."attemptCount",
        letter."id" AS "deadLetterId",
        item."effectKey",
        item."maxAttempts",
        item."status"::text
      FROM "WorkItem" AS item
      JOIN "WorkDeadLetter" AS letter
        ON letter."workItemId" = item."id"
      WHERE item."id" = ${input.workItemId}::uuid
      FOR UPDATE OF item
    `);
    const item = rows[0];
    if (item === undefined || item.status !== "DEAD_LETTER") {
      return Object.freeze({ ok: false as const, code: "NOT_REPLAYABLE" as const });
    }
    if (item.maxAttempts + input.addedAttemptBudget > 64) {
      return Object.freeze({
        ok: false as const,
        code: "ATTEMPT_BUDGET_EXHAUSTED" as const,
      });
    }
    await transaction.workReplayAudit.create({
      data: {
        workItemId: input.workItemId,
        deadLetterId: item.deadLetterId,
        actorReference: input.actorReference,
        capability: input.capability,
        stepUpEvidenceDigest: input.stepUpEvidenceDigest,
        reasonCode: input.reasonCode,
        effectKey: item.effectKey,
        priorAttemptCount: item.attemptCount,
        addedAttemptBudget: input.addedAttemptBudget,
        createdAt: input.now,
      },
    });
    await transaction.workItem.update({
      where: { id: input.workItemId },
      data: {
        status: "RETRY",
        availableAt: input.now,
        maxAttempts: { increment: input.addedAttemptBudget },
        replayCount: { increment: 1 },
        deadLetteredAt: null,
        lastFailureClass: null,
        lastErrorCode: null,
        lastErrorDigest: null,
        updatedAt: input.now,
      },
    });
    return Object.freeze({
      ok: true as const,
      effectKey: item.effectKey,
      nextAttemptNumber: item.attemptCount + 1,
    });
  });
}
