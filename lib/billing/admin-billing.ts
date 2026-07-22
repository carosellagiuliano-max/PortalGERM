import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  AdminDomainError,
  adminErrorResult,
  adminFailure,
  adminNow,
  adminReasonCodeSchema,
  adminSuccess,
  adminUuidSchema,
  operationKey,
  requireCapability,
  writeAdminAudit,
  type AdminDependencies,
} from "@/lib/admin/common";
import { buildExactCreditConsumeReversalV1 } from "@/lib/billing/credit-policy";
import { addZurichCalendarMonthsClampedV1 } from "@/lib/billing/billing-policy-v1";
import { productReleaseTier } from "@/lib/billing/product-release";

const creditTypeSchema = z.enum([
  "TALENT_CONTACT",
  "JOB_BOOST",
  "NEWSLETTER",
  "SOCIAL_PUSH",
]);

const grantCreditsSchema = z.strictObject({
  companyId: adminUuidSchema,
  creditType: creditTypeSchema,
  amount: z.coerce.number().int().min(1).max(10_000),
  validUntil: z.coerce.date(),
  reasonCode: adminReasonCodeSchema,
  idempotencyKey: adminUuidSchema,
});

const reverseConsumeSchema = z.strictObject({
  entryId: adminUuidSchema,
  reasonCode: adminReasonCodeSchema,
  idempotencyKey: adminUuidSchema,
});

const schedulePlanSchema = z.strictObject({
  planId: adminUuidSchema,
  sourceVersionId: adminUuidSchema,
  netPriceRappen: z.coerce.number().int().min(0).max(100_000_000),
  validFrom: z.coerce.date(),
  validTo: z.coerce.date().nullable().optional(),
  isPublic: z.boolean(),
  isSelfService: z.boolean(),
  reasonCode: adminReasonCodeSchema,
  idempotencyKey: adminUuidSchema,
});

const scheduleProductSchema = z.strictObject({
  productId: adminUuidSchema,
  sourceVersionId: adminUuidSchema,
  netPriceRappen: z.coerce.number().int().min(0).max(100_000_000),
  validFrom: z.coerce.date(),
  validTo: z.coerce.date().nullable().optional(),
  isPublic: z.boolean(),
  isSelfService: z.boolean(),
  releaseDecisionId: adminUuidSchema.nullable().optional(),
  reasonCode: adminReasonCodeSchema,
  idempotencyKey: adminUuidSchema,
});

const deactivateCatalogSchema = z.strictObject({
  versionId: adminUuidSchema,
  reasonCode: adminReasonCodeSchema,
  idempotencyKey: adminUuidSchema,
});

export async function listAdminOrders(dependencies: AdminDependencies) {
  if (!requireCapability(dependencies, "ADMIN_BILLING_READ")) return null;
  return dependencies.database.order.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
    select: {
      id: true,
      status: true,
      provider: true,
      currency: true,
      netTotalRappen: true,
      vatTotalRappen: true,
      totalRappen: true,
      paidAt: true,
      createdAt: true,
      company: { select: { id: true, name: true, slug: true } },
      lines: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          descriptionSnapshot: true,
          planVersion: { select: { version: true, plan: { select: { code: true, name: true } } } },
          productVersion: { select: { version: true, product: { select: { code: true, name: true, type: true } } } },
        },
      },
      invoice: { select: { id: true, number: true, status: true } },
    },
  });
}

export async function getAdminOrderDetail(dependencies: AdminDependencies, orderId: string) {
  if (!requireCapability(dependencies, "ADMIN_BILLING_READ") || !z.uuid().safeParse(orderId).success) return null;
  return dependencies.database.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      provider: true,
      providerReference: true,
      requestFingerprint: true,
      currency: true,
      netTotalRappen: true,
      vatTotalRappen: true,
      totalRappen: true,
      billingLegalNameSnapshot: true,
      billingContactEmailSnapshot: true,
      billingStreetSnapshot: true,
      billingPostalCodeSnapshot: true,
      billingCitySnapshot: true,
      billingCountryCodeSnapshot: true,
      billingUidSnapshot: true,
      billingVatNumberSnapshot: true,
      paidAt: true,
      failedAt: true,
      cancelledAt: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,
      company: { select: { id: true, name: true, slug: true } },
      createdBy: { select: { id: true, email: true, name: true } },
      lines: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          quantity: true,
          unitNetRappen: true,
          netRappen: true,
          taxRateBasisPoints: true,
          vatRappen: true,
          totalRappen: true,
          currency: true,
          descriptionSnapshot: true,
          fulfillmentContext: true,
          targetJobId: true,
          targetImportSourceId: true,
          targetCreditType: true,
          planVersion: { select: { id: true, version: true, plan: { select: { code: true, name: true } } } },
          productVersion: { select: { id: true, version: true, product: { select: { code: true, name: true, type: true } } } },
          taxRateVersion: { select: { jurisdiction: true, taxType: true, rateBasisPoints: true, validFrom: true, validTo: true } },
          subscriptionSnapshot: true,
          creditLedgerEntries: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: { id: true, kind: true, amount: true, fundingSource: true, validFrom: true, validTo: true },
          },
        },
      },
      paymentEvents: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, provider: true, kind: true, providerReference: true, idempotencyKey: true, createdAt: true },
      },
      invoice: { select: { id: true, number: true, status: true } },
      subscription: { select: { id: true, status: true, currentPeriodStart: true, currentPeriodEnd: true } },
    },
  });
}

