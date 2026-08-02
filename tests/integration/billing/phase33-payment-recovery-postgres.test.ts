import { randomUUID } from "node:crypto";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  approveAndSubmitFinanceRefund,
  financeRefundApprovalAction,
  financeRefundRequestAction,
  requestFinanceRefund,
} from "@/lib/billing/finance-operations";
import {
  ingestVerifiedPaymentEvent,
  projectPaymentInboxEvent,
} from "@/lib/billing/payment-inbox";
import { subscriptionProviderInvoiceProjectionDigestV1 } from "@/lib/billing/subscription-provider-ordering";
import {
  PHASE24_STARTER_TOTAL_RAPPEN,
  createPhase24BillingFixture,
  createPhase24StarterCheckout,
  phase24ProviderEvent,
  projectPhase24ProviderEvent,
  type Phase24BillingFixture,
} from "@/tests/fixtures/phase24-billing";

describe("Phase 33 payment recovery authority", () => {
  let fixture: Phase24BillingFixture;
  let checkout: Awaited<ReturnType<typeof createPhase24StarterCheckout>>;
  let subscriptionReference: string;

  beforeAll(async () => {
    fixture = await createPhase24BillingFixture("phase33-payment-recovery");
    checkout = await createPhase24StarterCheckout(fixture);
    const checkoutBinding = phase24ProviderEvent(checkout, {
      providerInvoiceReference: null,
      providerPaymentReference: null,
      providerPeriodEnd: null,
      providerPeriodStart: null,
    });
    subscriptionReference = checkoutBinding.providerSubscriptionReference!;
    await projectPhase24ProviderEvent(fixture, checkoutBinding);
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  it("retries provider failure and persists immutable minimal hydration evidence for an unexpanded paid invoice", async () => {
    const providerInvoiceReference = `in_unexpanded_${randomUUID().replaceAll("-", "")}`;
    const expectedPaymentReference = `pi_hydrated_${randomUUID().replaceAll("-", "")}`;
    fixture.provider.invoicePaymentResolutionReference =
      expectedPaymentReference;
    const event = phase24ProviderEvent(checkout, {
      eventCreatedAt: new Date("2026-07-28T12:01:00.000Z"),
      eventType: "invoice.paid",
      providerEventId: `evt_unexpanded_${randomUUID().replaceAll("-", "")}`,
      providerInvoiceReference,
      providerPaymentReference: null,
      providerSessionReference: null,
      providerStatus: "paid",
      providerSubscriptionReference: subscriptionReference,
    });
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
        projectionEnabled: true,
        providerMode: "SANDBOX",
        rawBody: JSON.stringify({ id: event.providerEventId, type: event.eventType }),
        receivedAt,
        signatureHeader: `t=${Math.floor(receivedAt.getTime() / 1_000)},v1=${"a".repeat(64)}`,
      },
      fixture.database,
    );

    fixture.provider.invoicePaymentResolutionFailure = true;
    await expect(
      projectPaymentInboxEvent(
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
      ),
    ).rejects.toThrow("INVOICE_PAYMENT_HYDRATION_UNAVAILABLE");
    await expect(
      fixture.database.providerEventInbox.findUniqueOrThrow({
        where: { id: ingestion.inboxId },
        select: {
          errorCode: true,
          failureClass: true,
          hydratedPaymentReference: true,
          status: true,
        },
      }),
    ).resolves.toEqual({
      errorCode: "INVOICE_PAYMENT_HYDRATION_UNAVAILABLE",
      failureClass: "TRANSIENT",
      hydratedPaymentReference: null,
      status: "FAILED",
    });

    fixture.provider.invoicePaymentResolutionFailure = false;
    await expect(
      projectPaymentInboxEvent(
        {
          correlationId,
          inboxId: ingestion.inboxId,
          now: new Date(receivedAt.getTime() + 61_000),
        },
        {
          database: fixture.database,
          emailProvider: fixture.dependencies().emailProvider,
          paymentProvider: fixture.provider,
        },
      ),
    ).resolves.toMatchObject({ status: "PROJECTED" });

    const inbox = await fixture.database.providerEventInbox.findUniqueOrThrow({
      where: { id: ingestion.inboxId },
    });
    expect(inbox).toMatchObject({
      hydratedPaymentReference: expectedPaymentReference,
      hydrationEvidenceDigest: "e".repeat(64),
      hydrationSource: "STRIPE_INVOICE_PAYMENTS_LIST_V1",
      status: "PROJECTED",
    });
    expect(inbox.normalizedPayload).toMatchObject({
      providerPaymentReference: null,
    });
    await expect(
      fixture.database.providerEventInbox.update({
        where: { id: inbox.id },
        data: { hydratedPaymentReference: "pi_tampered_phase33" },
      }),
    ).rejects.toThrow();
    await expect(
      fixture.database.employerSubscription.findUniqueOrThrow({
        where: { providerSubscriptionReference: subscriptionReference },
        select: { providerRecurringAmountRappenSnapshot: true, status: true },
      }),
    ).resolves.toEqual({
      providerRecurringAmountRappenSnapshot: PHASE24_STARTER_TOTAL_RAPPEN,
      status: "ACTIVE",
    });
  });

  it("fails renewal amount drift closed against the immutable subscription snapshot", async () => {
    const providerInvoiceReference = `in_amount_conflict_${randomUUID().replaceAll("-", "")}`;
    const result = await projectPhase24ProviderEvent(
      fixture,
      phase24ProviderEvent(checkout, {
        amountRappen: PHASE24_STARTER_TOTAL_RAPPEN + 1,
        eventCreatedAt: new Date("2026-08-28T12:01:00.000Z"),
        eventType: "invoice.paid",
        providerEventId: `evt_amount_conflict_${randomUUID().replaceAll("-", "")}`,
        providerInvoiceReference,
        providerPaymentReference: `pi_amount_conflict_${randomUUID().replaceAll("-", "")}`,
        providerPeriodStart: new Date("2026-08-28T12:00:00.000Z"),
        providerPeriodEnd: new Date("2026-09-28T12:00:00.000Z"),
        providerStatus: "paid",
        providerSubscriptionReference: subscriptionReference,
      }),
    );
    expect(result.projection).toMatchObject({ status: "HELD" });
    await expect(
      fixture.database.employerSubscription.findUniqueOrThrow({
        where: { providerSubscriptionReference: subscriptionReference },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "SUSPENDED" });
    await expect(
      fixture.database.subscriptionProviderInvoice.findUniqueOrThrow({
        where: {
          provider_environment_adapterKey_providerAccountReference_providerInvoiceReference:
            {
              provider: "STRIPE",
              environment: "ci",
              adapterKey: "stripe_sandbox",
              providerAccountReference: "acct_phase24fixture",
              providerInvoiceReference,
            },
        },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "CONFLICT" });
  });
});

describe("Phase 33 duplicate paid invoice aliases", () => {
  it.each([
    ["invoice.paid", "invoice.payment_succeeded"],
    ["invoice.payment_succeeded", "invoice.paid"],
  ] as const)(
    "treats %s then %s as one stable invoice fact",
    async (firstType, secondType) => {
      const fixture = await createPhase24BillingFixture(
        `phase33-invoice-alias-${firstType.replaceAll(".", "-")}`,
      );
      try {
        const checkout = await createPhase24StarterCheckout(fixture);
        const checkoutBinding = phase24ProviderEvent(checkout, {
          providerInvoiceReference: null,
          providerPaymentReference: null,
          providerPeriodEnd: null,
          providerPeriodStart: null,
        });
        await projectPhase24ProviderEvent(fixture, checkoutBinding);
        const providerInvoiceReference = `in_alias_${randomUUID().replaceAll("-", "")}`;
        const providerPaymentReference = `pi_alias_${randomUUID().replaceAll("-", "")}`;
        const first = phase24ProviderEvent(checkout, {
          eventCreatedAt: new Date("2026-07-28T12:01:00.000Z"),
          eventType: firstType,
          providerEventId: `evt_alias_first_${randomUUID().replaceAll("-", "")}`,
          providerInvoiceReference,
          providerPaymentReference,
          providerSessionReference: null,
          providerStatus: "paid",
          providerSubscriptionReference:
            checkoutBinding.providerSubscriptionReference,
        });
        await expect(
          projectPhase24ProviderEvent(fixture, first),
        ).resolves.toMatchObject({ projection: { status: "PROJECTED" } });
        const projectedInvoice =
          await fixture.database.subscriptionProviderInvoice.findFirstOrThrow({
            where: { providerInvoiceReference },
          });
        expect(projectedInvoice).toMatchObject({
          adapterKey: "stripe_sandbox",
          amountRappen: first.amountRappen,
          currency: "CHF",
          environment: "ci",
          periodEnd: first.providerPeriodEnd,
          periodStart: first.providerPeriodStart,
          providerAccountReference: "acct_phase24fixture",
          providerPaymentReference,
          provider: "STRIPE",
        });
        expect(projectedInvoice.paidProjectionDigest).toBe(
          subscriptionProviderInvoiceProjectionDigestV1(
            {
              provider: "STRIPE",
              environment: "ci",
              adapterKey: "stripe_sandbox",
              providerAccountReference: "acct_phase24fixture",
              providerInvoiceReference,
            },
            {
              amountRappen: first.amountRappen!,
              currency: "CHF",
              paidAt: first.eventCreatedAt,
              periodEnd: first.providerPeriodEnd!,
              periodStart: first.providerPeriodStart!,
              providerPaymentReference,
            },
            projectedInvoice.subscriptionId,
          ),
        );
        const second = phase24ProviderEvent(checkout, {
          ...first,
          eventCreatedAt: new Date("2026-07-28T12:01:07.000Z"),
          eventType: secondType,
          providerEventId: `evt_alias_second_${randomUUID().replaceAll("-", "")}`,
        });
        const duplicate = await projectPhase24ProviderEvent(fixture, second);
        const duplicateInbox =
          await fixture.database.providerEventInbox.findUniqueOrThrow({
            where: { id: duplicate.ingestion.inboxId },
            select: { errorCode: true, status: true },
          });
        expect(duplicateInbox).toEqual({
          errorCode: "SUBSCRIPTION_INVOICE_PAID_ALREADY_PROJECTED",
          status: "IGNORED",
        });
        await expect(
          fixture.database.subscriptionProviderInvoice.count({
            where: { providerInvoiceReference, status: "PAID" },
          }),
        ).resolves.toBe(1);
        await expect(
          fixture.database.employerSubscription.findFirstOrThrow({
            where: { providerSubscriptionReference: first.providerSubscriptionReference! },
            select: { status: true },
          }),
        ).resolves.toEqual({ status: "ACTIVE" });
      } finally {
        await fixture.dispose();
      }
    },
  );
});

describe("Phase 33 refund race recovery and source authority", () => {
  let fixture: Phase24BillingFixture;

  beforeEach(async () => {
    fixture = await createPhase24BillingFixture(
      `phase33-refund-recovery-${randomUUID()}`,
    );
  });

  afterEach(async () => {
    await fixture.dispose();
  });

  it("accepts a signed refund webhook before API-result persistence and replays without duplication", async () => {
    const settled = await settleInitialPayment(fixture);
    const requested = await requestRefund(fixture, {
      amountRappen: PHASE24_STARTER_TOTAL_RAPPEN,
      orderId: settled.checkout.orderId,
      reasonCode: "WEBHOOK_BEFORE_API_RETURN",
    });
    const approvalEvidenceId = await issueRefundApproval(
      fixture,
      requested.refundId,
    );
    const providerRefundReference = providerRefundReferenceFor(
      requested.refundId,
    );
    fixture.provider.beforeRefundReturn = async () => {
      fixture.provider.beforeRefundReturn = null;
      await projectPhase24ProviderEvent(
        fixture,
        phase24ProviderEvent(settled.checkout, {
          amountRappen: PHASE24_STARTER_TOTAL_RAPPEN,
          eventCreatedAt: new Date("2026-07-28T12:02:00.000Z"),
          eventType: "refund.updated",
          providerEventId: `evt_refund_race_${randomUUID().replaceAll("-", "")}`,
          providerObjectReference: providerRefundReference,
          providerPaymentReference: settled.providerPaymentReference,
          providerStatus: "succeeded",
          refundId: requested.refundId,
        }),
      );
    };

    const submitted = await approveRefund(
      fixture,
      requested.refundId,
      approvalEvidenceId,
    );
    expect(submitted).toEqual({
      ok: true,
      refundId: requested.refundId,
      replay: true,
      status: "SUCCEEDED",
    });
    await expect(
      approveRefund(fixture, requested.refundId, approvalEvidenceId),
    ).resolves.toEqual({
      ok: true,
      refundId: requested.refundId,
      replay: true,
      status: "SUCCEEDED",
    });
    await expect(
      fixture.database.refund.findUniqueOrThrow({
        where: { id: requested.refundId },
        select: { providerRefundReference: true, status: true },
      }),
    ).resolves.toEqual({
      providerRefundReference,
      status: "SUCCEEDED",
    });
    await expect(
      fixture.database.creditNote.count({
        where: { refundId: requested.refundId },
      }),
    ).resolves.toBe(1);
    expect(
      fixture.provider.refundInputs.filter(
        (candidate) => candidate.refundId === requested.refundId,
      ),
    ).toHaveLength(1);
  });

  it("recovers an ambiguous provider timeout through the signed webhook and idempotent retry", async () => {
    const settled = await settleInitialPayment(fixture);
    const requested = await requestRefund(fixture, {
      amountRappen: PHASE24_STARTER_TOTAL_RAPPEN,
      orderId: settled.checkout.orderId,
      reasonCode: "PROVIDER_TIMEOUT_RECOVERY",
    });
    const approvalEvidenceId = await issueRefundApproval(
      fixture,
      requested.refundId,
    );
    fixture.provider.refundFailure = true;
    await expect(
      approveRefund(fixture, requested.refundId, approvalEvidenceId),
    ).resolves.toEqual({ ok: false, code: "PROVIDER_UNAVAILABLE" });
    fixture.provider.refundFailure = false;
    await expect(
      fixture.database.refund.findUniqueOrThrow({
        where: { id: requested.refundId },
        select: { providerRefundReference: true, status: true },
      }),
    ).resolves.toEqual({ providerRefundReference: null, status: "PENDING" });

    const providerRefundReference = providerRefundReferenceFor(
      requested.refundId,
    );
    await projectPhase24ProviderEvent(
      fixture,
      phase24ProviderEvent(settled.checkout, {
        amountRappen: PHASE24_STARTER_TOTAL_RAPPEN,
        eventCreatedAt: new Date("2026-07-28T12:03:00.000Z"),
        eventType: "refund.updated",
        providerEventId: `evt_refund_timeout_${randomUUID().replaceAll("-", "")}`,
        providerObjectReference: providerRefundReference,
        providerPaymentReference: settled.providerPaymentReference,
        providerStatus: "succeeded",
        refundId: requested.refundId,
      }),
    );
    await expect(
      approveRefund(fixture, requested.refundId, approvalEvidenceId),
    ).resolves.toEqual({
      ok: true,
      refundId: requested.refundId,
      replay: true,
      status: "SUCCEEDED",
    });
  });

  it("recovers a database write failure after the provider accepted the idempotent refund", async () => {
    const settled = await settleInitialPayment(fixture);
    const requested = await requestRefund(fixture, {
      amountRappen: PHASE24_STARTER_TOTAL_RAPPEN,
      orderId: settled.checkout.orderId,
      reasonCode: "POST_PROVIDER_DATABASE_FAILURE",
    });
    const approvalEvidenceId = await issueRefundApproval(
      fixture,
      requested.refundId,
    );
    const originalTransaction = fixture.database.$transaction.bind(
      fixture.database,
    ) as unknown as (...args: unknown[]) => unknown;
    const transactionSpy = vi.spyOn(fixture.database, "$transaction");
    let transactionCall = 0;
    (
      transactionSpy.mockImplementation as unknown as (
        implementation: (...args: unknown[]) => unknown,
      ) => void
    )((...args: unknown[]) => {
      transactionCall += 1;
      if (transactionCall === 2) {
        return Promise.reject(new Error("PHASE33_DATABASE_WRITE_FAILURE"));
      }
      return originalTransaction(...args);
    });
    try {
      await expect(
        approveRefund(fixture, requested.refundId, approvalEvidenceId),
      ).resolves.toEqual({ ok: false, code: "WRITE_FAILED" });
    } finally {
      transactionSpy.mockRestore();
    }
    await expect(
      fixture.database.refund.findUniqueOrThrow({
        where: { id: requested.refundId },
        select: { providerRefundReference: true, status: true },
      }),
    ).resolves.toEqual({ providerRefundReference: null, status: "PENDING" });

    await expect(
      approveRefund(fixture, requested.refundId, approvalEvidenceId),
    ).resolves.toMatchObject({ ok: true, status: "PENDING" });
    const providerCalls = fixture.provider.refundInputs.filter(
      (candidate) => candidate.refundId === requested.refundId,
    );
    expect(providerCalls).toHaveLength(2);
    expect(providerCalls[0]!.idempotencyKey).toBe(
      providerCalls[1]!.idempotencyKey,
    );
    await projectPhase24ProviderEvent(
      fixture,
      phase24ProviderEvent(settled.checkout, {
        amountRappen: PHASE24_STARTER_TOTAL_RAPPEN,
        eventCreatedAt: new Date("2026-07-28T12:03:30.000Z"),
        eventType: "refund.updated",
        providerEventId: `evt_refund_db_recovery_${randomUUID().replaceAll("-", "")}`,
        providerObjectReference: providerRefundReferenceFor(requested.refundId),
        providerPaymentReference: settled.providerPaymentReference,
        providerStatus: "succeeded",
        refundId: requested.refundId,
      }),
    );
    await expect(
      approveRefund(fixture, requested.refundId, approvalEvidenceId),
    ).resolves.toMatchObject({ ok: true, replay: true, status: "SUCCEEDED" });
  });

  it("keeps a webhook-before-refund-row race transient instead of holding the signed event", async () => {
    const settled = await settleInitialPayment(fixture);
    const event = phase24ProviderEvent(settled.checkout, {
      amountRappen: PHASE24_STARTER_TOTAL_RAPPEN,
      eventCreatedAt: new Date("2026-07-28T12:04:00.000Z"),
      eventType: "refund.updated",
      providerEventId: `evt_refund_not_visible_${randomUUID().replaceAll("-", "")}`,
      providerObjectReference: `re_not_visible_${randomUUID().replaceAll("-", "")}`,
      providerPaymentReference: settled.providerPaymentReference,
      providerStatus: "succeeded",
      refundId: randomUUID(),
    });
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
        projectionEnabled: true,
        providerMode: "SANDBOX",
        rawBody: JSON.stringify({ id: event.providerEventId, type: event.eventType }),
        receivedAt,
        signatureHeader: `t=${Math.floor(receivedAt.getTime() / 1_000)},v1=${"a".repeat(64)}`,
      },
      fixture.database,
    );
    await expect(
      projectPaymentInboxEvent(
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
      ),
    ).rejects.toThrow("REFUND_BINDING_NOT_YET_VISIBLE");
    await expect(
      fixture.database.providerEventInbox.findUniqueOrThrow({
        where: { id: ingestion.inboxId },
        select: { errorCode: true, failureClass: true, status: true },
      }),
    ).resolves.toEqual({
      errorCode: "REFUND_BINDING_NOT_YET_VISIBLE",
      failureClass: "TRANSIENT",
      status: "FAILED",
    });
  });

  it("caps refunds per immutable initial or renewal charge and issues the renewal credit note against that source", async () => {
    const settled = await settleInitialPayment(fixture);
    const renewalPaymentReference = `pi_renewal_${randomUUID().replaceAll("-", "")}`;
    const renewalInvoiceReference = `in_renewal_${randomUUID().replaceAll("-", "")}`;
    await projectPhase24ProviderEvent(
      fixture,
      phase24ProviderEvent(settled.checkout, {
        eventCreatedAt: new Date("2026-08-28T12:01:00.000Z"),
        eventType: "invoice.paid",
        providerEventId: `evt_renewal_${randomUUID().replaceAll("-", "")}`,
        providerInvoiceReference: renewalInvoiceReference,
        providerPaymentReference: renewalPaymentReference,
        providerPeriodStart: new Date("2026-08-28T12:00:00.000Z"),
        providerPeriodEnd: new Date("2026-09-28T12:00:00.000Z"),
        providerSessionReference: null,
        providerStatus: "paid",
        providerSubscriptionReference: settled.subscriptionReference,
      }),
    );
    const renewalInvoice =
      await fixture.database.subscriptionProviderInvoice.findUniqueOrThrow({
        where: {
          provider_environment_adapterKey_providerAccountReference_providerInvoiceReference:
            {
              provider: "STRIPE",
              environment: "ci",
              adapterKey: "stripe_sandbox",
              providerAccountReference: "acct_phase24fixture",
              providerInvoiceReference: renewalInvoiceReference,
            },
        },
        select: { id: true },
      });
    const renewalRefund = await requestRefund(fixture, {
      amountRappen: PHASE24_STARTER_TOTAL_RAPPEN,
      orderId: settled.checkout.orderId,
      reasonCode: "RENEWAL_REFUND",
      subscriptionProviderInvoiceId: renewalInvoice.id,
    });

    await expect(
      requestRefundResult(fixture, {
        amountRappen: 1,
        orderId: settled.checkout.orderId,
        reasonCode: "RENEWAL_OVER_CAP",
        subscriptionProviderInvoiceId: renewalInvoice.id,
      }),
    ).resolves.toEqual({ ok: false, code: "CONFLICT" });
    await expect(
      requestRefundResult(fixture, {
        amountRappen: PHASE24_STARTER_TOTAL_RAPPEN,
        orderId: settled.checkout.orderId,
        reasonCode: "INITIAL_CHARGE_INDEPENDENT",
      }),
    ).resolves.toMatchObject({ ok: true, status: "REQUESTED" });

    const approvalEvidenceId = await issueRefundApproval(
      fixture,
      renewalRefund.refundId,
    );
    await expect(
      approveRefund(fixture, renewalRefund.refundId, approvalEvidenceId),
    ).resolves.toMatchObject({ ok: true, status: "PENDING" });
    const providerInput = fixture.provider.refundInputs.find(
      (candidate) => candidate.refundId === renewalRefund.refundId,
    );
    expect(providerInput).toMatchObject({
      providerPaymentReference: renewalPaymentReference,
      sourceKind: "SUBSCRIPTION_PROVIDER_INVOICE",
    });
    const providerRefundReference = providerRefundReferenceFor(
      renewalRefund.refundId,
    );
    await projectPhase24ProviderEvent(
      fixture,
      phase24ProviderEvent(settled.checkout, {
        amountRappen: PHASE24_STARTER_TOTAL_RAPPEN,
        eventCreatedAt: new Date("2026-08-28T12:02:00.000Z"),
        eventType: "refund.updated",
        providerEventId: `evt_renewal_refund_${randomUUID().replaceAll("-", "")}`,
        providerObjectReference: providerRefundReference,
        providerPaymentReference: renewalPaymentReference,
        providerStatus: "succeeded",
        refundId: renewalRefund.refundId,
      }),
    );
    await expect(
      fixture.database.creditNote.findUniqueOrThrow({
        where: { refundId: renewalRefund.refundId },
        select: { invoiceId: true, subscriptionProviderInvoiceId: true },
      }),
    ).resolves.toEqual({
      invoiceId: null,
      subscriptionProviderInvoiceId: renewalInvoice.id,
    });
  });
});

