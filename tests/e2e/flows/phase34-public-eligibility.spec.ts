import { createHash, randomUUID } from "node:crypto";

import type { Browser, BrowserContext, Page } from "@playwright/test";

import {
  buildPublicationFingerprintV1,
  calculateJobFreshnessScheduleV1,
  JOB_FRESHNESS_POLICY_V1,
} from "@/lib/jobs/freshness-policy";
import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  login,
  observePage,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";
import {
  createCompanyTrustCase,
  createFreshCompanyTrustEvidence,
} from "@/tests/e2e/fixtures/phase25-security";

const DAY_MILLISECONDS = 86_400_000;
const PUBLIC_JOB_ANALYTICS_ROUTE = "**/api/analytics/public-jobs";

type Database = ReturnType<typeof phase17Database>;

type PublishedFixtureJob = Readonly<{
  id: string;
  slug: string;
  title: string;
}>;

type PublicEligibilityFixture = Readonly<{
  companyId: string;
  companyName: string;
  companySlug: string;
  employerEmail: string;
  expiredCompanyId: string;
  expiredRequestId: string;
  jobs: Readonly<{
    demo: PublishedFixtureJob;
    expiredTrust: PublishedFixtureJob;
    live: PublishedFixtureJob;
    salaryUnavailable: PublishedFixtureJob;
    stale: PublishedFixtureJob;
    test: PublishedFixtureJob;
  }>;
  requestId: string;
  token: string;
}>;

test.describe.configure({ mode: "serial" });

/**
 * This is deliberately finding-labelled rather than E2E-34-03/11/15:
 * Phase 34's real browser harness runs local + preview, where indexing and the
 * strong public badge are globally disabled. The journey proves every
 * reachable HTTP boundary without turning preview evidence into a production
 * claim. Production indexing, the strong badge cutover and the provider-backed
 * Salary Radar remain separate activation evidence.
 */