export async function listAdminInvoices(dependencies: AdminDependencies) {
  if (!requireCapability(dependencies, "ADMIN_BILLING_READ")) return null;
  return dependencies.database.invoice.findMany({
    orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: 200,
    select: {
      id: true,
      number: true,
      status: true,
      currency: true,
      netTotalRappen: true,
      vatTotalRappen: true,
      totalRappen: true,
      dueAt: true,
      issuedAt: true,
      paidAt: true,
      createdAt: true,
      company: { select: { id: true, name: true, slug: true } },
      order: { select: { id: true, provider: true, status: true } },
    },
  });
}

export async function getAdminInvoiceDetail(dependencies: AdminDependencies, invoiceId: string) {
  if (!requireCapability(dependencies, "ADMIN_BILLING_READ") || !z.uuid().safeParse(invoiceId).success) return null;
  return dependencies.database.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      number: true,
      status: true,
      currency: true,
      netTotalRappen: true,
      vatTotalRappen: true,
      totalRappen: true,
      dueAt: true,
      issuedAt: true,
      paidAt: true,
      voidedAt: true,
      createdAt: true,
      billingLegalNameSnapshot: true,
      billingContactEmailSnapshot: true,
      billingStreetSnapshot: true,
      billingPostalCodeSnapshot: true,
      billingCitySnapshot: true,
      billingCountryCodeSnapshot: true,
      billingUidSnapshot: true,
      billingVatNumberSnapshot: true,
      company: { select: { id: true, name: true, slug: true } },
      order: {
        select: {
          id: true,
          status: true,
          provider: true,
          providerReference: true,
          paymentEvents: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: { id: true, kind: true, provider: true, providerReference: true, idempotencyKey: true, createdAt: true },
          },
        },
      },
      lines: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: {
          id: true,
          sortOrder: true,
          descriptionSnapshot: true,
          quantity: true,
          unitNetRappen: true,
          netRappen: true,
          taxRateBasisPoints: true,
          vatRappen: true,
          totalRappen: true,
          currency: true,
          orderLineId: true,
        },
      },
    },
  });
}

