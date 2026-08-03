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
  await expect(
    page.getByText("Einwilligungsversion:", { exact: false }),
  ).toBeVisible();
  await assertNoViewportClipping(page);
});

test("[P29-AC-05] @journey employer operations and admin queue work in the released engine", async ({
  page,
}) => {
  await login(page, DEMO_ACCOUNTS.employer, DEMO_PASSWORD);
  await settleJourneyPage(page);
  await openResponsiveOperationsPage(
    page,
    "/employer/jobs",
    "Inserate & Revisionen",
  );
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
  await openResponsiveOperationsPage(
    page,
    "/admin/jobs?status=ALL",
    "Job-Prüfung",
  );
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
  await expect(
    page.getByRole("heading", { name: heading, level: 1 }),
  ).toBeVisible();
  await assertNoViewportClipping(page);
}

async function openJourneyPage(page: Page, path: string) {
  await page.goto(path);
  await settleJourneyPage(page);
}

async function openAnalyticsJourneyPage(page: Page, path: string) {
  const pathUrl = new URL(path, "https://example.test");
  const expectedKind =
    pathUrl.pathname === "/jobs"
      ? "SEARCH_RESULTS_VIEWED"
      : "JOB_DETAIL_VIEWED";
  const expectedJobSlug =
    expectedKind === "JOB_DETAIL_VIEWED"
      ? decodeURIComponent(pathUrl.pathname.slice("/jobs/".length))
      : undefined;
  const analyticsResponse = page.waitForResponse((response) => {
    const request = response.request();
    if (
      request.method() !== "POST" ||
      new URL(response.url()).pathname !== "/api/analytics/public-jobs" ||
      request.headers()["content-type"]?.split(";", 1)[0] !== "application/json"
    )
      return false;
    let payload: { kind?: unknown; jobSlug?: unknown };
    try {
      payload = request.postDataJSON() as {
        kind?: unknown;
        jobSlug?: unknown;
      };
    } catch {
      return false;
    }
    return (
      payload.kind === expectedKind &&
      (expectedJobSlug === undefined || payload.jobSlug === expectedJobSlug)
    );
  });
  await openJourneyPage(page, path);
  const response = await analyticsResponse;
  // The 204 is emitted only after the route has awaited best-effort analytics
  // processing. Chromium may keep Playwright's response.finished() unresolved
  // for a completed keepalive request, so the terminal route status is the
  // portable completion boundary across all released engines.
  expect(response.status()).toBe(204);
  expect(response.headers()["cache-control"]).toBe(
    "private, no-store, max-age=0",
  );
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
}

async function settleJourneyPage(page: Page) {
  await page.waitForLoadState("networkidle");
}
