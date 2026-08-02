import { randomUUID } from "node:crypto";

import type { BillingDependencies } from "@/lib/billing/contracts";
import { createCheckoutOrder } from "@/lib/billing/orders";
import {
  ingestVerifiedPaymentEvent,
  projectPaymentInboxEvent,
} from "@/lib/billing/payment-inbox";
import {
  checkoutStepUpAction,
  realPaymentQuoteDigest,
} from "@/lib/billing/paid-activation-policy";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { MockEmailProvider } from "@/lib/providers/email";
import { PrismaEmailLogRepository } from "@/lib/providers/email/prisma-email-log-repository";
import type {
  CheckoutSession,
  CreatePaymentOperationInput,
  HostedPaymentProvider,
  NormalizedPaymentProviderEvent,
  ProviderInvoicePaymentResolution,
  ProviderRefundResult,
} from "@/lib/providers/payments";
import {
  resolveStripePaymentRuntime,
  stripePaymentConfigurationDigest,
} from "@/lib/providers/payments";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

export const PHASE24_NOW = new Date("2026-07-28T12:00:00.000Z");
export const PHASE24_STARTER_TOTAL_RAPPEN = 16_107;

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

export type Phase24BillingFixture = Readonly<{
  actor: BillingDependencies["actor"];
  companyId: string;
  database: DatabaseClient;
  financeApproverId: string;
  financeRequesterId: string;
  migrated: MigratedDatabase;
  now: Date;
  provider: Phase24HostedPaymentProvider;
  providerActivationId: string;
  scopeDecisionId: string;
  starterPlanVersionId: string;
  dispose: () => Promise<void>;
  dependencies: (
    overrides?: Partial<BillingDependencies>,
  ) => BillingDependencies;
  issueCheckoutStepUp: (
    orderId: string,
    userId?: string,
  ) => Promise<Readonly<{ evidenceId: string; quoteDigest: string }>>;
  issueFinanceStepUp: (
    input: Readonly<{
      action: string;
      purpose: string;
      userId: string;
    }>,
  ) => Promise<string>;
}>;

export type Phase24StarterCheckout = Readonly<{
  orderId: string;
  paymentAttemptId: string;
  providerSessionReference: string;
}>;

export class Phase24HostedPaymentProvider implements HostedPaymentProvider {
  readonly kind = "STRIPE" as const;
  readonly adapterKey = "stripe_sandbox" as const;
  readonly adapterVersion = "v1" as const;
  readonly providerAccountReference = "acct_phase24fixture";
  readonly providerMode = "SANDBOX" as const;
  readonly expectedLiveMode = false;
  readonly checkoutInputs: CreatePaymentOperationInput[] = [];
  readonly refundInputs: Array<{
    amountRappen: number;
    idempotencyKey: string;
    orderId: string;
    paymentAttemptId: string;
    providerPaymentReference: string;
    reasonCode: string;
    refundId: string;
    sourceKind: "INITIAL_ORDER" | "SUBSCRIPTION_PROVIDER_INVOICE";
  }> = [];
  readonly expiredCheckoutInputs: Array<{
    idempotencyKey: string;
    orderId: string;
    providerSessionReference: string;
  }> = [];
  checkoutFailure = false;
  beforeCheckoutReturn: (() => Promise<void>) | null = null;
  beforeRefundReturn: (() => Promise<void>) | null = null;
  refundFailure = false;
  refundStatus: ProviderRefundResult["status"] = "PENDING";
  invoicePaymentResolutionFailure = false;
  invoicePaymentResolutionReference: string | null = null;
  readonly invoicePaymentResolutionInputs: Array<{
    amountRappen: number;
    currency: "CHF";
    providerInvoiceReference: string;
  }> = [];

