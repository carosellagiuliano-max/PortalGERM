import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import {
  hashPassword,
  PASSWORD_HASH_POLICY_V1,
  verifyPassword,
} from "@/lib/auth/password";
import { buildNotificationStorageDedupeKey } from "@/lib/notifications/writer";
import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  openActor,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";

test.describe.configure({ mode: "serial" });

test("[E2E-03] @journey upgrades a full Free quota exactly once and publishes the next Job", async ({
  browser,
  page,
}) => {
  const database = phase17Database();
  let admin: Awaited<ReturnType<typeof openActor>> | undefined;
  let owner: Awaited<ReturnType<typeof openActor>> | undefined;
  try {
    const scenario = await prepareFreeQuotaScenario(database);
    const commercialBaseline = await commercialFingerprint(
      database,
      scenario.companyId,
    );
    expect(commercialBaseline.activeJobs).toBe(1);
    await assertDefaultFreeLimit(database, new Date());

    admin = await openActor(browser, DEMO_ACCOUNTS.admin);
    await moveSubmittedJobToApproved(admin.page, database, scenario);

    const publishedEventsBeforeDenial = await database.jobStatusEvent.count({
      where: { jobId: scenario.jobId, kind: "PUBLISHED" },
    });
    await admin.page
      .getByRole("button", { name: "Atomar veröffentlichen" })
      .click();
    await expect(
      admin.page.getByText(
        "Das aktuelle Nutzungslimit verhindert diese Aktion.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect
      .poll(() =>
        database.job.findUniqueOrThrow({
          where: { id: scenario.jobId },
          select: { status: true },
        }),
      )
      .toEqual({ status: "APPROVED" });
    expect(
      await database.jobStatusEvent.count({
        where: { jobId: scenario.jobId, kind: "PUBLISHED" },
      }),
    ).toBe(publishedEventsBeforeDenial);
    expect(
      await commercialFingerprint(database, scenario.companyId),
    ).toEqual(commercialBaseline);

    owner = await openActor(browser, scenario.ownerEmail);
    await owner.page.goto("/employer/billing");
    await expect(
      owner.page.getByRole("heading", {
        name: "Plan, Rechnungen und Guthaben",
      }),
    ).toBeVisible();
    await assertPlanMetric(owner.page, "Free Basic", "1 / 1");

    await owner.page.getByRole("link", { name: "Rechnungsprofil" }).click();
    await expect(
      owner.page.getByText(
        "Ohne vollständiges Schweizer Rechnungsprofil wird serverseitig keine Bestellung erstellt.",
        { exact: true },
      ),
    ).toBeVisible();
    await saveBillingProfile(owner.page, scenario);
    expect(
      await commercialFingerprint(database, scenario.companyId),
    ).toEqual(commercialBaseline);

    await owner.page.goto("/employer/billing");
    await owner.page
      .getByRole("link", { name: /Starter wählen/u })
      .click();
    await expect(
      owner.page.getByRole("heading", { name: "Bestellung prüfen" }),
    ).toBeVisible();
    await expect(
      owner.page.getByRole("heading", { name: "Starter", exact: true }),
    ).toBeVisible();
    await expect(owner.page.getByText("3 aktive Jobs", { exact: true })).toBeVisible();
    await expect(owner.page.getByText(/CHF\s*161\.07/u).first()).toBeVisible();
    await expect(owner.page.getByText(scenario.billing.legalName)).toBeVisible();

    await owner.page
      .getByRole("button", { name: "Zum sicheren Mock-Checkout" })
      .click();
    await expect(owner.page).toHaveURL(/\/mock\/checkout\/[0-9a-f-]{36}$/u);
    const orderId = orderIdFromMockCheckout(owner.page.url());
    await expect(
      owner.page.getByRole("heading", { name: "Mock-Checkout" }),
    ).toBeVisible();
    await expect(owner.page.getByText(/CHF\s*161\.07/u).first()).toBeVisible();

    expect(
      await commercialFingerprint(database, scenario.companyId),
    ).toEqual({
      ...commercialBaseline,
      orderLines: commercialBaseline.orderLines + 1,
      orders: commercialBaseline.orders + 1,
      paymentEvents: commercialBaseline.paymentEvents + 1,
    });
    await assertPendingStarterOrder(database, orderId, scenario);

    const paymentRequestPromise = owner.page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === `/mock/checkout/${orderId}`,
    );
    await owner.page.getByRole("button", { name: "Mock bezahlen" }).click();
    const paymentRequest = await paymentRequestPromise;
    await expect(owner.page).toHaveURL(
      new RegExp(
        `/employer/billing/success\\?order=${escapeRegExp(orderId)}$`,
        "u",
      ),
    );
    await expect(
      owner.page.getByRole("heading", {
        name: "Zahlung erfolgreich (Mock)",
      }),
    ).toBeVisible();
    await expect(
      owner.page.getByText(
        "Bestellung, Rechnung und Auslieferung wurden atomar verbucht.",
        { exact: true },
      ),
    ).toBeVisible();

    const replayResponse = await owner.context.request.fetch(paymentRequest, {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    const replayHeaders = replayResponse.headers();
    expect([200, 303]).toContain(replayResponse.status());
    expect(
      replayHeaders["x-action-redirect"] ?? replayHeaders.location,
    ).toContain(`/employer/billing/success?order=${orderId}`);
    await replayResponse.dispose();

    const paidEvidence = await assertPaidStarterEvidence(
      database,
      orderId,
      scenario,
    );
    expect(
      await commercialFingerprint(database, scenario.companyId),
    ).toEqual({
      ...commercialBaseline,
      invoiceLines: commercialBaseline.invoiceLines + 1,
      invoices: commercialBaseline.invoices + 1,
      orderLines: commercialBaseline.orderLines + 1,
      orders: commercialBaseline.orders + 1,
      paymentEvents: commercialBaseline.paymentEvents + 2,
      subscriptionEvents: commercialBaseline.subscriptionEvents + 1,
      subscriptions: commercialBaseline.subscriptions + 1,
    });

    await owner.page
      .getByRole("link", { name: "Rechnung ansehen" })
      .click();
    await expect(
      owner.page.getByRole("heading", {
        exact: true,
        level: 1,
        name: paidEvidence.invoiceNumber,
      }),
    ).toBeVisible();
    await expect(owner.page.getByText("Bezahlt", { exact: true })).toBeVisible();
    await expect(owner.page.getByText(/CHF\s*161\.07/u).first()).toBeVisible();

    await owner.page.goto("/employer/billing");
    await assertPlanMetric(owner.page, "Starter", "1 / 3");

    await admin.page.goto(`/admin/jobs/${scenario.jobId}`);
    await admin.page
      .getByRole("button", { name: "Atomar veröffentlichen" })
      .click();
    await expect(
      admin.page.getByText("PUBLISHED", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        database.job.findUniqueOrThrow({
          where: { id: scenario.jobId },
          select: { status: true },
        }),
      )
      .toEqual({ status: "PUBLISHED" });

    await page.goto(`/jobs/${scenario.jobSlug}`);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: scenario.jobTitle,
      }),
    ).toBeVisible();

    await assertPublishedJobEvidence(database, scenario);
    expect(
      await commercialFingerprint(database, scenario.companyId),
    ).toEqual({
      ...commercialBaseline,
      activeJobs: commercialBaseline.activeJobs + 1,
      invoiceLines: commercialBaseline.invoiceLines + 1,
      invoices: commercialBaseline.invoices + 1,
      orderLines: commercialBaseline.orderLines + 1,
      orders: commercialBaseline.orders + 1,
      paymentEvents: commercialBaseline.paymentEvents + 2,
      subscriptionEvents: commercialBaseline.subscriptionEvents + 1,
      subscriptions: commercialBaseline.subscriptions + 1,
    });
  } finally {
    await owner?.close();
    await admin?.close();
    await database.$disconnect();
  }
});

type Phase17Database = ReturnType<typeof phase17Database>;

type BillingScenario = Readonly<{
  billing: Readonly<{
    billingContactEmail: string;
    city: string;
    legalName: string;
    postalCode: string;
    street: string;
  }>;
  companyId: string;
  companyName: string;
  companySlug: string;
  jobId: string;
  jobSlug: string;
  jobTitle: string;
  ownerEmail: string;
  ownerUserId: string;
}>;

async function prepareFreeQuotaScenario(
  database: Phase17Database,
): Promise<BillingScenario> {
  const now = new Date();
  const companies = await database.company.findMany({
    where: {
      entitlementGrants: { none: {} },
      status: "ACTIVE",
      subscriptions: { none: {} },
      verificationRequests: {
        some: {
          status: "VERIFIED",
          supersededBy: null,
        },
      },
    },
    orderBy: { slug: "asc" },
    select: {
      billingProfile: { select: { id: true } },
      id: true,
      name: true,
      slug: true,
      jobs: {
        where: {
          status: "SUBMITTED",
          currentRevision: {
            is: {
              approvedAt: null,
              rejectedAt: null,
              submittedAt: { not: null },
              validThrough: { gt: now },
            },
          },
        },
        orderBy: { id: "asc" },
        take: 1,
        select: {
          id: true,
          slug: true,
          currentRevision: {
            select: {
              title: true,
            },
          },
        },
      },
      memberships: {
        where: {
          removedAt: null,
          role: "OWNER",
          status: "ACTIVE",
        },
        orderBy: { id: "asc" },
        select: {
          user: {
            select: {
              credential: {
                select: {
                  passwordHash: true,
                },
              },
              emailNormalized: true,
              id: true,
              role: true,
              status: true,
            },
          },
        },
      },
      verificationRequests: {
        where: {
          status: "VERIFIED",
          supersededBy: null,
        },
        select: { id: true },
      },
    },
  });
  const company = companies.find(
    (candidate) =>
      candidate.billingProfile === null &&
      candidate.jobs.length === 1 &&
      candidate.memberships.some(
        ({ user }) => user.role === "EMPLOYER" && user.status === "ACTIVE",
      ),
  );
  if (company === undefined) {
    throw new Error(
      "Phase 17 needs a verified Free seed Company with one submitted Job and no Billing profile.",
    );
  }
  expect(company.verificationRequests).toHaveLength(1);
  const membership = company.memberships.find(
    ({ user }) => user.role === "EMPLOYER" && user.status === "ACTIVE",
  );
  const job = company.jobs[0];
  if (
    membership === undefined ||
    job === undefined ||
    job.currentRevision === null
  ) {
    throw new Error("The selected Phase 17 Free quota fixture is incomplete.");
  }
  expect(
    await activeJobCount(database, company.id, now),
  ).toBe(1);
  expect(
    await database.moderationRestriction.count({
      where: {
        status: "ACTIVE",
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        AND: [
          {
            OR: [
              { targetType: "HIDE_JOB", targetId: job.id },
              { targetType: "PAUSE_COMPANY", targetId: company.id },
            ],
          },
        ],
      },
    }),
  ).toBe(0);

  if (membership.user.credential === null) {
    await database.credential.create({
      data: {
        id: randomUUID(),
        userId: membership.user.id,
        passwordHash: await hashPassword(DEMO_PASSWORD),
        algorithm: PASSWORD_HASH_POLICY_V1.algorithm,
        algorithmVersion: PASSWORD_HASH_POLICY_V1.algorithmVersion,
        passwordChangedAt: now,
      },
    });
  } else {
    expect(
      await verifyPassword(
        DEMO_PASSWORD,
        membership.user.credential.passwordHash,
      ),
    ).toBe(true);
  }

  return Object.freeze({
    billing: Object.freeze({
      billingContactEmail: `billing+phase17@${company.slug}.example.test`,
      city: "Olten",
      legalName: `${company.name} Phase 17`,
      postalCode: "4600",
      street: "Prüfweg 17",
    }),
    companyId: company.id,
    companyName: company.name,
    companySlug: company.slug,
    jobId: job.id,
    jobSlug: job.slug,
    jobTitle: job.currentRevision.title,
    ownerEmail: membership.user.emailNormalized,
    ownerUserId: membership.user.id,
  });
}

async function moveSubmittedJobToApproved(
  page: Page,
  database: Phase17Database,
  scenario: BillingScenario,
) {
  await page.goto(`/admin/jobs/${scenario.jobId}`);
  await expect(
    page.getByRole("heading", { name: scenario.jobTitle }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Prüfung starten" }).click();
  await expect(
    page.getByRole("button", { name: "Job freigeben" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      database.job.findUniqueOrThrow({
        where: { id: scenario.jobId },
        select: { status: true },
      }),
    )
    .toEqual({ status: "IN_REVIEW" });

  await page.reload();
  await page.getByRole("button", { name: "Job freigeben" }).click();
  await expect(
    page.getByRole("button", { name: "Atomar veröffentlichen" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      database.job.findUniqueOrThrow({
        where: { id: scenario.jobId },
        select: { status: true },
      }),
    )
    .toEqual({ status: "APPROVED" });
  await page.reload();
}

async function saveBillingProfile(page: Page, scenario: BillingScenario) {
  await page
    .getByLabel("Rechtlicher Firmenname")
    .fill(scenario.billing.legalName);
  await page
    .getByLabel("E-Mail für Rechnungen")
    .fill(scenario.billing.billingContactEmail);
  await page
    .getByLabel("Strasse und Hausnummer")
    .fill(scenario.billing.street);
  await page.getByLabel("PLZ").fill(scenario.billing.postalCode);
  await page.getByLabel("Ort", { exact: true }).fill(scenario.billing.city);
  await page
    .getByRole("button", { name: "Rechnungsprofil speichern" })
    .click();
  await expect(
    page.getByText("Rechnungsprofil sicher gespeichert.", { exact: true }),
  ).toBeVisible();
}

async function assertPlanMetric(
  page: Page,
  planName: string,
  activeJobs: string,
) {
  const planCard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Aktueller Plan" });
  const jobCard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Aktive Jobs" });
  await expect(planCard).toContainText(planName);
  await expect(jobCard).toContainText(activeJobs);
}

async function assertDefaultFreeLimit(
  database: Phase17Database,
  at: Date,
) {
  const versions = await database.planVersion.findMany({
    where: {
      status: "ACTIVE",
      validFrom: { lte: at },
      OR: [{ validTo: null }, { validTo: { gt: at } }],
      plan: { is: { isDefaultFree: true } },
    },
    select: {
      plan: { select: { code: true } },
      entitlements: {
        where: { key: "ACTIVE_JOB_LIMIT" },
        select: {
          integerValue: true,
          key: true,
          valueType: true,
        },
      },
    },
  });
  expect(versions).toEqual([
    {
      plan: { code: "FREE_BASIC" },
      entitlements: [
        {
          integerValue: 1,
          key: "ACTIVE_JOB_LIMIT",
          valueType: "INTEGER",
        },
      ],
    },
  ]);
}

async function assertPendingStarterOrder(
  database: Phase17Database,
  orderId: string,
  scenario: BillingScenario,
) {
  const order = await database.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      companyId: true,
      createdByUserId: true,
      invoice: { select: { id: true } },
      lines: {
        select: {
          fulfillmentContext: true,
          planVersion: {
            select: {
              plan: { select: { code: true } },
            },
          },
          productVersionId: true,
          subscriptionSnapshot: {
            select: {
              activeJobLimitSnapshot: true,
              changeKind: true,
              jobBoostAllowanceSnapshot: true,
              quotedNetRappen: true,
              seatLimitSnapshot: true,
              sourceSubscriptionId: true,
              talentContactAllowanceSnapshot: true,
            },
          },
        },
      },
      paymentEvents: {
        select: { kind: true },
      },
      provider: true,
      status: true,
      subscription: { select: { id: true } },
      totalRappen: true,
    },
  });
  expect(order).toEqual({
    companyId: scenario.companyId,
    createdByUserId: scenario.ownerUserId,
    invoice: null,
    lines: [
      {
        fulfillmentContext: "SUBSCRIPTION",
        planVersion: { plan: { code: "STARTER" } },
        productVersionId: null,
        subscriptionSnapshot: {
          activeJobLimitSnapshot: 3,
          changeKind: "NEW",
          jobBoostAllowanceSnapshot: 0,
          quotedNetRappen: 14_900,
          seatLimitSnapshot: 2,
          sourceSubscriptionId: null,
          talentContactAllowanceSnapshot: 0,
        },
      },
    ],
    paymentEvents: [{ kind: "CHECKOUT_CREATED" }],
    provider: "MOCK",
    status: "PENDING",
    subscription: null,
    totalRappen: 16_107,
  });
}

async function assertPaidStarterEvidence(
  database: Phase17Database,
  orderId: string,
  scenario: BillingScenario,
) {
  const order = await database.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      billingCitySnapshot: true,
      billingContactEmailSnapshot: true,
      billingLegalNameSnapshot: true,
      billingPostalCodeSnapshot: true,
      billingStreetSnapshot: true,
      companyId: true,
      createdByUserId: true,
      currency: true,
      invoice: {
        select: {
          billingCitySnapshot: true,
          billingContactEmailSnapshot: true,
          billingLegalNameSnapshot: true,
          billingPostalCodeSnapshot: true,
          billingStreetSnapshot: true,
          id: true,
          lines: {
            select: {
              currency: true,
              netRappen: true,
              orderLineId: true,
              quantity: true,
              taxRateBasisPoints: true,
              totalRappen: true,
              unitNetRappen: true,
              vatRappen: true,
            },
          },
          netTotalRappen: true,
          number: true,
          paidAt: true,
          status: true,
          totalRappen: true,
          vatTotalRappen: true,
        },
      },
      lines: {
        select: {
          additionalJobPermit: { select: { id: true } },
          creditLedgerEntries: { select: { id: true } },
          currency: true,
          fulfillmentContext: true,
          id: true,
          importAccessGrant: { select: { id: true } },
          jobBoost: { select: { id: true } },
          netRappen: true,
          planVersion: {
            select: {
              entitlements: {
                where: { key: "ACTIVE_JOB_LIMIT" },
                select: {
                  integerValue: true,
                  key: true,
                  valueType: true,
                },
              },
              plan: {
                select: {
                  code: true,
                },
              },
            },
          },
          productVersionId: true,
          quantity: true,
          subscriptionSnapshot: {
            select: {
              activeJobLimitSnapshot: true,
              changeKind: true,
              jobBoostAllowanceSnapshot: true,
              quotedNetRappen: true,
              retainedDefaultOwnerId: true,
              retainedMembershipIds: true,
              seatLimitSnapshot: true,
              sourceSubscriptionId: true,
              talentContactAllowanceSnapshot: true,
              targetRecurringNetRappen: true,
            },
          },
          targetCreditType: true,
          targetImportSetupApprovalId: true,
          targetImportSourceId: true,
          targetJobId: true,
          taxRateBasisPoints: true,
          totalRappen: true,
          unitNetRappen: true,
          vatRappen: true,
        },
      },
      netTotalRappen: true,
      paidAt: true,
      paymentEvents: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          idempotencyKey: true,
          kind: true,
          provider: true,
          providerReference: true,
        },
      },
      provider: true,
      status: true,
      subscription: {
        select: {
          activatedAt: true,
          billingIntervalSnapshot: true,
          currencySnapshot: true,
          currentPeriodEnd: true,
          currentPeriodStart: true,
          events: {
            select: {
              kind: true,
              reasonCode: true,
            },
          },
          id: true,
          monthlyEquivalentRappenSnapshot: true,
          planAllowanceEntries: { select: { id: true } },
          planVersion: {
            select: {
              entitlements: {
                where: { key: "ACTIVE_JOB_LIMIT" },
                select: {
                  integerValue: true,
                  key: true,
                  valueType: true,
                },
              },
              plan: { select: { code: true } },
            },
          },
          recurringNetRappenSnapshot: true,
          sourceOrderId: true,
          status: true,
          termMonthsSnapshot: true,
        },
      },
      totalRappen: true,
      vatTotalRappen: true,
    },
  });
  expect(order).toMatchObject({
    billingCitySnapshot: scenario.billing.city,
    billingContactEmailSnapshot: scenario.billing.billingContactEmail,
    billingLegalNameSnapshot: scenario.billing.legalName,
    billingPostalCodeSnapshot: scenario.billing.postalCode,
    billingStreetSnapshot: scenario.billing.street,
    companyId: scenario.companyId,
    createdByUserId: scenario.ownerUserId,
    currency: "CHF",
    netTotalRappen: 14_900,
    provider: "MOCK",
    status: "PAID",
    totalRappen: 16_107,
    vatTotalRappen: 1_207,
  });
  expect(order.paidAt).not.toBeNull();
  expect(order.paymentEvents).toHaveLength(2);
  expect(
    order.paymentEvents.map(({ kind }) => kind).sort(),
  ).toEqual(["CHECKOUT_CREATED", "PAID"]);
  expect(
    order.paymentEvents.filter(({ kind }) => kind === "CHECKOUT_CREATED"),
  ).toEqual([
    expect.objectContaining({
      idempotencyKey: `checkout-created:${orderId}`,
      provider: "MOCK",
      providerReference: null,
    }),
  ]);
  expect(
    order.paymentEvents.filter(({ kind }) => kind === "PAID"),
  ).toEqual([
    expect.objectContaining({
      idempotencyKey: `paid:${orderId}`,
      provider: "MOCK",
      providerReference: expect.any(String),
    }),
  ]);

  expect(order.lines).toHaveLength(1);
  const line = order.lines[0]!;
  expect(line).toMatchObject({
    additionalJobPermit: null,
    creditLedgerEntries: [],
    currency: "CHF",
    fulfillmentContext: "SUBSCRIPTION",
    importAccessGrant: null,
    jobBoost: null,
    netRappen: 14_900,
    planVersion: {
      entitlements: [
        {
          integerValue: 3,
          key: "ACTIVE_JOB_LIMIT",
          valueType: "INTEGER",
        },
      ],
      plan: { code: "STARTER" },
    },
    productVersionId: null,
    quantity: 1,
    subscriptionSnapshot: {
      activeJobLimitSnapshot: 3,
      changeKind: "NEW",
      jobBoostAllowanceSnapshot: 0,
      quotedNetRappen: 14_900,
      retainedDefaultOwnerId: null,
      retainedMembershipIds: [],
      seatLimitSnapshot: 2,
      sourceSubscriptionId: null,
      talentContactAllowanceSnapshot: 0,
      targetRecurringNetRappen: 14_900,
    },
    targetCreditType: null,
    targetImportSetupApprovalId: null,
    targetImportSourceId: null,
    targetJobId: null,
    taxRateBasisPoints: 810,
    totalRappen: 16_107,
    unitNetRappen: 14_900,
    vatRappen: 1_207,
  });

  expect(order.invoice).not.toBeNull();
  const invoice = order.invoice!;
  expect(invoice).toMatchObject({
    billingCitySnapshot: scenario.billing.city,
    billingContactEmailSnapshot: scenario.billing.billingContactEmail,
    billingLegalNameSnapshot: scenario.billing.legalName,
    billingPostalCodeSnapshot: scenario.billing.postalCode,
    billingStreetSnapshot: scenario.billing.street,
    netTotalRappen: 14_900,
    status: "PAID",
    totalRappen: 16_107,
    vatTotalRappen: 1_207,
  });
  expect(invoice.number).toMatch(/^STH-\d{4}-\d{5}$/u);
  expect(invoice.paidAt).not.toBeNull();
  expect(invoice.lines).toEqual([
    {
      currency: "CHF",
      netRappen: 14_900,
      orderLineId: line.id,
      quantity: 1,
      taxRateBasisPoints: 810,
      totalRappen: 16_107,
      unitNetRappen: 14_900,
      vatRappen: 1_207,
    },
  ]);

  expect(order.subscription).not.toBeNull();
  const subscription = order.subscription!;
  expect(subscription).toMatchObject({
    billingIntervalSnapshot: "MONTHLY",
    currencySnapshot: "CHF",
    events: [{ kind: "ACTIVATED", reasonCode: "NEW_PLAN" }],
    monthlyEquivalentRappenSnapshot: 14_900,
    planAllowanceEntries: [],
    planVersion: {
      entitlements: [
        {
          integerValue: 3,
          key: "ACTIVE_JOB_LIMIT",
          valueType: "INTEGER",
        },
      ],
      plan: { code: "STARTER" },
    },
    recurringNetRappenSnapshot: 14_900,
    sourceOrderId: orderId,
    status: "ACTIVE",
    termMonthsSnapshot: 1,
  });
  expect(subscription.activatedAt).not.toBeNull();
  expect(subscription.currentPeriodStart.getTime()).toBeLessThan(
    subscription.currentPeriodEnd.getTime(),
  );

  const notificationDedupeKeys = {
    invoice: buildNotificationStorageDedupeKey({
      recipientUserId: scenario.ownerUserId,
      kind: "INVOICE_ISSUED",
      dedupeKey: `billing:${orderId}:invoice`,
    }),
    paid: buildNotificationStorageDedupeKey({
      recipientUserId: scenario.ownerUserId,
      kind: "ORDER_PAID",
      dedupeKey: `billing:${orderId}:paid`,
    }),
    subscription: buildNotificationStorageDedupeKey({
      recipientUserId: scenario.ownerUserId,
      kind: "SUBSCRIPTION_CHANGED",
      dedupeKey: `billing:${orderId}:subscription`,
    }),
  };
  const notifications = await database.notification.findMany({
    where: {
      recipientUserId: scenario.ownerUserId,
      dedupeKey: {
        in: Object.values(notificationDedupeKeys),
      },
    },
    orderBy: { dedupeKey: "asc" },
    select: {
      dedupeKey: true,
      kind: true,
    },
  });
  expect(
    [...notifications].sort((left, right) =>
      left.kind.localeCompare(right.kind),
    ),
  ).toEqual([
    {
      dedupeKey: notificationDedupeKeys.invoice,
      kind: "INVOICE_ISSUED",
    },
    {
      dedupeKey: notificationDedupeKeys.paid,
      kind: "ORDER_PAID",
    },
    {
      dedupeKey: notificationDedupeKeys.subscription,
      kind: "SUBSCRIPTION_CHANGED",
    },
  ]);

  const billingEmails = await database.emailLog.findMany({
    where: {
      recipient: scenario.billing.billingContactEmail,
      templateKey: {
        in: [
          "invoice_issued",
          "payment_received",
          "subscription_activated",
        ],
      },
    },
    orderBy: { templateKey: "asc" },
    select: {
      status: true,
      templateKey: true,
    },
  });
  expect(billingEmails).toEqual([
    { status: "MOCK_RECORDED", templateKey: "invoice_issued" },
    { status: "MOCK_RECORDED", templateKey: "payment_received" },
    { status: "MOCK_RECORDED", templateKey: "subscription_activated" },
  ]);

  const auditCounts = await Promise.all([
    database.auditLog.count({
      where: {
        action: "CHECKOUT_CREATED",
        targetId: orderId,
        targetType: "ORDER",
      },
    }),
    database.auditLog.count({
      where: {
        action: "ORDER_PAID",
        targetId: orderId,
        targetType: "ORDER",
      },
    }),
    database.auditLog.count({
      where: {
        action: "INVOICE_ISSUED",
        targetId: invoice.id,
        targetType: "INVOICE",
      },
    }),
    database.auditLog.count({
      where: {
        action: "INVOICE_PAID",
        targetId: invoice.id,
        targetType: "INVOICE",
      },
    }),
    database.auditLog.count({
      where: {
        action: "SUBSCRIPTION_ACTIVATED",
        targetId: subscription.id,
        targetType: "SUBSCRIPTION",
      },
    }),
  ]);
  expect(auditCounts).toEqual([1, 1, 1, 1, 1]);

  return Object.freeze({
    invoiceNumber: invoice.number,
    subscriptionId: subscription.id,
  });
}

