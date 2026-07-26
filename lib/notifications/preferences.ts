import "server-only";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import type { AuthRequestContext } from "@/lib/auth/request-context";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import type { NotificationPurpose } from "@/lib/generated/prisma/client";

import { mayUserDisablePurpose } from "./purpose-policy";

const AUDIT_RETENTION_MILLISECONDS = 365 * 24 * 60 * 60 * 1_000;

export async function setNotificationPreference(
  input: Readonly<{
    userId: string;
    actorUserId: string;
    purpose: NotificationPurpose;
    enabled: boolean;
    expectedVersion?: number;
    reasonCode: string;
  }>,
  dependencies: Readonly<{
    database: DatabaseClient;
    environment: ServerEnvironment;
    request: AuthRequestContext;
    now?: Date;
  }>,
) {
  if (
    input.userId !== input.actorUserId ||
    !mayUserDisablePurpose(input.purpose) ||
    !/^[A-Z][A-Z0-9_]{0,63}$/u.test(input.reasonCode)
  ) {
    return Object.freeze({
      ok: false as const,
      code:
        input.userId !== input.actorUserId
          ? ("FORBIDDEN" as const)
          : ("MANDATORY_OR_UNKNOWN" as const),
    });
  }
  const now = dependencies.now ?? new Date();
  try {
    const preference = await dependencies.database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
            FROM "User"
           WHERE "id" = ${input.userId}::uuid
             AND "status" = 'ACTIVE'
           FOR UPDATE
        `;
        const current = await transaction.notificationPreference.findUnique({
          where: {
            userId_purpose_channel: {
              userId: input.userId,
              purpose: input.purpose,
              channel: "EMAIL",
            },
          },
          select: { id: true, enabled: true, version: true },
        });
        if (
          input.expectedVersion !== undefined &&
          input.expectedVersion !== (current?.version ?? 0)
        ) {
          return null;
        }
        if (current?.enabled === input.enabled) {
          return current;
        }
        const version = (current?.version ?? 0) + 1;
        const updated = await transaction.notificationPreference.upsert({
          where: {
            userId_purpose_channel: {
              userId: input.userId,
              purpose: input.purpose,
              channel: "EMAIL",
            },
          },
          create: {
            userId: input.userId,
            purpose: input.purpose,
            channel: "EMAIL",
            enabled: input.enabled,
            version,
            createdAt: now,
          },
          update: {
            enabled: input.enabled,
            version,
          },
          select: { id: true, enabled: true, version: true },
        });
        await transaction.notificationPreferenceEvent.create({
          data: {
            userId: input.userId,
            purpose: input.purpose,
            channel: "EMAIL",
            enabled: input.enabled,
            version,
            actorUserId: input.actorUserId,
            reasonCode: input.reasonCode,
            createdAt: now,
          },
          select: { id: true },
        });
        await writeRequiredAudit(
          createPrismaTransactionAuditPort(transaction),
          {
            action: "NOTIFICATION_PREFERENCE_CHANGED",
            actorKind: "USER",
            actorUserId: input.actorUserId,
            capability: "NOTIFICATION_PREFERENCE_WRITE",
            correlationId: dependencies.request.correlationId,
            result: "SUCCEEDED",
            retainUntil: new Date(
              now.getTime() + AUDIT_RETENTION_MILLISECONDS,
            ),
            targetId: input.userId,
            targetType: "USER",
          },
          {
            sourceIp: dependencies.request.sourceIp,
            keyring:
              dependencies.environment.secrets.keyrings.AUDIT_IP_HASH_KEYS,
          },
        );
        return updated;
      },
    );
    if (preference === null) {
      return Object.freeze({
        ok: false as const,
        code: "VERSION_CONFLICT" as const,
      });
    }
    return Object.freeze({ ok: true as const, preference });
  } catch {
    return Object.freeze({
      ok: false as const,
      code: "PERSISTENCE_CONFLICT" as const,
    });
  }
}

export async function listNotificationPreferences(
  userId: string,
  database: DatabaseClient,
) {
  const rows = await database.notificationPreference.findMany({
    where: { userId },
    orderBy: [{ purpose: "asc" }, { channel: "asc" }],
    select: {
      purpose: true,
      channel: true,
      enabled: true,
      version: true,
      updatedAt: true,
    },
  });
  return Object.freeze(rows.map((row) => Object.freeze(row)));
}
