import { createHash, randomUUID } from "node:crypto";

import {
  request as playwrightRequest,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  login,
  observePage,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";

test.describe.configure({ mode: "serial" });

test("[F34-PAY-002][F34-SEC-003] @phase34 preview trusts its direct Next peer, rejects malformed forwarded chains and blocks every legacy mock-checkout route without a write", async ({
  browser,
}) => {
  const previewBaseUrl = requiredEnvironment("PHASE34_PREVIEW_BASE_URL");
  const database = phase17Database();
  let previewContext: BrowserContext | undefined;
  try {
    const before = await commercialFingerprint(database);
    const malformedForwardedTopology = await playwrightRequest.newContext({
      baseURL: previewBaseUrl,
      extraHTTPHeaders: { "x-forwarded-for": "not-an-ip" },
    });
    try {
      // `next start` is the immediate trusted hop in this self-hosted gate. If
      // X-Forwarded-For is absent, Next derives it from the connected peer
      // before the application proxy runs. A raw missing-header request is
      // therefore valid here; the unit proxy contract separately proves that
      // a strict public request object with no trusted topology fails closed.
      const directPeer = await fetch(`${previewBaseUrl}/login`, {
        redirect: "manual",
      });
      const malformed = await malformedForwardedTopology.get("/login", {
        failOnStatusCode: false,
      });
      expect(directPeer.status).toBe(200);
      expect(malformed.status()).toBe(400);
      expect(directPeer.headers.get("cache-control")).toContain("no-store");
      expect(malformed.headers()["cache-control"]).toBe("no-store");
    } finally {
      await malformedForwardedTopology.dispose();
    }

    previewContext = await browser.newContext({
      baseURL: previewBaseUrl,
      locale: "de-CH",
      timezoneId: "Europe/Zurich",
      serviceWorkers: "block",
      extraHTTPHeaders: { "x-forwarded-for": "198.51.100.34" },
    });
    const previewPage = await previewContext.newPage();
    const observation = await observePage(previewPage);
    const pricing = await previewPage.goto("/pricing");
    expect(pricing?.status()).toBe(200);
    await expect(
      previewPage.getByText(
        "Self-Service-Käufe serverseitig gesperrt · Angebote unverbindlich",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      previewPage.getByText(/Lokaler Mock-Checkout/u),
    ).toHaveCount(0);

    const directCheckout = await previewPage.goto(
      `/mock/checkout/${randomUUID()}`,
    );
    expect(directCheckout?.status()).toBe(404);
    await expect(
      previewPage.getByRole("heading", { name: "Mock-Checkout" }),
    ).toHaveCount(0);
    expect(await commercialFingerprint(database)).toEqual(before);
    observation.assertClean();
  } finally {
    await previewContext?.close();
    await database.$disconnect();
  }
});

test("[F34-DATA-001] @phase34 public response evidence stays synthetic locally and unknown in preview without a write", async ({
  browser,
  page,
}) => {
  const database = phase17Database();
  let previewContext: BrowserContext | undefined;
  try {
    const fixture = await loadResponseEvidenceFixture(database);
    const before = await responseEvidenceFingerprint(
      database,
      fixture.companyId,
      fixture.jobId,
    );
    const query = new URLSearchParams({
      keyword: fixture.title,
      sort: "response",
      evidence: "response",
    }).toString();

    // Search-result analytics are a separate owning flow. Suppressing that
    // expected telemetry write lets this journey prove that merely rendering
    // or forging response-evidence controls cannot mutate business state.
    await page.route("**/api/analytics/public-jobs", async (route) => {
      await route.fulfill({ status: 204 });
    });
    const localResponse = await page.goto(`/jobs?${query}`);
    expect(localResponse?.status()).toBe(200);
    const localCard = publicJobCard(page, fixture.title);
    await expect(localCard).toBeVisible();
    await expect(
      localCard.getByText(fixture.expectedKnownSignal, { exact: true }),
    ).toBeVisible();
    const localSort = page.getByRole("combobox", { name: "Sortierung" });
    await expect(localSort).toHaveValue("response");
    await expect(localSort.locator("option:checked")).toHaveText(
      "Antwortverhalten",
    );
    await page
      .locator("summary")
      .filter({ hasText: "Weitere Filter" })
      .click();
    await expect(
      page.getByRole("checkbox", { name: "Belastbares Antwortsignal" }),
    ).toBeChecked();

    previewContext = await browser.newContext({
      baseURL: requiredEnvironment("PHASE34_PREVIEW_BASE_URL"),
      locale: "de-CH",
      timezoneId: "Europe/Zurich",
      serviceWorkers: "block",
      extraHTTPHeaders: { "x-forwarded-for": "198.51.100.35" },
    });
    const previewPage = await previewContext.newPage();
    const previewObservation = await observePage(previewPage);
    await previewPage.route(
      "**/api/analytics/public-jobs",
      async (route) => {
        await route.fulfill({ status: 204 });
      },
    );
    const previewResponse = await previewPage.goto(`/jobs?${query}`);
    expect(previewResponse?.status()).toBe(200);
    const previewCard = publicJobCard(previewPage, fixture.title);
    await expect(previewCard).toBeVisible();
    await expect(
      previewCard.getByText("Antwortverhalten noch nicht belastbar", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      previewCard.getByText(fixture.expectedKnownSignal, { exact: true }),
    ).toHaveCount(0);
    await previewPage
      .locator("summary")
      .filter({ hasText: "Weitere Filter" })
      .click();
    await expect(
      previewPage.getByRole("option", { name: "Antwortverhalten" }),
    ).toHaveCount(0);
    await expect(
      previewPage.getByRole("checkbox", {
        name: "Belastbares Antwortsignal",
      }),
    ).toHaveCount(0);
    await expect(
      previewPage.getByRole("combobox", { name: "Sortierung" }),
    ).toHaveValue("relevance");
    await expect(previewPage.getByRole("status")).toContainText(
      "Die Suche wurde ohne Antwortsignal und nach Relevanz ausgeführt",
    );

    expect(
      await responseEvidenceFingerprint(
        database,
        fixture.companyId,
        fixture.jobId,
      ),
    ).toEqual(before);
    previewObservation.assertClean();
  } finally {
    await previewContext?.close();
    await database.$disconnect();
  }
});

test("[F34-COMPANY-001] @phase34 an admin closes one suspended company completely while unresolved billing blocks another", async ({
  page,
}) => {
  const database = phase17Database();
  try {
    const fixture = await createClosureFixture(database);
    await login(page, DEMO_ACCOUNTS.admin, DEMO_PASSWORD);
    await page.goto(`/admin/companies/${fixture.closableCompanyId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: fixture.closableCompanyName }),
    ).toBeVisible();

    const closureForm = page.locator("form").filter({
      has: page.getByRole("button", { name: "Firma endgültig schliessen" }),
    });
    await closureForm
      .getByLabel("Zur Bestätigung FIRMA_SCHLIESSEN eingeben")
      .fill("FIRMA_SCHLIESSEN");
    await closureForm
      .getByRole("button", { name: "Firma endgültig schliessen" })
      .click();
    await expect(
      page.getByText("CLOSED", { exact: true }),
    ).toBeVisible();
    await expect(closureForm).toHaveCount(0);

    await expect
      .poll(() =>
        database.company.findUniqueOrThrow({
          where: { id: fixture.closableCompanyId },
          select: { status: true },
        }),
      )
      .toEqual({ status: "CLOSED" });
    await expect(
      database.job.findUniqueOrThrow({
        where: { id: fixture.publishedJobId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "PAUSED" });
    await expect(
      database.radarOpaqueMapping.findUniqueOrThrow({
        where: { id: fixture.radarMappingId },
        select: { revokedAt: true, revocationReason: true },
      }),
    ).resolves.toEqual({
      revokedAt: expect.any(Date),
      revocationReason: "COMPANY_INACTIVE",
    });
    expect(
      await database.companyStatusEvent.count({
        where: { companyId: fixture.closableCompanyId, kind: "CLOSED" },
      }),
    ).toBe(1);
    expect(
      await database.auditLog.count({
        where: {
          targetId: fixture.closableCompanyId,
          action: "COMPANY_CLOSED",
          result: "SUCCEEDED",
        },
      }),
    ).toBe(1);

    await page.goto(`/admin/companies/${fixture.blockedCompanyId}`);
    await expect(
      page.getByText(/Der endgültige Abschluss ist gesperrt/u),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Firma endgültig schliessen" }),
    ).toHaveCount(0);
    await expect(
      database.company.findUniqueOrThrow({
        where: { id: fixture.blockedCompanyId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "SUSPENDED" });
    expect(
      await database.companyStatusEvent.count({
        where: { companyId: fixture.blockedCompanyId, kind: "CLOSED" },
      }),
    ).toBe(0);
    expect(
      await database.auditLog.count({
        where: {
          targetId: fixture.blockedCompanyId,
          action: "COMPANY_CLOSED",
        },
      }),
    ).toBe(0);
  } finally {
    await database.$disconnect();
  }
});

type Phase34Database = ReturnType<typeof phase17Database>;

function publicJobCard(page: Page, title: string) {
  return page.locator('[data-slot="card"]').filter({
    has: page.getByRole("heading", { level: 3, name: title, exact: true }),
  });
}

async function loadResponseEvidenceFixture(database: Phase34Database) {
  const now = new Date();
  const job = await database.job.findFirstOrThrow({
    where: {
      status: "PUBLISHED",
      publishedAt: { lte: now },
      expiresAt: { gt: now },
      company: {
        status: "ACTIVE",
        responseTargetDays: { gte: 1, lte: 30 },
        responseSampleSize: { gte: 20 },
        responseWithinTargetBps: { gte: 0, lte: 10_000 },
      },
      publishedRevision: {
        is: {
          approvedAt: { not: null },
          rejectedAt: null,
          validThrough: { gt: now },
        },
      },
    },
    orderBy: { slug: "asc" },
    select: {
      id: true,
      companyId: true,
      currentRevisionId: true,
      publishedRevisionId: true,
      expiresAt: true,
      company: {
        select: {
          responseTargetDays: true,
          responseSampleSize: true,
          responseWithinTargetBps: true,
        },
      },
      publishedRevision: {
        select: { id: true, title: true, validThrough: true },
      },
    },
  });
  const targetDays = job.company.responseTargetDays;
  const rateBasisPoints = job.company.responseWithinTargetBps;
  if (
    job.currentRevisionId === null ||
    job.publishedRevisionId === null ||
    job.currentRevisionId !== job.publishedRevisionId ||
    job.publishedRevision?.id !== job.publishedRevisionId ||
    job.expiresAt === null ||
    job.publishedRevision.validThrough === null ||
    job.expiresAt.getTime() !== job.publishedRevision.validThrough.getTime() ||
    targetDays === null ||
    rateBasisPoints === null
  ) {
    throw new Error(
      "The seeded response-evidence fixture is not canonically publishable.",
    );
  }
  return Object.freeze({
    companyId: job.companyId,
    jobId: job.id,
    title: job.publishedRevision.title,
    expectedKnownSignal: `${Math.round(rateBasisPoints / 100)}% antworten innert ${targetDays} Tagen`,
  });
}

async function responseEvidenceFingerprint(
  database: Phase34Database,
  companyId: string,
  jobId: string,
) {
  const [company, job, counts] = await Promise.all([
    database.company.findUniqueOrThrow({
      where: { id: companyId },
      select: {
        id: true,
        status: true,
        responseTargetDays: true,
        responseSampleSize: true,
        responseWithinTargetBps: true,
        updatedAt: true,
      },
    }),
    database.job.findUniqueOrThrow({
      where: { id: jobId },
      select: {
        id: true,
        status: true,
        version: true,
        currentRevisionId: true,
        publishedRevisionId: true,
        publishedAt: true,
        expiresAt: true,
        updatedAt: true,
      },
    }),
    Promise.all([
      database.application.count(),
      database.savedJob.count(),
      database.jobStatusEvent.count(),
      database.companyStatusEvent.count(),
      database.auditLog.count(),
      database.analyticsEvent.count(),
      database.searchLearningEvent.count(),
    ]),
  ]);
  return Object.freeze({ company, job, counts: Object.freeze(counts) });
}

async function commercialFingerprint(database: Phase34Database) {
  const [orders, invoices, paymentEvents, subscriptions, credits, boosts] =
    await Promise.all([
      database.order.count(),
      database.invoice.count(),
      database.paymentEvent.count(),
      database.employerSubscription.count(),
      database.creditLedgerEntry.count(),
      database.jobBoost.count(),
    ]);
  return Object.freeze({
    orders,
    invoices,
    paymentEvents,
    subscriptions,
    credits,
    boosts,
  });
}

async function createClosureFixture(database: Phase34Database) {
  const suffix = randomUUID().slice(0, 8);
  const now = new Date();
  const validThrough = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000);
  const [employer, candidate, category, canton, paidPlanVersion] =
    await Promise.all([
      database.user.findUniqueOrThrow({
        where: { emailNormalized: DEMO_ACCOUNTS.employer },
        select: { id: true },
      }),
      database.user.findUniqueOrThrow({
        where: { emailNormalized: DEMO_ACCOUNTS.candidate },
        select: { candidateProfile: { select: { id: true } } },
      }),
      database.category.findFirstOrThrow({
        where: { isActive: true },
        orderBy: { id: "asc" },
        select: { id: true },
      }),
      database.canton.findFirstOrThrow({
        orderBy: { id: "asc" },
        select: {
          id: true,
          cities: { orderBy: { id: "asc" }, take: 1, select: { id: true } },
        },
      }),
      database.planVersion.findFirstOrThrow({
        where: { plan: { isDefaultFree: false }, status: "ACTIVE" },
        orderBy: { id: "asc" },
        select: {
          id: true,
          billingInterval: true,
          termMonths: true,
          netPriceRappen: true,
          monthlyEquivalentRappen: true,
          currency: true,
        },
      }),
    ]);
  if (candidate.candidateProfile === null) {
    throw new Error("The seeded candidate profile is missing.");
  }
  const cityId = canton.cities[0]?.id ?? null;
  const closableCompanyName = `Phase 34 Abschluss ${suffix} AG`;
  const [closable, blocked] = await Promise.all([
    database.company.create({
      data: {
        name: closableCompanyName,
        slug: `phase34-close-${suffix}`,
        status: "SUSPENDED",
        dataProvenance: "TEST",
        industry: "Technology",
        about: "Reproduzierbare E2E-Firma für den endgültigen Abschluss.",
        memberships: {
          create: { userId: employer.id, role: "OWNER", status: "ACTIVE" },
        },
      },
      select: { id: true },
    }),
    database.company.create({
      data: {
        name: `Phase 34 Billingblock ${suffix} AG`,
        slug: `phase34-close-blocked-${suffix}`,
        status: "SUSPENDED",
        dataProvenance: "TEST",
        industry: "Technology",
        about: "Reproduzierbare E2E-Firma mit offenem Abo.",
        memberships: {
          create: { userId: employer.id, role: "OWNER", status: "ACTIVE" },
        },
      },
      select: { id: true },
    }),
  ]);
  const job = await database.job.create({
    data: {
      companyId: closable.id,
      slug: `phase34-close-job-${suffix}`,
      status: "DRAFT",
      dataProvenance: "TEST",
      createdByUserId: employer.id,
    },
    select: { id: true },
  });
  const revision = await database.jobRevision.create({
    data: {
      jobId: job.id,
      revisionNumber: 1,
      title: "Phase 34 Abschlussstelle",
      description:
        "Eine echte Browserreise prüft, dass der Firmenabschluss diese Stelle pausiert.",
      tasks: ["Sicheren Firmenabschluss prüfen"],
      requirements: ["Nachvollziehbare Evidence"],
      applicationProcessSteps: ["Bewerbung", "Gespräch"],
      requiredDocumentKinds: ["CV"],
      jobType: "PERMANENT",
      remoteType: "HYBRID",
      categoryId: category.id,
      cantonId: canton.id,
      cityId,
      locationLabel: "Schweiz",
      workloadMin: 80,
      workloadMax: 100,
      salaryPeriod: "YEARLY",
      salaryMin: 100_000,
      salaryMax: 120_000,
      validThrough,
      responseTargetDays: 7,
      applicationEffort: "SIMPLE",
      applicationContactKind: "EMAIL",
      applicationContactValue: "jobs@example.test",
      authoredByUserId: employer.id,
      contentChecksum: createHash("sha256")
        .update(`phase34-close-job:${job.id}`, "utf8")
        .digest("hex"),
      submittedAt: new Date(now.getTime() - 2_000),
      approvedAt: new Date(now.getTime() - 1_000),
    },
    select: { id: true },
  });
  await database.job.update({
    where: { id: job.id },
    data: {
      status: "PUBLISHED",
      currentRevisionId: revision.id,
      publishedRevisionId: revision.id,
      publishedAt: now,
      expiresAt: validThrough,
      publishedCategoryId: category.id,
      publishedCantonId: canton.id,
      publishedCityId: cityId,
      publishedSalaryPeriod: "YEARLY",
      publishedSalaryMin: 100_000,
      publishedSalaryMax: 120_000,
    },
  });
  const mapping = await database.radarOpaqueMapping.create({
    data: {
      candidateProfileId: candidate.candidateProfile.id,
      companyId: closable.id,
      epoch: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      lookupHmac: createHash("sha256")
        .update(`phase34-close-map:${closable.id}`, "utf8")
        .digest("hex"),
      encryptedToken: Buffer.alloc(32, 34),
      nonce: Buffer.alloc(12, 3),
      authTag: Buffer.alloc(16, 4),
      lookupKeyVersion: "phase34-lookup-v1",
      encryptionKeyVersion: "phase34-encryption-v1",
      validFrom: now,
      validTo: validThrough,
    },
    select: { id: true },
  });
  await database.employerSubscription.create({
    data: {
      companyId: blocked.id,
      planVersionId: paidPlanVersion.id,
      status: "ACTIVE",
      currentPeriodStart: now,
      currentPeriodEnd: validThrough,
      billingIntervalSnapshot: paidPlanVersion.billingInterval,
      termMonthsSnapshot: paidPlanVersion.termMonths,
      recurringNetRappenSnapshot: requiredMoney(
        paidPlanVersion.netPriceRappen,
        "paid plan net price",
      ),
      monthlyEquivalentRappenSnapshot:
        requiredMoney(
          paidPlanVersion.monthlyEquivalentRappen,
          "paid plan monthly equivalent",
        ),
      currencySnapshot: paidPlanVersion.currency,
      activatedAt: now,
    },
  });

  return Object.freeze({
    blockedCompanyId: blocked.id,
    closableCompanyId: closable.id,
    closableCompanyName,
    publishedJobId: job.id,
    radarMappingId: mapping.id,
  });
}

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for Phase 34 browser tests.`);
  }
  return value;
}

function requiredMoney(value: number | null, label: string) {
  if (!Number.isSafeInteger(value) || value === null || value < 0) {
    throw new Error(`The ${label} is not a valid money snapshot.`);
  }
  return value;
}
