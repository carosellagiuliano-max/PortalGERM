import "server-only";

import { z } from "zod";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import {
  billingFailure,
  billingSuccess,
  canManageBillingProfile,
  normalizeBillingNow,
  type BillingActor,
  type BillingCommandResult,
} from "@/lib/billing/contracts";
import type { DatabaseClient } from "@/lib/db/factory";
import type { Prisma } from "@/lib/generated/prisma/client";
import { billingAddressSchema } from "@/lib/validation/billing";

const BILLING_AUDIT_RETENTION_MS = 10 * 365 * 86_400_000;

const billingProfileCommandSchema = billingAddressSchema.extend({
  expectedVersion: z.coerce.number().int().positive().nullable().optional(),
});

export type BillingProfileView = Readonly<{
  legalName: string;
  billingContactEmail: string;
  street: string;
  postalCode: string;
  city: string;
  countryCode: "CH";
  uid: string | null;
  vatNumber: string | null;
  version: number;
}>;

export async function saveCompanyBillingProfile(
  input: unknown,
  dependencies: Readonly<{
    actor: BillingActor;
    correlationId: string;
    database: DatabaseClient;
    now?: Date;
  }>,
): Promise<BillingCommandResult<BillingProfileView>> {
  const parsed = billingProfileCommandSchema.safeParse(input);
  if (!parsed.success) return billingFailure("INVALID_INPUT");
  if (!canManageBillingProfile(dependencies.actor.membershipRole)) {
    return billingFailure("FORBIDDEN");
  }
  const now = normalizeBillingNow(dependencies.now);

  try {
    return await dependencies.database.$transaction(async (transaction) => {
      const membership = await transaction.companyMembership.findFirst({
        where: {
          id: dependencies.actor.membershipId,
          userId: dependencies.actor.userId,
          companyId: dependencies.actor.companyId,
          role: dependencies.actor.membershipRole,
          status: "ACTIVE",
          removedAt: null,
          company: { status: { in: ["DRAFT", "ACTIVE"] } },
        },
        select: { id: true },
      });
      if (membership === null) return billingFailure("NOT_FOUND");

      const current = await transaction.companyBillingProfile.findUnique({
        where: { companyId: dependencies.actor.companyId },
        select: { version: true },
      });
      const expectedVersion = parsed.data.expectedVersion ?? null;
      if (
        (current === null && expectedVersion !== null) ||
        (current !== null && current.version !== expectedVersion)
      ) {
        return billingFailure("CONFLICT");
      }

      const data = {
        legalName: parsed.data.legalName,
        billingContactEmail: parsed.data.billingContactEmail,
        street: parsed.data.street,
        postalCode: parsed.data.postalCode,
        city: parsed.data.city,
        countryCode: "CH" as const,
        uid: parsed.data.uid ?? null,
        vatNumber: parsed.data.vatNumber ?? null,
      };
      const saved =
        current === null
          ? await transaction.companyBillingProfile.create({
              data: { companyId: dependencies.actor.companyId, ...data },
              select: profileSelect,
            })
          : await updateExistingProfile(
              transaction,
              dependencies.actor.companyId,
              current.version,
              data,
            );
      if (saved === null) return billingFailure("CONFLICT");

      await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
        action: "BILLING_PROFILE_UPDATED",
        actorKind: "USER",
        actorUserId: dependencies.actor.userId,
        capability: "EMPLOYER_BILLING_PROFILE_MANAGE",
        companyId: dependencies.actor.companyId,
        correlationId: dependencies.correlationId,
        reasonCode: current === null ? "PROFILE_CREATED" : "PROFILE_UPDATED",
        result: "SUCCEEDED",
        retainUntil: new Date(now.getTime() + BILLING_AUDIT_RETENTION_MS),
        targetId: dependencies.actor.companyId,
        targetType: "COMPANY",
      });
      return billingSuccess(toProfileView(saved));
    });
  } catch (error) {
    return billingFailure(
      isUniqueConstraintError(error) ? "CONFLICT" : "WRITE_FAILED",
    );
  }
}

async function updateExistingProfile(
  transaction: Prisma.TransactionClient,
  companyId: string,
  version: number,
  data: Readonly<{
    legalName: string;
    billingContactEmail: string;
    street: string;
    postalCode: string;
    city: string;
    countryCode: "CH";
    uid: string | null;
    vatNumber: string | null;
  }>,
) {
  const updated = await transaction.companyBillingProfile.updateMany({
    where: { companyId, version },
    data: { ...data, version: { increment: 1 } },
  });
  if (updated.count !== 1) return null;
  return transaction.companyBillingProfile.findUnique({
    where: { companyId },
    select: profileSelect,
  });
}

const profileSelect = {
  legalName: true,
  billingContactEmail: true,
  street: true,
  postalCode: true,
  city: true,
  countryCode: true,
  uid: true,
  vatNumber: true,
  version: true,
} as const;

function toProfileView(row: {
  legalName: string;
  billingContactEmail: string;
  street: string;
  postalCode: string;
  city: string;
  countryCode: string;
  uid: string | null;
  vatNumber: string | null;
  version: number;
}): BillingProfileView {
  return Object.freeze({ ...row, countryCode: "CH" });
}

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}