  async createCheckout(
    input: CreatePaymentOperationInput,
  ): Promise<CheckoutSession> {
    this.checkoutInputs.push(input);
    if (this.checkoutFailure) {
      throw new Error("PHASE24_CHECKOUT_PROVIDER_FAILURE");
    }
    await this.beforeCheckoutReturn?.();
    return Object.freeze({
      orderId: input.orderId,
      checkoutUrl: `https://checkout.stripe.com/c/pay/cs_test_${input.orderId.replaceAll("-", "")}`,
      provider: "STRIPE" as const,
      providerSessionReference: `cs_test_${input.orderId.replaceAll("-", "")}`,
    });
  }

  async createRefund(input: {
    amountRappen: number;
    idempotencyKey: string;
    orderId: string;
    paymentAttemptId: string;
    providerPaymentReference: string;
    reasonCode: string;
    refundId: string;
    sourceKind: "INITIAL_ORDER" | "SUBSCRIPTION_PROVIDER_INVOICE";
  }): Promise<ProviderRefundResult> {
    this.refundInputs.push(input);
    if (this.refundFailure) {
      throw new Error("PHASE24_REFUND_PROVIDER_FAILURE");
    }
    await this.beforeRefundReturn?.();
    return Object.freeze({
      amountRappen: input.amountRappen,
      currency: "CHF" as const,
      providerRefundReference: `re_${input.idempotencyKey.replaceAll(/[^A-Za-z0-9]/gu, "")}`,
      status: this.refundStatus,
    });
  }

  async resolveInvoicePayment(input: {
    amountRappen: number;
    currency: "CHF";
    providerInvoiceReference: string;
  }): Promise<ProviderInvoicePaymentResolution> {
    this.invoicePaymentResolutionInputs.push(input);
    if (this.invoicePaymentResolutionFailure) {
      throw new Error("PHASE24_INVOICE_PAYMENT_RESOLUTION_FAILURE");
    }
    const providerPaymentReference =
      this.invoicePaymentResolutionReference ??
      `pi_hydrated_${input.providerInvoiceReference.replaceAll(/[^A-Za-z0-9]/gu, "")}`;
    return Object.freeze({
      amountRappen: input.amountRappen,
      currency: input.currency,
      evidenceDigest: "e".repeat(64),
      providerInvoicePaymentReference: `ip_${input.providerInvoiceReference.replaceAll(/[^A-Za-z0-9]/gu, "")}`,
      providerInvoiceReference: input.providerInvoiceReference,
      providerPaymentReference,
      source: "STRIPE_INVOICE_PAYMENTS_LIST_V1" as const,
    });
  }

  async expireCheckoutSession(input: {
    idempotencyKey: string;
    orderId: string;
    providerSessionReference: string;
  }): Promise<void> {
    this.expiredCheckoutInputs.push(input);
  }

  async confirmPayment(): Promise<{ providerReference: string }> {
    throw new Error("REAL_CONFIRMATION_FORBIDDEN");
  }

  async cancel(): Promise<void> {
    throw new Error("REAL_CANCELLATION_FORBIDDEN");
  }

  verifyWebhook(): NormalizedPaymentProviderEvent {
    throw new Error("Use signed provider contract fixtures for verification.");
  }
}