test("[F34-SEARCH-001][F34-SEARCH-010][F34-SEO-001] @phase34 public eligibility stays consistent through freshness, provenance and a real trust revoke", async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const database = phase17Database();
  let fixture: PublicEligibilityFixture | undefined;
  let previewContext: BrowserContext | undefined;

  try {
    fixture = await createPublicEligibilityFixture(
      database,
      `${testInfo.project.name}-${randomUUID().replaceAll("-", "").slice(0, 10)}`,
    );
    const unrelated = await loadUnrelatedSeedJob(database);

    await assertPersistedPositiveContract(database, fixture);

    await suppressPublicAnalytics(page);
    await assertSearchProjection(page, fixture, true);
    await assertUnrelatedJobRemainsVisible(page, unrelated);
    await assertCanonicalNoindexJob(page, fixture.jobs.live);
    await assertCanonicalNoindexCompany(page, fixture);

    await login(page, fixture.employerEmail, DEMO_PASSWORD);
    const localRadar = await page.goto("/employer/talent-radar");
    expect(localRadar?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "Talent Radar" }),
    ).toBeVisible();
    await expect(page.getByText("Anonym geschützt", { exact: true })).toBeVisible();

    previewContext = await createPreviewContext(browser, testInfo.project.name);
    const previewPage = await previewContext.newPage();
    const previewObservation = await observePage(previewPage);
    await suppressPublicAnalytics(previewPage);

    await assertSearchProjection(previewPage, fixture, true);
    await assertCanonicalNoindexJob(previewPage, fixture.jobs.live);
    await assertCanonicalNoindexJob(previewPage, fixture.jobs.demo);
    await assertCanonicalNoindexJob(previewPage, fixture.jobs.test);
    await assertCanonicalNoindexJob(
      previewPage,
      fixture.jobs.salaryUnavailable,
    );
    await assertUnavailableJob(previewPage, fixture.jobs.stale);
    await assertUnavailableJob(previewPage, fixture.jobs.expiredTrust);
    await assertCanonicalNoindexCompany(previewPage, fixture);
    await assertPreviewIndexingBoundary(previewContext, previewPage, fixture);

    await page.context().clearCookies();
    await login(page, DEMO_ACCOUNTS.admin, DEMO_PASSWORD);
    const review = await page.goto(
      `/admin/company-verification/${fixture.requestId}`,
    );
    expect(review?.status()).toBe(200);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: fixture.companyName,
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Trust sofort widerrufen" })
      .click();

    await expect
      .poll(
        async () =>
          database.companyVerificationRequest.findUnique({
            where: { id: fixture!.requestId },
            select: { status: true },
          }),
        { timeout: 30_000 },
      )
      .toEqual({ status: "REVOKED" });
    await expect
      .poll(
        async () =>
          database.companyTrustProjection.findUnique({
            where: {
              companyId_scope: {
                companyId: fixture!.companyId,
                scope: "COMPANY_IDENTITY",
              },
            },
            select: { riskState: true, status: true },
          }),
        { timeout: 30_000 },
      )
      .toEqual({ riskState: "REVOKED", status: "REVOKED" });
    expect(
      await database.auditLog.count({
        where: {
          action: "COMPANY_TRUST_CHANGED_V2",
          companyId: fixture.companyId,
          result: "SUCCEEDED",
        },
      }),
    ).toBe(1);

    await page.context().clearCookies();
    await assertSearchProjection(page, fixture, false);
    await assertUnrelatedJobRemainsVisible(page, unrelated);
    await assertUnavailableJob(page, fixture.jobs.live);

    // Company profiles are intentionally status/provenance-gated rather than
    // trust-gated. Revocation removes the badge and jobs, not the ACTIVE public
    // company profile itself. In this harness the badge was never activated,
    // so its absence is asserted without claiming a visible-before transition.
    await assertCanonicalNoindexCompany(page, fixture);

    await login(page, fixture.employerEmail, DEMO_PASSWORD);
    const revokedRadar = await page.goto("/employer/talent-radar");
    expect(revokedRadar?.status()).toBe(200);
    await expect(page.getByText("Gesperrt", { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        "Talent Radar bleibt gesperrt, bis die aktuelle Firmenverifizierung abgeschlossen ist.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByText("Anonym geschützt", { exact: true })).toHaveCount(
      0,
    );

    await assertSearchProjection(previewPage, fixture, false);
    await assertUnrelatedJobRemainsVisible(previewPage, unrelated);
    await assertUnavailableJob(previewPage, fixture.jobs.live);
    previewObservation.assertClean();
  } finally {
    await previewContext?.close();
    if (fixture !== undefined) {
      await containFixture(database, fixture);
    }
    await database.$disconnect();
  }
});

