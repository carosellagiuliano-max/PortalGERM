import "server-only";

import type { DatabaseClient } from "@/lib/db/factory";
import type { Prisma } from "@/lib/generated/prisma/client";
import type {
  EmailLogRepository,
  MockEmailLogRecord,
} from "@/lib/providers/email/mock-email-provider";
import { EmailLogIdempotencyConflictError } from "@/lib/providers/email/mock-email-provider";

export class PrismaEmailLogRepository implements EmailLogRepository {
  readonly #database: DatabaseClient;

  constructor(database: DatabaseClient) {
    this.#database = database;
  }

  async record(input: MockEmailLogRecord) {
    try {
      const created = await this.#database.emailLog.create({
        data: {
          ...(input.id === undefined ? {} : { id: input.id }),
          recipient: input.recipient,
          purpose: input.purpose,
          templateKey: input.templateKey,
          payload: input.payload as Prisma.InputJsonObject,
          status: input.status,
          providerReference: input.providerReference,
        },
        select: { id: true },
      });
      return { id: created.id, created: true };
    } catch (error) {
      if (input.id === undefined || !isUniqueConstraintError(error)) {
        throw error;
      }
      const existing = await this.#database.emailLog.findUnique({
        where: { id: input.id },
        select: {
          id: true,
          recipient: true,
          templateKey: true,
          providerReference: true,
        },
      });
      if (
        existing === null ||
        existing.recipient !== input.recipient ||
        existing.templateKey !== input.templateKey ||
        existing.providerReference !== input.providerReference
      ) {
        throw new EmailLogIdempotencyConflictError();
      }
      return { id: existing.id, created: false };
    }
  }
}

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}