export async function createPhase24BillingFixture(
  purpose: string,
): Promise<Phase24BillingFixture> {
  const migrated = await createMigratedTestDatabase(purpose);
  const database = createDatabaseClient(migrated.connectionString);
  await database.$connect();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const reviewer = await createUser(database, `reviewer-${suffix}`, "ADMIN");
  const owner = await createUser(database, `owner-${suffix}`, "EMPLOYER");
  const financeRequester = await createUser(
    database,
    `finance-request-${suffix}`,
    "ADMIN",
  );
  const financeApprover = await createUser(
    database,
    `finance-approve-${suffix}`,
    "ADMIN",
  );
  const canton = await database.canton.create({
    data: {
      code: `Z${suffix.slice(0, 1).toUpperCase()}`,
      name: `Phase24 Kanton ${suffix}`,
      slug: `phase24-canton-${suffix}`,
      language: "DE",
      sortOrder: 90,
    },
  });
  const city = await database.city.create({
    data: {
      cantonId: canton.id,
      name: `Phase24 Stadt ${suffix}`,
      slug: `phase24-stadt-${suffix}`,
      sortOrder: 90,
    },
  });
  const company = await database.company.create({
    data: {
      name: `Phase 24 Billing ${suffix} AG`,
      slug: `phase24-billing-${suffix}`,
      status: "DRAFT",
      industry: "Software",
      size: "11-50",
      about: "Isolierte Phase-24-Zahlungsfixture.",
      website: "https://example.ch",
      values: [],
      benefits: [],
      locations: {
        create: {
          cantonId: canton.id,
          cityId: city.id,
          isPrimary: true,
          address: "Teststrasse 24",
          postalCode: "8000",
        },
      },
    },
  });
  const membership = await database.companyMembership.create({
    data: {
      companyId: company.id,
      userId: owner.id,
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  await database.companyVerificationRequest.create({
    data: {
      companyId: company.id,
      requestedByUserId: owner.id,
      status: "VERIFIED",
      evidenceMetadata: { fixture: "phase24" },
    },
  });
  await database.company.update({
    where: { id: company.id },
    data: { status: "ACTIVE" },
  });
  await database.companyBillingProfile.create({
    data: {
      companyId: company.id,
      legalName: company.name,
      billingContactEmail: owner.email,
      street: "Teststrasse 24",
      postalCode: "8000",
      city: "Zürich",
      countryCode: "CH",
    },
  });
  await createPlanVersion(database, {
    code: "FREE_BASIC",
    name: "Free Basic",
    isDefaultFree: true,
    netPriceRappen: 0,
  });
  const starterPlanVersion = await createPlanVersion(database, {
    code: "STARTER",
    name: "Starter",
    isDefaultFree: false,
    netPriceRappen: 14_900,
  });
  const tax = await database.taxRateVersion.create({
    data: {
      jurisdiction: "CH",
      taxType: "MWST_STANDARD_DEMO",
      rateBasisPoints: 810,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      source: "Phase-24-Testannahme",
      reviewStatus: "DRAFT",
    },
  });
  await database.taxRateVersion.update({
    where: { id: tax.id },
    data: {
      reviewStatus: "APPROVED",
      reviewedByUserId: reviewer.id,
      reviewedAt: new Date("2026-01-01T00:01:00.000Z"),
    },
  });
  const providerActivation = await database.providerActivation.create({
    data: {
      environment: "ci",
      useCase: "payments.hosted-checkout",
      adapterKey: "stripe_sandbox",
      adapterVersion: "v1",
      mode: "SANDBOX",
      configurationDigest: stripePaymentConfigurationDigest({
        providerAccountReference: "acct_phase24fixture",
        runtime: resolveStripePaymentRuntime("stripe_sandbox")!,
      }),
      secretVersionRef: "secret:stripe:test:v1",
      region: "CH-test",
      dpaRef: "dpa:stripe:test",
      contractRef: "contract:stripe:test",
      approvalRef: "approval:phase24:test",
      evidenceDigest: "b".repeat(64),
      owner: "Finance Test",
      runbookRef: "codex-plan/runbooks/payment-operations.md",
      health: "HEALTHY",
      healthCheckedAt: PHASE24_NOW,
      quotaUnits: 10_000,
      sustainableCapacity: 1_000,
      unitCostMicros: 10n,
      unitCostSource: "fixture",
      killSwitchEngaged: false,
      effectiveAt: new Date(PHASE24_NOW.getTime() - 60_000),
      expiresAt: new Date(PHASE24_NOW.getTime() + 86_400_000),
    },
  });
  const scopeDecision = await database.paidScopeDecision.create({
    data: {
      scopeCode: "LC5_PAID_SELF_SERVICE",
      packageCode: "STARTER",
      status: "GO",
      maximumMode: "SANDBOX",
      decisionRef: `phase31a:test:${suffix}`,
      evidenceDigest: "c".repeat(64),
      sampleSize: 10,
      thresholdCode: "WTP_TEST_THRESHOLD",
      reasonCode: "WTP_TEST_GO",
      decidedByUserId: reviewer.id,
      effectiveAt: new Date(PHASE24_NOW.getTime() - 60_000),
      expiresAt: new Date(PHASE24_NOW.getTime() + 86_400_000),
    },
  });
  await database.paymentPriceBinding.create({
    data: {
      planVersionId: starterPlanVersion.id,
      providerActivationId: providerActivation.id,
      environment: "ci",
      adapterKey: "stripe_sandbox",
      adapterVersion: "v1",
      providerMode: "SANDBOX",
      providerAccountReference: "acct_phase24fixture",
      providerPriceReference: "price_phase33starter",
      billingInterval: "MONTHLY",
      amountRappen: PHASE24_STARTER_TOTAL_RAPPEN,
      currency: "CHF",
      evidenceDigest: "d".repeat(64),
      effectiveAt: new Date(PHASE24_NOW.getTime() - 60_000),
      expiresAt: new Date(PHASE24_NOW.getTime() + 86_400_000),
    },
  });
  const actor = Object.freeze({
    userId: owner.id,
    email: owner.email,
    companyId: company.id,
    membershipId: membership.id,
    membershipRole: "OWNER" as const,
  });
  const provider = new Phase24HostedPaymentProvider();
  const emailProvider = new MockEmailProvider(
    new PrismaEmailLogRepository(database),
  );

  const dependencies = (
    overrides: Partial<BillingDependencies> = {},
  ): BillingDependencies => {
    const baseDependencies = {
      actor,
      correlationId: randomUUID(),
      database,
      paymentProvider: provider,
      emailProvider,
      realPayment: {
        activationMode: "SANDBOX",
        adapterKey: "stripe_sandbox",
        adapterVersion: "v1",
        appUrl: "https://example.ch",
        configurationDigest: stripePaymentConfigurationDigest({
          providerAccountReference: "acct_phase24fixture",
          runtime: resolveStripePaymentRuntime("stripe_sandbox")!,
        }),
        environment: "ci",
        expectedLiveMode: false,
        paidSelfServiceEnabled: true,
        providerAccountReference: "acct_phase24fixture",
        providerMode: "SANDBOX",
        sandboxCohort: "test",
        secretVersionRef: "secret:stripe:test:v1",
      },
      now: PHASE24_NOW,
    } satisfies BillingDependencies;
    return Object.freeze({ ...baseDependencies, ...overrides });
  };

  return Object.freeze({
    actor,
    companyId: company.id,
    database,
    financeApproverId: financeApprover.id,
    financeRequesterId: financeRequester.id,
    migrated,
    now: PHASE24_NOW,
    provider,
    providerActivationId: providerActivation.id,
    scopeDecisionId: scopeDecision.id,
    starterPlanVersionId: starterPlanVersion.id,
    dependencies,
    async issueCheckoutStepUp(orderId, userId = owner.id) {
      const quoteDigest = realPaymentQuoteDigest({
        amountRappen: PHASE24_STARTER_TOTAL_RAPPEN,
        companyId: company.id,
        currency: "CHF",
        description: "Starter Monatsplan",
        orderId,
        adapterKey: "stripe_sandbox",
        checkoutKind: "SUBSCRIPTION",
        paymentPriceBindingId: (
          await database.paymentPriceBinding.findFirstOrThrow({
            where: { planVersionId: starterPlanVersion.id },
            select: { id: true },
          })
        ).id,
        planVersionId: starterPlanVersion.id,
        providerAccountReference: "acct_phase24fixture",
        providerMode: "SANDBOX",
        providerPriceReference: "price_phase33starter",
      });
      const evidence = await database.authAssuranceEvidence.create({
        data: {
          userId,
          purpose: "PAID_CHECKOUT",
          action: checkoutStepUpAction(quoteDigest),
          tenantId: company.id,
          method: "WEBAUTHN",
          issuedAt: new Date(PHASE24_NOW.getTime() - 30_000),
          expiresAt: new Date(PHASE24_NOW.getTime() + 5 * 60_000),
        },
      });
      return Object.freeze({
        evidenceId: evidence.id,
        quoteDigest,
      });
    },
    async issueFinanceStepUp(input) {
      const evidence = await database.authAssuranceEvidence.create({
        data: {
          userId: input.userId,
          purpose: input.purpose,
          action: input.action,
          tenantId: company.id,
          method: "WEBAUTHN",
          issuedAt: new Date(PHASE24_NOW.getTime() - 30_000),
          expiresAt: new Date(PHASE24_NOW.getTime() + 5 * 60_000),
        },
      });
      return evidence.id;
    },
    async dispose() {
      await database.$disconnect().catch(() => undefined);
      await migrated.dispose();
    },
  });
}

export async function createPhase24StarterCheckout(
  fixture: Phase24BillingFixture,
  input: Readonly<{
    idempotencyKey?: string;
    orderId?: string;
  }> = {},
): Promise<Phase24StarterCheckout> {
  const orderId = input.orderId ?? randomUUID();
  const stepUp = await fixture.issueCheckoutStepUp(orderId);
  const result = await createCheckoutOrder(
    {
      kind: "PLAN",
      planSlug: "starter",
      paymentOrderId: orderId,
      stepUpEvidenceId: stepUp.evidenceId,
      idempotencyKey:
        input.idempotencyKey ?? `phase24-checkout-${randomUUID()}`,
    },
    fixture.dependencies(),
  );
  if (!result.ok) {
    throw new Error(`PHASE24_CHECKOUT_FAILED:${result.code}`);
  }
  const attempt = await fixture.database.paymentAttempt.findFirst({
    where: { orderId },
    select: {
      id: true,
      providerSessionReference: true,
    },
  });
  if (attempt?.providerSessionReference === null || attempt === null) {
    throw new Error("PHASE24_PAYMENT_ATTEMPT_MISSING");
  }
  return Object.freeze({
    orderId,
    paymentAttemptId: attempt.id,
    providerSessionReference: attempt.providerSessionReference,
  });
}

export function phase24ProviderEvent(
  checkout: Phase24StarterCheckout,
  input: Partial<NormalizedPaymentProviderEvent> = {},
): NormalizedPaymentProviderEvent {
  return Object.freeze({
    apiVersion: "2026-06-30.basil",
    amountRappen: PHASE24_STARTER_TOTAL_RAPPEN,
    currency: "CHF",
    eventCreatedAt: new Date(PHASE24_NOW.getTime() + 60_000),
    eventType: "checkout.session.completed",
    liveMode: false,
    orderId: checkout.orderId,
    paymentAttemptId: checkout.paymentAttemptId,
    refundId: null,
    providerAccountReference: "acct_phase24fixture",
    providerCancelAtPeriodEnd: false,
    providerCustomerReference: "cus_phase24fixture",
    providerEventId: `evt_${randomUUID().replaceAll("-", "")}`,
    providerObjectReference: checkout.providerSessionReference,
    providerPaymentReference: `pi_${randomUUID().replaceAll("-", "")}`,
    providerInvoiceReference: `in_${randomUUID().replaceAll("-", "")}`,
    providerPriceReference: "price_phase33starter",
    providerSessionReference: checkout.providerSessionReference,
    providerSubscriptionReference: `sub_${checkout.orderId.replaceAll("-", "")}`,
    providerPeriodStart: PHASE24_NOW,
    providerPeriodEnd: new Date("2026-08-28T12:00:00.000Z"),
    providerStatus: "paid",
    ...input,
  });
}

export async function projectPhase24ProviderEvent(
  fixture: Phase24BillingFixture,
  event: NormalizedPaymentProviderEvent,
  input: Readonly<{ projectionEnabled?: boolean }> = {},
) {
  const correlationId = randomUUID();
  const receivedAt = new Date(event.eventCreatedAt.getTime() + 1_000);
  const ingestion = await ingestVerifiedPaymentEvent(
    {
      adapterKey: "stripe_sandbox",
      adapterVersion: "v1",
      correlationId,
      environment: "ci",
      event,
      expectedLiveMode: false,
      projectionEnabled: input.projectionEnabled ?? true,
      providerMode: "SANDBOX",
      rawBody: JSON.stringify({
        id: event.providerEventId,
        type: event.eventType,
      }),
      receivedAt,
      signatureHeader: `t=${Math.floor(receivedAt.getTime() / 1_000)},v1=${"a".repeat(64)}`,
    },
    fixture.database,
  );
  const projection =
    input.projectionEnabled === false
      ? null
      : await projectPaymentInboxEvent(
          {
            correlationId,
            inboxId: ingestion.inboxId,
            now: new Date(receivedAt.getTime() + 1_000),
          },
          {
            database: fixture.database,
            emailProvider: fixture.dependencies().emailProvider,
            paymentProvider: fixture.provider,
          },
        );
  return Object.freeze({ correlationId, ingestion, projection });
}

async function createUser(
  database: DatabaseClient,
  prefix: string,
  role: "ADMIN" | "EMPLOYER",
) {
  const email = `${prefix}@example.ch`;
  return database.user.create({
    data: {
      email,
      emailNormalized: email,
      role,
      status: "ACTIVE",
    },
  });
}

async function createPlanVersion(
  database: DatabaseClient,
  input: Readonly<{
    code: string;
    isDefaultFree: boolean;
    name: string;
    netPriceRappen: number;
  }>,
) {
  const plan = await database.plan.create({
    data: {
      code: input.code,
      name: input.name,
      isDefaultFree: input.isDefaultFree,
    },
  });
  const version = await database.planVersion.create({
    data: {
      planId: plan.id,
      version: 1,
      status: "DRAFT",
      priceMode: "FIXED",
      billingInterval: "MONTHLY",
      termMonths: 1,
      netPriceRappen: input.netPriceRappen,
      monthlyEquivalentRappen: input.netPriceRappen,
      currency: "CHF",
      isPublic: true,
      isSelfService: !input.isDefaultFree,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      entitlements: {
        create: [
          integerEntitlement("ACTIVE_JOB_LIMIT", input.isDefaultFree ? 1 : 3),
          integerEntitlement("SEAT_LIMIT", input.isDefaultFree ? 1 : 3),
          booleanEntitlement("TALENT_RADAR_ACCESS", false),
          integerEntitlement("TALENT_CONTACT_ALLOWANCE", 0),
          integerEntitlement("JOB_BOOST_ALLOWANCE", 0),
          {
            key: "ANALYTICS_LEVEL",
            valueType: "ANALYTICS_LEVEL",
            analyticsLevelValue: input.isDefaultFree ? "NONE" : "BASIC",
          },
          booleanEntitlement("ENHANCED_COMPANY_PROFILE", false),
          booleanEntitlement("EMPLOYER_IMPORT_ACCESS", false),
        ],
      },
    },
  });
  return database.planVersion.update({
    where: { id: version.id },
    data: { status: "ACTIVE" },
  });
}

function integerEntitlement(
  key:
    | "ACTIVE_JOB_LIMIT"
    | "SEAT_LIMIT"
    | "TALENT_CONTACT_ALLOWANCE"
    | "JOB_BOOST_ALLOWANCE",
  value: number,
) {
  return { key, valueType: "INTEGER" as const, integerValue: value };
}

function booleanEntitlement(
  key:
    | "TALENT_RADAR_ACCESS"
    | "ENHANCED_COMPANY_PROFILE"
    | "EMPLOYER_IMPORT_ACCESS",
  value: boolean,
) {
  return { key, valueType: "BOOLEAN" as const, booleanValue: value };
}