async function createPublicEligibilityFixture(
  database: Database,
  projectSuffix: string,
): Promise<PublicEligibilityFixture> {
  const token = `p34vis${createHash("sha256")
    .update(projectSuffix, "utf8")
    .digest("hex")
    .slice(0, 12)}`;
  const admin = await database.user.findUniqueOrThrow({
    where: { emailNormalized: DEMO_ACCOUNTS.admin },
    select: { id: true },
  });

  const currentTrustCase = await createCompanyTrustCase(database, {
    status: "OPEN",
    effectScope: ["BADGE", "PUBLIC_JOBS", "RADAR"],
  });
  const currentTrust = await createFreshCompanyTrustEvidence(database, {
    companyId: currentTrustCase.companyId,
    requestedByUserId: currentTrustCase.employerUserId,
    reviewerUserId: admin.id,
    verifiedAfter: currentTrustCase.now,
  });
  const company = await database.company.findUniqueOrThrow({
    where: { id: currentTrustCase.companyId },
    select: { id: true, name: true, slug: true },
  });

  const entitlementNow = new Date();
  await database.entitlementGrant.create({
    data: {
      companyId: company.id,
      key: "TALENT_RADAR_ACCESS",
      valueType: "BOOLEAN",
      booleanValue: true,
      reasonCode: "PHASE34_PUBLIC_ELIGIBILITY_E2E",
      grantedByUserId: admin.id,
      validFrom: new Date(entitlementNow.getTime() - 60_000),
      validTo: new Date(entitlementNow.getTime() + 30 * DAY_MILLISECONDS),
      idempotencyKey: `phase34:public-eligibility:radar:${token}`,
    },
  });

  const template = await loadPublishedTemplate(database, currentTrustCase.jobId);
  const [live, demo, testJob, salaryUnavailable, stale] = await Promise.all([
    createPublishedFixtureJob(database, template, {
      companyId: company.id,
      createdByUserId: currentTrustCase.employerUserId,
      dataProvenance: "LIVE",
      freshness: "ACTIVE",
      salaryAvailable: true,
      slug: `phase34-${token}-live`,
      title: `Phase 34 Sichtbarkeit ${token} LIVE`,
    }),
    createPublishedFixtureJob(database, template, {
      companyId: company.id,
      createdByUserId: currentTrustCase.employerUserId,
      dataProvenance: "DEMO",
      freshness: "ACTIVE",
      salaryAvailable: true,
      slug: `phase34-${token}-demo`,
      title: `Phase 34 Sichtbarkeit ${token} DEMO`,
    }),
    createPublishedFixtureJob(database, template, {
      companyId: company.id,
      createdByUserId: currentTrustCase.employerUserId,
      dataProvenance: "TEST",
      freshness: "ACTIVE",
      salaryAvailable: true,
      slug: `phase34-${token}-test`,
      title: `Phase 34 Sichtbarkeit ${token} TEST`,
    }),
    createPublishedFixtureJob(database, template, {
      companyId: company.id,
      createdByUserId: currentTrustCase.employerUserId,
      dataProvenance: "LIVE",
      freshness: "ACTIVE",
      salaryAvailable: false,
      slug: `phase34-${token}-salary-unavailable`,
      title: `Phase 34 Sichtbarkeit ${token} ohne Lohndaten`,
    }),
    createPublishedFixtureJob(database, template, {
      companyId: company.id,
      createdByUserId: currentTrustCase.employerUserId,
      dataProvenance: "LIVE",
      freshness: "STALE",
      salaryAvailable: true,
      slug: `phase34-${token}-stale`,
      title: `Phase 34 Sichtbarkeit ${token} STALE`,
    }),
  ]);

  const expiredTrustCase = await createCompanyTrustCase(database, {
    status: "OPEN",
    effectScope: ["BADGE", "PUBLIC_JOBS", "RADAR"],
  });
  const expiredTrust = await createFreshCompanyTrustEvidence(database, {
    companyId: expiredTrustCase.companyId,
    requestedByUserId: expiredTrustCase.employerUserId,
    reviewerUserId: admin.id,
    verifiedAfter: expiredTrustCase.now,
  });
  const expiredTemplate = await loadPublishedTemplate(
    database,
    expiredTrustCase.jobId,
  );
  const expiredTrustJob = await createPublishedFixtureJob(
    database,
    expiredTemplate,
    {
      companyId: expiredTrustCase.companyId,
      createdByUserId: expiredTrustCase.employerUserId,
      dataProvenance: "LIVE",
      freshness: "ACTIVE",
      salaryAvailable: true,
      slug: `phase34-${token}-expired-trust`,
      title: `Phase 34 Sichtbarkeit ${token} EXPIRED TRUST`,
    },
  );
  await database.companyTrustProjection.update({
    where: { id: expiredTrust.projectionId },
    data: {
      status: "EXPIRED",
      changedAt: new Date(),
      version: { increment: 1 },
    },
  });

  return Object.freeze({
    companyId: company.id,
    companyName: company.name,
    companySlug: company.slug,
    employerEmail: currentTrustCase.employerEmail,
    expiredCompanyId: expiredTrustCase.companyId,
    expiredRequestId: expiredTrust.requestId,
    jobs: Object.freeze({
      demo,
      expiredTrust: expiredTrustJob,
      live,
      salaryUnavailable,
      stale,
      test: testJob,
    }),
    requestId: currentTrust.requestId,
    token,
  });
}

