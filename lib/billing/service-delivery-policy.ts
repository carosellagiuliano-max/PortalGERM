import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import { buildExactCreditConsumeReversalV1 } from "@/lib/billing/credit-policy";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";

const FINANCE_RETENTION_MS = 10 * 365 * 86_400_000;

export const SERVICE_DELIVERY_POLICY_V1 = Object.freeze({
  version: "phase24-v1" as const,
  boostExtensionDays: 7,
  supportedServiceKinds: ["JOB_BOOST", "RADAR_CONTACT"] as const,
});

type ServiceKind =
  (typeof SERVICE_DELIVERY_POLICY_V1.supportedServiceKinds)[number];
type Classification =
  | "PLATFORM_FAILURE"
  | "EXPECTED_MARKET_OUTCOME"
  | "USER_ACTION"
  | "PROVIDER_PAYMENT_FAILURE";
type FundingMode = "CREDIT" | "PAID_ORDER_LINE";

export type ServiceDeliveryPolicyInput = Readonly<{
  classification: Classification;
  deliveryStillPossible: boolean;
  evidenceComplete: boolean;
  fundingMode: FundingMode;
  paidAmountRappen: number;
  serviceKind: ServiceKind;
}>;

export type ServiceDeliveryPolicyDecision = Readonly<{
  remedyAmount: number | null;
  remedyKind:
    | "NONE"
    | "CREDIT_RESTORE"
    | "SERVICE_EXTENSION"
    | "REPLACEMENT"
    | "REFUND"
    | "PARTIAL_REFUND";
  status: "APPROVED" | "DENIED" | "ESCALATED";
}>;

export function evaluateServiceDeliveryPolicyV1(
  input: ServiceDeliveryPolicyInput,
): ServiceDeliveryPolicyDecision {
  if (
    !SERVICE_DELIVERY_POLICY_V1.supportedServiceKinds.includes(
      input.serviceKind,
    ) ||
    !Number.isSafeInteger(input.paidAmountRappen) ||
    input.paidAmountRappen < 0
  ) {
    throw new TypeError("Service-delivery policy input is invalid.");
  }
  if (input.classification !== "PLATFORM_FAILURE") {
    return decision("DENIED", "NONE", null);
  }
  if (!input.evidenceComplete) {
    return decision("ESCALATED", "NONE", null);
  }
  if (input.fundingMode === "CREDIT") {
    return decision("APPROVED", "CREDIT_RESTORE", null);
  }
  if (input.serviceKind === "JOB_BOOST" && input.deliveryStillPossible) {
    return decision("APPROVED", "SERVICE_EXTENSION", null);
  }
  if (input.paidAmountRappen > 0) {
    return decision("ESCALATED", "REFUND", input.paidAmountRappen);
  }
  return decision("ESCALATED", "NONE", null);
}

export type ServiceDeliveryCommandResult =
  | Readonly<{
      ok: true;
      assessmentId: string;
      remedyKind: ServiceDeliveryPolicyDecision["remedyKind"];
      replay: boolean;
      status: "APPROVED" | "APPLIED" | "DENIED" | "ESCALATED";
    }>
  | Readonly<{
      ok: false;
      code:
        | "CONFLICT"
        | "DISABLED"
        | "INVALID_INPUT"
        | "NOT_FOUND"
        | "NOT_APPROVED"
        | "POLICY_ESCALATION"
        | "WRITE_FAILED";
    }>;

const assessmentInputSchema = z.strictObject({
  actorUserId: z.uuid().nullable(),
  classification: z.enum([
    "PLATFORM_FAILURE",
    "EXPECTED_MARKET_OUTCOME",
    "USER_ACTION",
    "PROVIDER_PAYMENT_FAILURE",
  ]),
  companyId: z.uuid(),
  correlationId: z.uuid(),
  deliveryStillPossible: z.boolean(),
  evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  idempotencyKey: z.string().min(8).max(160),
  orderLineId: z.uuid(),
  reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/u),
  serviceInstanceId: z.uuid(),
  serviceKind: z.enum(["JOB_BOOST", "RADAR_CONTACT"]),
});

