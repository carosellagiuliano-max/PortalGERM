import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  trackAnalyticsEventV1,
  type AnalyticsWriteRecord,
  type AnalyticsWriter,
} from "@/lib/analytics/track";
import { writeRequiredAudit, type AuditTargetTypeV1 } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import {
  BILLING_POLICY_V1,
  addZurichCalendarMonthsClampedV1,
  computeProratedAllowanceV1,
  computeProratedPlanDeltaV1,
  selectDefaultRetainedSeatsV1,
} from "@/lib/billing/billing-policy-v1";
import {
  billingFailure,
  billingSuccess,
  canManageBillingProfile,
  canManagePlan,
  checkoutIntentSchema,
  confirmPaymentSchema,
  normalizeBillingNow,
  type BillingCommandResult,
  type BillingCommandErrorCode,
  type BillingDependencies,
  type CheckoutIntent,
} from "@/lib/billing/contracts";
import { isContactPackPlanEligibleV1 } from "@/lib/billing/checkout-eligibility";
import {
  decodePlanEntitlementsV1,
  getEffectiveEntitlements,
} from "@/lib/billing/entitlements";
import {
  allocateInvoiceNumber,
  type InvoiceNumberTransaction,
} from "@/lib/billing/invoice-number";
import { createPrismaEntitlementRepository } from "@/lib/billing/prisma-publish-quota";
import { computeVat } from "@/lib/billing/vat";
import { Prisma } from "@/lib/generated/prisma/client";
import { createPrismaNotificationPort } from "@/lib/notifications/prisma-port";
import { writeNotificationExactlyOnce } from "@/lib/notifications/writer";
import type { EmailProvider, EmailTemplateKey } from "@/lib/providers/email";
import { renderEmailTemplate } from "@/lib/providers/email/templates";

const BILLING_AUDIT_RETENTION_MS = 10 * 365 * 86_400_000;
const CHECKOUT_TTL_MS = 30 * 60 * 1_000;
const COMPANY_BILLING_LOCK_NAMESPACE = 1212;
const CHECKOUT_IDEMPOTENCY_LOCK_NAMESPACE = 1213;
const CHECKOUT_HASH_SEPARATOR = String.fromCharCode(0);

class BillingDomainRollbackError extends Error {
  readonly code: BillingCommandErrorCode;

  constructor(code: BillingCommandErrorCode) {
    super(code);
    this.code = code;
  }
}

export type CheckoutOrderResult = Readonly<{
  orderId: string;
  checkoutUrl: string;
  status: "PENDING" | "PAID";
}>;

export type ConfirmedOrderResult = Readonly<{
  orderId: string;
  invoiceId: string;
  invoiceNumber: string;
  subscriptionId: string | null;
  creditGrantEntryId: string | null;
  additionalJobPermitId: string | null;
  importAccessGrantId: string | null;
  emailsRecorded: boolean;
}>;

type PlanQuote = Readonly<{
  kind: "PLAN";
  planVersion: PlanVersionQuoteRow;
  unitNetRappen: number;
  snapshot: Prisma.SubscriptionOrderSnapshotUncheckedCreateWithoutOrderLineInput;
}>;

type ContactPackQuote = Readonly<{
  kind: "CONTACT_PACK";
  productVersion: ProductVersionQuoteRow;
  quantity: number;
  unitNetRappen: number;
}>;

type AdditionalJobQuote = Readonly<{
  kind: "ADDITIONAL_JOB";
  productVersion: ProductVersionQuoteRow;
  quantity: 1;
  unitNetRappen: 12_900;
  targetJobId: string;
}>;

type ImportSetupQuote = Readonly<{
  kind: "IMPORT_SETUP";
  productVersion: ProductVersionQuoteRow;
  quantity: 1;
  unitNetRappen: 75_000;
  targetImportSourceId: string;
  targetImportSetupApprovalId: string;
}>;

type ProductQuote = ContactPackQuote | AdditionalJobQuote | ImportSetupQuote;
type ResolvedQuote = PlanQuote | ProductQuote;

type PreparedCheckoutOrder = Readonly<{
  orderId: string;
  providerIdempotencyKey: string;
  status: "PENDING" | "PAID";
}>;

type PlanFulfillmentTerms = Readonly<{
  periodStart: Date;
  periodEnd: Date;
  talentContactAllowance: number;
  jobBoostAllowance: number;
}>;

type PlanVersionQuoteRow = NonNullable<
  Awaited<ReturnType<typeof loadPlanVersion>>
>;
type ProductVersionQuoteRow = NonNullable<
  Awaited<ReturnType<typeof loadProductVersion>>
>;