export async function listAdminPlans(dependencies: AdminDependencies) {
  if (!requireCapability(dependencies, "ADMIN_CATALOG_READ")) return null;
  return dependencies.database.plan.findMany({
    orderBy: [{ isDefaultFree: "desc" }, { name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      isDefaultFree: true,
      versions: {
        orderBy: [{ version: "desc" }, { id: "desc" }],
        select: {
          id: true,
          version: true,
          status: true,
          priceMode: true,
          billingInterval: true,
          termMonths: true,
          netPriceRappen: true,
          monthlyEquivalentRappen: true,
          currency: true,
          isPublic: true,
          isSelfService: true,
          validFrom: true,
          validTo: true,
          entitlements: { orderBy: { key: "asc" }, select: { key: true, valueType: true, booleanValue: true, integerValue: true, analyticsLevelValue: true } },
          _count: { select: { subscriptions: true, orderLines: true } },
        },
      },
    },
  });
}

export async function listAdminProducts(dependencies: AdminDependencies) {
  if (!requireCapability(dependencies, "ADMIN_CATALOG_READ")) return null;
  return dependencies.database.product.findMany({
    orderBy: [{ type: "asc" }, { name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      releaseDecisions: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 20,
        select: {
          id: true,
          releaseTier: true,
          allowsPublic: true,
          allowsSelfService: true,
          reasonCode: true,
          rationale: true,
          expiresAt: true,
          createdAt: true,
          releasedVersion: { select: { id: true, version: true, status: true } },
        },
      },
      versions: {
        orderBy: [{ version: "desc" }, { id: "desc" }],
        select: {
          id: true,
          version: true,
          status: true,
          netPriceRappen: true,
          currency: true,
          durationDays: true,
          creditType: true,
          creditAmount: true,
          isPublic: true,
          isSelfService: true,
          priority: true,
          requiresLegalReview: true,
          releaseDecisionId: true,
          validFrom: true,
          validTo: true,
          _count: { select: { orderLines: true } },
        },
      },
    },
  });
}

export async function getAdminCompanyCreditReadModel(dependencies: AdminDependencies, companyId: string) {
  if (!requireCapability(dependencies, "ADMIN_BILLING_READ") || !z.uuid().safeParse(companyId).success) return null;
  const now = adminNow(dependencies.now);
  const company = await dependencies.database.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      creditAccounts: {
        orderBy: [{ periodEnd: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          creditType: true,
          fundingSource: true,
          periodStart: true,
          periodEnd: true,
          createdAt: true,
          entries: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: {
              id: true,
              kind: true,
              amount: true,
              fundingSource: true,
              validFrom: true,
              validTo: true,
              idempotencyKey: true,
              reasonCode: true,
              actorUserId: true,
              sourceOrderLineId: true,
              sourceSubscriptionId: true,
              consumedGrantEntryId: true,
              reversalOfEntryId: true,
              createdAt: true,
              reversedByEntry: { select: { id: true, idempotencyKey: true } },
            },
          },
        },
      },
    },
  });
  if (company === null) return null;

  const accounts = company.creditAccounts.map((account) => {
    const balance = account.entries.reduce((sum, entry) => sum + entry.amount, 0);
    const effective = account.periodStart.getTime() <= now.getTime() && now.getTime() < account.periodEnd.getTime();
    return Object.freeze({ ...account, balance, effective, fundable: effective ? Math.max(0, balance) : 0 });
  });
  const totals = {
    TALENT_CONTACT: { PLAN_ALLOWANCE: 0, PURCHASED_PACK: 0, ADMIN_GRANT: 0, total: 0 },
    JOB_BOOST: { PLAN_ALLOWANCE: 0, PURCHASED_PACK: 0, ADMIN_GRANT: 0, total: 0 },
    NEWSLETTER: { PLAN_ALLOWANCE: 0, PURCHASED_PACK: 0, ADMIN_GRANT: 0, total: 0 },
    SOCIAL_PUSH: { PLAN_ALLOWANCE: 0, PURCHASED_PACK: 0, ADMIN_GRANT: 0, total: 0 },
  };
  for (const account of accounts) {
    totals[account.creditType][account.fundingSource] += account.fundable;
    totals[account.creditType].total += account.fundable;
  }
  return Object.freeze({ company: Object.freeze({ id: company.id, name: company.name }), measuredAt: now, accounts: Object.freeze(accounts), totals: Object.freeze(totals) });
}

