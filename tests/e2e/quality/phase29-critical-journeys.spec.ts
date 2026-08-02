import type { Page } from "@playwright/test";

import {
  assertNoViewportClipping,
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  login,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";

let publishedJobSlug = "";

test.beforeAll(async () => {
  const database = phase17Database();
  try {
    const job = await database.job.findFirstOrThrow({
      where: { status: "PUBLISHED", publishedRevisionId: { not: null } },
      orderBy: [{ publishedAt: "asc" }, { id: "asc" }],
      select: { slug: true },
    });
    publishedJobSlug = job.slug;
  } finally {
    await database.$disconnect();
  }
});

test("[P29-AC-05] @journey public search, job and legal trust path works in the released engine", async ({
  page,
}) => {
  await openAnalyticsJourneyPage(page, "/jobs");
  await expect(
    page.getByRole("heading", { name: "Finde deinen nächsten fairen Job." }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  await assertNoViewportClipping(page);

  await openAnalyticsJourneyPage(page, `/jobs/${publishedJobSlug}`);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.locator("h1")).toBeVisible();
  await assertNoViewportClipping(page);

  await openJourneyPage(page, "/legal/privacy");
  await expect(
    page.getByRole("heading", { name: "Datenschutz", level: 1 }),
  ).toBeVisible();
  await assertNoViewportClipping(page);
});

test("[P29-AC-05] @journey candidate JobPass and Radar path works in the released engine", async ({
  page,
}) => {
  await login(page, DEMO_ACCOUNTS.candidate, DEMO_PASSWORD);
  await settleJourneyPage(page);
  await openJourneyPage(page, "/candidate/jobpass");
  await expect(
    page.getByRole("heading", { name: "Dein SwissJobPass", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "SwissJobPass-Fortschritt" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Weiter/u })).toBeVisible();
  await assertNoViewportClipping(page);

  await openJourneyPage(page, "/candidate/talent-radar");
  await expect(
    page.getByRole("heading", { name: "Anonymer Talent Radar", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Einwilligungsversion:", { exact: false })).toBeVisible();
  await assertNoViewportClipping(page);
});

test("[P29-AC-05] @journey employer operations and admin queue work in the released engine", async ({
  page,
}) => {
  await login(page, DEMO_ACCOUNTS.employer, DEMO_PASSWORD);
  await settleJourneyPage(page);
  await openResponsiveOperationsPage(page, "/employer/jobs", "Inserate & Revisionen");
  await expect(
    page.getByRole("region", { name: "Jobs und verfügbare Aktionen" }),
  ).toBeVisible();

  await openResponsiveOperationsPage(
    page,
    "/employer/billing",
    "Plan, Rechnungen und Guthaben",
  );

  await page.context().clearCookies();
  await login(page, DEMO_ACCOUNTS.admin, DEMO_PASSWORD);
  await settleJourneyPage(page);
  await openResponsiveOperationsPage(page, "/admin/jobs?status=ALL", "Job-Prüfung");
  await expect(
    page.getByRole("region", { name: "Job-Prüfung und verfügbare Aktionen" }),
  ).toBeVisible();
});

async function openResponsiveOperationsPage(
  page: Page,
  path: string,
  heading: string,
) {
  await openJourneyPage(page, path);
  await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
  await assertNoViewportClipping(page);
}

async function openJourneyPage(page: Page, path: string) {
  await page.goto(path);
  await settleJourneyPage(page);
}

async function openAnalyticsJourneyPage(page: Page, path: string) {
  const analyticsResponse = page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === "POST" &&
      request.headers()["next-action"] !== undefined &&
      new URL(response.url()).pathname === path
    );
  });
  await openJourneyPage(page, path);
  const response = await analyticsResponse;
  expect(response.ok()).toBe(true);
  await response.finished();
}

async function settleJourneyPage(page: Page) {
  await page.waitForLoadState("networkidle");
}
