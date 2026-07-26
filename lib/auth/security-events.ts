import "server-only";

import type {
  AuthSecurityEventKind,
  Prisma,
} from "@/lib/generated/prisma/client";

const RETENTION_MILLISECONDS = 90 * 24 * 60 * 60 * 1_000;

export async function writeAuthSecurityEvent(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    userId?: string;
    kind: AuthSecurityEventKind;
    actorHash?: string;
    targetHash?: string;
    correlationId: string;
    outcomeCode: string;
    occurredAt: Date;
  }>,
) {
  return transaction.authSecurityEvent.create({
    data: {
      ...(input.userId === undefined ? {} : { userId: input.userId }),
      kind: input.kind,
      ...(input.actorHash === undefined ? {} : { actorHash: input.actorHash }),
      ...(input.targetHash === undefined
        ? {}
        : { targetHash: input.targetHash }),
      correlationId: input.correlationId,
      outcomeCode: input.outcomeCode,
      occurredAt: input.occurredAt,
      retainUntil: new Date(
        input.occurredAt.getTime() + RETENTION_MILLISECONDS,
      ),
    },
    select: { id: true },
  });
}