async function loadPublishedTemplate(database: Database, jobId: string) {
  const job = await database.job.findUniqueOrThrow({
    where: { id: jobId },
    select: { publishedRevision: true },
  });
  if (job.publishedRevision === null) {
    throw new Error("Phase 34 public eligibility requires a published template.");
  }
  return job.publishedRevision;
}

async function createPublishedFixtureJob(
  database: Database,
  template: Awaited<ReturnType<typeof loadPublishedTemplate>>,
  input: Readonly<{
    companyId: string;
    createdByUserId: string;
    dataProvenance: "LIVE" | "DEMO" | "TEST";
    freshness: "ACTIVE" | "STALE";
    salaryAvailable: boolean;
    slug: string;
    title: string;
  }>,
): Promise<PublishedFixtureJob> {
  const now = new Date();
  const confirmedAt =
    input.freshness === "ACTIVE"
      ? new Date(now.getTime() - 60_000)
      : new Date(now.getTime() - 40 * DAY_MILLISECONDS);
  const validThrough = new Date(now.getTime() + 60 * DAY_MILLISECONDS);
  const schedule = calculateJobFreshnessScheduleV1(
    confirmedAt,
    validThrough,
  );
  const jobId = randomUUID();
  const revisionId = randomUUID();
  const salaryPeriod = input.salaryAvailable ? "YEARLY" : null;
  const salaryMin = input.salaryAvailable ? 110_000 : null;
  const salaryMax = input.salaryAvailable ? 130_000 : null;
  const fingerprint = buildPublicationFingerprintV1({
    title: input.title,
    description: template.description,
    tasks: template.tasks,
    requirements: template.requirements,
    offer: template.offer,
    categoryId: template.categoryId,
    cantonId: template.cantonId,
    cityId: template.cityId,
    workloadMin: template.workloadMin,
    workloadMax: template.workloadMax,
    jobType: template.jobType,
    remoteType: template.remoteType,
  });

  await database.$transaction(async (transaction) => {
    await transaction.job.create({
      data: {
        id: jobId,
        companyId: input.companyId,
        slug: input.slug,
        status: "DRAFT",
        origin: "MANUAL",
        sourceReference: `phase34-public-eligibility-${input.slug}`,
        version: 1,
        dataProvenance: input.dataProvenance,
        createdByUserId: input.createdByUserId,
        createdAt: new Date(now.getTime() - 4 * 60_000),
      },
    });
    await transaction.jobRevision.create({
      data: {
        id: revisionId,
        jobId,
        revisionNumber: 1,
        contentLanguage: template.contentLanguage,
        title: input.title,
        companyIntro: template.companyIntro,
        description: template.description,
        tasks: template.tasks,
        requirements: template.requirements,
        niceToHave: template.niceToHave,
        offer: template.offer,
        applicationProcessSteps: template.applicationProcessSteps,
        requiredDocumentKinds: template.requiredDocumentKinds,
        jobType: template.jobType,
        remoteType: template.remoteType,
        remoteCountryCode: template.remoteCountryCode,
        categoryId: template.categoryId,
        cantonId: template.cantonId,
        cityId: template.cityId,
        locationLabel: template.locationLabel,
        workloadMin: template.workloadMin,
        workloadMax: template.workloadMax,
        salaryPeriod,
        salaryMin,
        salaryMax,
        startDate: template.startDate,
        startByArrangement: template.startByArrangement,
        validThrough,
        responseTargetDays: template.responseTargetDays,
        applicationEffort: template.applicationEffort,
        inclusionStatement: template.inclusionStatement,
        applicationContactKind: template.applicationContactKind,
        applicationContactValue: template.applicationContactValue,
        authoredByUserId: input.createdByUserId,
        contentChecksum: createHash("sha256")
          .update(`phase34-public:${jobId}:${input.title}`, "utf8")
          .digest("hex"),
        version: 1,
        submittedAt: new Date(now.getTime() - 3 * 60_000),
        approvedAt: new Date(now.getTime() - 2 * 60_000),
        createdAt: new Date(now.getTime() - 4 * 60_000),
      },
    });
    await transaction.job.update({
      where: { id: jobId },
      data: {
        currentRevisionId: revisionId,
        publishedRevisionId: revisionId,
        expiresAt: validThrough,
        publishedCategoryId: template.categoryId,
        publishedCantonId: template.cantonId,
        publishedCityId: template.cityId,
        publishedSalaryPeriod: salaryPeriod,
        publishedSalaryMin: salaryMin,
        publishedSalaryMax: salaryMax,
      },
    });
    await transaction.job.update({
      where: { id: jobId },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(now.getTime() - 60_000),
      },
    });
    await transaction.jobFreshnessProjection.create({
      data: {
        jobId,
        policyVersion: JOB_FRESHNESS_POLICY_V1.version,
        state: input.freshness,
        publishedAt: new Date(now.getTime() - 60_000),
        lastConfirmedAt: confirmedAt,
        dueAt: schedule.dueAt,
        reminder7At: schedule.reminder7At,
        reminder24At: schedule.reminder24At,
        enforceAt:
          input.freshness === "ACTIVE"
            ? new Date(now.getTime() - 60_000)
            : new Date(now.getTime() - DAY_MILLISECONDS),
        updatedAt: now,
      },
    });
    await transaction.jobFreshnessEvent.create({
      data: {
        id: randomUUID(),
        jobId,
        kind: "PUBLISHED",
        toState: "ACTIVE",
        actorUserId: input.createdByUserId,
        reasonCode: "PHASE34_PUBLIC_ELIGIBILITY_PUBLISHED",
        idempotencyKey: `phase34:public:published:${jobId}`,
        correlationId: `phase34-public-${jobId}`,
        createdAt: new Date(now.getTime() - 60_000),
      },
    });
    if (input.freshness === "STALE") {
      await transaction.jobFreshnessEvent.create({
        data: {
          id: randomUUID(),
          jobId,
          kind: "DUE",
          fromState: "ACTIVE",
          toState: "STALE",
          actorUserId: null,
          reasonCode: "PHASE34_PUBLIC_ELIGIBILITY_STALE",
          idempotencyKey: `phase34:public:stale:${jobId}`,
          correlationId: `phase34-public-${jobId}`,
          createdAt: new Date(now.getTime() - DAY_MILLISECONDS),
        },
      });
    }
    await transaction.jobPublicationFingerprint.create({
      data: {
        id: randomUUID(),
        jobId,
        companyId: input.companyId,
        sourceScope: "manual",
        exactFingerprint: fingerprint.exactFingerprint,
        signatureTokens: [...fingerprint.signatureTokens],
        active: input.freshness === "ACTIVE",
        createdAt: now,
        updatedAt: now,
      },
    });
  });

  return Object.freeze({ id: jobId, slug: input.slug, title: input.title });
}

