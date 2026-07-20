import type { AuditPersistenceRecord, AuditWritePort } from "@/lib/audit/log";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";

export function createPrismaAuditPort(
  database: DatabaseClient,
): AuditWritePort<unknown> {
  return buildPort((data) => database.auditLog.create({ data }));
}

export function createPrismaTransactionAuditPort(
  transaction: Prisma.TransactionClient,
): AuditWritePort<unknown> {
  return buildPort((data) => transaction.auditLog.create({ data }));
}

function buildPort(
  create: (data: Prisma.AuditLogUncheckedCreateInput) => PromiseLike<unknown>,
): AuditWritePort<unknown> {
  return Object.freeze({
    auditLog: Object.freeze({
      async create({ data }: Readonly<{ data: AuditPersistenceRecord }>) {
        return await create({
          ...data,
          metadata:
            data.metadata === null
              ? Prisma.JsonNull
              : (data.metadata as Prisma.InputJsonValue),
        });
      },
    }),
  });
}