export async function grantAdminCredits(raw: unknown, dependencies: AdminDependencies) {
  const parsed = grantCreditsSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_CREDITS_GRANT")) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  const maximumValidity = addZurichCalendarMonthsClampedV1(now, 12);
  if (
    !maximumValidity.ok ||
    parsed.data.validUntil.getTime() <= now.getTime() ||
    parsed.data.validUntil.getTime() > maximumValidity.value.getTime()
  ) {
    return adminFailure("INVALID_INPUT");
  }
  const ledgerKey = operationKey("admin-credit-grant", parsed.data.idempotencyKey);
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Company" WHERE "id" = ${parsed.data.companyId}::uuid FOR UPDATE`;
      const company = await transaction.company.findUnique({ where: { id: parsed.data.companyId }, select: { id: true, status: true } });
      if (company === null) return adminFailure("NOT_FOUND");
      if (company.status === "CLOSED") return adminFailure("CONFLICT");
      const replay = await transaction.creditLedgerEntry.findFirst({
        where: { idempotencyKey: ledgerKey, account: { companyId: company.id } },
        select: { id: true, accountId: true, amount: true, reasonCode: true, account: { select: { creditType: true, fundingSource: true, periodEnd: true } } },
      });
      if (replay !== null) {
        if (replay.amount !== parsed.data.amount || replay.reasonCode !== parsed.data.reasonCode || replay.account.creditType !== parsed.data.creditType || replay.account.fundingSource !== "ADMIN_GRANT" || replay.account.periodEnd.getTime() !== parsed.data.validUntil.getTime()) {
          return adminFailure("CONFLICT");
        }
        return adminSuccess({ entryId: replay.id, accountId: replay.accountId, amount: replay.amount, creditType: replay.account.creditType, validUntil: replay.account.periodEnd }, true);
      }
      const account = await transaction.creditAccount.upsert({
        where: { companyId_creditType_fundingSource_periodStart: { companyId: company.id, creditType: parsed.data.creditType, fundingSource: "ADMIN_GRANT", periodStart: now } },
        create: { id: randomUUID(), companyId: company.id, creditType: parsed.data.creditType, fundingSource: "ADMIN_GRANT", periodStart: now, periodEnd: parsed.data.validUntil, createdAt: now },
        update: {},
        select: { id: true, periodEnd: true },
      });
      if (account.periodEnd.getTime() !== parsed.data.validUntil.getTime()) throw new AdminDomainError("CONFLICT");
      const entry = await transaction.creditLedgerEntry.create({ data: {
        id: randomUUID(), accountId: account.id, fundingSource: "ADMIN_GRANT", kind: "GRANT", amount: parsed.data.amount,
        validFrom: now, validTo: parsed.data.validUntil, idempotencyKey: ledgerKey, reasonCode: parsed.data.reasonCode,
        actorUserId: dependencies.actor.userId, createdAt: now,
      }, select: { id: true, accountId: true, amount: true } });
      await writeAdminAudit(transaction, dependencies, now, { action: "CREDITS_GRANTED", capability: "ADMIN_CREDITS_GRANT", targetType: "CREDIT_LEDGER_ENTRY", targetId: entry.id, companyId: company.id, reasonCode: parsed.data.reasonCode });
      return adminSuccess({ entryId: entry.id, accountId: entry.accountId, amount: entry.amount, creditType: parsed.data.creditType, validUntil: parsed.data.validUntil });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    return adminErrorResult(error);
  }
}

