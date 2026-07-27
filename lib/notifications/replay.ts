import "server-only";

import {
  adminFailure,
  adminNow,
  adminSuccess,
  requireCapability,
  writeAdminAudit,
  type AdminDependencies,
  type AdminCommandResult,
} from "@/lib/admin/common";
import type { ServerEnvironment } from "@/lib/config/env-schema";

const SANDBOX_CONFIRMATION = "PHASE20_LOCAL_SANDBOX_REPLAY";

/**
 * Requeues exactly one dead-lettered notification in the isolated local
 * sandbox. Capability and activation checks intentionally happen before the
 * outbox row is read, so Support cannot use this function as a payload/status
 * oracle. Production remains blocked until Phase 25 supplies a real step-up
 * grant.
 */
export async function replayDeadLetterNotification(
  input: Readonly<{
    outboxId: string;
    reasonCode: string;
    sandboxConfirmation: string;
  }>,
  dependencies: AdminDependencies &
    Readonly<{ environment: ServerEnvironment }>,
): Promise<
  AdminCommandResult<Readonly<{ outboxId: string; nextAttempt: number }>>
> {
  if (!(await requireCapability(dependencies, "ADMIN_SYSTEM_TASK_MANAGE"))) {
    return adminFailure("FORBIDDEN");
  }
  if (
    !dependencies.environment.DELIVERY_REPLAY ||
    dependencies.environment.APP_ENV !== "local" ||
    dependencies.environment.EMAIL_PROVIDER_MODE !== "local_mock" ||
    input.sandboxConfirmation !== SANDBOX_CONFIRMATION
  ) {
    return adminFailure("RESTRICTED");
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      input.outboxId,
    ) ||
    !/^[A-Z][A-Z0-9_]{1,63}$/u.test(input.reasonCode)
  ) {
    return adminFailure("INVALID_INPUT");
  }
  const now = adminNow(dependencies.now);
  try {
    const result = await dependencies.database.$transaction(
      async (transaction) => {
        const locked = await transaction.$queryRaw<
          Array<{
            id: string;
            status: string;
            attemptCount: number;
            maxAttempts: number;
          }>
        >`
          SELECT "id", "status"::text, "attemptCount", "maxAttempts"
            FROM "NotificationOutbox"
           WHERE "id" = ${input.outboxId}::uuid
           FOR UPDATE
        `;
        const outbox = locked[0];
        if (outbox === undefined) return "NOT_FOUND" as const;
        if (
          outbox.status !== "DEAD_LETTER" ||
          outbox.attemptCount >= 20
        ) {
          return "CONFLICT" as const;
        }
        const nextAttempt = outbox.attemptCount + 1;
        await transaction.notificationOutbox.update({
          where: { id: outbox.id },
          data: {
            status: "RETRY",
            availableAt: now,
            maxAttempts: Math.max(outbox.maxAttempts, nextAttempt),
            deadLetteredAt: null,
            lastErrorCode: null,
          },
          select: { id: true },
        });
        await writeAdminAudit(transaction, dependencies, now, {
          action: "NOTIFICATION_DELIVERY_REPLAYED",
          capability: "ADMIN_SYSTEM_TASK_MANAGE",
          targetType: "SYSTEM_TASK",
          targetId: outbox.id,
          reasonCode: input.reasonCode,
        });
        return Object.freeze({ outboxId: outbox.id, nextAttempt });
      },
    );
    if (result === "NOT_FOUND") return adminFailure("NOT_FOUND");
    if (result === "CONFLICT") return adminFailure("CONFLICT");
    return adminSuccess(result);
  } catch {
    return adminFailure("WRITE_FAILED");
  }
}

export const PHASE20_SANDBOX_REPLAY_CONFIRMATION = SANDBOX_CONFIRMATION;