async function settleInitialPayment(fixture: Phase24BillingFixture) {
  const checkout = await createPhase24StarterCheckout(fixture);
  const providerPaymentReference = `pi_initial_${randomUUID().replaceAll("-", "")}`;
  const event = phase24ProviderEvent(checkout, {
    providerPaymentReference,
  });
  await projectPhase24ProviderEvent(fixture, event);
  return Object.freeze({
    checkout,
    providerPaymentReference,
    subscriptionReference: event.providerSubscriptionReference!,
  });
}

async function requestRefundResult(
  fixture: Phase24BillingFixture,
  input: Readonly<{
    amountRappen: number;
    orderId: string;
    reasonCode: string;
    subscriptionProviderInvoiceId?: string;
  }>,
) {
  const action = financeRefundRequestAction({
    amountRappen: input.amountRappen,
    companyId: fixture.companyId,
    orderId: input.orderId,
    reasonCode: input.reasonCode,
    ...(input.subscriptionProviderInvoiceId === undefined
      ? {}
      : {
          sourceKind: "SUBSCRIPTION_PROVIDER_INVOICE" as const,
          subscriptionProviderInvoiceId: input.subscriptionProviderInvoiceId,
        }),
  });
  const stepUpEvidenceId = await fixture.issueFinanceStepUp({
    action,
    purpose: "FINANCE_REFUND_REQUEST",
    userId: fixture.financeRequesterId,
  });
  return requestFinanceRefund(
    {
      amountRappen: input.amountRappen,
      companyId: fixture.companyId,
      correlationId: randomUUID(),
      idempotencyKey: `phase33-refund-${randomUUID()}`,
      orderId: input.orderId,
      reasonCode: input.reasonCode,
      stepUpEvidenceId,
      ...(input.subscriptionProviderInvoiceId === undefined
        ? {}
        : { subscriptionProviderInvoiceId: input.subscriptionProviderInvoiceId }),
    },
    {
      actor: {
        capabilities: ["FINANCE_REFUND_REQUEST"],
        userId: fixture.financeRequesterId,
      },
      database: fixture.database,
      financeRepairActionsEnabled: true,
      now: fixture.now,
    },
  );
}