export async function reverseCreditConsume(raw: unknown, dependencies: AdminDependencies) {
  const parsed = reverseConsumeSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_CREDIT_REVERSE")) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  const ledgerKey = operationKey("admin-credit-reversal", parsed.data.idempotencyKey);
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "CreditLedgerEntry" WHERE "id" = ${parsed.data.entryId}::uuid FOR UPDATE`;
      const entry = await transaction.creditLedgerEntry.findUnique({
        where: { id: parsed.data.entryId },
        select: {
          id: true, accountId: true, fundingSource: true, kind: true, amount: true, validFrom: true, validTo: true,
          consumedGrantEntryId: true, reversedByEntry: { select: { id: true, idempotencyKey: true, amount: true, reasonCode: true } },
          account: { select: { companyId: true, creditType: true } },
          consumedGrantEntry: { select: { id: true, accountId: true, fundingSource: true, kind: true, validFrom: true, validTo: true } },
        },
      });
      if (entry === null) {
        await writeAdminAudit(
          transaction,
          { ...dependencies, correlationId: parsed.data.idempotencyKey },
          now,
          {
            action: "CREDIT_CONSUME_REVERSED",
            capability: "ADMIN_CREDIT_REVERSE",
            targetType: "CREDIT_LEDGER_ENTRY",
            targetId: parsed.data.entryId,
            reasonCode: "REVERSAL_ENTRY_NOT_FOUND",
            result: "DENIED",
          },
        );
        return adminFailure("NOT_FOUND");
      }
      const denyConflict = async (reasonCode: string) => {
        await writeAdminAudit(
          transaction,
          { ...dependencies, correlationId: parsed.data.idempotencyKey },
          now,
          {
            action: "CREDIT_CONSUME_REVERSED",
            capability: "ADMIN_CREDIT_REVERSE",
            targetType: "CREDIT_LEDGER_ENTRY",
            targetId: entry.id,
            companyId: entry.account.companyId,
            reasonCode,
            result: "DENIED",
          },
        );
        return adminFailure("CONFLICT");
      };
      if (entry.reversedByEntry !== null) {
        if (entry.reversedByEntry.idempotencyKey !== ledgerKey) {
          return await denyConflict("REVERSAL_ALREADY_EXISTS");
        }
        if (entry.reversedByEntry.reasonCode !== parsed.data.reasonCode) {
          return await denyConflict("REVERSAL_REASON_MISMATCH");
        }
        return adminSuccess({ entryId: entry.reversedByEntry.id, reversalOfEntryId: entry.id, amount: entry.reversedByEntry.amount }, true);
      }
      const source = entry.consumedGrantEntry;
      if (source === null || source.id !== entry.consumedGrantEntryId || source.kind !== "GRANT" || source.accountId !== entry.accountId || source.fundingSource !== entry.fundingSource || source.validFrom.getTime() > now.getTime() || now.getTime() >= source.validTo.getTime()) {
        return await denyConflict("REVERSAL_SOURCE_INVALID");
      }
      const decision = buildExactCreditConsumeReversalV1({
        entry: { id: entry.id, accountId: entry.accountId, fundingSource: entry.fundingSource, creditType: entry.account.creditType, kind: entry.kind, amount: entry.amount, validFrom: entry.validFrom, validTo: entry.validTo, reversedByEntryId: null },
        expectedAccountId: entry.accountId,
        expectedFundingSource: entry.fundingSource,
        expectedCreditType: entry.account.creditType,
        at: now,
      });
      if (!decision.ok) return await denyConflict("REVERSAL_POLICY_DENIED");
      const reversal = await transaction.creditLedgerEntry.create({ data: {
        id: randomUUID(), accountId: decision.value.accountId, fundingSource: decision.value.fundingSource, kind: "REVERSAL", amount: decision.value.amount,
        reversalOfEntryId: decision.value.reversalOfEntryId, validFrom: decision.value.validFrom, validTo: decision.value.validTo,
        idempotencyKey: ledgerKey, reasonCode: parsed.data.reasonCode, actorUserId: dependencies.actor.userId, createdAt: now,
      }, select: { id: true, amount: true } });
      await writeAdminAudit(transaction, { ...dependencies, correlationId: parsed.data.idempotencyKey }, now, { action: "CREDIT_CONSUME_REVERSED", capability: "ADMIN_CREDIT_REVERSE", targetType: "CREDIT_LEDGER_ENTRY", targetId: reversal.id, companyId: entry.account.companyId, reasonCode: parsed.data.reasonCode });
      return adminSuccess({ entryId: reversal.id, reversalOfEntryId: entry.id, amount: reversal.amount });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    return adminErrorResult(error);
  }
}

export async function schedulePlanVersion(raw: unknown, dependencies: AdminDependencies) {
  const parsed = schedulePlanSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_CATALOG_MUTATE")) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  const validTo = parsed.data.validTo ?? null;
  if (parsed.data.validFrom.getTime() <= now.getTime() || (validTo !== null && validTo.getTime() <= parsed.data.validFrom.getTime())) return adminFailure("INVALID_INPUT");
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Plan" WHERE "id" = ${parsed.data.planId}::uuid FOR UPDATE`;
      const replay = await transaction.planVersion.findUnique({ where: { id: parsed.data.idempotencyKey }, select: { id: true, planId: true, version: true, status: true, netPriceRappen: true, validFrom: true, validTo: true, isPublic: true, isSelfService: true } });
      if (replay !== null) {
        const audit = await transaction.auditLog.findFirst({
          where: {
            action: "CATALOG_VERSION_SCHEDULED",
            correlationId: parsed.data.idempotencyKey,
            targetId: replay.id,
            targetType: "PLAN_VERSION",
          },
          select: { metadata: true, reasonCode: true },
        });
        const matches = replay.planId === parsed.data.planId && replay.netPriceRappen === parsed.data.netPriceRappen && replay.validFrom.getTime() === parsed.data.validFrom.getTime() && sameNullableInstant(replay.validTo, validTo) && replay.isPublic === parsed.data.isPublic && replay.isSelfService === parsed.data.isSelfService && catalogScheduleAuditMatches(audit, parsed.data.sourceVersionId, parsed.data.reasonCode);
        return matches ? adminSuccess({ id: replay.id, planId: replay.planId, version: replay.version, status: replay.status }, true) : adminFailure("CONFLICT");
      }
      const plan = await transaction.plan.findUnique({ where: { id: parsed.data.planId }, select: { id: true, code: true } });
      const source = await transaction.planVersion.findUnique({
        where: { id: parsed.data.sourceVersionId },
        select: { id: true, planId: true, priceMode: true, billingInterval: true, termMonths: true, currency: true, entitlements: { select: { key: true, valueType: true, booleanValue: true, integerValue: true, analyticsLevelValue: true } } },
      });
      if (plan === null || source === null) return adminFailure("NOT_FOUND");
      if (source.planId !== plan.id || source.priceMode !== "FIXED") return adminFailure("CONFLICT");
      if (parsed.data.isSelfService && !(source.billingInterval === "MONTHLY" && source.termMonths === 1 && ["STARTER", "PRO"].includes(plan.code))) return adminFailure("CONFLICT");
      const released = await transaction.planVersion.findMany({ where: { planId: plan.id, status: { in: ["SCHEDULED", "ACTIVE"] } }, orderBy: [{ validFrom: "asc" }, { id: "asc" }], select: { id: true, status: true, validFrom: true, validTo: true } });
      const closable = released.filter((version) => catalogRangesOverlap(version.validFrom, version.validTo, parsed.data.validFrom, validTo));
      for (const version of closable) {
        if (version.status !== "ACTIVE" || version.validTo !== null || version.validFrom.getTime() >= parsed.data.validFrom.getTime()) return adminFailure("CONFLICT");
        const closed = await transaction.planVersion.updateMany({ where: { id: version.id, status: "ACTIVE", validTo: null }, data: { validTo: parsed.data.validFrom } });
        if (closed.count !== 1) throw new AdminDomainError("CONFLICT");
      }
      const latest = await transaction.planVersion.aggregate({ where: { planId: plan.id }, _max: { version: true } });
      const monthlyEquivalentRappen = source.billingInterval === "MONTHLY" ? parsed.data.netPriceRappen : Math.floor(parsed.data.netPriceRappen / source.termMonths + 0.5);
      const draft = await transaction.planVersion.create({ data: {
        id: parsed.data.idempotencyKey, planId: plan.id, version: (latest._max.version ?? 0) + 1, status: "DRAFT", priceMode: "FIXED",
        billingInterval: source.billingInterval, termMonths: source.termMonths, netPriceRappen: parsed.data.netPriceRappen,
        monthlyEquivalentRappen, currency: source.currency, isPublic: parsed.data.isPublic, isSelfService: parsed.data.isSelfService,
        validFrom: parsed.data.validFrom, validTo, createdAt: now,
      }, select: { id: true } });
      await transaction.planEntitlement.createMany({ data: source.entitlements.map((entitlement) => ({ id: randomUUID(), planVersionId: draft.id, ...entitlement, createdAt: now })) });
      const version = await transaction.planVersion.update({ where: { id: draft.id }, data: { status: "SCHEDULED" }, select: { id: true, planId: true, version: true, status: true } });
      await writeAdminAudit(transaction, { ...dependencies, correlationId: parsed.data.idempotencyKey }, now, { action: "CATALOG_VERSION_SCHEDULED", capability: "ADMIN_CATALOG_MUTATE", targetType: "PLAN_VERSION", targetId: version.id, reasonCode: parsed.data.reasonCode, metadata: { sourceVersionId: parsed.data.sourceVersionId } });
      return adminSuccess(version);
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    return adminErrorResult(error);
  }
}