async function assertPublishedJobEvidence(
  database: Phase17Database,
  scenario: BillingScenario,
) {
  const job = await database.job.findUniqueOrThrow({
    where: { id: scenario.jobId },
    select: {
      currentRevisionId: true,
      expiresAt: true,
      publishedAt: true,
      publishedCategoryId: true,
      publishedCantonId: true,
      publishedRevisionId: true,
      status: true,
      statusEvents: {
        where: { kind: "PUBLISHED" },
        select: {
          fromStatus: true,
          kind: true,
          toStatus: true,
        },
      },
    },
  });
  expect(job).toMatchObject({
    publishedCategoryId: expect.any(String),
    publishedCantonId: expect.any(String),
    status: "PUBLISHED",
    statusEvents: [
      {
        fromStatus: "APPROVED",
        kind: "PUBLISHED",
        toStatus: "PUBLISHED",
      },
    ],
  });
  expect(job.currentRevisionId).toBe(job.publishedRevisionId);
  expect(job.publishedAt).not.toBeNull();
  expect(job.expiresAt).not.toBeNull();
  expect(
    await database.auditLog.count({
      where: {
        action: "JOB_PUBLISHED",
        targetId: scenario.jobId,
        targetType: "JOB",
      },
    }),
  ).toBe(1);
}