async function requestRefund(
  fixture: Phase24BillingFixture,
  input: Parameters<typeof requestRefundResult>[1],
) {
  const result = await requestRefundResult(fixture, input);
  if (!result.ok) throw new Error(`REFUND_REQUEST_FAILED:${result.code}`);
  return result;
}

async function issueRefundApproval(
  fixture: Phase24BillingFixture,
  refundId: string,
) {
  return fixture.issueFinanceStepUp({
    action: financeRefundApprovalAction(refundId),
    purpose: "FINANCE_REFUND_APPROVE",
    userId: fixture.financeApproverId,
  });
}

function approveRefund(
  fixture: Phase24BillingFixture,
  refundId: string,
  approvalStepUpEvidenceId: string,
) {
  return approveAndSubmitFinanceRefund(
    {
      approvalStepUpEvidenceId,
      correlationId: randomUUID(),
      refundId,
    },
    {
      actor: {
        capabilities: ["FINANCE_REFUND_EXECUTE"],
        userId: fixture.financeApproverId,
      },
      database: fixture.database,
      financeRepairActionsEnabled: true,
      now: fixture.now,
      paymentProvider: fixture.provider,
    },
  );
}

function providerRefundReferenceFor(refundId: string) {
  return `re_${`refund:${refundId}`.replaceAll(/[^A-Za-z0-9]/gu, "")}`;
}