export async function assessServiceDelivery(
  raw: unknown,
  dependencies: Readonly<{
    database: DatabaseClient;
    now: Date;
  }>,
): Promise<ServiceDeliveryCommandResult> {
  const parsed = assessmentInputSchema.safeParse(raw);
  if (!parsed.success || !Number.isFinite(dependencies.now.getTime())) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const input = parsed.data;
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        const existing = await transaction.serviceDeliveryAssessment.findUnique(
          {
            where: { idempotencyKey: input.idempotencyKey },
            select: {
              id: true,
              orderLineId: true,
              companyId: true,
              serviceKind: true,
              serviceInstanceId: true,
              policyVersion: true,
              classification: true,
              status: true,
              remedyKind: true,
              evidenceDigest: true,
              reasonCode: true,
            },
          },
        );
        if (existing !== null) {
          if (
            existing.orderLineId !== input.orderLineId ||
            existing.companyId !== input.companyId ||
            existing.serviceKind !== input.serviceKind ||
            existing.serviceInstanceId !== input.serviceInstanceId ||
            existing.policyVersion !== SERVICE_DELIVERY_POLICY_V1.version ||
            existing.classification !== input.classification ||
            existing.evidenceDigest !== input.evidenceDigest ||
            existing.reasonCode !== input.reasonCode
          ) {
            return { ok: false as const, code: "CONFLICT" as const };
          }
          return {
            ok: true as const,
            assessmentId: existing.id,
            remedyKind: existing.remedyKind,
            replay: true,
            status: existing.status as
              "APPROVED" | "APPLIED" | "DENIED" | "ESCALATED",
          };
        }
        const context = await resolveServiceContext(transaction, input);
        if (context === null) {
          return { ok: false as const, code: "NOT_FOUND" as const };
        }
        const policy = evaluateServiceDeliveryPolicyV1({
          classification: input.classification,
          deliveryStillPossible: input.deliveryStillPossible,
          evidenceComplete: true,
          fundingMode: context.fundingMode,
          paidAmountRappen: context.paidAmountRappen,
          serviceKind: input.serviceKind,
        });
        const assessmentId = randomUUID();
        const approvedAt =
          policy.status === "APPROVED" ? dependencies.now : null;
        await transaction.serviceDeliveryAssessment.create({
          data: {
            id: assessmentId,
            orderLineId: input.orderLineId,
            companyId: input.companyId,
            serviceKind: input.serviceKind,
            serviceInstanceId: input.serviceInstanceId,
            policyVersion: SERVICE_DELIVERY_POLICY_V1.version,
            classification: input.classification,
            status: policy.status,
            remedyKind: policy.remedyKind,
            remedyAmount: policy.remedyAmount,
            currency: policy.remedyAmount === null ? null : "CHF",
            evidenceDigest: input.evidenceDigest,
            reasonCode: input.reasonCode,
            idempotencyKey: input.idempotencyKey,
            approvedByUserId:
              policy.status === "APPROVED" ? input.actorUserId : null,
            assessedAt: dependencies.now,
            approvedAt,
            createdAt: dependencies.now,
            updatedAt: dependencies.now,
          },
        });
        await appendServiceDeliveryEvent(transaction, {
          actorUserId: input.actorUserId,
          assessmentId,
          evidenceDigest: input.evidenceDigest,
          idempotencyKey: `${input.idempotencyKey}:assessed`,
          kind: "ASSESSED",
          now: dependencies.now,
          reasonCode: input.reasonCode,
        });
        await appendServiceDeliveryEvent(transaction, {
          actorUserId: input.actorUserId,
          assessmentId,
          evidenceDigest: input.evidenceDigest,
          idempotencyKey: `${input.idempotencyKey}:decision`,
          kind:
            policy.status === "APPROVED"
              ? "APPROVED"
              : policy.status === "DENIED"
                ? "DENIED"
                : "ESCALATED",
          now: dependencies.now,
          reasonCode: input.reasonCode,
        });
        await writeRequiredAudit(
          createPrismaTransactionAuditPort(transaction),
          {
            action: "SERVICE_DELIVERY_ASSESSED",
            actorKind: input.actorUserId === null ? "SYSTEM" : "USER",
            ...(input.actorUserId === null
              ? {}
              : { actorUserId: input.actorUserId }),
            capability: "SERVICE_DELIVERY_ASSESS",
            companyId: input.companyId,
            correlationId: input.correlationId,
            reasonCode: `SERVICE_${policy.status}`,
            result: "SUCCEEDED",
            retainUntil: new Date(
              dependencies.now.getTime() + FINANCE_RETENTION_MS,
            ),
            targetId: assessmentId,
            targetType: "SERVICE_DELIVERY",
          },
        );
        return {
          ok: true as const,
          assessmentId,
          remedyKind: policy.remedyKind,
          replay: false,
          status: policy.status,
        };
      },
      { isolationLevel: "Serializable" },
    );
  } catch {
    return { ok: false, code: "WRITE_FAILED" };
  }
}