async function commercialFingerprint(
  database: Phase17Database,
  companyId: string,
) {
  const now = new Date();
  const [
    activeJobs,
    additionalJobPermits,
    creditAccounts,
    creditLedgerEntries,
    entitlementGrants,
    invoiceLines,
    invoices,
    orderLines,
    orders,
    paymentEvents,
    subscriptionChangeSchedules,
    subscriptionEvents,
    subscriptions,
  ] = await Promise.all([
    activeJobCount(database, companyId, now),
    database.additionalJobPermit.count({ where: { companyId } }),
    database.creditAccount.count({ where: { companyId } }),
    database.creditLedgerEntry.count({
      where: { account: { companyId } },
    }),
    database.entitlementGrant.count({ where: { companyId } }),
    database.invoiceLine.count({
      where: { invoice: { companyId } },
    }),
    database.invoice.count({ where: { companyId } }),
    database.orderLine.count({
      where: { order: { companyId } },
    }),
    database.order.count({ where: { companyId } }),
    database.paymentEvent.count({
      where: { order: { companyId } },
    }),
    database.subscriptionChangeSchedule.count({ where: { companyId } }),
    database.subscriptionEvent.count({
      where: { subscription: { companyId } },
    }),
    database.employerSubscription.count({ where: { companyId } }),
  ]);
  return Object.freeze({
    activeJobs,
    additionalJobPermits,
    creditAccounts,
    creditLedgerEntries,
    entitlementGrants,
    invoiceLines,
    invoices,
    orderLines,
    orders,
    paymentEvents,
    subscriptionChangeSchedules,
    subscriptionEvents,
    subscriptions,
  });
}

function activeJobCount(
  database: Phase17Database,
  companyId: string,
  now: Date,
) {
  return database.job.count({
    where: {
      companyId,
      expiresAt: { gt: now },
      publishedAt: { lte: now },
      status: "PUBLISHED",
    },
  });
}

function orderIdFromMockCheckout(pageUrl: string) {
  const match = new URL(pageUrl).pathname.match(
    /^\/mock\/checkout\/([0-9a-f-]{36})$/u,
  );
  if (match?.[1] === undefined) {
    throw new Error("The local Mock checkout URL did not expose an Order UUID.");
  }
  return match[1];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
