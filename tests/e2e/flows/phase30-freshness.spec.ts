import { createHash, randomUUID } from "node:crypto";

import {
  DEMO_ACCOUNTS,
  expect,
  openActor,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";
import {
  JOB_FRESHNESS_POLICY_V1,
  buildPublicationFingerprintV1,
  calculateJobFreshnessScheduleV1,
} from "@/lib/jobs/freshness-policy";
import type { DataProvenance } from "@/lib/generated/prisma/enums";

const DAY_MS = 86_400_000;

test("[E2E-30] @journey reconfirms and fills one publication through the employer and public Job surfaces", async ({
  browser,
}) => {
  const database = phase17Database();
  const fixture = await createFreshnessFixture(database);
  const employer = await openActor(browser, DEMO_ACCOUNTS.employer);
  try {
    await employer.page.goto(`/employer/jobs/${fixture.jobId}`);
    await expect(
      employer.page.getByRole("heading", { name: "Aktualität der Stelle" }),
    ).toBeVisible();
    await expect(
      employer.page.getByText(
        /Ohne Bestätigung wird die Stelle .* aus Suche, Alerts, Empfehlungen und Sitemap entfernt/u,
      ),
    ).toBeVisible();
    await expect(
      employer.page.getByRole("button", {
        name: "Stelle ist weiterhin offen",
      }),
    ).toBeVisible();
    expect(
      (await employer.page.request.get(`/jobs/${fixture.slug}`)).status(),
    ).toBe(200);
    await employer.page
      .getByRole("button", { name: "Stelle ist weiterhin offen" })
      .click();
    await expect(
      employer.page.getByRole("status").filter({
        hasText: "Die Stelle ist bestätigt und bleibt bis",
      }),
    ).toBeVisible();
    await expect
      .poll(async () =>
        database.jobFreshnessEvent.count({
          where: { jobId: fixture.jobId, kind: "RECONFIRMED" },
        }),
      )
      .toBe(1);
    await expect
      .poll(async () =>
        database.auditLog.count({
          where: {
            targetId: fixture.jobId,
            action: "JOB_FRESHNESS_CONFIRMED",
          },
        }),
      )
      .toBe(1);

    await employer.page
      .getByRole("button", { name: "Stelle ist besetzt" })
      .click();
    await expect
      .poll(async () =>
        database.job.findUnique({
          where: { id: fixture.jobId },
          select: {
            status: true,
            freshnessProjection: { select: { state: true } },
            publicationFingerprint: { select: { active: true } },
          },
        }),
      )
      .toEqual({
        status: "CLOSED",
        freshnessProjection: { state: "FILLED" },
        publicationFingerprint: { active: false },
      });
    await employer.page.goto(`/jobs/${fixture.slug}`);
    await expect(
      employer.page.getByRole("heading", {
        name: "Diese Seite ist nicht verfügbar.",
      }),
    ).toBeVisible();
    await expect(
      employer.page.getByRole("heading", { name: fixture.title }),
    ).toHaveCount(0);
  } finally {
    await employer.close();
    await cleanupFreshnessFixture(database, fixture);
    await database.$disconnect();
  }
});

async function createFreshnessFixture(
  database: ReturnType<typeof phase17Database>,
) {
  const source = await database.job.findFirstOrThrow({
    where: {
      status: "PUBLISHED",
      company: {
        memberships: {
          some: {
            status: "ACTIVE",
            user: { emailNormalized: DEMO_ACCOUNTS.employer },
          },
        },
      },
    },
    orderBy: { id: "asc" },
    include: {
      currentRevision: true,
      company: {
        select: {
          id: true,
          dataProvenance: true,
          memberships: {
            where: {
              status: "ACTIVE",
              user: { emailNormalized: DEMO_ACCOUNTS.employer },
            },
            take: 1,
            select: { userId: true },
          },
        },
      },
    },
  });
  if (source.currentRevision === null) {
    throw new Error("Phase 30 requires a seeded publication revision.");
  }
  const ownerUserId = source.company.memberships[0]?.userId;
  if (ownerUserId === undefined) {
    throw new Error("Phase 30 requires the demo Employer membership.");
  }

  const now = new Date();
  const jobId = randomUUID();
  const revisionId = randomUUID();
  const slug = `phase-30-browser-freshness-${jobId.slice(0, 8)}`;
  const title = `Phase 30 Aktualitätsprüfung ${jobId.slice(0, 8)}`;
  const validThrough = new Date(now.getTime() + 60 * DAY_MS);
  const revision = source.currentRevision;
  const schedule = calculateJobFreshnessScheduleV1(now, validThrough);
  const fingerprint = buildPublicationFingerprintV1({
    title,
    description: revision.description,
    tasks: revision.tasks,
    requirements: revision.requirements,
    offer: revision.offer,
    categoryId: revision.categoryId,
    cantonId: revision.cantonId,
    cityId: revision.cityId,
    workloadMin: revision.workloadMin,
    workloadMax: revision.workloadMax,
    jobType: revision.jobType,
    remoteType: revision.remoteType,
  });

  await database.$transaction(async (transaction) => {
    await transaction.company.update({
      where: { id: source.company.id },
      data: { dataProvenance: "LIVE" },
    });
    await transaction.job.create({
      data: {
        id: jobId,
        companyId: source.companyId,
        slug,
        status: "DRAFT",
        origin: "MANUAL",
        sourceReference: "phase30-browser-fixture",
        version: 1,
        dataProvenance: "LIVE",
        createdByUserId: ownerUserId,
        createdAt: now,
      },
    });
    await transaction.jobRevision.create({
      data: {
        id: revisionId,
        jobId,
        revisionNumber: 1,
        contentLanguage: revision.contentLanguage,
        title,
        companyIntro: revision.companyIntro,
        description: revision.description,
        tasks: revision.tasks,
        requirements: revision.requirements,
        niceToHave: revision.niceToHave,
        offer: revision.offer,
        applicationProcessSteps: revision.applicationProcessSteps,
        requiredDocumentKinds: revision.requiredDocumentKinds,
        jobType: revision.jobType,
        remoteType: revision.remoteType,
        remoteCountryCode: revision.remoteCountryCode,
        categoryId: revision.categoryId,
        cantonId: revision.cantonId,
        cityId: revision.cityId,
        locationLabel: revision.locationLabel,
        workloadMin: revision.workloadMin,
        workloadMax: revision.workloadMax,
        salaryPeriod: revision.salaryPeriod,
        salaryMin: revision.salaryMin,
        salaryMax: revision.salaryMax,
        startDate: revision.startDate,
        startByArrangement: revision.startByArrangement,
        validThrough,
        responseTargetDays: revision.responseTargetDays,
        applicationEffort: revision.applicationEffort,
        inclusionStatement: revision.inclusionStatement,
        applicationContactKind: revision.applicationContactKind,
        applicationContactValue: revision.applicationContactValue,
        authoredByUserId: ownerUserId,
        contentChecksum: createHash("sha256")
          .update(`phase30:${jobId}:${revision.contentChecksum}`, "utf8")
          .digest("hex"),
        version: 1,
        submittedAt: new Date(now.getTime() - 2 * DAY_MS),
        approvedAt: new Date(now.getTime() - DAY_MS),
        createdAt: new Date(now.getTime() - 3 * DAY_MS),
      },
    });
    const [projectionCheck] = await transaction.$queryRaw<
      Array<{
        bounded: boolean;
        canton: boolean;
        category: boolean;
        city: boolean;
        expires: boolean;
        salaryMaximum: boolean;
        salaryMinimum: boolean;
        salaryPeriod: boolean;
      }>
    >`
      SELECT
        revision."validThrough" = ${validThrough} AS "expires",
        revision."categoryId" IS NOT DISTINCT FROM ${revision.categoryId}::uuid AS "category",
        revision."cantonId" IS NOT DISTINCT FROM ${revision.cantonId}::uuid AS "canton",
        revision."cityId" IS NOT DISTINCT FROM ${revision.cityId}::uuid AS "city",
        revision."salaryPeriod" IS NOT DISTINCT FROM ${revision.salaryPeriod}::"SalaryPeriod" AS "salaryPeriod",
        revision."salaryMin" IS NOT DISTINCT FROM ${revision.salaryMin}::integer AS "salaryMinimum",
        revision."salaryMax" IS NOT DISTINCT FROM ${revision.salaryMax}::integer AS "salaryMaximum",
        revision."validThrough" > CURRENT_TIMESTAMP
          AND revision."validThrough" <= CURRENT_TIMESTAMP + INTERVAL '90 days'
          AS "bounded"
      FROM "JobRevision" AS revision
      WHERE revision."id" = ${revisionId}::uuid
    `;
    const failedProjectionChecks = Object.entries(
      projectionCheck ?? {},
    ).flatMap(([name, passed]) => (passed ? [] : [name]));
    if (failedProjectionChecks.length > 0) {
      throw new Error(
        `Phase 30 fixture projection mismatch: ${failedProjectionChecks.join(", ")}`,
      );
    }
    await transaction.job.update({
      where: { id: jobId },
      data: {
        currentRevisionId: revisionId,
        publishedRevisionId: revisionId,
        expiresAt: validThrough,
        publishedCategoryId: revision.categoryId,
        publishedCantonId: revision.cantonId,
        publishedCityId: revision.cityId,
        publishedSalaryPeriod: revision.salaryPeriod,
        publishedSalaryMin: revision.salaryMin,
        publishedSalaryMax: revision.salaryMax,
      },
    });
    const [storedProjectionCheck] = await transaction.$queryRaw<
      Array<{
        bounded: boolean;
        canton: boolean;
        category: boolean;
        city: boolean;
        expires: boolean;
        owner: boolean;
        salaryMaximum: boolean;
        salaryMinimum: boolean;
        salaryPeriod: boolean;
      }>
    >`
      SELECT
        revision."jobId" = job."id" AS "owner",
        revision."validThrough" IS NOT DISTINCT FROM job."expiresAt" AS "expires",
        revision."categoryId" IS NOT DISTINCT FROM job."publishedCategoryId" AS "category",
        revision."cantonId" IS NOT DISTINCT FROM job."publishedCantonId" AS "canton",
        revision."cityId" IS NOT DISTINCT FROM job."publishedCityId" AS "city",
        revision."salaryPeriod" IS NOT DISTINCT FROM job."publishedSalaryPeriod" AS "salaryPeriod",
        revision."salaryMin" IS NOT DISTINCT FROM job."publishedSalaryMin" AS "salaryMinimum",
        revision."salaryMax" IS NOT DISTINCT FROM job."publishedSalaryMax" AS "salaryMaximum",
        revision."validThrough" > CURRENT_TIMESTAMP
          AND revision."validThrough" <= CURRENT_TIMESTAMP + INTERVAL '90 days'
          AS "bounded"
      FROM "Job" AS job
      INNER JOIN "JobRevision" AS revision
        ON revision."id" = job."publishedRevisionId"
      WHERE job."id" = ${jobId}::uuid
    `;
    const failedStoredProjectionChecks = Object.entries(
      storedProjectionCheck ?? {},
    ).flatMap(([name, passed]) => (passed ? [] : [name]));
    if (failedStoredProjectionChecks.length > 0) {
      throw new Error(
        `Phase 30 stored projection mismatch: ${failedStoredProjectionChecks.join(", ")}`,
      );
    }
    await transaction.job.update({
      where: { id: jobId },
      data: {
        status: "PUBLISHED",
        publishedAt: now,
      },
    });
    await transaction.jobFreshnessProjection.create({
      data: {
        jobId,
        policyVersion: JOB_FRESHNESS_POLICY_V1.version,
        state: "ACTIVE",
        publishedAt: now,
        lastConfirmedAt: now,
        ...schedule,
        enforceAt: now,
        updatedAt: now,
      },
    });
    await transaction.jobFreshnessEvent.create({
      data: {
        id: randomUUID(),
        jobId,
        kind: "PUBLISHED",
        toState: "ACTIVE",
        actorUserId: ownerUserId,
        reasonCode: "E2E_PUBLICATION_CONFIRMED",
        idempotencyKey: `e2e:freshness:published:${jobId}`,
        correlationId: `e2e-phase30-${jobId}`,
        createdAt: now,
      },
    });
    await transaction.jobPublicationFingerprint.create({
      data: {
        id: randomUUID(),
        jobId,
        companyId: source.companyId,
        sourceScope: "manual",
        exactFingerprint: fingerprint.exactFingerprint,
        signatureTokens: [...fingerprint.signatureTokens],
        active: true,
        createdAt: now,
        updatedAt: now,
      },
    });
  });
  return Object.freeze({
    companyId: source.company.id,
    jobId,
    originalCompanyProvenance: source.company.dataProvenance,
    slug,
    title,
  });
}

async function cleanupFreshnessFixture(
  database: ReturnType<typeof phase17Database>,
  fixture: Readonly<{
    companyId: string;
    jobId: string;
    originalCompanyProvenance: DataProvenance;
  }>,
) {
  await database.$transaction(async (transaction) => {
    await transaction.job.updateMany({
      where: { id: fixture.jobId, status: { not: "CLOSED" } },
      data: {
        status: "CLOSED",
      },
    });
    await transaction.jobFreshnessProjection.updateMany({
      where: { jobId: fixture.jobId },
      data: { state: "CLOSED", updatedAt: new Date() },
    });
    await transaction.jobPublicationFingerprint.updateMany({
      where: { jobId: fixture.jobId },
      data: { active: false, updatedAt: new Date() },
    });
    await transaction.company.update({
      where: { id: fixture.companyId },
      data: { dataProvenance: fixture.originalCompanyProvenance },
    });
  });
}