async function assertPersistedPositiveContract(
  database: Database,
  fixture: PublicEligibilityFixture,
) {
  const [request, projection, freshness, revision, currentCycles] =
    await Promise.all([
      database.companyVerificationRequest.findUniqueOrThrow({
        where: { id: fixture.requestId },
        select: { assignedReviewerUserId: true, status: true },
      }),
      database.companyTrustProjection.findUniqueOrThrow({
        where: {
          companyId_scope: {
            companyId: fixture.companyId,
            scope: "COMPANY_IDENTITY",
          },
        },
        select: {
          level: true,
          riskState: true,
          status: true,
          verificationRequestId: true,
        },
      }),
      database.jobFreshnessProjection.findUniqueOrThrow({
        where: { jobId: fixture.jobs.live.id },
        select: { dueAt: true, enforceAt: true, state: true },
      }),
      database.job.findUniqueOrThrow({
        where: { id: fixture.jobs.live.id },
        select: {
          currentRevisionId: true,
          dataProvenance: true,
          publishedRevision: {
            select: { approvedAt: true, rejectedAt: true, validThrough: true },
          },
          publishedRevisionId: true,
          status: true,
        },
      }),
      database.companyVerificationRequest.count({
        where: {
          companyId: fixture.companyId,
          status: "VERIFIED",
          supersededBy: null,
        },
      }),
    ]);

  expect(request).toMatchObject({
    assignedReviewerUserId: expect.any(String),
    status: "VERIFIED",
  });
  expect(projection).toEqual({
    level: "STRONG",
    riskState: "CLEAR",
    status: "ACTIVE",
    verificationRequestId: fixture.requestId,
  });
  expect(currentCycles).toBe(1);
  expect(freshness.state).toBe("ACTIVE");
  expect(freshness.enforceAt.getTime()).toBeLessThan(Date.now());
  expect(freshness.dueAt.getTime()).toBeGreaterThan(Date.now());
  expect(revision).toMatchObject({
    currentRevisionId: revision.publishedRevisionId,
    dataProvenance: "LIVE",
    status: "PUBLISHED",
    publishedRevision: {
      approvedAt: expect.any(Date),
      rejectedAt: null,
      validThrough: expect.any(Date),
    },
  });
}