export async function scheduleProductVersion(raw: unknown, dependencies: AdminDependencies) {
  const parsed = scheduleProductSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_CATALOG_MUTATE")) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  const validTo = parsed.data.validTo ?? null;
  if (parsed.data.validFrom.getTime() <= now.getTime() || (validTo !== null && validTo.getTime() <= parsed.data.validFrom.getTime())) return adminFailure("INVALID_INPUT");
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${parsed.data.productId}::uuid FOR UPDATE`;
      const replay = await transaction.productVersion.findUnique({ where: { id: parsed.data.idempotencyKey }, select: { id: true, productId: true, version: true, status: true, netPriceRappen: true, validFrom: true, validTo: true, isPublic: true, isSelfService: true, releaseDecisionId: true } });
      if (replay !== null) {
        const audit = await transaction.auditLog.findFirst({
          where: {
            action: "CATALOG_VERSION_SCHEDULED",
            correlationId: parsed.data.idempotencyKey,
            targetId: replay.id,
            targetType: "PRODUCT_VERSION",
          },
          select: { metadata: true, reasonCode: true },
        });
        const matches = replay.productId === parsed.data.productId && replay.netPriceRappen === parsed.data.netPriceRappen && replay.validFrom.getTime() === parsed.data.validFrom.getTime() && sameNullableInstant(replay.validTo, validTo) && replay.isPublic === parsed.data.isPublic && replay.isSelfService === parsed.data.isSelfService && replay.releaseDecisionId === (parsed.data.releaseDecisionId ?? null) && catalogScheduleAuditMatches(audit, parsed.data.sourceVersionId, parsed.data.reasonCode);
        return matches ? adminSuccess({ id: replay.id, productId: replay.productId, version: replay.version, status: replay.status }, true) : adminFailure("CONFLICT");
      }
      const product = await transaction.product.findUnique({ where: { id: parsed.data.productId }, select: { id: true, code: true, type: true } });
      const source = await transaction.productVersion.findUnique({ where: { id: parsed.data.sourceVersionId }, select: { id: true, productId: true, currency: true, durationDays: true, creditType: true, creditAmount: true, priority: true, requiresLegalReview: true } });
      if (product === null || source === null) return adminFailure("NOT_FOUND");
      if (source.productId !== product.id) return adminFailure("CONFLICT");
      const releaseTier = productReleaseTier(product.type);
      const releaseRequired =
        releaseTier === "P1";
      if (product.type === "SUCCESS_FEE") return adminFailure("CONFLICT");
      if (releaseTier === "P2") return adminFailure("CONFLICT");
      if (
        parsed.data.isSelfService &&
        !["CONTACT_PACK", "ADDITIONAL_JOB"].includes(product.type)
      ) return adminFailure("CONFLICT");
      if (source.requiresLegalReview) return adminFailure("CONFLICT");
      if (
        product.type === "ADDITIONAL_JOB" &&
        (product.code !== "additional-job-30d" ||
          parsed.data.netPriceRappen !== 12_900 ||
          source.durationDays !== 30 ||
          source.creditType !== null ||
          source.creditAmount !== null ||
          !parsed.data.isPublic ||
          !parsed.data.isSelfService)
      ) return adminFailure("CONFLICT");
      if (
        product.type === "IMPORT_SETUP" &&
        (product.code !== "import-setup" ||
          parsed.data.netPriceRappen !== 75_000 ||
          source.durationDays !== null ||
          source.creditType !== null ||
          source.creditAmount !== null ||
          parsed.data.isPublic ||
          parsed.data.isSelfService)
      ) return adminFailure("CONFLICT");
      if (!releaseRequired && releaseTier === null && parsed.data.releaseDecisionId != null) {
        return adminFailure("CONFLICT");
      }
      if (releaseRequired && parsed.data.releaseDecisionId == null) {
        return adminFailure("INCOMPLETE");
      }
      if (parsed.data.releaseDecisionId != null) {
        await transaction.$queryRaw`
          SELECT "id" FROM "ProductReleaseDecision"
          WHERE "id" = ${parsed.data.releaseDecisionId}::uuid
          FOR UPDATE
        `;
        const decision = await transaction.productReleaseDecision.findUnique({
          where: { id: parsed.data.releaseDecisionId },
          select: {
            productId: true,
            releaseTier: true,
            allowsPublic: true,
            allowsSelfService: true,
            expiresAt: true,
            releasedVersion: { select: { id: true } },
          },
        });
        if (
          decision === null ||
          decision.productId !== product.id ||
          decision.releaseTier !== releaseTier ||
          decision.allowsPublic !== parsed.data.isPublic ||
          decision.allowsSelfService !== parsed.data.isSelfService ||
          decision.expiresAt.getTime() <= now.getTime() ||
          decision.expiresAt.getTime() <= parsed.data.validFrom.getTime() ||
          decision.releasedVersion !== null
        ) return adminFailure("CONFLICT");
      }
      const released = await transaction.productVersion.findMany({ where: { productId: product.id, status: { in: ["SCHEDULED", "ACTIVE"] } }, orderBy: [{ validFrom: "asc" }, { id: "asc" }], select: { id: true, status: true, validFrom: true, validTo: true } });
      const closable = released.filter((version) => catalogRangesOverlap(version.validFrom, version.validTo, parsed.data.validFrom, validTo));
      for (const version of closable) {
        if (version.status !== "ACTIVE" || version.validTo !== null || version.validFrom.getTime() >= parsed.data.validFrom.getTime()) return adminFailure("CONFLICT");
        const closed = await transaction.productVersion.updateMany({ where: { id: version.id, status: "ACTIVE", validTo: null }, data: { validTo: parsed.data.validFrom } });
        if (closed.count !== 1) throw new AdminDomainError("CONFLICT");
      }
      const latest = await transaction.productVersion.aggregate({ where: { productId: product.id }, _max: { version: true } });
      const version = await transaction.productVersion.create({ data: {
        id: parsed.data.idempotencyKey, productId: product.id, version: (latest._max.version ?? 0) + 1, status: "SCHEDULED",
        netPriceRappen: parsed.data.netPriceRappen, currency: source.currency, durationDays: source.durationDays,
        creditType: source.creditType, creditAmount: source.creditAmount, isPublic: parsed.data.isPublic, isSelfService: parsed.data.isSelfService,
        priority: source.priority, requiresLegalReview: source.requiresLegalReview, releaseDecisionId: parsed.data.releaseDecisionId ?? null, validFrom: parsed.data.validFrom, validTo, createdAt: now,
      }, select: { id: true, productId: true, version: true, status: true } });
      await writeAdminAudit(transaction, { ...dependencies, correlationId: parsed.data.idempotencyKey }, now, { action: "CATALOG_VERSION_SCHEDULED", capability: "ADMIN_CATALOG_MUTATE", targetType: "PRODUCT_VERSION", targetId: version.id, reasonCode: parsed.data.reasonCode, metadata: { sourceVersionId: parsed.data.sourceVersionId } });
      return adminSuccess(version);
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    return adminErrorResult(error);
  }
}

export async function deactivatePlanVersion(raw: unknown, dependencies: AdminDependencies) {
  return deactivateCatalogVersion("PLAN", raw, dependencies);
}

export async function deactivateProductVersion(raw: unknown, dependencies: AdminDependencies) {
  return deactivateCatalogVersion("PRODUCT", raw, dependencies);
}

async function deactivateCatalogVersion(kind: "PLAN" | "PRODUCT", raw: unknown, dependencies: AdminDependencies) {
  const parsed = deactivateCatalogSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_CATALOG_MUTATE")) return adminFailure("FORBIDDEN");
  const now = adminNow(dependencies.now);
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      if (kind === "PLAN") await transaction.$queryRaw`SELECT "id" FROM "PlanVersion" WHERE "id" = ${parsed.data.versionId}::uuid FOR UPDATE`;
      else await transaction.$queryRaw`SELECT "id" FROM "ProductVersion" WHERE "id" = ${parsed.data.versionId}::uuid FOR UPDATE`;
      const existing = kind === "PLAN"
        ? await transaction.planVersion.findUnique({ where: { id: parsed.data.versionId }, select: { id: true, status: true, validFrom: true, validTo: true, plan: { select: { isDefaultFree: true } } } })
        : await transaction.productVersion.findUnique({ where: { id: parsed.data.versionId }, select: { id: true, status: true, validFrom: true, validTo: true } });
      if (existing === null) return adminFailure("NOT_FOUND");
      if (
        kind === "PLAN" &&
        "plan" in existing &&
        typeof existing.plan === "object" &&
        existing.plan !== null &&
        "isDefaultFree" in existing.plan &&
        existing.plan.isDefaultFree === true
      ) return adminFailure("CONFLICT");
      const replay = await transaction.auditLog.findFirst({ where: { targetId: existing.id, action: "CATALOG_VERSION_DEACTIVATED", correlationId: parsed.data.idempotencyKey }, select: { id: true, reasonCode: true } });
      if (replay !== null && existing.status === "INACTIVE") {
        return replay.reasonCode === parsed.data.reasonCode
          ? adminSuccess({ versionId: existing.id, status: "INACTIVE" as const }, true)
          : adminFailure("CONFLICT");
      }
      if (existing.status === "INACTIVE") return adminFailure("CONFLICT");
      const validTo = existing.status === "ACTIVE" && existing.validTo === null && existing.validFrom.getTime() < now.getTime() ? now : existing.validTo;
      if (kind === "PLAN") await transaction.planVersion.update({ where: { id: existing.id }, data: { status: "INACTIVE", validTo } });
      else await transaction.productVersion.update({ where: { id: existing.id }, data: { status: "INACTIVE", validTo } });
      await writeAdminAudit(transaction, { ...dependencies, correlationId: parsed.data.idempotencyKey }, now, { action: "CATALOG_VERSION_DEACTIVATED", capability: "ADMIN_CATALOG_MUTATE", targetType: kind === "PLAN" ? "PLAN_VERSION" : "PRODUCT_VERSION", targetId: existing.id, reasonCode: parsed.data.reasonCode });
      return adminSuccess({ versionId: existing.id, status: "INACTIVE" as const });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    return adminErrorResult(error);
  }
}

export function catalogRangesOverlap(leftFrom: Date, leftTo: Date | null, rightFrom: Date, rightTo: Date | null) {
  const leftEnd = leftTo?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightEnd = rightTo?.getTime() ?? Number.POSITIVE_INFINITY;
  return leftFrom.getTime() < rightEnd && rightFrom.getTime() < leftEnd;
}

function sameNullableInstant(left: Date | null, right: Date | null) {
  return left === null || right === null ? left === right : left.getTime() === right.getTime();
}

function catalogScheduleAuditMatches(
  audit: Readonly<{ metadata: unknown; reasonCode: string | null }> | null,
  sourceVersionId: string,
  reasonCode: string,
) {
  if (audit === null || audit.reasonCode !== reasonCode) return false;
  const metadata = z.strictObject({ sourceVersionId: z.uuid() }).safeParse(audit.metadata);
  return metadata.success && metadata.data.sourceVersionId === sourceVersionId;
}
