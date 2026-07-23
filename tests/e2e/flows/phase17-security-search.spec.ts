import { readFileSync, writeFileSync } from "node:fs";

import type { Page } from "@playwright/test";

import { calculateRelevanceProxy } from "@/lib/search/relevance";
import {
  DEMO_ACCOUNTS,
  expect,
  openActor,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";

test.describe.configure({ mode: "serial" });

test("[E2E-05] @journey denies IDOR and role escape without target side effects", async ({
  browser,
}) => {
  const database = phase17Database();
  let employer: Awaited<ReturnType<typeof openActor>> | undefined;
  let candidate: Awaited<ReturnType<typeof openActor>> | undefined;
  try {
    const [employerUser, candidateUser] = await Promise.all([
      database.user.findUniqueOrThrow({
        where: { emailNormalized: DEMO_ACCOUNTS.employer },
        select: {
          id: true,
          companyMemberships: {
            where: {
              status: "ACTIVE",
              company: { status: { in: ["ACTIVE", "DRAFT"] } },
            },
            orderBy: [{ company: { name: "asc" } }, { id: "asc" }],
            select: { companyId: true },
          },
        },
      }),
      database.user.findUniqueOrThrow({
        where: { emailNormalized: DEMO_ACCOUNTS.candidate },
        select: { id: true },
      }),
    ]);
    expect(employerUser.companyMemberships).toHaveLength(1);
    const ownCompanyId = employerUser.companyMemberships[0]!.companyId;
    const [foreignJob, foreignApplication, adminJobCanary] = await Promise.all([
      database.job.findFirstOrThrow({
        where: {
          companyId: { not: ownCompanyId },
          currentRevisionId: { not: null },
          assignments: { none: { userId: employerUser.id } },
        },
        orderBy: [{ status: "asc" }, { id: "asc" }],
        select: {
          id: true,
          currentRevision: { select: { title: true } },
        },
      }),
      database.application.findFirstOrThrow({
        where: {
          candidateProfile: { userId: { not: candidateUser.id } },
        },
        orderBy: { id: "asc" },
        select: {
          id: true,
          submittedJobRevision: { select: { title: true } },
          candidateProfile: {
            select: {
              firstName: true,
              lastName: true,
              user: { select: { email: true } },
            },
          },
        },
      }),
      database.job.findFirstOrThrow({
        where: {
          status: {
            in: ["SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED"],
          },
          currentRevisionId: { not: null },
        },
        orderBy: [{ status: "asc" }, { id: "asc" }],
        select: {
          currentRevision: { select: { title: true } },
        },
      }),
    ]);
    expect(foreignJob.currentRevision).not.toBeNull();
    expect(adminJobCanary.currentRevision).not.toBeNull();

    employer = await openActor(browser, DEMO_ACCOUNTS.employer);
    candidate = await openActor(browser, DEMO_ACCOUNTS.candidate);
    const before = await protectedTargetFingerprint(
      database,
      foreignJob.id,
      foreignApplication.id,
    );

    const crossTenant = await employer.context.request.get(
      `/employer/jobs/${foreignJob.id}`,
      { failOnStatusCode: false, maxRedirects: 0 },
    );
    expect(crossTenant.status()).toBe(404);
    const crossTenantBody = await crossTenant.text();
    expect(crossTenantBody).not.toContain(foreignJob.currentRevision!.title);

    const crossCandidate = await candidate.context.request.get(
      `/candidate/applications/${foreignApplication.id}`,
      { failOnStatusCode: false, maxRedirects: 0 },
    );
    expect(crossCandidate.status()).toBe(404);
    const crossCandidateBody = await crossCandidate.text();
    for (const protectedValue of [
      foreignApplication.candidateProfile.firstName,
      foreignApplication.candidateProfile.lastName,
      foreignApplication.candidateProfile.user.email,
      foreignApplication.submittedJobRevision.title,
    ]) {
      if (protectedValue !== null) {
        expect(crossCandidateBody).not.toContain(protectedValue);
      }
    }

    const roleEscape = await candidate.context.request.get("/admin/jobs", {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect(roleEscape.status()).toBe(403);
    const roleEscapeBody = await roleEscape.text();
    expect(roleEscapeBody).toContain("Zugriff nicht erlaubt");
    expect(roleEscapeBody).not.toContain(
      adminJobCanary.currentRevision!.title,
    );

    await expect(
      protectedTargetFingerprint(
        database,
        foreignJob.id,
        foreignApplication.id,
      ),
    ).resolves.toEqual(before);
  } finally {
    await candidate?.close();
    await employer?.close();
    await database.$disconnect();
  }
});

test("[E2E-07] @journey keeps boost disclosure, score and cursor pagination deterministic", async ({
  page,
}) => {
  const database = phase17Database();
  try {
    await withSeedAnchorClock(database, async (anchorAt) => {
      const scenario = await loadBoostScenario(database, anchorAt);
      const relevantBoostJobs = [...scenario.active, ...scenario.expired];
      const scoreRevisionIds = relevantBoostJobs.map(
        ({ job }) => job.publishedRevision!.id,
      );
      const scoreBefore = await database.jobScoreSnapshot.findMany({
        where: {
          jobRevisionId: { in: scoreRevisionIds },
          scoreVersion: "v2",
        },
        orderBy: [{ jobRevisionId: "asc" }, { id: "asc" }],
      });
      expect(scoreBefore).toHaveLength(scoreRevisionIds.length);
      expect(JSON.stringify(scoreBefore).toLowerCase()).not.toContain("boost");
      const boostBefore = await database.jobBoost.findMany({
        where: { id: { in: relevantBoostJobs.map(({ id }) => id) } },
        orderBy: { id: "asc" },
      });
      const relevanceBefore = relevanceFingerprint(relevantBoostJobs);
      expect(
        relevanceBefore.every(({ relevance }) => relevance.score > 0),
      ).toBe(true);

      const searchPath = "/jobs?keyword=Arbeit&pageSize=5";
      await page.goto(searchPath);
      await expect(
        page.getByRole("heading", {
          name: "Finde deinen nächsten fairen Job.",
        }),
      ).toBeVisible();
      const firstPageOrder = await resultHrefs(page);
      assertUniqueFullPage(firstPageOrder, 5);
      const firstCard = page.locator('[data-slot="card"]').first();
      const firstSponsoredHref = await firstCard
        .locator('h3 a[href^="/jobs/"]')
        .getAttribute("href");
      expect(firstSponsoredHref).not.toBeNull();
      expect(
        scenario.active.map(({ job }) => `/jobs/${job.slug}`),
      ).toContain(firstSponsoredHref);
      await expect(
        firstCard.getByLabel(/^Geboostet\./u),
      ).toBeVisible();

      await page.reload();
      expect(await resultHrefs(page)).toEqual(firstPageOrder);
      const nextPageHref = await page
        .getByRole("link", { name: "Nächste Ergebnisse" })
        .getAttribute("href");
      expect(nextPageHref).not.toBeNull();
      await page.goto(nextPageHref!);
      const secondPageOrder = await resultHrefs(page);
      assertUniqueFullPage(secondPageOrder, 5);
      expect(
        firstPageOrder.filter((href) => secondPageOrder.includes(href)),
      ).toEqual([]);
      await page.reload();
      expect(await resultHrefs(page)).toEqual(secondPageOrder);

      const activeJob = scenario.active.find(
        ({ job }) => `/jobs/${job.slug}` === firstSponsoredHref,
      );
      if (activeJob === undefined) {
        throw new Error("The disclosed sponsored Job lost its active Boost.");
      }
      await page.goto(`/jobs/${activeJob.job.slug}`);
      const activeHero = page.locator("section").first();
      await expect(
        activeHero.getByRole("heading", {
          level: 1,
          name: activeJob.job.publishedRevision!.title,
        }),
      ).toBeVisible();
      await expect(
        activeHero.getByLabel(/^Geboostet\./u),
      ).toBeVisible();

      const expiredJob = scenario.expired[0]!;
      await page.goto(`/jobs/${expiredJob.job.slug}`);
      const expiredHero = page.locator("section").first();
      await expect(
        expiredHero.getByRole("heading", {
          level: 1,
          name: expiredJob.job.publishedRevision!.title,
        }),
      ).toBeVisible();
      await expect(
        expiredHero.getByLabel(/^Geboostet\./u),
      ).toHaveCount(0);

      await expect(
        database.jobScoreSnapshot.findMany({
          where: {
            jobRevisionId: { in: scoreRevisionIds },
            scoreVersion: "v2",
          },
          orderBy: [{ jobRevisionId: "asc" }, { id: "asc" }],
        }),
      ).resolves.toEqual(scoreBefore);
      await expect(
        database.jobBoost.findMany({
          where: { id: { in: relevantBoostJobs.map(({ id }) => id) } },
          orderBy: { id: "asc" },
        }),
      ).resolves.toEqual(boostBefore);
      expect(await reloadRelevanceFingerprint(database, relevantBoostJobs)).toEqual(
        relevanceBefore,
      );
    });
  } finally {
    await database.$disconnect();
  }
});

type Phase17Database = ReturnType<typeof phase17Database>;

async function protectedTargetFingerprint(
  database: Phase17Database,
  jobId: string,
  applicationId: string,
) {
  const [
    job,
    jobRevisionCount,
    jobEventCount,
    jobBoosts,
    application,
    applicationSnapshot,
    applicationDocumentCount,
    applicationEventCount,
    candidateNoteCount,
    employerNoteCount,
    conversation,
    auditCount,
    notificationCount,
  ] = await Promise.all([
    database.job.findUniqueOrThrow({ where: { id: jobId } }),
    database.jobRevision.count({ where: { jobId } }),
    database.jobStatusEvent.count({ where: { jobId } }),
    database.jobBoost.findMany({
      where: { jobId },
      orderBy: { id: "asc" },
    }),
    database.application.findUniqueOrThrow({
      where: { id: applicationId },
    }),
    database.applicationSubmissionSnapshot.findUniqueOrThrow({
      where: { applicationId },
    }),
    database.applicationSubmissionDocument.count({
      where: { applicationId },
    }),
    database.applicationEvent.count({ where: { applicationId } }),
    database.applicationCandidateNote.count({ where: { applicationId } }),
    database.applicationEmployerNote.count({ where: { applicationId } }),
    database.conversation.findFirst({
      where: { applicationId },
      select: {
        id: true,
        _count: { select: { messages: true, participants: true } },
      },
    }),
    database.auditLog.count({
      where: { targetId: { in: [jobId, applicationId] } },
    }),
    database.notification.count({
      where: {
        payload: { path: ["applicationId"], equals: applicationId },
      },
    }),
  ]);
  return Object.freeze({
    job,
    jobRevisionCount,
    jobEventCount,
    jobBoosts,
    application,
    applicationSnapshot,
    applicationDocumentCount,
    applicationEventCount,
    candidateNoteCount,
    employerNoteCount,
    conversation,
    auditCount,
    notificationCount,
  });
}

async function withSeedAnchorClock<T>(
  database: Phase17Database,
  run: (anchorAt: Date) => Promise<T>,
): Promise<T> {
  const manifest = await database.demoSeedManifest.findFirstOrThrow({
    where: { completedAt: { not: null } },
    orderBy: [{ anchorAt: "asc" }, { seedVersion: "asc" }],
    select: { anchorAt: true },
  });
  const clockPath = requiredEnvironment("PHASE17_CLOCK_FILE");
  const originalClock = readFileSync(clockPath, "utf8");
  writeFileSync(
    clockPath,
    `${JSON.stringify({
      offsetMilliseconds: manifest.anchorAt.getTime() - Date.now(),
      reason: "E2E-07 deterministic seed boost boundary",
      contract: "server-logical-clock-v1",
    })}\n`,
    "utf8",
  );
  try {
    return await run(manifest.anchorAt);
  } finally {
    writeFileSync(clockPath, originalClock, "utf8");
  }
}

async function loadBoostScenario(
  database: Phase17Database,
  now: Date,
) {
  const jobScope = {
    status: "PUBLISHED" as const,
    expiresAt: { gt: now },
    publishedRevisionId: { not: null },
    company: {
      status: "ACTIVE" as const,
      verificationRequests: {
        some: { status: "VERIFIED" as const, supersededBy: null },
      },
    },
  };
  const select = {
    id: true,
    status: true,
    startsAt: true,
    endsAt: true,
    cancelledAt: true,
    job: {
      select: {
        id: true,
        slug: true,
        company: { select: { name: true } },
        publishedRevision: {
          select: {
            id: true,
            title: true,
            description: true,
            tasks: true,
            requirements: true,
            offer: true,
          },
        },
      },
    },
  } as const;
  const [active, expired] = await Promise.all([
    database.jobBoost.findMany({
      where: {
        cancelledAt: null,
        startsAt: { lte: now },
        endsAt: { gt: now },
        job: jobScope,
      },
      orderBy: { id: "asc" },
      select,
    }),
    database.jobBoost.findMany({
      where: {
        cancelledAt: null,
        endsAt: { lte: now },
        job: jobScope,
      },
      orderBy: { id: "asc" },
      select,
    }),
  ]);
  expect(active.length).toBeGreaterThan(0);
  expect(expired.length).toBeGreaterThan(0);
  expect(
    active.every(
      (boost) =>
        boost.startsAt.getTime() <= now.getTime() &&
        now.getTime() < boost.endsAt.getTime(),
    ),
  ).toBe(true);
  expect(
    expired.every((boost) => boost.endsAt.getTime() <= now.getTime()),
  ).toBe(true);
  return Object.freeze({
    active: Object.freeze(active),
    expired: Object.freeze(expired),
  });
}

type BoostScenarioJob = Awaited<
  ReturnType<typeof loadBoostScenario>
>["active"][number];

function relevanceFingerprint(jobs: readonly BoostScenarioJob[]) {
  return jobs
    .map(({ job }) => {
      const revision = job.publishedRevision;
      if (revision === null) {
        throw new Error("A seeded Boost Job lost its published revision.");
      }
      return Object.freeze({
        jobId: job.id,
        relevance: calculateRelevanceProxy("Arbeit", {
          title: revision.title,
          companyName: job.company.name,
          body: [
            revision.description,
            ...revision.tasks,
            ...revision.requirements,
            revision.offer ?? "",
          ].join("\n"),
        }),
      });
    })
    .sort((left, right) => left.jobId.localeCompare(right.jobId));
}

async function reloadRelevanceFingerprint(
  database: Phase17Database,
  jobs: readonly BoostScenarioJob[],
) {
  const reloaded = await database.jobBoost.findMany({
    where: { id: { in: jobs.map(({ id }) => id) } },
    orderBy: { id: "asc" },
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
      cancelledAt: true,
      job: {
        select: {
          id: true,
          slug: true,
          company: { select: { name: true } },
          publishedRevision: {
            select: {
              id: true,
              title: true,
              description: true,
              tasks: true,
              requirements: true,
              offer: true,
            },
          },
        },
      },
    },
  });
  return relevanceFingerprint(reloaded);
}

async function resultHrefs(page: Page) {
  return page
    .locator('[data-slot="card"] h3 a[href^="/jobs/"]')
    .evaluateAll((links) =>
      links.map((link) => link.getAttribute("href")).filter(
        (href): href is string => href !== null,
      ),
    );
}

function assertUniqueFullPage(
  hrefs: readonly string[],
  expectedSize: number,
) {
  expect(hrefs).toHaveLength(expectedSize);
  expect(new Set(hrefs).size).toBe(expectedSize);
}

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required by this Phase 17 journey.`);
  }
  return value;
}