async function assertSearchProjection(
  page: Page,
  fixture: PublicEligibilityFixture,
  currentTrustExpected: boolean,
) {
  const response = await page.goto(
    `/jobs?keyword=${encodeURIComponent(fixture.token)}`,
  );
  expect(response?.status()).toBe(200);
  const expectedVisible = currentTrustExpected
    ? [
        fixture.jobs.live,
        fixture.jobs.demo,
        fixture.jobs.test,
        fixture.jobs.salaryUnavailable,
      ]
    : [];
  for (const job of expectedVisible) {
    await expect(jobLink(page, job)).toBeVisible();
  }
  const expectedHidden = currentTrustExpected
    ? [fixture.jobs.stale, fixture.jobs.expiredTrust]
    : Object.values(fixture.jobs);
  for (const job of expectedHidden) {
    await expect(jobLink(page, job)).toHaveCount(0);
  }
}

async function assertCanonicalNoindexJob(page: Page, job: PublishedFixtureJob) {
  const response = await page.goto(`/jobs/${job.slug}`);
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: job.title, exact: true }),
  ).toBeVisible();
  await assertCanonicalNoindex(page, `/jobs/${job.slug}`);
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
}

async function assertCanonicalNoindexCompany(
  page: Page,
  fixture: PublicEligibilityFixture,
) {
  const response = await page.goto(`/companies/${fixture.companySlug}`);
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: fixture.companyName,
      exact: true,
    }),
  ).toBeVisible();
  await assertCanonicalNoindex(page, `/companies/${fixture.companySlug}`);
  await expect(
    page.getByText("Firmenidentität geprüft", { exact: true }),
  ).toHaveCount(0);
}

async function assertUnavailableJob(page: Page, job: PublishedFixtureJob) {
  const response = await page.goto(`/jobs/${job.slug}`);
  // `app/(public)/jobs/loading.tsx` makes this an App Router streamed
  // response. Next.js 16 deliberately keeps the already-sent HTTP status at
  // 200 when a later `notFound()` renders; the noindex metadata and the
  // inaccessible UI are therefore the authoritative browser contract.
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Diese Seite ist nicht verfügbar." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: job.title, exact: true }),
  ).toHaveCount(0);
  await assertRobotsNoindex(page);
}

async function assertCanonicalNoindex(page: Page, expectedPath: string) {
  const canonical = await page
    .locator('link[rel="canonical"]')
    .getAttribute("href");
  expect(canonical).not.toBeNull();
  expect(new URL(canonical!, page.url()).pathname).toBe(expectedPath);
  await assertRobotsNoindex(page);
}

async function assertRobotsNoindex(page: Page) {
  // Streamed metadata can legitimately contain the inherited, generated and
  // notFound noindex directives at once. Assert the effective restrictive
  // directive without relying on a single-tag implementation detail.
  await expect(
    page.locator('meta[name="robots"][content*="noindex"]').first(),
  ).toHaveAttribute("content", /(?:^|[\s,])noindex(?:$|[\s,])/u);
}