export async function createCheckoutOrder(
  input: unknown,
  dependencies: BillingDependencies,
): Promise<BillingCommandResult<CheckoutOrderResult>> {
  const parsed = checkoutIntentSchema.safeParse(input);
  if (!parsed.success) return billingFailure("INVALID_INPUT");
  if (
    parsed.data.kind === "PLAN"
      ? !canManagePlan(dependencies.actor.membershipRole)
      : !canManageBillingProfile(dependencies.actor.membershipRole)
  ) {
    return billingFailure("FORBIDDEN");
  }
  const now = normalizeBillingNow(dependencies.now);
  const fingerprint = checkoutRequestFingerprint(
    dependencies.actor.companyId,
    parsed.data,
  );

  let prepared: BillingCommandResult<PreparedCheckoutOrder>;
  try {
    prepared = await dependencies.database.$transaction(
      async (transaction) => {
        await lockCheckoutIdempotencyKey(
          transaction,
          parsed.data.idempotencyKey,
        );
        await lockCompanyBillingScope(transaction, dependencies.actor.companyId);
        if (!(await hasCurrentBillingMembership(transaction, dependencies))) {
          return billingFailure("NOT_FOUND");
        }

        const existing = await transaction.order.findUnique({
          where: { clientIdempotencyKey: parsed.data.idempotencyKey },
          select: {
            id: true,
            companyId: true,
            status: true,
            requestFingerprint: true,
            providerIdempotencyKey: true,
            expiresAt: true,
          },
        });
        if (existing !== null) {
          if (
            existing.companyId !== dependencies.actor.companyId ||
            existing.requestFingerprint !== fingerprint ||
            existing.providerIdempotencyKey === null
          ) {
            return billingFailure("IDEMPOTENCY_MISMATCH");
          }
          if (existing.status === "FAILED") {
            return billingFailure("PAYMENT_PROVIDER_FAILED");
          }
          if (
            existing.status === "PENDING" &&
            existing.expiresAt !== null &&
            existing.expiresAt.getTime() <= now.getTime()
          ) {
            await expirePendingOrder(transaction, {
              companyId: dependencies.actor.companyId,
              correlationId: dependencies.correlationId,
              now,
              orderId: existing.id,
            });
            return billingFailure("ORDER_EXPIRED");
          }
          if (existing.status !== "PENDING" && existing.status !== "PAID") {
            return billingFailure("ORDER_NOT_PENDING");
          }
          return billingSuccess(
            {
              orderId: existing.id,
              providerIdempotencyKey: existing.providerIdempotencyKey,
              status: existing.status,
            },
            true,
          );
        }

        const profile = await transaction.companyBillingProfile.findUnique({
          where: { companyId: dependencies.actor.companyId },
        });
        if (profile === null || !isCompleteSwissBillingProfile(profile)) {
          return billingFailure("PROFILE_REQUIRED");
        }
        const taxRate = await loadCurrentTaxRate(transaction, now);
        if (taxRate === null) return billingFailure("TAX_UNAVAILABLE");
        const quote = await resolveCheckoutQuote(
          transaction,
          parsed.data,
          dependencies,
          now,
        );
        if (!quote.ok) return quote;

        const orderId = randomUUID();
        const orderLineId = randomUUID();
        const providerIdempotencyKey = `checkout:${orderId}`;
        const quantity = quote.value.kind === "PLAN" ? 1 : quote.value.quantity;
        const netRappen = quote.value.unitNetRappen * quantity;
        const vat = computeVat(netRappen, taxRate.rateBasisPoints);
        const descriptionSnapshot =
          quote.value.kind === "PLAN"
            ? `${quote.value.planVersion.plan.name} Monatsplan`
            : quote.value.productVersion.product.name;

        await transaction.order.create({
          data: {
            id: orderId,
            companyId: dependencies.actor.companyId,
            createdByUserId: dependencies.actor.userId,
            status: "DRAFT",
            provider: "MOCK",
            clientIdempotencyKey: parsed.data.idempotencyKey,
            providerIdempotencyKey,
            requestFingerprint: fingerprint,
            billingLegalNameSnapshot: profile.legalName,
            billingContactEmailSnapshot: profile.billingContactEmail,
            billingStreetSnapshot: profile.street,
            billingPostalCodeSnapshot: profile.postalCode,
            billingCitySnapshot: profile.city,
            billingCountryCodeSnapshot: "CH",
            billingUidSnapshot: profile.uid,
            billingVatNumberSnapshot: profile.vatNumber,
            currency: "CHF",
            netTotalRappen: vat.net,
            vatTotalRappen: vat.vatAmount,
            totalRappen: vat.total,
            expiresAt: new Date(now.getTime() + CHECKOUT_TTL_MS),
            lines: {
              create: {
                id: orderLineId,
                planVersionId:
                  quote.value.kind === "PLAN"
                    ? quote.value.planVersion.id
                    : null,
                productVersionId:
                  quote.value.kind === "PLAN"
                    ? null
                    : quote.value.productVersion.id,
                taxRateVersionId: taxRate.id,
                quantity,
                unitNetRappen: quote.value.unitNetRappen,
                netRappen: vat.net,
                taxRateBasisPoints: taxRate.rateBasisPoints,
                vatRappen: vat.vatAmount,
                totalRappen: vat.total,
                currency: "CHF",
                descriptionSnapshot,
                fulfillmentContext:
                  quote.value.kind === "PLAN" ? "SUBSCRIPTION" : quote.value.kind,
                targetJobId:
                  quote.value.kind === "ADDITIONAL_JOB"
                    ? quote.value.targetJobId
                    : null,
                targetImportSourceId:
                  quote.value.kind === "IMPORT_SETUP"
                    ? quote.value.targetImportSourceId
                    : null,
                targetImportSetupApprovalId:
                  quote.value.kind === "IMPORT_SETUP"
                    ? quote.value.targetImportSetupApprovalId
                    : null,
                targetCreditType:
                  quote.value.kind === "CONTACT_PACK" ? "TALENT_CONTACT" : null,
                ...(quote.value.kind === "PLAN"
                  ? {
                      subscriptionSnapshot: {
                        create: { id: randomUUID(), ...quote.value.snapshot },
                      },
                    }
                  : {}),
              },
            },
          },
        });
        const released = await transaction.order.updateMany({
          where: { id: orderId, status: "DRAFT" },
          data: { status: "PENDING" },
        });
        if (released.count !== 1) {
          throw new BillingDomainRollbackError("CONFLICT");
        }
        if (quote.value.kind === "IMPORT_SETUP") {
          const reserved = await transaction.importSetupApproval.updateMany({
            where: {
              id: quote.value.targetImportSetupApprovalId,
              companyId: dependencies.actor.companyId,
              importSourceId: quote.value.targetImportSourceId,
              status: "APPROVED",
              validUntil: { gt: now },
              orderLineId: null,
            },
            data: { orderLineId },
          });
          if (reserved.count !== 1) {
            throw new BillingDomainRollbackError(
              "IMPORT_SETUP_NOT_ELIGIBLE",
            );
          }
        }
        await transaction.paymentEvent.create({
          data: {
            orderId,
            provider: "MOCK",
            kind: "CHECKOUT_CREATED",
            idempotencyKey: `checkout-created:${orderId}`,
            payload: {
              schemaVersion: "1",
              provider: "MOCK",
              amountAuthoritative: false,
            },
          },
        });
        await writeBillingAudit(transaction, dependencies, now, {
          action: "CHECKOUT_CREATED",
          capability: "EMPLOYER_BILLING_CHECKOUT_CREATE",
          targetId: orderId,
          targetType: "ORDER",
          reasonCode:
            quote.value.kind === "PLAN"
              ? "PLAN_CHECKOUT"
              : quote.value.kind === "CONTACT_PACK"
                ? "CONTACT_PACK_CHECKOUT"
                : quote.value.kind === "ADDITIONAL_JOB"
                  ? "ADDITIONAL_JOB_CHECKOUT"
                  : "IMPORT_SETUP_CHECKOUT",
        });

        return billingSuccess({
          orderId,
          providerIdempotencyKey,
          status: "PENDING",
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch {
    return billingFailure("WRITE_FAILED");
  }

  if (!prepared.ok) return prepared;
  if (prepared.value.status === "PAID") {
    return billingSuccess(
      {
        orderId: prepared.value.orderId,
        checkoutUrl: `/employer/billing/success?order=${encodeURIComponent(prepared.value.orderId)}`,
        status: "PAID",
      },
      prepared.replay === true,
    );
  }
  const providerSession = await safeCreateProviderCheckout(
    dependencies,
    prepared.value.orderId,
    prepared.value.providerIdempotencyKey,
  );
  if (providerSession === null) {
    await recordCheckoutProviderFailure(
      dependencies,
      prepared.value.orderId,
      now,
    );
    return billingFailure("PAYMENT_PROVIDER_FAILED");
  }
  const analytics = await recordCheckoutStartedAnalytics(
    dependencies,
    prepared.value.orderId,
    now,
  );
  if (!analytics.ok) return analytics;
  return billingSuccess(
    {
      orderId: prepared.value.orderId,
      checkoutUrl: providerSession.checkoutUrl,
      status: "PENDING",
    },
    prepared.replay === true,
  );
}

export async function confirmMockPayment(
  input: unknown,
  dependencies: BillingDependencies,
): Promise<BillingCommandResult<ConfirmedOrderResult>> {
  const parsed = confirmPaymentSchema.safeParse(input);
  if (!parsed.success) return billingFailure("INVALID_INPUT");
  if (!canManageBillingProfile(dependencies.actor.membershipRole)) {
    return billingFailure("FORBIDDEN");
  }
  const now = normalizeBillingNow(dependencies.now);
  const authorization = await authorizeMockPaymentConfirmation(
    parsed.data.orderId,
    dependencies,
    now,
  );
  if (!authorization.ok) return authorization;

  let providerReference = authorization.value.providerReference;
  if (authorization.value.requiresProviderConfirmation) {
    try {
      providerReference = (
        await dependencies.paymentProvider.confirmPayment({
          orderId: parsed.data.orderId,
          idempotencyKey: parsed.data.idempotencyKey,
        })
      ).providerReference;
      if (!/^mock_payment_[0-9a-f]{64}$/u.test(providerReference)) {
        return billingFailure("PAYMENT_PROVIDER_FAILED");
      }
    } catch {
      return billingFailure("PAYMENT_PROVIDER_FAILED");
    }
  }

  const transactionResult = await runSerializableRetry(async () =>
    dependencies.database.$transaction(
      async (transaction) => {
        await lockCompanyBillingScope(transaction, dependencies.actor.companyId);
        await transaction.$queryRaw`
          SELECT "id" FROM "Order"
          WHERE "id" = ${parsed.data.orderId}::uuid
          FOR UPDATE
        `;
        if (!(await hasCurrentBillingMembership(transaction, dependencies))) {
          return billingFailure("NOT_FOUND");
        }
        const order = await loadOrderForConfirmation(
          transaction,
          parsed.data.orderId,
          dependencies.actor.companyId,
        );
        if (order === null) return billingFailure("NOT_FOUND");
        if (order.provider !== "MOCK") return billingFailure("NOT_FOUND");
        if (order.status === "PAID") {
          const replay = buildPaidReplay(order);
          return replay === null
            ? billingFailure("CONFLICT")
            : billingSuccess(replay, true);
        }
        if (order.status !== "PENDING") {
          return billingFailure("ORDER_NOT_PENDING");
        }
        if (order.expiresAt !== null && order.expiresAt.getTime() <= now.getTime()) {
          await expirePendingOrder(transaction, {
            companyId: order.companyId,
            correlationId: dependencies.correlationId,
            now,
            orderId: order.id,
          });
          return billingFailure("ORDER_EXPIRED");
        }
        if (order.lines.length !== 1) return billingFailure("CONFLICT");
        const line = order.lines[0];
        if (line === undefined) return billingFailure("CONFLICT");
        if (line.planVersionId !== null && !canManagePlan(dependencies.actor.membershipRole)) {
          return billingFailure("FORBIDDEN");
        }
        if (
          line.productVersionId !== null &&
          (line.productVersion === null ||
            !isProductVersionEffective(line.productVersion, now))
        ) {
          return billingFailure("PRODUCT_NOT_AVAILABLE");
        }
        if (providerReference === null) return billingFailure("CONFLICT");

        await transaction.paymentEvent.create({
          data: {
            orderId: order.id,
            provider: "MOCK",
            kind: "PAID",
            providerReference,
            idempotencyKey: `paid:${order.id}`,
            createdAt: now,
            payload: {
              schemaVersion: "1",
              mock: true,
              externalChargeClaimed: false,
            },
          },
        });
        const paid = await transaction.order.updateMany({
          where: { id: order.id, companyId: order.companyId, status: "PENDING" },
          data: {
            status: "PAID",
            paidAt: now,
            providerReference,
          },
        });
        if (paid.count !== 1) throw new BillingDomainRollbackError("CONFLICT");

        const invoice = await createPaidInvoice(transaction, order, now);
        const fulfillment =
          line.planVersionId !== null
            ? await fulfillPlanOrder(transaction, order, line, dependencies, now)
            : await fulfillProductOrder(
                transaction,
                order,
                line,
                dependencies,
                now,
              );
        if (!fulfillment.ok) {
          throw new BillingDomainRollbackError(fulfillment.code);
        }

        await writeBillingAudit(transaction, dependencies, now, {
          action: "ORDER_PAID",
          capability: "EMPLOYER_BILLING_PAYMENT_CONFIRM",
          targetId: order.id,
          targetType: "ORDER",
          reasonCode: "MOCK_PAYMENT_CONFIRMED",
        });
        await writeBillingAudit(transaction, dependencies, now, {
          action: "INVOICE_ISSUED",
          capability: "EMPLOYER_BILLING_PAYMENT_CONFIRM",
          targetId: invoice.id,
          targetType: "INVOICE",
          reasonCode: "ORDER_PAID",
        });
        await writeBillingAudit(transaction, dependencies, now, {
          action: "INVOICE_PAID",
          capability: "EMPLOYER_BILLING_PAYMENT_CONFIRM",
          targetId: invoice.id,
          targetType: "INVOICE",
          reasonCode: "MOCK_PAYMENT_CONFIRMED",
        });
        await writeCheckoutAnalyticsEvent(
          transaction,
          "CHECKOUT_COMPLETED",
          order,
          line,
          now,
        );

        return billingSuccess({
          orderId: order.id,
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          subscriptionId: fulfillment.value.subscriptionId,
          creditGrantEntryId: fulfillment.value.creditGrantEntryId,
          additionalJobPermitId: fulfillment.value.additionalJobPermitId,
          importAccessGrantId: fulfillment.value.importAccessGrantId,
          recipientUserId: order.createdByUserId,
          subscriptionStatus: fulfillment.value.subscriptionStatus,
          subscriptionReason: fulfillment.value.subscriptionReason,
          billingEmail: order.billingContactEmailSnapshot,
          planName: line.planVersion?.plan.name ?? null,
          creditCount:
            line.productVersion?.creditAmount === null ||
            line.productVersion?.creditAmount === undefined
              ? null
              : line.productVersion.creditAmount * line.quantity,
        });
      },
      { isolationLevel: "Serializable" },
    ),
  );

  if (!transactionResult.ok) return transactionResult;
  const emailContext = transactionResult.value;
  await sendBillingNotifications(dependencies.database, emailContext);
  const emailsRecorded = await sendBillingEmails(
    dependencies.emailProvider,
    emailContext,
  );
  return billingSuccess(
    {
      orderId: emailContext.orderId,
      invoiceId: emailContext.invoiceId,
      invoiceNumber: emailContext.invoiceNumber,
      subscriptionId: emailContext.subscriptionId,
      creditGrantEntryId: emailContext.creditGrantEntryId,
      additionalJobPermitId: emailContext.additionalJobPermitId,
      importAccessGrantId: emailContext.importAccessGrantId,
      emailsRecorded,
    },
    transactionResult.replay === true,
  );
}

async function resolveCheckoutQuote(
  transaction: Prisma.TransactionClient,
  intent: CheckoutIntent,
  dependencies: BillingDependencies,
  now: Date,
): Promise<BillingCommandResult<ResolvedQuote>> {
  if (intent.kind === "PLAN") {
    const version = await loadPlanVersion(transaction, intent.planSlug, now);
    if (version === null) return billingFailure("CATALOG_UNAVAILABLE");
    if (
      version.plan.code !== intent.planSlug.toUpperCase() ||
      version.billingInterval !== "MONTHLY" ||
      version.termMonths !== 1 ||
      version.priceMode !== "FIXED" ||
      version.netPriceRappen === null ||
      version.netPriceRappen <= 0 ||
      version.monthlyEquivalentRappen !== version.netPriceRappen ||
      version.currency !== "CHF"
    ) {
      return billingFailure("PLAN_NOT_SELF_SERVICE");
    }
    const decoded = decodePlanEntitlementsV1(version.entitlements);
    if (!decoded.ok) return billingFailure("CATALOG_UNAVAILABLE");
    const currentRows = await transaction.employerSubscription.findMany({
      where: {
        companyId: dependencies.actor.companyId,
        status: { in: ["ACTIVE", "CANCELLING"] },
        currentPeriodStart: { lte: now },
        currentPeriodEnd: { gt: now },
      },
      take: 2,
      select: {
        id: true,
        status: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        recurringNetRappenSnapshot: true,
        planVersion: { select: { plan: { select: { code: true } } } },
        currentChangeSchedules: {
          where: { status: "PENDING" },
          take: 1,
          select: { id: true },
        },
      },
    });
    if (currentRows.length > 1) return billingFailure("CONFLICT");
    const current = currentRows[0] ?? null;
    if (
      current?.status === "CANCELLING" ||
      (current?.currentChangeSchedules.length ?? 0) > 0
    ) {
      return billingFailure("CHANGE_ALREADY_SCHEDULED");
    }

    if (current === null) {
      if (intent.retainedMembershipIds !== undefined) {
        return billingFailure("INVALID_INPUT");
      }
      const end = addZurichCalendarMonthsClampedV1(now, 1);
      if (!end.ok) return billingFailure("CATALOG_UNAVAILABLE");
      return billingSuccess({
        kind: "PLAN",
        planVersion: version,
        unitNetRappen: version.netPriceRappen,
        snapshot: {
          policyVersion: BILLING_POLICY_V1.version,
          changeKind: "NEW",
          sourceSubscriptionId: null,
          sourcePeriodStart: null,
          sourcePeriodEnd: null,
          fulfillmentPeriodStart: now,
          fulfillmentPeriodEnd: end.value,
          sourceRecurringNetRappen: null,
          targetRecurringNetRappen: version.netPriceRappen,
          prorationNumeratorSeconds: null,
          prorationDenominatorSeconds: null,
          quotedNetRappen: version.netPriceRappen,
          activeJobLimitSnapshot: decoded.value.ACTIVE_JOB_LIMIT,
          seatLimitSnapshot: decoded.value.SEAT_LIMIT,
          talentContactAllowanceSnapshot:
            decoded.value.TALENT_CONTACT_ALLOWANCE,
          jobBoostAllowanceSnapshot: decoded.value.JOB_BOOST_ALLOWANCE,
          retainedMembershipIds: [],
          retainedDefaultOwnerId: null,
        },
      });
    }

    const currentCode = current.planVersion.plan.code;
    if (currentCode === version.plan.code) return billingFailure("SAME_PLAN");
    if (currentCode === "STARTER" && version.plan.code === "PRO") {
      if (intent.retainedMembershipIds !== undefined) {
        return billingFailure("INVALID_INPUT");
      }
      const prorated = computeProratedPlanDeltaV1({
        currentPlanNetRappen: current.recurringNetRappenSnapshot,
        targetPlanNetRappen: version.netPriceRappen,
        period: {
          start: current.currentPeriodStart,
          end: current.currentPeriodEnd,
        },
        at: now,
      });
      const contacts = computeProratedAllowanceV1({
        targetAllowance: decoded.value.TALENT_CONTACT_ALLOWANCE,
        period: {
          start: current.currentPeriodStart,
          end: current.currentPeriodEnd,
        },
        at: now,
      });
      const boosts = computeProratedAllowanceV1({
        targetAllowance: decoded.value.JOB_BOOST_ALLOWANCE,
        period: {
          start: current.currentPeriodStart,
          end: current.currentPeriodEnd,
        },
        at: now,
      });
      if (
        !prorated.ok ||
        !contacts.ok ||
        !boosts.ok ||
        prorated.value.amountRappen < 1
      ) {
        return billingFailure("CONFLICT");
      }
      return billingSuccess({
        kind: "PLAN",
        planVersion: version,
        unitNetRappen: prorated.value.amountRappen,
        snapshot: {
          policyVersion: BILLING_POLICY_V1.version,
          changeKind: "UPGRADE",
          sourceSubscriptionId: current.id,
          sourcePeriodStart: current.currentPeriodStart,
          sourcePeriodEnd: current.currentPeriodEnd,
          fulfillmentPeriodStart: now,
          fulfillmentPeriodEnd: current.currentPeriodEnd,
          sourceRecurringNetRappen: current.recurringNetRappenSnapshot,
          targetRecurringNetRappen: version.netPriceRappen,
          prorationNumeratorSeconds: prorated.value.remainingSeconds,
          prorationDenominatorSeconds: prorated.value.periodSeconds,
          quotedNetRappen: prorated.value.amountRappen,
          activeJobLimitSnapshot: decoded.value.ACTIVE_JOB_LIMIT,
          seatLimitSnapshot: decoded.value.SEAT_LIMIT,
          talentContactAllowanceSnapshot: contacts.value.allowance,
          jobBoostAllowanceSnapshot: boosts.value.allowance,
          retainedMembershipIds: [],
          retainedDefaultOwnerId: null,
        },
      });
    }

    if (currentCode === "PRO" && version.plan.code === "STARTER") {
      const end = addZurichCalendarMonthsClampedV1(current.currentPeriodEnd, 1);
      if (!end.ok) return billingFailure("CATALOG_UNAVAILABLE");
      const memberships = await transaction.companyMembership.findMany({
        where: {
          companyId: dependencies.actor.companyId,
          status: "ACTIVE",
          removedAt: null,
        },
        orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          userId: true,
          role: true,
          status: true,
          joinedAt: true,
        },
      });
      const requestedMembershipIds = intent.retainedMembershipIds;
      const retainedCandidates =
        requestedMembershipIds === undefined
          ? memberships
          : memberships.filter((membership) =>
              requestedMembershipIds.includes(membership.id),
            );
      if (
        requestedMembershipIds !== undefined &&
        (requestedMembershipIds.length > decoded.value.SEAT_LIMIT ||
          retainedCandidates.length !== requestedMembershipIds.length)
      ) {
        return billingFailure("INVALID_INPUT");
      }
      const retained = selectDefaultRetainedSeatsV1({
        seatLimit: decoded.value.SEAT_LIMIT,
        memberships: retainedCandidates,
      });
      if (!retained.ok) return billingFailure("CONFLICT");
      return billingSuccess({
        kind: "PLAN",
        planVersion: version,
        unitNetRappen: version.netPriceRappen,
        snapshot: {
          policyVersion: BILLING_POLICY_V1.version,
          changeKind: "DOWNGRADE",
          sourceSubscriptionId: current.id,
          sourcePeriodStart: current.currentPeriodStart,
          sourcePeriodEnd: current.currentPeriodEnd,
          fulfillmentPeriodStart: current.currentPeriodEnd,
          fulfillmentPeriodEnd: end.value,
          sourceRecurringNetRappen: current.recurringNetRappenSnapshot,
          targetRecurringNetRappen: version.netPriceRappen,
          prorationNumeratorSeconds: null,
          prorationDenominatorSeconds: null,
          quotedNetRappen: version.netPriceRappen,
          activeJobLimitSnapshot: decoded.value.ACTIVE_JOB_LIMIT,
          seatLimitSnapshot: decoded.value.SEAT_LIMIT,
          talentContactAllowanceSnapshot:
            decoded.value.TALENT_CONTACT_ALLOWANCE,
          jobBoostAllowanceSnapshot: decoded.value.JOB_BOOST_ALLOWANCE,
          retainedMembershipIds: [...retained.value.retainedMembershipIds],
          retainedDefaultOwnerId: retained.value.defaultOwnerUserId,
        },
      });
    }
    return billingFailure("PLAN_NOT_SELF_SERVICE");
  }

  if (intent.productSlug === "boost-7d" || intent.productSlug === "boost-30d") {
    return billingFailure("FULFILLMENT_HANDLER_MISSING");
  }
  const product = await loadProductVersion(
    transaction,
    intent.productSlug,
    now,
  );
  if (product === null || product.currency !== "CHF") {
    return billingFailure("PRODUCT_NOT_AVAILABLE");
  }

  if (
    intent.productSlug === "contact-pack-10" ||
    intent.productSlug === "contact-pack-50"
  ) {
    if (
      product.product.type !== "CONTACT_PACK" ||
      !product.isPublic ||
      !product.isSelfService ||
      product.creditType !== "TALENT_CONTACT" ||
      product.creditAmount === null ||
      product.creditAmount !==
        (intent.productSlug === "contact-pack-10" ? 10 : 50) ||
      product.durationDays !== null ||
      product.netPriceRappen <= 0
    ) {
      return billingFailure("PRODUCT_NOT_AVAILABLE");
    }
    const entitlements = await getEffectiveEntitlements(
      dependencies.actor.companyId,
      now,
      createPrismaEntitlementRepository(transaction),
    );
    if (!entitlements.ok) return billingFailure("CATALOG_UNAVAILABLE");
    if (!entitlements.value.rights.TALENT_RADAR_ACCESS) {
      return billingFailure("TALENT_RADAR_REQUIRED");
    }
    if (!(await hasContactPackEligiblePlan(transaction, dependencies.actor.companyId, now))) {
      return billingFailure("TALENT_RADAR_REQUIRED");
    }
    return billingSuccess({
      kind: "CONTACT_PACK",
      productVersion: product,
      quantity: intent.quantity,
      unitNetRappen: product.netPriceRappen,
    });
  }

  if (intent.productSlug === "additional-job-30d") {
    if (!isReleasedAdditionalJobProduct(product)) {
      return billingFailure("PRODUCT_RELEASE_REQUIRED");
    }
    const eligible = await authorizeAdditionalJobContext(transaction, {
      companyId: dependencies.actor.companyId,
      targetJobId: intent.targetJobId,
      at: now,
    });
    if (!eligible) return billingFailure("ADDITIONAL_JOB_NOT_ELIGIBLE");
    return billingSuccess({
      kind: "ADDITIONAL_JOB",
      productVersion: product,
      quantity: 1,
      unitNetRappen: 12_900,
      targetJobId: intent.targetJobId,
    });
  }

  if (intent.productSlug === "import-setup") {
    if (!isReleasedImportSetupProduct(product)) {
      return billingFailure("PRODUCT_RELEASE_REQUIRED");
    }
    const context = await authorizeImportSetupContext(transaction, {
      companyId: dependencies.actor.companyId,
      approvalId: intent.importSetupApprovalId,
      at: now,
      correlationId: dependencies.correlationId,
    });
    if (context === null) return billingFailure("IMPORT_SETUP_NOT_ELIGIBLE");
    return billingSuccess({
      kind: "IMPORT_SETUP",
      productVersion: product,
      quantity: 1,
      unitNetRappen: 75_000,
      targetImportSourceId: context.importSourceId,
      targetImportSetupApprovalId: context.approvalId,
    });
  }

  return billingFailure("PRODUCT_NOT_AVAILABLE");
}

async function fulfillPlanOrder(
  transaction: Prisma.TransactionClient,
  order: ConfirmOrderRow,
  line: ConfirmOrderRow["lines"][number],
  dependencies: BillingDependencies,
  now: Date,
): Promise<BillingCommandResult<FulfillmentResult>> {
  const snapshot = line.subscriptionSnapshot;
  const plan = line.planVersion;
  if (
    snapshot === null ||
    plan === null ||
    snapshot.policyVersion !== BILLING_POLICY_V1.version
  ) {
    return billingFailure("CONFLICT");
  }
  const fulfillmentTerms = await derivePlanFulfillmentTerms(
    transaction,
    order,
    line,
    now,
  );
  if (!fulfillmentTerms.ok) return fulfillmentTerms;
  const sourceSubscriptionId = snapshot.sourceSubscriptionId;
  const subscriptionId = randomUUID();
  if (snapshot.changeKind === "NEW") {
    const overlapping = await transaction.employerSubscription.findFirst({
      where: {
        companyId: order.companyId,
        status: { in: ["SCHEDULED", "ACTIVE", "CANCELLING"] },
        currentPeriodStart: { lt: fulfillmentTerms.value.periodEnd },
        currentPeriodEnd: { gt: fulfillmentTerms.value.periodStart },
      },
      select: { id: true },
    });
    if (overlapping !== null) return billingFailure("CONFLICT");
  } else {
    if (sourceSubscriptionId === null) return billingFailure("CONFLICT");
    await transaction.$queryRaw`
      SELECT "id" FROM "EmployerSubscription"
      WHERE "id" = ${sourceSubscriptionId}::uuid
      FOR UPDATE
    `;
    const source = await transaction.employerSubscription.findFirst({
      where: {
        id: sourceSubscriptionId,
        companyId: order.companyId,
        status: "ACTIVE",
        currentPeriodStart: snapshot.sourcePeriodStart ?? undefined,
        currentPeriodEnd: snapshot.sourcePeriodEnd ?? undefined,
        AND: [
          { currentPeriodStart: { lte: now } },
          { currentPeriodEnd: { gt: now } },
        ],
        recurringNetRappenSnapshot:
          snapshot.sourceRecurringNetRappen ?? undefined,
      },
      select: {
        id: true,
        currentChangeSchedules: {
          where: { status: "PENDING" },
          take: 1,
          select: { id: true },
        },
      },
    });
    if (source === null || source.currentChangeSchedules.length !== 0) {
      return billingFailure("CONFLICT");
    }
  }

  if (snapshot.changeKind === "DOWNGRADE") {
    if (
      sourceSubscriptionId === null ||
      snapshot.retainedDefaultOwnerId === null ||
      snapshot.retainedMembershipIds.length === 0
    ) {
      return billingFailure("CONFLICT");
    }
    const [retainedCount, retainedOwner] = await Promise.all([
      transaction.companyMembership.count({
        where: {
          id: { in: snapshot.retainedMembershipIds },
          companyId: order.companyId,
          status: "ACTIVE",
          removedAt: null,
        },
      }),
      transaction.companyMembership.findFirst({
        where: {
          companyId: order.companyId,
          userId: snapshot.retainedDefaultOwnerId,
          role: "OWNER",
          status: "ACTIVE",
          removedAt: null,
          id: { in: snapshot.retainedMembershipIds },
        },
        select: { id: true },
      }),
    ]);
    if (
      retainedCount !== snapshot.retainedMembershipIds.length ||
      retainedOwner === null
    ) {
      return billingFailure("CONFLICT");
    }
  }

  const status = snapshot.changeKind === "DOWNGRADE" ? "SCHEDULED" : "ACTIVE";
  if (snapshot.changeKind === "UPGRADE") {
    if (sourceSubscriptionId === null) return billingFailure("CONFLICT");
    const ended = await transaction.employerSubscription.updateMany({
      where: {
        id: sourceSubscriptionId,
        companyId: order.companyId,
        status: "ACTIVE",
      },
      data: { status: "EXPIRED", endedAt: now },
    });
    if (ended.count !== 1) return billingFailure("CONFLICT");
    await transaction.subscriptionEvent.create({
      data: {
        subscriptionId: sourceSubscriptionId,
        kind: "CHANGED",
        actorUserId: dependencies.actor.userId,
        reasonCode: "IMMEDIATE_UPGRADE",
        idempotencyKey: `subscription-superseded:${order.id}`,
        correlationId: dependencies.correlationId,
      },
    });
    await writeBillingAudit(transaction, dependencies, now, {
      action: "SUBSCRIPTION_CHANGED",
      capability: "EMPLOYER_SUBSCRIPTION_CHANGE",
      targetId: sourceSubscriptionId,
      targetType: "SUBSCRIPTION",
      reasonCode: "IMMEDIATE_UPGRADE",
    });
  }
  const subscription = await transaction.employerSubscription.create({
    data: {
      id: subscriptionId,
      companyId: order.companyId,
      planVersionId: plan.id,
      sourceOrderId: order.id,
      status,
      currentPeriodStart: fulfillmentTerms.value.periodStart,
      currentPeriodEnd: fulfillmentTerms.value.periodEnd,
      billingIntervalSnapshot: plan.billingInterval,
      termMonthsSnapshot: plan.termMonths,
      recurringNetRappenSnapshot: snapshot.targetRecurringNetRappen,
      monthlyEquivalentRappenSnapshot: plan.monthlyEquivalentRappen ?? 0,
      currencySnapshot: plan.currency,
      activatedAt: status === "ACTIVE" ? now : null,
    },
  });

  if (snapshot.changeKind === "DOWNGRADE") {
    if (
      sourceSubscriptionId === null ||
      snapshot.retainedDefaultOwnerId === null
    ) {
      return billingFailure("CONFLICT");
    }
    await transaction.subscriptionChangeSchedule.create({
      data: {
        companyId: order.companyId,
        currentSubscriptionId: sourceSubscriptionId,
        successorSubscriptionId: subscription.id,
        kind: "DOWNGRADE",
        status: "PENDING",
        effectiveAt: snapshot.fulfillmentPeriodStart,
        retainedMembershipIds: snapshot.retainedMembershipIds,
        retainedDefaultOwnerId: snapshot.retainedDefaultOwnerId,
        invitationRevocationScope: {
          policyVersion: BILLING_POLICY_V1.version,
          revokePendingInvitationsAtBoundary: true,
        },
        actorUserId: dependencies.actor.userId,
        idempotencyKey: `subscription-change:${order.id}`,
      },
    });
    await transaction.subscriptionEvent.create({
      data: {
        subscriptionId: sourceSubscriptionId,
        kind: "CHANGE_SCHEDULED",
        actorUserId: dependencies.actor.userId,
        reasonCode: "PAID_DOWNGRADE",
        idempotencyKey: `subscription-change-scheduled:${order.id}`,
        correlationId: dependencies.correlationId,
      },
    });
    await writeBillingAudit(transaction, dependencies, now, {
      action: "SUBSCRIPTION_CHANGED",
      capability: "EMPLOYER_SUBSCRIPTION_CHANGE",
      targetId: subscription.id,
      targetType: "SUBSCRIPTION",
      reasonCode: "DOWNGRADE_SCHEDULED",
    });
  } else {
    await transaction.subscriptionEvent.create({
      data: {
        subscriptionId: subscription.id,
        kind: "ACTIVATED",
        actorUserId: dependencies.actor.userId,
        reasonCode:
          snapshot.changeKind === "NEW" ? "NEW_PLAN" : "IMMEDIATE_UPGRADE",
        idempotencyKey: `subscription-activated:${order.id}`,
        correlationId: dependencies.correlationId,
      },
    });
    await grantPlanAllowances(
      transaction,
      order.companyId,
      subscription,
      {
        TALENT_CONTACT: fulfillmentTerms.value.talentContactAllowance,
        JOB_BOOST: fulfillmentTerms.value.jobBoostAllowance,
      },
      dependencies,
      now,
    );
    await writeBillingAudit(transaction, dependencies, now, {
      action:
        snapshot.changeKind === "NEW"
          ? "SUBSCRIPTION_ACTIVATED"
          : "SUBSCRIPTION_CHANGED",
      capability: "EMPLOYER_SUBSCRIPTION_CHANGE",
      targetId: subscription.id,
      targetType: "SUBSCRIPTION",
      reasonCode:
        snapshot.changeKind === "NEW" ? "NEW_PLAN" : "IMMEDIATE_UPGRADE",
    });
  }

  return billingSuccess({
    subscriptionId: subscription.id,
    creditGrantEntryId: null,
    additionalJobPermitId: null,
    importAccessGrantId: null,
    subscriptionStatus: status,
    subscriptionReason:
      snapshot.changeKind === "DOWNGRADE"
        ? "DOWNGRADED"
        : snapshot.changeKind === "NEW"
          ? "ACTIVATED"
          : "UPGRADED",
  });
}

/**
 * Settles time-sensitive ADR-028 terms against the injected payment clock.
 *
 * The append-only SubscriptionOrderSnapshot remains the quote offered at
 * checkout. NEW periods are anchored to the actual paidAt instant. UPGRADE
 * periods and allowances are recomputed at that same instant and are accepted
 * only while the immutable OrderLine still equals the correct rounded price;
 * otherwise confirmation fails before PAID and the caller must request a new
 * quote.
 */
async function derivePlanFulfillmentTerms(
  transaction: Prisma.TransactionClient,
  order: ConfirmOrderRow,
  line: ConfirmOrderRow["lines"][number],
  now: Date,
): Promise<BillingCommandResult<PlanFulfillmentTerms>> {
  const snapshot = line.subscriptionSnapshot;
  const plan = line.planVersion;
  if (
    snapshot === null ||
    plan === null ||
    line.quantity !== 1 ||
    plan.netPriceRappen === null ||
    plan.netPriceRappen <= 0
  ) {
    return billingFailure("CONFLICT");
  }
  const entitlements = decodePlanEntitlementsV1(plan.entitlements);
  if (!entitlements.ok) return billingFailure("CATALOG_UNAVAILABLE");

  if (snapshot.changeKind === "NEW") {
    if (
      snapshot.sourceSubscriptionId !== null ||
      line.unitNetRappen !== plan.netPriceRappen ||
      line.netRappen !== plan.netPriceRappen ||
      snapshot.quotedNetRappen !== plan.netPriceRappen
    ) {
      return billingFailure("CONFLICT");
    }
    const periodEnd = addZurichCalendarMonthsClampedV1(now, 1);
    if (!periodEnd.ok) return billingFailure("CONFLICT");
    return billingSuccess({
      periodStart: now,
      periodEnd: periodEnd.value,
      talentContactAllowance:
        entitlements.value.TALENT_CONTACT_ALLOWANCE,
      jobBoostAllowance: entitlements.value.JOB_BOOST_ALLOWANCE,
    });
  }

  if (snapshot.changeKind === "DOWNGRADE") {
    return billingSuccess({
      periodStart: snapshot.fulfillmentPeriodStart,
      periodEnd: snapshot.fulfillmentPeriodEnd,
      talentContactAllowance:
        entitlements.value.TALENT_CONTACT_ALLOWANCE,
      jobBoostAllowance: entitlements.value.JOB_BOOST_ALLOWANCE,
    });
  }

  if (
    snapshot.changeKind !== "UPGRADE" ||
    snapshot.sourceSubscriptionId === null ||
    snapshot.sourcePeriodStart === null ||
    snapshot.sourcePeriodEnd === null ||
    snapshot.sourceRecurringNetRappen === null
  ) {
    return billingFailure("CONFLICT");
  }
  const source = await transaction.employerSubscription.findFirst({
    where: {
      id: snapshot.sourceSubscriptionId,
      companyId: order.companyId,
      status: "ACTIVE",
      currentPeriodStart: snapshot.sourcePeriodStart,
      currentPeriodEnd: snapshot.sourcePeriodEnd,
      recurringNetRappenSnapshot: snapshot.sourceRecurringNetRappen,
      AND: [
        { currentPeriodStart: { lte: now } },
        { currentPeriodEnd: { gt: now } },
      ],
    },
    select: { id: true },
  });
  if (source === null) return billingFailure("CONFLICT");

  const prorated = computeProratedPlanDeltaV1({
    currentPlanNetRappen: snapshot.sourceRecurringNetRappen,
    targetPlanNetRappen: plan.netPriceRappen,
    period: {
      start: snapshot.sourcePeriodStart,
      end: snapshot.sourcePeriodEnd,
    },
    at: now,
  });
  const contacts = computeProratedAllowanceV1({
    targetAllowance: entitlements.value.TALENT_CONTACT_ALLOWANCE,
    period: {
      start: snapshot.sourcePeriodStart,
      end: snapshot.sourcePeriodEnd,
    },
    at: now,
  });
  const boosts = computeProratedAllowanceV1({
    targetAllowance: entitlements.value.JOB_BOOST_ALLOWANCE,
    period: {
      start: snapshot.sourcePeriodStart,
      end: snapshot.sourcePeriodEnd,
    },
    at: now,
  });
  if (
    !prorated.ok ||
    !contacts.ok ||
    !boosts.ok ||
    prorated.value.amountRappen < 1 ||
    line.unitNetRappen !== prorated.value.amountRappen ||
    line.netRappen !== prorated.value.amountRappen ||
    snapshot.prorationNumeratorSeconds !== prorated.value.remainingSeconds ||
    snapshot.prorationDenominatorSeconds !== prorated.value.periodSeconds ||
    snapshot.talentContactAllowanceSnapshot !== contacts.value.allowance ||
    snapshot.jobBoostAllowanceSnapshot !== boosts.value.allowance
  ) {
    return billingFailure("CONFLICT");
  }
  return billingSuccess({
    periodStart: now,
    periodEnd: snapshot.sourcePeriodEnd,
    talentContactAllowance: contacts.value.allowance,
    jobBoostAllowance: boosts.value.allowance,
  });
}

async function fulfillProductOrder(
  transaction: Prisma.TransactionClient,
  order: ConfirmOrderRow,
  line: ConfirmOrderRow["lines"][number],
  dependencies: BillingDependencies,
  now: Date,
): Promise<BillingCommandResult<FulfillmentResult>> {
  if (line.fulfillmentContext === "CONTACT_PACK") {
    return fulfillContactPackOrder(transaction, order, line, dependencies, now);
  }
  if (line.fulfillmentContext === "ADDITIONAL_JOB") {
    return fulfillAdditionalJobOrder(transaction, order, line, dependencies, now);
  }
  if (line.fulfillmentContext === "IMPORT_SETUP") {
    return fulfillImportSetupOrder(transaction, order, line, dependencies, now);
  }
  return billingFailure("FULFILLMENT_HANDLER_MISSING");
}

async function fulfillAdditionalJobOrder(
  transaction: Prisma.TransactionClient,
  order: ConfirmOrderRow,
  line: ConfirmOrderRow["lines"][number],
  dependencies: BillingDependencies,
  now: Date,
): Promise<BillingCommandResult<FulfillmentResult>> {
  const product = line.productVersion;
  if (
    product === null ||
    !isReleasedAdditionalJobProduct(product) ||
    line.targetJobId === null ||
    line.targetImportSourceId !== null ||
    line.targetImportSetupApprovalId !== null ||
    line.targetCreditType !== null ||
    line.quantity !== 1 ||
    line.unitNetRappen !== 12_900 ||
    line.netRappen !== 12_900
  ) {
    return billingFailure("FULFILLMENT_HANDLER_MISSING");
  }
  if (
    !(await authorizeAdditionalJobContext(transaction, {
      companyId: order.companyId,
      targetJobId: line.targetJobId,
      at: now,
    }))
  ) {
    return billingFailure("ADDITIONAL_JOB_NOT_ELIGIBLE");
  }
  const validTo = new Date(now.getTime() + 30 * 86_400_000);
  const permit = await transaction.additionalJobPermit.create({
    data: {
      id: randomUUID(),
      companyId: order.companyId,
      targetJobId: line.targetJobId,
      orderLineId: line.id,
      status: "ACTIVE",
      validFrom: now,
      validTo,
      activatedAt: now,
      consumedAt: null,
      revokedAt: null,
      createdAt: now,
    },
    select: { id: true },
  });
  await writeBillingAudit(transaction, dependencies, now, {
    action: "ORDER_PAID",
    capability: "EMPLOYER_BILLING_PRODUCT_FULFILL",
    targetId: order.id,
    targetType: "ORDER",
    reasonCode: "ADDITIONAL_JOB_PERMIT_GRANTED",
  });
  return billingSuccess({
    subscriptionId: null,
    creditGrantEntryId: null,
    additionalJobPermitId: permit.id,
    importAccessGrantId: null,
    subscriptionStatus: null,
    subscriptionReason: null,
  });
}

async function fulfillImportSetupOrder(
  transaction: Prisma.TransactionClient,
  order: ConfirmOrderRow,
  line: ConfirmOrderRow["lines"][number],
  dependencies: BillingDependencies,
  now: Date,
): Promise<BillingCommandResult<FulfillmentResult>> {
  const product = line.productVersion;
  if (
    product === null ||
    !isReleasedImportSetupProduct(product) ||
    line.targetImportSourceId === null ||
    line.targetImportSetupApprovalId === null ||
    line.targetJobId !== null ||
    line.targetCreditType !== null ||
    line.quantity !== 1 ||
    line.unitNetRappen !== 75_000 ||
    line.netRappen !== 75_000
  ) {
    return billingFailure("FULFILLMENT_HANDLER_MISSING");
  }
  const context = await authorizeImportSetupContext(transaction, {
    companyId: order.companyId,
    approvalId: line.targetImportSetupApprovalId,
    at: now,
    correlationId: dependencies.correlationId,
    expectedOrderLineId: line.id,
  });
  if (
    context === null ||
    context.importSourceId !== line.targetImportSourceId
  ) {
    return billingFailure("IMPORT_SETUP_NOT_ELIGIBLE");
  }
  const used = await transaction.importSetupApproval.updateMany({
    where: {
      id: context.approvalId,
      companyId: order.companyId,
      importSourceId: context.importSourceId,
      status: "APPROVED",
      validUntil: { gt: now },
      orderLineId: line.id,
    },
    data: { status: "USED" },
  });
  if (used.count !== 1) return billingFailure("IMPORT_SETUP_NOT_ELIGIBLE");
  const validTo = addZurichCalendarMonthsClampedV1(now, 12);
  if (!validTo.ok) return billingFailure("CONFLICT");
  const grant = await transaction.importAccessGrant.create({
    data: {
      id: randomUUID(),
      companyId: order.companyId,
      importSourceId: context.importSourceId,
      importSetupApprovalId: context.approvalId,
      orderLineId: line.id,
      status: "ACTIVE",
      validFrom: now,
      validTo: validTo.value,
      auditCorrelationId: dependencies.correlationId,
      revokedAt: null,
      createdAt: now,
    },
    select: { id: true },
  });
  await writeBillingAudit(transaction, dependencies, now, {
    action: "ORDER_PAID",
    capability: "EMPLOYER_BILLING_PRODUCT_FULFILL",
    targetId: order.id,
    targetType: "ORDER",
    reasonCode: "IMPORT_ACCESS_GRANTED",
  });
  return billingSuccess({
    subscriptionId: null,
    creditGrantEntryId: null,
    additionalJobPermitId: null,
    importAccessGrantId: grant.id,
    subscriptionStatus: null,
    subscriptionReason: null,
  });
}

async function fulfillContactPackOrder(
  transaction: Prisma.TransactionClient,
  order: ConfirmOrderRow,
  line: ConfirmOrderRow["lines"][number],
  dependencies: BillingDependencies,
  now: Date,
): Promise<BillingCommandResult<FulfillmentResult>> {
  const product = line.productVersion;
  if (
    product === null ||
    line.fulfillmentContext !== "CONTACT_PACK" ||
    !product.isPublic ||
    !product.isSelfService ||
    product.product.type !== "CONTACT_PACK" ||
    product.creditType !== "TALENT_CONTACT" ||
    product.creditAmount === null ||
    product.creditAmount <= 0
  ) {
    return billingFailure("FULFILLMENT_HANDLER_MISSING");
  }
  const entitlements = await getEffectiveEntitlements(
    order.companyId,
    now,
    createPrismaEntitlementRepository(transaction),
  );
  if (!entitlements.ok) return billingFailure("CATALOG_UNAVAILABLE");
  if (!entitlements.value.rights.TALENT_RADAR_ACCESS) {
    return billingFailure("TALENT_RADAR_REQUIRED");
  }
  if (!(await hasContactPackEligiblePlan(transaction, order.companyId, now))) {
    return billingFailure("TALENT_RADAR_REQUIRED");
  }
  const end = addZurichCalendarMonthsClampedV1(now, 12);
  if (!end.ok) return billingFailure("CONFLICT");
  const account = await transaction.creditAccount.upsert({
    where: {
      companyId_creditType_fundingSource_periodStart: {
        companyId: order.companyId,
        creditType: "TALENT_CONTACT",
        fundingSource: "PURCHASED_PACK",
        periodStart: now,
      },
    },
    create: {
      companyId: order.companyId,
      creditType: "TALENT_CONTACT",
      fundingSource: "PURCHASED_PACK",
      periodStart: now,
      periodEnd: end.value,
    },
    update: {},
  });
  const entry = await transaction.creditLedgerEntry.create({
    data: {
      accountId: account.id,
      fundingSource: "PURCHASED_PACK",
      kind: "GRANT",
      amount: product.creditAmount * line.quantity,
      sourceOrderLineId: line.id,
      validFrom: now,
      validTo: end.value,
      idempotencyKey: `contact-pack:${line.id}`,
      reasonCode: "PAID_CONTACT_PACK",
      actorUserId: order.createdByUserId,
    },
  });
  await writeBillingAudit(transaction, dependencies, now, {
    action: "CREDITS_GRANTED",
    capability: "EMPLOYER_BILLING_PAYMENT_CONFIRM",
    targetId: entry.id,
    targetType: "CREDIT_LEDGER_ENTRY",
    reasonCode: "PAID_CONTACT_PACK",
  });
  return billingSuccess({
    subscriptionId: null,
    creditGrantEntryId: entry.id,
    additionalJobPermitId: null,
    importAccessGrantId: null,
    subscriptionStatus: null,
    subscriptionReason: null,
  });
}

async function grantPlanAllowances(
  transaction: Prisma.TransactionClient,
  companyId: string,
  subscription: Readonly<{
    id: string;
    planVersionId: string;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
  }>,
  amounts: Readonly<Record<"TALENT_CONTACT" | "JOB_BOOST", number>>,
  dependencies: BillingDependencies,
  now: Date,
) {
  for (const creditType of ["TALENT_CONTACT", "JOB_BOOST"] as const) {
    const amount = amounts[creditType];
    if (amount <= 0) continue;
    const account = await transaction.creditAccount.upsert({
      where: {
        companyId_creditType_fundingSource_periodStart: {
          companyId,
          creditType,
          fundingSource: "PLAN_ALLOWANCE",
          periodStart: subscription.currentPeriodStart,
        },
      },
      create: {
        companyId,
        creditType,
        fundingSource: "PLAN_ALLOWANCE",
        periodStart: subscription.currentPeriodStart,
        periodEnd: subscription.currentPeriodEnd,
      },
      update: {},
    });
    const entry = await transaction.creditLedgerEntry.create({
      data: {
        accountId: account.id,
        fundingSource: "PLAN_ALLOWANCE",
        kind: "GRANT",
        amount,
        sourcePlanVersionId: subscription.planVersionId,
        sourceSubscriptionId: subscription.id,
        validFrom: subscription.currentPeriodStart,
        validTo: subscription.currentPeriodEnd,
        idempotencyKey: `plan-allowance:${subscription.id}:${creditType}`,
        reasonCode: "SUBSCRIPTION_ALLOWANCE",
      },
    });
    await writeBillingAudit(transaction, dependencies, now, {
      action: "CREDITS_GRANTED",
      capability: "EMPLOYER_SUBSCRIPTION_CHANGE",
      targetId: entry.id,
      targetType: "CREDIT_LEDGER_ENTRY",
      reasonCode: "SUBSCRIPTION_ALLOWANCE",
    });
  }
}

async function createPaidInvoice(
  transaction: Prisma.TransactionClient,
  order: ConfirmOrderRow,
  now: Date,
) {
  const adapter: InvoiceNumberTransaction = {
    async acquireInvoiceYearAdvisoryLock(namespace, year) {
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(
          ${namespace}::integer,
          ${year}::integer
        ) IS NULL AS "locked"
      `;
    },
    async findHighestInvoiceSequence(year) {
      const pattern = `^STH-${year}-[0-9]{5,}$`;
      const rows = await transaction.$queryRaw<
        readonly Readonly<{ sequence: bigint | null }>[]
      >`
        SELECT max(substring("number" from 10)::bigint) AS "sequence"
        FROM "Invoice"
        WHERE "number" ~ ${pattern}
      `;
      const value = rows[0]?.sequence ?? null;
      if (value === null) return null;
      const numeric = Number(value);
      if (!Number.isSafeInteger(numeric)) throw new RangeError("Invoice sequence overflow.");
      return numeric;
    },
  };
  const allocated = await allocateInvoiceNumber(
    now,
    { transaction: async (callback) => callback(adapter) },
    async (_numberTransaction, number) =>
      transaction.invoice.create({
        data: {
          orderId: order.id,
          companyId: order.companyId,
          number,
          status: "DRAFT",
          billingLegalNameSnapshot: order.billingLegalNameSnapshot,
          billingContactEmailSnapshot: order.billingContactEmailSnapshot,
          billingStreetSnapshot: order.billingStreetSnapshot,
          billingPostalCodeSnapshot: order.billingPostalCodeSnapshot,
          billingCitySnapshot: order.billingCitySnapshot,
          billingCountryCodeSnapshot: order.billingCountryCodeSnapshot,
          billingUidSnapshot: order.billingUidSnapshot,
          billingVatNumberSnapshot: order.billingVatNumberSnapshot,
          currency: order.currency,
          netTotalRappen: order.netTotalRappen,
          vatTotalRappen: order.vatTotalRappen,
          totalRappen: order.totalRappen,
          dueAt: now,
          lines: {
            create: order.lines.map((line, sortOrder) => ({
              orderLineId: line.id,
              sortOrder,
              descriptionSnapshot: line.descriptionSnapshot,
              quantity: line.quantity,
              unitNetRappen: line.unitNetRappen,
              netRappen: line.netRappen,
              taxRateBasisPoints: line.taxRateBasisPoints,
              vatRappen: line.vatRappen,
              totalRappen: line.totalRappen,
              currency: line.currency,
            })),
          },
        },
        select: { id: true, number: true },
      }),
  );
  const issued = await transaction.invoice.updateMany({
    where: { id: allocated.value.id, status: "DRAFT" },
    data: { status: "ISSUED", issuedAt: now },
  });
  if (issued.count !== 1) throw new BillingDomainRollbackError("CONFLICT");
  const paid = await transaction.invoice.updateMany({
    where: { id: allocated.value.id, status: "ISSUED" },
    data: { status: "PAID", paidAt: now },
  });
  if (paid.count !== 1) throw new BillingDomainRollbackError("CONFLICT");
  return allocated.value;
}

/**
 * User-facing notifications are projections of the already committed Billing
 * transaction. Their deterministic dedupe keys make retries safe without ever
 * rolling a paid Order back because a notification projection was unavailable.
 */
async function sendBillingNotifications(
  database: BillingDependencies["database"],
  context: EmailContext,
): Promise<boolean> {
  try {
    const port = createPrismaNotificationPort(database);
    await writeNotificationExactlyOnce(port, {
      recipientUserId: context.recipientUserId,
      kind: "ORDER_PAID",
      dedupeKey: `billing:${context.orderId}:paid`,
      payload: { orderId: context.orderId, status: "PAID" },
    });
    await writeNotificationExactlyOnce(port, {
      recipientUserId: context.recipientUserId,
      kind: "INVOICE_ISSUED",
      dedupeKey: `billing:${context.orderId}:invoice`,
      payload: { invoiceId: context.invoiceId, status: "ISSUED" },
    });
    if (
      context.subscriptionId !== null &&
      (context.subscriptionStatus === "SCHEDULED" ||
        context.subscriptionStatus === "ACTIVE") &&
      (context.subscriptionReason === "ACTIVATED" ||
        context.subscriptionReason === "UPGRADED" ||
        context.subscriptionReason === "DOWNGRADED")
    ) {
      await writeNotificationExactlyOnce(port, {
        recipientUserId: context.recipientUserId,
        kind: "SUBSCRIPTION_CHANGED",
        dedupeKey: `billing:${context.orderId}:subscription`,
        payload: {
          subscriptionId: context.subscriptionId,
          status: context.subscriptionStatus,
          reasonCode: context.subscriptionReason,
        },
      });
    }
    return true;
  } catch {
    return false;
  }
}

async function sendBillingEmails(
  provider: EmailProvider,
  context: EmailContext,
): Promise<boolean> {
  const messages: Readonly<{
    templateKey: EmailTemplateKey;
    data: Record<string, unknown>;
  }>[] = [
    {
      templateKey: "payment_received",
      data: {
        orderReference: context.orderId,
        idempotencyKey: `billing:${context.orderId}:payment`,
      },
    },
    {
      templateKey: "invoice_issued",
      data: {
        invoiceNumber: context.invoiceNumber,
        idempotencyKey: `billing:${context.orderId}:invoice`,
      },
    },
  ];
  if (context.creditGrantEntryId !== null) {
    messages.push({
      templateKey: "credits_granted",
      data: {
        creditCount: context.creditCount ?? 0,
        creditTypeLabel: "Talent-Kontakte",
        idempotencyKey: `billing:${context.orderId}:credits`,
      },
    });
  } else if (context.subscriptionStatus === "ACTIVE") {
    messages.push({
      templateKey: "subscription_activated",
      data: {
        planName: context.planName ?? "Plan",
        idempotencyKey: `billing:${context.orderId}:subscription`,
      },
    });
  }
  let recorded = true;
  for (const message of messages) {
    try {
      const rendered = renderEmailTemplate(message.templateKey, message.data);
      await provider.send({
        to: context.billingEmail,
        templateKey: message.templateKey,
        data: message.data,
        subject: rendered.subject,
      });
    } catch {
      recorded = false;
    }
  }
  return recorded;
}

function buildPaidReplay(order: ConfirmOrderRow): EmailContext | null {
  if (order.invoice === null || order.paymentEvents.length !== 1) return null;
  const line = order.lines[0];
  if (line === undefined || order.lines.length !== 1) return null;
  return {
    orderId: order.id,
    invoiceId: order.invoice.id,
    invoiceNumber: order.invoice.number,
    subscriptionId: order.subscription?.id ?? null,
    creditGrantEntryId: line.creditLedgerEntries[0]?.id ?? null,
    additionalJobPermitId: line.additionalJobPermit?.id ?? null,
    importAccessGrantId: line.importAccessGrant?.id ?? null,
    recipientUserId: order.createdByUserId,
    subscriptionStatus: order.subscription?.status ?? null,
    subscriptionReason:
      order.subscription === null
        ? null
        : line.subscriptionSnapshot?.changeKind === "DOWNGRADE"
          ? "DOWNGRADED"
          : line.subscriptionSnapshot?.changeKind === "UPGRADE"
            ? "UPGRADED"
            : "ACTIVATED",
    billingEmail: order.billingContactEmailSnapshot,
    planName: line.planVersion?.plan.name ?? null,
    creditCount:
      line.productVersion?.creditAmount === null ||
      line.productVersion?.creditAmount === undefined
        ? null
        : line.productVersion.creditAmount * line.quantity,
  };
}

async function loadPlanVersion(
  transaction: Prisma.TransactionClient,
  slug: "starter" | "pro",
  now: Date,
) {
  const rows = await transaction.planVersion.findMany({
    where: {
      status: "ACTIVE",
      isPublic: true,
      isSelfService: true,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
      plan: { code: slug.toUpperCase() },
    },
    take: 2,
    select: {
      id: true,
      priceMode: true,
      billingInterval: true,
      termMonths: true,
      netPriceRappen: true,
      monthlyEquivalentRappen: true,
      currency: true,
      plan: { select: { code: true, name: true } },
      entitlements: {
        select: {
          key: true,
          valueType: true,
          booleanValue: true,
          integerValue: true,
          analyticsLevelValue: true,
        },
      },
    },
  });
  return rows.length === 1 ? rows[0]! : null;
}

async function loadProductVersion(
  transaction: Prisma.TransactionClient,
  slug: string,
  now: Date,
) {
  const rows = await transaction.productVersion.findMany({
    where: {
      status: "ACTIVE",
      requiresLegalReview: false,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
      product: { code: slug },
    },
    take: 2,
    select: {
      id: true,
      netPriceRappen: true,
      currency: true,
      durationDays: true,
      creditType: true,
      creditAmount: true,
      isPublic: true,
      isSelfService: true,
      status: true,
      validFrom: true,
      validTo: true,
      releaseDecisionId: true,
      releaseDecision: {
        select: {
          id: true,
          productId: true,
          releaseTier: true,
          allowsPublic: true,
          allowsSelfService: true,
          reasonCode: true,
        },
      },
      product: { select: { id: true, code: true, name: true, type: true } },
    },
  });
  return rows.length === 1 ? rows[0]! : null;
}

function isReleasedAdditionalJobProduct(product: ProductVersionQuoteRow) {
  return (
    product.product.code === "additional-job-30d" &&
    product.product.type === "ADDITIONAL_JOB" &&
    product.netPriceRappen === 12_900 &&
    product.durationDays === 30 &&
    product.creditType === null &&
    product.creditAmount === null &&
    product.isPublic &&
    product.isSelfService &&
    product.releaseDecisionId !== null &&
    product.releaseDecision?.id === product.releaseDecisionId &&
    product.releaseDecision.productId === product.product.id &&
    product.releaseDecision.releaseTier === "P1" &&
    product.releaseDecision.allowsPublic &&
    product.releaseDecision.allowsSelfService &&
    product.releaseDecision.reasonCode.trim().length > 0
  );
}

function isProductVersionEffective(
  product: Readonly<{
    status: string;
    validFrom: Date;
    validTo: Date | null;
  }>,
  at: Date,
) {
  return (
    product.status === "ACTIVE" &&
    product.validFrom.getTime() <= at.getTime() &&
    (product.validTo === null || at.getTime() < product.validTo.getTime())
  );
}

function isReleasedImportSetupProduct(product: ProductVersionQuoteRow) {
  return (
    product.product.code === "import-setup" &&
    product.product.type === "IMPORT_SETUP" &&
    product.netPriceRappen === 75_000 &&
    product.durationDays === null &&
    product.creditType === null &&
    product.creditAmount === null &&
    !product.isPublic &&
    !product.isSelfService &&
    product.releaseDecisionId !== null &&
    product.releaseDecision?.id === product.releaseDecisionId &&
    product.releaseDecision.productId === product.product.id &&
    product.releaseDecision.releaseTier === "P1" &&
    !product.releaseDecision.allowsPublic &&
    !product.releaseDecision.allowsSelfService &&
    product.releaseDecision.reasonCode.trim().length > 0
  );
}

async function authorizeAdditionalJobContext(
  transaction: Prisma.TransactionClient,
  input: Readonly<{ companyId: string; targetJobId: string; at: Date }>,
) {
  const validTo = new Date(input.at.getTime() + 30 * 86_400_000);
  const [subscriptions, job, overlappingPermit] = await Promise.all([
    loadEffectiveP1Subscription(transaction, input.companyId, input.at),
    transaction.job.findFirst({
      where: {
        id: input.targetJobId,
        companyId: input.companyId,
        status: "APPROVED",
        publishedAt: null,
        publishedRevisionId: null,
        company: { status: "ACTIVE" },
      },
      select: {
        id: true,
        currentRevisionId: true,
        currentRevision: {
          select: {
            id: true,
            approvedAt: true,
            rejectedAt: true,
            validThrough: true,
          },
        },
      },
    }),
    transaction.additionalJobPermit.findFirst({
      where: {
        OR: [
          { companyId: input.companyId },
          { targetJobId: input.targetJobId },
        ],
        status: { in: ["SCHEDULED", "ACTIVE"] },
        revokedAt: null,
        validFrom: { lt: validTo },
        validTo: { gt: input.at },
      },
      select: { id: true },
    }),
  ]);
  if (subscriptions.length !== 1 || subscriptions[0]?.planVersion.plan.code !== "STARTER") {
    return false;
  }
  const revision = job?.currentRevision;
  if (job === null || revision === null || revision === undefined) return false;
  return (
    job.currentRevisionId === revision.id &&
    revision.approvedAt !== null &&
    revision.rejectedAt === null &&
    revision.validThrough !== null &&
    revision.validThrough.getTime() > input.at.getTime() &&
    revision.validThrough.getTime() <= validTo.getTime() &&
    overlappingPermit === null
  );
}

async function authorizeImportSetupContext(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    companyId: string;
    approvalId: string;
    at: Date;
    correlationId: string;
    expectedOrderLineId?: string;
  }>,
): Promise<Readonly<{ approvalId: string; importSourceId: string }> | null> {
  const subscriptions = await loadEffectiveP1Subscription(
    transaction,
    input.companyId,
    input.at,
  );
  if (subscriptions.length !== 1) return null;
  const subscription = subscriptions[0]!;
  const planCode = subscription.planVersion.plan.code;
  if (
    (planCode !== "BUSINESS" && planCode !== "ENTERPRISE_CONTRACT") ||
    (planCode === "ENTERPRISE_CONTRACT" &&
      (subscription.planVersion.priceMode !== "CONTRACT" ||
        subscription.planVersion.isPublic ||
        subscription.planVersion.isSelfService))
  ) {
    return null;
  }
  const entitlements = await getEffectiveEntitlements(
    input.companyId,
    input.at,
    createPrismaEntitlementRepository(transaction),
  );
  if (
    !entitlements.ok ||
    !entitlements.value.planRights.EMPLOYER_IMPORT_ACCESS ||
    entitlements.value.source.planSlug.toUpperCase() !== planCode
  ) {
    return null;
  }
  const approval = await transaction.importSetupApproval.findFirst({
    where: {
      id: input.approvalId,
      companyId: input.companyId,
      status: "APPROVED",
      validUntil: { gt: input.at },
      importSource: { isActive: true },
    },
    select: {
      id: true,
      importSourceId: true,
      orderLineId: true,
      orderLine: {
        select: {
          id: true,
          targetImportSetupApprovalId: true,
          order: {
            select: {
              id: true,
              companyId: true,
              status: true,
              expiresAt: true,
            },
          },
        },
      },
    },
  });
  if (approval === null) return null;
  if (input.expectedOrderLineId !== undefined) {
    if (
      approval.orderLineId !== input.expectedOrderLineId ||
      approval.orderLine?.id !== input.expectedOrderLineId ||
      approval.orderLine.targetImportSetupApprovalId !== approval.id ||
      approval.orderLine.order.companyId !== input.companyId ||
      (approval.orderLine.order.status !== "PENDING" &&
        approval.orderLine.order.status !== "PAID")
    ) {
      return null;
    }
  } else if (approval.orderLineId !== null) {
    const reservation = approval.orderLine;
    if (
      reservation === null ||
      reservation.targetImportSetupApprovalId !== approval.id ||
      reservation.order.companyId !== input.companyId
    ) {
      return null;
    }
    let terminal =
      reservation.order.status === "FAILED" ||
      reservation.order.status === "CANCELLED" ||
      reservation.order.status === "EXPIRED";
    if (
      reservation.order.status === "PENDING" &&
      reservation.order.expiresAt !== null &&
      reservation.order.expiresAt.getTime() <= input.at.getTime()
    ) {
      const expired = await expirePendingOrder(transaction, {
        companyId: input.companyId,
        correlationId: input.correlationId,
        now: input.at,
        orderId: reservation.order.id,
      });
      if (!expired) return null;
      terminal = true;
    }
    if (!terminal) return null;
    const released = await transaction.importSetupApproval.updateMany({
      where: {
        id: approval.id,
        companyId: input.companyId,
        status: "APPROVED",
        orderLineId: reservation.id,
      },
      data: { orderLineId: null },
    });
    if (released.count !== 1) return null;
  }
  const validTo = addZurichCalendarMonthsClampedV1(input.at, 12);
  if (!validTo.ok) return null;
  const overlappingGrant = await transaction.importAccessGrant.findFirst({
    where: {
      companyId: input.companyId,
      importSourceId: approval.importSourceId,
      status: { in: ["SCHEDULED", "ACTIVE"] },
      revokedAt: null,
      validFrom: { lt: validTo.value },
      validTo: { gt: input.at },
    },
    select: { id: true },
  });
  return overlappingGrant === null
    ? Object.freeze({
        approvalId: approval.id,
        importSourceId: approval.importSourceId,
      })
    : null;
}

function loadEffectiveP1Subscription(
  transaction: Prisma.TransactionClient,
  companyId: string,
  at: Date,
) {
  return transaction.employerSubscription.findMany({
    where: {
      companyId,
      status: { in: ["ACTIVE", "CANCELLING"] },
      currentPeriodStart: { lte: at },
      currentPeriodEnd: { gt: at },
    },
    take: 2,
    select: {
      id: true,
      planVersion: {
        select: {
          isPublic: true,
          isSelfService: true,
          priceMode: true,
          plan: { select: { code: true } },
        },
      },
    },
  });
}

async function hasContactPackEligiblePlan(
  transaction: Prisma.TransactionClient,
  companyId: string,
  at: Date,
) {
  const subscriptions = await loadEffectiveP1Subscription(
    transaction,
    companyId,
    at,
  );
  if (subscriptions.length !== 1) return false;
  const planVersion = subscriptions[0]!.planVersion;
  return isContactPackPlanEligibleV1({
    code: planVersion.plan.code,
    priceMode: planVersion.priceMode,
    isPublic: planVersion.isPublic,
    isSelfService: planVersion.isSelfService,
  });
}

async function loadCurrentTaxRate(
  transaction: Prisma.TransactionClient,
  now: Date,
) {
  const rows = await transaction.taxRateVersion.findMany({
    where: {
      jurisdiction: "CH",
      taxType: "MWST_STANDARD_DEMO",
      reviewStatus: "APPROVED",
      reviewedAt: { not: null },
      reviewedByUserId: { not: null },
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
    },
    take: 2,
    select: { id: true, rateBasisPoints: true },
  });
  return rows.length === 1 ? rows[0]! : null;
}

const confirmOrderInclude = {
  company: { select: { dataProvenance: true } },
  createdBy: { select: { dataProvenance: true } },
  lines: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      subscriptionSnapshot: true,
      planVersion: {
        include: { plan: true, entitlements: true },
      },
      productVersion: { include: { product: true, releaseDecision: true } },
      additionalJobPermit: { select: { id: true } },
      importAccessGrant: { select: { id: true } },
      creditLedgerEntries: {
        where: { kind: "GRANT" },
        take: 1,
        select: { id: true },
      },
    },
  },
  invoice: { select: { id: true, number: true } },
  subscription: { select: { id: true, status: true } },
  paymentEvents: {
    where: { kind: "PAID" },
    select: { id: true },
  },
} satisfies Prisma.OrderInclude;

type ConfirmOrderRow = Prisma.OrderGetPayload<{
  include: typeof confirmOrderInclude;
}>;

async function authorizeMockPaymentConfirmation(
  orderId: string,
  dependencies: BillingDependencies,
  now: Date,
): Promise<
  BillingCommandResult<
    Readonly<{
      requiresProviderConfirmation: boolean;
      providerReference: string | null;
    }>
  >
> {
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      if (!(await hasCurrentBillingMembership(transaction, dependencies))) {
        return billingFailure("NOT_FOUND");
      }
      const order = await loadOrderForConfirmation(
        transaction,
        orderId,
        dependencies.actor.companyId,
      );
      if (order === null) return billingFailure("NOT_FOUND");
      if (order.provider !== "MOCK") return billingFailure("NOT_FOUND");
      if (order.status === "PAID") {
        return billingSuccess({
          requiresProviderConfirmation: false,
          providerReference: order.providerReference,
        });
      }
      if (order.status !== "PENDING") {
        return billingFailure("ORDER_NOT_PENDING");
      }
      if (order.expiresAt !== null && order.expiresAt.getTime() <= now.getTime()) {
        await expirePendingOrder(transaction, {
          companyId: order.companyId,
          correlationId: dependencies.correlationId,
          now,
          orderId: order.id,
        });
        return billingFailure("ORDER_EXPIRED");
      }
      const line = order.lines.length === 1 ? order.lines[0] : undefined;
      if (line === undefined) return billingFailure("CONFLICT");
      if (line.planVersionId !== null) {
        if (!canManagePlan(dependencies.actor.membershipRole)) {
          return billingFailure("FORBIDDEN");
        }
        const fulfillmentTerms = await derivePlanFulfillmentTerms(
          transaction,
          order,
          line,
          now,
        );
        if (!fulfillmentTerms.ok) return fulfillmentTerms;
      } else {
        const product = line.productVersion;
        if (product === null || !isProductVersionEffective(product, now)) {
          return billingFailure("PRODUCT_NOT_AVAILABLE");
        }
        if (line.fulfillmentContext === "CONTACT_PACK") {
          if (
            product.product.type !== "CONTACT_PACK" ||
            !product.isPublic ||
            !product.isSelfService ||
            product.creditType !== "TALENT_CONTACT" ||
            product.creditAmount === null ||
            product.creditAmount <= 0
          ) {
            return billingFailure("FULFILLMENT_HANDLER_MISSING");
          }
          const entitlements = await getEffectiveEntitlements(
            order.companyId,
            now,
            createPrismaEntitlementRepository(transaction),
          );
          if (!entitlements.ok) return billingFailure("CATALOG_UNAVAILABLE");
          if (!entitlements.value.rights.TALENT_RADAR_ACCESS) {
            return billingFailure("TALENT_RADAR_REQUIRED");
          }
          if (!(await hasContactPackEligiblePlan(transaction, order.companyId, now))) {
            return billingFailure("TALENT_RADAR_REQUIRED");
          }
        } else if (line.fulfillmentContext === "ADDITIONAL_JOB") {
          if (
            !isReleasedAdditionalJobProduct(product) ||
            line.targetJobId === null ||
            !(await authorizeAdditionalJobContext(transaction, {
              companyId: order.companyId,
              targetJobId: line.targetJobId,
              at: now,
            }))
          ) {
            return billingFailure("ADDITIONAL_JOB_NOT_ELIGIBLE");
          }
        } else if (line.fulfillmentContext === "IMPORT_SETUP") {
          if (
            !isReleasedImportSetupProduct(product) ||
            line.targetImportSourceId === null ||
            line.targetImportSetupApprovalId === null
          ) {
            return billingFailure("IMPORT_SETUP_NOT_ELIGIBLE");
          }
          const context = await authorizeImportSetupContext(transaction, {
            companyId: order.companyId,
            approvalId: line.targetImportSetupApprovalId,
            at: now,
            correlationId: dependencies.correlationId,
            expectedOrderLineId: line.id,
          });
          if (
            context === null ||
            context.importSourceId !== line.targetImportSourceId
          ) {
            return billingFailure("IMPORT_SETUP_NOT_ELIGIBLE");
          }
        } else {
          return billingFailure("FULFILLMENT_HANDLER_MISSING");
        }
      }
      return billingSuccess({
        requiresProviderConfirmation: true,
        providerReference: null,
      });
    });
  } catch {
    return billingFailure("WRITE_FAILED");
  }
}

async function loadOrderForConfirmation(
  transaction: Prisma.TransactionClient,
  orderId: string,
  companyId: string,
): Promise<ConfirmOrderRow | null> {
  return transaction.order.findFirst({
    where: { id: orderId, companyId, provider: "MOCK" },
    include: confirmOrderInclude,
  });
}

type FulfillmentResult = Readonly<{
  subscriptionId: string | null;
  creditGrantEntryId: string | null;
  additionalJobPermitId: string | null;
  importAccessGrantId: string | null;
  subscriptionStatus: "SCHEDULED" | "ACTIVE" | null;
  subscriptionReason:
    | "DOWNGRADED"
    | "ACTIVATED"
    | "UPGRADED"
    | null;
}>;

type EmailContext = Readonly<{
    orderId: string;
    invoiceId: string;
    invoiceNumber: string;
    subscriptionId: string | null;
    creditGrantEntryId: string | null;
    additionalJobPermitId: string | null;
    importAccessGrantId: string | null;
    recipientUserId: string;
    subscriptionStatus: string | null;
    subscriptionReason: string | null;
    billingEmail: string;
    planName: string | null;
    creditCount: number | null;
  }>;

async function hasCurrentBillingMembership(
  transaction: Prisma.TransactionClient,
  dependencies: BillingDependencies,
) {
  return (
    (await transaction.companyMembership.findFirst({
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
    })) !== null
  );
}

async function lockCompanyBillingScope(
  transaction: Prisma.TransactionClient,
  companyId: string,
) {
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(
      ${COMPANY_BILLING_LOCK_NAMESPACE}::integer,
      hashtext(${companyId})::integer
    ) IS NULL AS "locked"
  `;
  await transaction.$queryRaw`
    SELECT "id" FROM "Company" WHERE "id" = ${companyId}::uuid FOR UPDATE
  `;
}

async function lockCheckoutIdempotencyKey(
  transaction: Prisma.TransactionClient,
  idempotencyKey: string,
) {
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(
      ${CHECKOUT_IDEMPOTENCY_LOCK_NAMESPACE}::integer,
      hashtext(${idempotencyKey})::integer
    ) IS NULL AS "locked"
  `;
}

async function recordCheckoutStartedAnalytics(
  dependencies: BillingDependencies,
  orderId: string,
  now: Date,
): Promise<BillingCommandResult<Readonly<{ recorded: true }>>> {
  return runSerializableRetry(async () =>
    dependencies.database.$transaction(
      async (transaction) => {
        await lockCompanyBillingScope(
          transaction,
          dependencies.actor.companyId,
        );
        await transaction.$queryRaw`
          SELECT "id" FROM "Order"
          WHERE "id" = ${orderId}::uuid
          FOR UPDATE
        `;
        const order = await loadOrderForConfirmation(
          transaction,
          orderId,
          dependencies.actor.companyId,
        );
        if (order === null || order.provider !== "MOCK") {
          return billingFailure("NOT_FOUND");
        }
        if (order.status !== "PENDING" && order.status !== "PAID") {
          return billingFailure("ORDER_NOT_PENDING");
        }
        const line = order.lines[0];
        if (order.lines.length !== 1 || line === undefined) {
          return billingFailure("CONFLICT");
        }
        await writeCheckoutAnalyticsEvent(
          transaction,
          "CHECKOUT_STARTED",
          order,
          line,
          now,
        );
        return billingSuccess({ recorded: true as const });
      },
      { isolationLevel: "Serializable" },
    ),
  );
}

async function writeCheckoutAnalyticsEvent(
  transaction: Prisma.TransactionClient,
  kind: "CHECKOUT_STARTED" | "CHECKOUT_COMPLETED",
  order: ConfirmOrderRow,
  line: ConfirmOrderRow["lines"][number],
  occurredAt: Date,
) {
  const catalogProperties =
    line.planVersion === null
      ? line.productVersion === null
        ? null
        : { productSlug: line.productVersion.product.code }
      : { planSlug: line.planVersion.plan.code.toLocaleLowerCase("en-US") };
  if (catalogProperties === null) {
    throw new BillingDomainRollbackError("CONFLICT");
  }

  await trackAnalyticsEventV1(
    {
      schemaVersion: "1",
      producerEventId: `${kind}:${order.id}`,
      occurredAt,
      kind,
      pseudonymousActorId: checkoutAnalyticsPseudonym(
        "actor",
        order.createdByUserId,
      ),
      pseudonymousSessionId: checkoutAnalyticsPseudonym("order", order.id),
      companyId: order.companyId,
      properties: {
        ...catalogProperties,
        amountRappen: order.netTotalRappen,
      },
    },
    {
      producer: "billing-checkout",
      productAnalyticsEnabled: false,
      provenance: {
        actor: order.createdBy.dataProvenance,
        company: order.company.dataProvenance,
      },
    },
    transactionAnalyticsWriter(transaction),
  );
}

function checkoutAnalyticsPseudonym(scope: "actor" | "order", value: string) {
  const digest = createHash("sha256")
    .update("billing-checkout-analytics-v1", "utf8")
    .update(CHECKOUT_HASH_SEPARATOR, "utf8")
    .update(scope, "utf8")
    .update(CHECKOUT_HASH_SEPARATOR, "utf8")
    .update(value, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `billing-${scope}-${digest}`;
}

function transactionAnalyticsWriter(
  transaction: Prisma.TransactionClient,
): AnalyticsWriter {
  return Object.freeze({
    async create(record: AnalyticsWriteRecord) {
      const result = await transaction.analyticsEvent.createMany({
        data: record,
        skipDuplicates: true,
      });
      return result.count === 0 ? "DUPLICATE" : "CREATED";
    },
    async expire(retainUntilInclusive: Date) {
      return (
        await transaction.analyticsEvent.deleteMany({
          where: { retainUntil: { lte: retainUntilInclusive } },
        })
      ).count;
    },
  });
}

async function recordCheckoutProviderFailure(
  dependencies: BillingDependencies,
  orderId: string,
  now: Date,
) {
  try {
    await dependencies.database.$transaction(
      async (transaction) => {
        await lockCompanyBillingScope(
          transaction,
          dependencies.actor.companyId,
        );
        const importReservation = await transaction.orderLine.findFirst({
          where: {
            orderId,
            fulfillmentContext: "IMPORT_SETUP",
            targetImportSetupApprovalId: { not: null },
          },
          select: { id: true, targetImportSetupApprovalId: true },
        });
        const failed = await transaction.order.updateMany({
          where: {
            id: orderId,
            companyId: dependencies.actor.companyId,
            status: "PENDING",
          },
          data: { status: "FAILED", failedAt: now },
        });
        if (failed.count !== 1) return;
        if (
          importReservation !== null &&
          importReservation.targetImportSetupApprovalId !== null
        ) {
          const released = await transaction.importSetupApproval.updateMany({
            where: {
              id: importReservation.targetImportSetupApprovalId,
              companyId: dependencies.actor.companyId,
              status: "APPROVED",
              orderLineId: importReservation.id,
            },
            data: { orderLineId: null },
          });
          if (released.count !== 1) {
            throw new BillingDomainRollbackError("CONFLICT");
          }
        }
        await transaction.paymentEvent.create({
          data: {
            orderId,
            provider: "MOCK",
            kind: "FAILED",
            idempotencyKey: `checkout-failed:${orderId}`,
            createdAt: now,
            payload: {
              schemaVersion: "1",
              reasonCode: "MOCK_CHECKOUT_PROVIDER_FAILED",
              externalChargeClaimed: false,
            },
          },
        });
        await writeBillingAudit(transaction, dependencies, now, {
          action: "ORDER_FAILED",
          capability: "EMPLOYER_BILLING_CHECKOUT_CREATE",
          targetId: orderId,
          targetType: "ORDER",
          reasonCode: "MOCK_CHECKOUT_PROVIDER_FAILED",
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch {
    // The persisted PENDING Order remains safe to retry with the same key if
    // failure projection itself is temporarily unavailable.
  }
}

async function safeCreateProviderCheckout(
  dependencies: BillingDependencies,
  orderId: string,
  idempotencyKey: string,
) {
  try {
    const session = await dependencies.paymentProvider.createCheckout({
      orderId,
      idempotencyKey,
      successUrl: `/employer/billing/success?order=${encodeURIComponent(orderId)}`,
      cancelUrl: "/employer/billing?checkout=cancelled",
    });
    return session.provider === "MOCK" && session.orderId === orderId
      ? session
      : null;
  } catch {
    return null;
  }
}

function checkoutRequestFingerprint(companyId: string, intent: CheckoutIntent) {
  const canonical =
    intent.kind === "PLAN"
      ? [
          "PLAN",
          intent.planSlug,
          "1",
          [...(intent.retainedMembershipIds ?? [])].sort().join(","),
        ].join(CHECKOUT_HASH_SEPARATOR)
      : [
          "PRODUCT",
          intent.productSlug,
          String(intent.quantity),
          "targetJobId" in intent ? intent.targetJobId : "",
          "importSetupApprovalId" in intent
            ? intent.importSetupApprovalId
            : "",
        ].join(CHECKOUT_HASH_SEPARATOR);
  return createHash("sha256")
    .update("billing-checkout-intent-v1", "utf8")
    .update(CHECKOUT_HASH_SEPARATOR, "utf8")
    .update(companyId, "utf8")
    .update(CHECKOUT_HASH_SEPARATOR, "utf8")
    .update(canonical, "utf8")
    .digest("hex");
}

function isCompleteSwissBillingProfile(profile: Readonly<{
  legalName: string;
  billingContactEmail: string;
  street: string;
  postalCode: string;
  city: string;
  countryCode: string;
}>) {
  return (
    profile.countryCode === "CH" &&
    profile.legalName.trim().length >= 2 &&
    profile.billingContactEmail.includes("@") &&
    profile.street.trim().length >= 3 &&
    /^\d{4}$/u.test(profile.postalCode) &&
    profile.city.trim().length >= 2
  );
}

/**
 * Projects the half-open checkout TTL boundary exactly once. Expiry is a
 * first-class Order transition, so the state change and its SYSTEM audit row
 * deliberately share one transaction.
 */
async function expirePendingOrder(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    companyId: string;
    correlationId: string;
    now: Date;
    orderId: string;
  }>,
) {
  const expired = await transaction.order.updateMany({
    where: {
      id: input.orderId,
      companyId: input.companyId,
      status: "PENDING",
      expiresAt: { lte: input.now },
    },
    data: { status: "EXPIRED" },
  });
  if (expired.count !== 1) return false;
  await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
    action: "ORDER_EXPIRED",
    actorKind: "SYSTEM",
    capability: "BILLING_ORDER_EXPIRY_PROJECT",
    companyId: input.companyId,
    correlationId: input.correlationId,
    reasonCode: "ORDER_TTL_ELAPSED",
    result: "SUCCEEDED",
    retainUntil: new Date(
      input.now.getTime() + BILLING_AUDIT_RETENTION_MS,
    ),
    targetId: input.orderId,
    targetType: "ORDER",
  });
  return true;
}

async function writeBillingAudit(
  transaction: Prisma.TransactionClient,
  dependencies: BillingDependencies,
  now: Date,
  input: Readonly<{
    action:
      | "CHECKOUT_CREATED"
      | "ORDER_PAID"
      | "ORDER_FAILED"
      | "INVOICE_ISSUED"
      | "INVOICE_PAID"
      | "SUBSCRIPTION_ACTIVATED"
      | "SUBSCRIPTION_CHANGED"
      | "CREDITS_GRANTED";
    capability: string;
    targetId: string;
    targetType: AuditTargetTypeV1;
    reasonCode: string;
  }>,
) {
  await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
    action: input.action,
    actorKind: "USER",
    actorUserId: dependencies.actor.userId,
    capability: input.capability,
    companyId: dependencies.actor.companyId,
    correlationId: dependencies.correlationId,
    reasonCode: input.reasonCode,
    result: "SUCCEEDED",
    retainUntil: new Date(now.getTime() + BILLING_AUDIT_RETENTION_MS),
    targetId: input.targetId,
    targetType: input.targetType,
  });
}

async function runSerializableRetry<TResult>(
  operation: () => Promise<BillingCommandResult<TResult>>,
): Promise<BillingCommandResult<TResult>> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof BillingDomainRollbackError) {
        return billingFailure(error.code);
      }
      if (!isRetryableTransactionError(error) || attempt === 2) {
        return billingFailure("WRITE_FAILED");
      }
    }
  }
  return billingFailure("WRITE_FAILED");
}

function isRetryableTransactionError(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String(error.code) : "";
  if (code === "P2034" || code === "40001" || code === "40P01") {
    return true;
  }
  const metadata =
    "meta" in error && typeof error.meta === "object" && error.meta !== null
      ? error.meta
      : null;
  if (code === "P2010" && metadata !== null && "code" in metadata) {
    const databaseCode = String(metadata.code);
    if (databaseCode === "40001" || databaseCode === "40P01") return true;
  }
  const messages = [
    "message" in error && typeof error.message === "string"
      ? error.message
      : "",
    metadata !== null &&
    "message" in metadata &&
    typeof metadata.message === "string"
      ? metadata.message
      : "",
  ].join("\n");
  return /could not serialize access|deadlock detected|write conflict/iu.test(
    messages,
  );
}
