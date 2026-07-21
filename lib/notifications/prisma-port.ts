import type { DatabaseClient } from "@/lib/db/factory";
import type { Prisma } from "@/lib/generated/prisma/client";
import type {
  NotificationPersistenceRecord,
  NotificationWritePort,
} from "@/lib/notifications/writer";

export function createPrismaNotificationPort(
  database: DatabaseClient | Prisma.TransactionClient,
): NotificationWritePort<unknown> {
  return Object.freeze({
    notification: Object.freeze({
      async upsert(input: Readonly<{
        create: NotificationPersistenceRecord;
        update: Readonly<Record<string, never>>;
        where: Readonly<{
          recipientUserId_kind_dedupeKey: Readonly<{
            recipientUserId: string;
            kind: NotificationPersistenceRecord["kind"];
            dedupeKey: string;
          }>;
        }>;
      }>) {
        return database.notification.upsert({
          create: {
            ...input.create,
            payload: input.create.payload as Prisma.InputJsonObject,
          },
          update: input.update,
          where: input.where,
        });
      },
    }),
  });
}