async function assertPreviewIndexingBoundary(
  context: BrowserContext,
  page: Page,
  fixture: PublicEligibilityFixture,
) {
  const salaryRadar = await page.goto("/salary-radar");
  expect(salaryRadar?.status()).toBe(200);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Ordne deinen Lohn nachvollziehbar ein.",
    }),
  ).toBeVisible();
  await assertCanonicalNoindex(page, "/salary-radar");

  const sitemapResponse = await context.request.get("/sitemap.xml", {
    failOnStatusCode: false,
  });
  expect(sitemapResponse.status()).toBe(200);
  const sitemap = await sitemapResponse.text();
  expect(sitemap).toContain("<urlset");
  for (const job of Object.values(fixture.jobs)) {
    expect(sitemap).not.toContain(`/jobs/${job.slug}`);
  }
  expect(sitemap).not.toContain(`/companies/${fixture.companySlug}`);
  expect(sitemap).not.toContain("/salary-radar");

  const robotsResponse = await context.request.get("/robots.txt", {
    failOnStatusCode: false,
  });
  expect(robotsResponse.status()).toBe(200);
  const robots = await robotsResponse.text();
  expect(robots).toContain("User-Agent: *");
  expect(robots).toContain("Disallow: /admin/");
  expect(robots).toContain("Sitemap:");
}

async function loadUnrelatedSeedJob(database: Database) {
  const job = await database.job.findUniqueOrThrow({
    where: { slug: "zh-engineering-demo-024" },
    select: {
      slug: true,
      publishedRevision: { select: { title: true } },
    },
  });
  if (job.publishedRevision === null) {
    throw new Error("The unrelated Phase 34 seed job is not published.");
  }
  return Object.freeze({ slug: job.slug, title: job.publishedRevision.title });
}

async function assertUnrelatedJobRemainsVisible(
  page: Page,
  job: Readonly<{ slug: string; title: string }>,
) {
  const response = await page.goto(
    `/jobs?keyword=${encodeURIComponent(job.title)}`,
  );
  expect(response?.status()).toBe(200);
  await expect(jobLink(page, job)).toBeVisible();
}

function jobLink(
  page: Page,
  job: Readonly<{ slug: string }>,
) {
  return page.locator(`a[href="/jobs/${job.slug}"]`).first();
}

async function suppressPublicAnalytics(page: Page) {
  await page.route(PUBLIC_JOB_ANALYTICS_ROUTE, async (route) => {
    await route.fulfill({ status: 204 });
  });
}

async function createPreviewContext(
  browser: Browser,
  projectName: string,
): Promise<BrowserContext> {
  const finalOctet = projectName.includes("firefox")
    ? 92
    : projectName.includes("webkit")
      ? 93
      : 91;
  return browser.newContext({
    baseURL: requiredEnvironment("PHASE34_PREVIEW_BASE_URL"),
    locale: "de-CH",
    timezoneId: "Europe/Zurich",
    viewport: { width: 1_440, height: 900 },
    colorScheme: "light",
    serviceWorkers: "block",
    extraHTTPHeaders: {
      "x-forwarded-for": `198.51.100.${finalOctet}`,
    },
  });
}

async function containFixture(
  database: Database,
  fixture: PublicEligibilityFixture,
) {
  const now = new Date();
  await database.$transaction(async (transaction) => {
    await transaction.job.updateMany({
      where: {
        companyId: { in: [fixture.companyId, fixture.expiredCompanyId] },
        status: "PUBLISHED",
      },
      data: { status: "PAUSED", updatedAt: now },
    });
    await transaction.companyTrustProjection.updateMany({
      where: {
        companyId: { in: [fixture.companyId, fixture.expiredCompanyId] },
        status: { not: "REVOKED" },
      },
      data: {
        status: "REVOKED",
        riskState: "REVOKED",
        changedAt: now,
        version: { increment: 1 },
        updatedAt: now,
      },
    });
    await transaction.company.updateMany({
      where: { id: { in: [fixture.companyId, fixture.expiredCompanyId] } },
      data: { status: "SUSPENDED", updatedAt: now },
    });
  });
}

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required for Phase 34 public eligibility.`);
  }
  return value;
}