export async function applyServiceDeliveryRemedy(
  input: Readonly<{
    actorUserId: string | null;
    assessmentId: string;
    correlationId: string;
    recoveryEnabled: boolean;
  }>,
  dependencies: Readonly<{
    database: DatabaseClient;
    now: Date;
  }>,
): Promise<ServiceDeliveryCommandResult> {
  if (
    !z.uuid().safeParse(input.assessmentId).success ||
    !z.uuid().safeParse(input.correlationId).success ||
    (input.actorUserId !== null &&
      !z.uuid().safeParse(input.actorUserId).success) ||
    !Number.isFinite(dependencies.now.getTime())
  ) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  if (!input.recoveryEnabled) {
    return { ok: false, code: "DISABLED" };
  }
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id"
          FROM "ServiceDeliveryAssessment"
          WHERE "id" = ${input.assessmentId}::uuid
          FOR UPDATE
        `;
        const assessment =
          await transaction.serviceDeliveryAssessment.findUnique({
            where: { id: input.assessmentId },
          });
        if (assessment === null) {
          return { ok: false as const, code: "NOT_FOUND" as const };
        }
        if (assessment.status === "APPLIED") {
          return {
            ok: true as const,
            assessmentId: assessment.id,
            remedyKind: assessment.remedyKind,
            replay: true,
            status: "APPLIED" as const,
          };
        }
        if (assessment.status !== "APPROVED") {
          return {
            ok: false as const,
            code: "NOT_APPROVED" as const,
          };
        }

        if (assessment.remedyKind === "CREDIT_RESTORE") {
          const source = await resolveConsumedCreditEntry(
            transaction,
            assessment.serviceKind as ServiceKind,
            assessment.serviceInstanceId,
            assessment.companyId,
            assessment.orderLineId,
          );
          if (source === null) {
            await escalateAssessment(
              transaction,
              assessment.id,
              input.actorUserId,
              assessment.evidenceDigest,
              dependencies.now,
              "CREDIT_SOURCE_INVALID",
            );
            return {
              ok: false as const,
              code: "POLICY_ESCALATION" as const,
            };
          }
          await transaction.$queryRaw`
            SELECT "id"
            FROM "CreditLedgerEntry"
            WHERE "id" = ${source.id}::uuid
            FOR UPDATE
          `;
          const locked = await transaction.creditLedgerEntry.findUnique({
            where: { id: source.id },
            select: {
              id: true,
              accountId: true,
              fundingSource: true,
              kind: true,
              amount: true,
              validFrom: true,
              validTo: true,
              reversedByEntry: { select: { id: true } },
              account: { select: { creditType: true } },
            },
          });
          if (locked === null) {
            return { ok: false as const, code: "NOT_FOUND" as const };
          }
          const reversal = buildExactCreditConsumeReversalV1({
            entry: {
              id: locked.id,
              accountId: locked.accountId,
              fundingSource: locked.fundingSource,
              creditType: locked.account.creditType,
              kind: locked.kind,
              amount: locked.amount,
              validFrom: locked.validFrom,
              validTo: locked.validTo,
              reversedByEntryId: locked.reversedByEntry?.id ?? null,
            },
            expectedAccountId: locked.accountId,
            expectedFundingSource: locked.fundingSource,
            expectedCreditType: locked.account.creditType,
            at: dependencies.now,
          });
          if (!reversal.ok) {
            if (
              reversal.error.code === "ALREADY_REVERSED" &&
              locked.reversedByEntry !== null
            ) {
              // The unique lineage is authoritative; continue to mark this
              // assessment applied only when its own event already exists.
              const prior = await transaction.serviceDeliveryEvent.findUnique({
                where: {
                  idempotencyKey: `service-remedy:${assessment.id}`,
                },
                select: { id: true },
              });
              if (prior === null) {
                return {
                  ok: false as const,
                  code: "CONFLICT" as const,
                };
              }
            } else {
              await escalateAssessment(
                transaction,
                assessment.id,
                input.actorUserId,
                assessment.evidenceDigest,
                dependencies.now,
                "CREDIT_REVERSAL_POLICY_DENIED",
              );
              return {
                ok: false as const,
                code: "POLICY_ESCALATION" as const,
              };
            }
          } else {
            await transaction.creditLedgerEntry.create({
              data: {
                id: randomUUID(),
                accountId: reversal.value.accountId,
                fundingSource: reversal.value.fundingSource,
                kind: "REVERSAL",
                amount: reversal.value.amount,
                reversalOfEntryId: reversal.value.reversalOfEntryId,
                validFrom: reversal.value.validFrom,
                validTo: reversal.value.validTo,
                idempotencyKey: `service-recovery:${assessment.id}`,
                reasonCode: "PLATFORM_FAILURE_RECOVERY",
                actorUserId: input.actorUserId,
                createdAt: dependencies.now,
              },
            });
          }
        } else if (
          assessment.remedyKind === "SERVICE_EXTENSION" &&
          assessment.serviceKind === "JOB_BOOST"
        ) {
          const boost = await transaction.jobBoost.findFirst({
            where: {
              id: assessment.serviceInstanceId,
              companyId: assessment.companyId,
              orderLineId: assessment.orderLineId,
              status: { in: ["SCHEDULED", "ACTIVE", "EXPIRED"] },
            },
            select: {
              id: true,
              endsAt: true,
              startsAt: true,
              status: true,
            },
          });
          if (boost === null) {
            await escalateAssessment(
              transaction,
              assessment.id,
              input.actorUserId,
              assessment.evidenceDigest,
              dependencies.now,
              "BOOST_EXTENSION_NOT_ELIGIBLE",
            );
            return {
              ok: false as const,
              code: "POLICY_ESCALATION" as const,
            };
          }
          const extensionBase = Math.max(
            boost.endsAt.getTime(),
            dependencies.now.getTime(),
          );
          await transaction.jobBoost.update({
            where: { id: boost.id },
            data: {
              endsAt: new Date(
                extensionBase +
                  SERVICE_DELIVERY_POLICY_V1.boostExtensionDays * 86_400_000,
              ),
              status:
                boost.startsAt.getTime() > dependencies.now.getTime()
                  ? "SCHEDULED"
                  : "ACTIVE",
            },
          });
        } else {
          await escalateAssessment(
            transaction,
            assessment.id,
            input.actorUserId,
            assessment.evidenceDigest,
            dependencies.now,
            "FINANCE_OR_MANUAL_REMEDY_REQUIRED",
          );
          return {
            ok: false as const,
            code: "POLICY_ESCALATION" as const,
          };
        }

        await appendServiceDeliveryEvent(transaction, {
          actorUserId: input.actorUserId,
          assessmentId: assessment.id,
          evidenceDigest: assessment.evidenceDigest,
          idempotencyKey: `service-remedy:${assessment.id}`,
          kind: "REMEDY_APPLIED",
          now: dependencies.now,
          reasonCode: "PLATFORM_FAILURE_RECOVERED",
        });
        await transaction.serviceDeliveryAssessment.update({
          where: { id: assessment.id },
          data: {
            status: "APPLIED",
            appliedAt: dependencies.now,
            updatedAt: dependencies.now,
          },
        });
        await writeRequiredAudit(
          createPrismaTransactionAuditPort(transaction),
          {
            action: "SERVICE_DELIVERY_RECOVERED",
            actorKind: input.actorUserId === null ? "SYSTEM" : "USER",
            ...(input.actorUserId === null
              ? {}
              : { actorUserId: input.actorUserId }),
            capability: "SERVICE_DELIVERY_RECOVER",
            companyId: assessment.companyId,
            correlationId: input.correlationId,
            reasonCode: `REMEDY_${assessment.remedyKind}`,
            result: "SUCCEEDED",
            retainUntil: new Date(
              dependencies.now.getTime() + FINANCE_RETENTION_MS,
            ),
            targetId: assessment.id,
            targetType: "SERVICE_DELIVERY",
          },
        );
        return {
          ok: true as const,
          assessmentId: assessment.id,
          remedyKind: assessment.remedyKind,
          replay: false,
          status: "APPLIED" as const,
        };
      },
      { isolationLevel: "Serializable" },
    );
  } catch {
    return { ok: false, code: "WRITE_FAILED" };
  }
}

export async function projectApprovedServiceRecoveries(
  input: Readonly<{
    correlationId: string;
    database: DatabaseClient;
    enabled: boolean;
    now: Date;
  }>,
) {
  if (!input.enabled) {
    return Object.freeze({ processed: 0, status: "DISABLED" as const });
  }
  const assessments = await input.database.serviceDeliveryAssessment.findMany({
    where: {
      status: "APPROVED",
      remedyKind: { in: ["CREDIT_RESTORE", "SERVICE_EXTENSION"] },
    },
    orderBy: [{ assessedAt: "asc" }, { id: "asc" }],
    take: 100,
    select: { id: true },
  });
  let processed = 0;
  for (const assessment of assessments) {
    const result = await applyServiceDeliveryRemedy(
      {
        actorUserId: null,
        assessmentId: assessment.id,
        correlationId: input.correlationId,
        recoveryEnabled: true,
      },
      { database: input.database, now: input.now },
    );
    if (result.ok && result.status === "APPLIED") processed += 1;
  }
  return Object.freeze({ processed, status: "COMPLETED" as const });
}

async function resolveServiceContext(
  transaction: Prisma.TransactionClient,
  input: z.infer<typeof assessmentInputSchema>,
): Promise<Readonly<{
  fundingMode: FundingMode;
  paidAmountRappen: number;
}> | null> {
  const line = await transaction.orderLine.findFirst({
    where: {
      id: input.orderLineId,
      order: { companyId: input.companyId, status: "PAID" },
    },
    select: { fulfillmentContext: true, id: true, totalRappen: true },
  });
  if (line === null) return null;
  if (input.serviceKind === "JOB_BOOST") {
    const boost = await transaction.jobBoost.findFirst({
      where: {
        id: input.serviceInstanceId,
        companyId: input.companyId,
      },
      select: {
        orderLineId: true,
        consumedCreditLedgerEntryId: true,
      },
    });
    if (boost === null) return null;
    if (
      line.fulfillmentContext === "JOB_BOOST" &&
      boost.orderLineId === line.id
    ) {
      return {
        fundingMode: "PAID_ORDER_LINE",
        paidAmountRappen: line.totalRappen,
      };
    }
  }
  const consumed = await resolveConsumedCreditEntry(
    transaction,
    input.serviceKind,
    input.serviceInstanceId,
    input.companyId,
    input.orderLineId,
  );
  if (consumed === null) return null;
  return { fundingMode: "CREDIT", paidAmountRappen: 0 };
}

async function resolveConsumedCreditEntry(
  transaction: Prisma.TransactionClient,
  serviceKind: ServiceKind,
  serviceInstanceId: string,
  companyId: string,
  orderLineId: string,
) {
  const consumeId =
    serviceKind === "RADAR_CONTACT"
      ? (
          await transaction.employerContactRequest.findFirst({
            where: { id: serviceInstanceId, companyId },
            select: { creditLedgerEntryId: true },
          })
        )?.creditLedgerEntryId
      : (
          await transaction.jobBoost.findFirst({
            where: { id: serviceInstanceId, companyId },
            select: { consumedCreditLedgerEntryId: true },
          })
        )?.consumedCreditLedgerEntryId;
  if (consumeId === undefined || consumeId === null) return null;
  const consume = await transaction.creditLedgerEntry.findFirst({
    where: {
      id: consumeId,
      kind: "CONSUME",
      account: { companyId },
    },
    select: {
      id: true,
      consumedGrantEntry: {
        select: {
          sourceOrderLineId: true,
          sourceSubscription: {
            select: {
              sourceOrder: {
                select: { lines: { select: { id: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (consume?.consumedGrantEntry === null || consume === null) {
    return null;
  }
  const allowedOrderLineIds = new Set<string>();
  if (consume.consumedGrantEntry.sourceOrderLineId !== null) {
    allowedOrderLineIds.add(consume.consumedGrantEntry.sourceOrderLineId);
  }
  for (const line of consume.consumedGrantEntry.sourceSubscription?.sourceOrder
    ?.lines ?? []) {
    allowedOrderLineIds.add(line.id);
  }
  return allowedOrderLineIds.has(orderLineId) ? { id: consume.id } : null;
}

async function appendServiceDeliveryEvent(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    actorUserId: string | null;
    assessmentId: string;
    evidenceDigest: string;
    idempotencyKey: string;
    kind: "ASSESSED" | "APPROVED" | "DENIED" | "ESCALATED" | "REMEDY_APPLIED";
    now: Date;
    reasonCode: string;
  }>,
) {
  await transaction.serviceDeliveryEvent.create({
    data: {
      id: randomUUID(),
      serviceDeliveryAssessmentId: input.assessmentId,
      kind: input.kind,
      actorUserId: input.actorUserId,
      reasonCode: input.reasonCode,
      idempotencyKey: input.idempotencyKey,
      evidenceDigest: input.evidenceDigest,
      createdAt: input.now,
    },
  });
}

async function escalateAssessment(
  transaction: Prisma.TransactionClient,
  assessmentId: string,
  actorUserId: string | null,
  evidenceDigest: string,
  now: Date,
  reasonCode: string,
) {
  await appendServiceDeliveryEvent(transaction, {
    actorUserId,
    assessmentId,
    evidenceDigest,
    idempotencyKey: `service-escalation:${assessmentId}`,
    kind: "ESCALATED",
    now,
    reasonCode,
  });
  await transaction.serviceDeliveryAssessment.update({
    where: { id: assessmentId },
    data: {
      status: "ESCALATED",
      approvedByUserId: null,
      approvedAt: null,
      updatedAt: now,
    },
  });
}

function decision(
  status: ServiceDeliveryPolicyDecision["status"],
  remedyKind: ServiceDeliveryPolicyDecision["remedyKind"],
  remedyAmount: number | null,
): ServiceDeliveryPolicyDecision {
  return Object.freeze({ status, remedyKind, remedyAmount });
}

export function serviceDeliveryEvidenceDigest(value: object) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
