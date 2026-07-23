import type { Page } from "@playwright/test";

import {
  assertCriticalAccessibility,
  assertKeyboardFocusVisible,
  assertNoViewportClipping,
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  login,
  test,
  type PageObservation,
} from "@/tests/e2e/fixtures/phase17-test";

const QUALITY_PERFORMANCE_BUDGET_V1 = Object.freeze({
  navigationMilliseconds: 60_000,
  renderMilliseconds: 60_000,
});

type QualityRoute = Readonly<{
  label: string;
  path: string;
  heading: string | RegExp;
  assertState?: (page: Page) => Promise<void>;
}>;

type QualityViewport = Readonly<{
  tag: "@quality-desktop" | "@quality-mobile";
  width: 1_440 | 360;
  height: 900 | 800;
}>;

test.describe.configure({ mode: "serial" });

defineQualityMatrix({
  tag: "@quality-desktop",
  width: 1_440,
  height: 900,
});
defineQualityMatrix({
  tag: "@quality-mobile",
  width: 360,
  height: 800,
});

function defineQualityMatrix(viewport: QualityViewport) {
  test(`${viewport.tag} public success and empty routes`, async ({
    page,
    pageObservation,
  }) => {
    assertProjectViewport(page, viewport);

    await auditRoute(page, pageObservation, {
      label: "public home success",
      path: "/",
      heading:
        "Finde nicht irgendeinen Job. Finde den Job, der wirklich passt.",
      assertState: async (currentPage) => {
        await expect(
          currentPage.getByRole("heading", {
            level: 2,
            name: "Neue faire Stellen",
          }),
        ).toBeVisible();
      },
    });
    await auditRoute(page, pageObservation, {
      label: "public job-search empty state",
      path: "/jobs?keyword=zzqxphase17qualitynomatchzzqx",
      heading: "Finde deinen nächsten fairen Job.",
      assertState: async (currentPage) => {
        await expect(
          currentPage.getByText(
            "Für diese Auswahl sind aktuell keine publizierten Stellen verfügbar.",
            { exact: true },
          ),
        ).toBeVisible();
      },
    });
  });

  test(`${viewport.tag} auth success and locked private route`, async ({
    page,
    pageObservation,
  }) => {
    assertProjectViewport(page, viewport);

    await auditRoute(page, pageObservation, {
      label: "login success",
      path: "/login",
      heading: "Willkommen zurück",
      assertState: async (currentPage) => {
        await expect(
          currentPage.getByRole("button", { name: "Sicher anmelden" }),
        ).toBeVisible();
      },
    });
    await auditRoute(page, pageObservation, {
      label: "unauthenticated Candidate route locked",
      path: "/candidate/dashboard",
      heading: "Willkommen zurück",
      assertState: async (currentPage) => {
        await expect(currentPage).toHaveURL(
          /\/login\?next=%2Fcandidate%2Fdashboard$/u,
        );
        await expect(
          currentPage.getByRole("button", { name: "Sicher anmelden" }),
        ).toBeVisible();
      },
    });
  });

  test(`${viewport.tag} Candidate success routes`, async ({
    page,
    pageObservation,
  }) => {
    assertProjectViewport(page, viewport);
    await loginClean(
      page,
      pageObservation,
      DEMO_ACCOUNTS.candidate,
    );

    await auditRoute(page, pageObservation, {
      label: "Candidate dashboard success",
      path: "/candidate/dashboard",
      heading: "Dein Kandidaten-Cockpit",
      assertState: async (currentPage) => {
        await expect(
          currentPage
            .getByText("Anonym sichtbar im Talent Radar", { exact: true })
            .first(),
        ).toBeVisible();
      },
    });
    await auditRoute(page, pageObservation, {
      label: "Candidate seeded Job Alert success",
      path: "/candidate/alerts",
      heading: "Passende Stellen im Blick behalten",
      assertState: async (currentPage) => {
        await expect(
          currentPage.getByRole("button", { name: "Pausieren" }).first(),
        ).toBeVisible();
        await expect(
          currentPage.getByText("Freigegeben", { exact: true }).first(),
        ).toBeVisible();
      },
    });
    await auditRoute(page, pageObservation, {
      label: "Candidate Radar visibility success",
      path: "/candidate/talent-radar",
      heading: "Anonymer Talent Radar",
      assertState: async (currentPage) => {
        await expect(
          currentPage.getByRole("heading", {
            level: 2,
            name: "Anonym sichtbar im Talent Radar",
          }),
        ).toBeVisible();
      },
    });
  });

  test(`${viewport.tag} Employer success routes`, async ({
    page,
    pageObservation,
  }) => {
    assertProjectViewport(page, viewport);
    await loginClean(
      page,
      pageObservation,
      DEMO_ACCOUNTS.employer,
    );

    await auditRoute(page, pageObservation, {
      label: "Employer dashboard success",
      path: "/employer/dashboard",
      heading: "Guten Tag bei NovaRigi Digital AG",
      assertState: async (currentPage) => {
        await expect(
          currentPage.getByText("Aktive Jobs", { exact: true }),
        ).toBeVisible();
      },
    });
    await auditRoute(page, pageObservation, {
      label: "Employer Talent Radar success",
      path: "/employer/talent-radar",
      heading: "Talent Radar",
      assertState: async (currentPage) => {
        await expect(
          currentPage.getByText("Anonym geschützt", { exact: true }),
        ).toBeVisible();
        await expect(currentPage.getByText(/Kohortengrösse:/u)).toBeVisible();
        await expect(
          currentPage.getByText("Gesperrt", { exact: true }),
        ).toHaveCount(0);
      },
    });
  });

  test(`${viewport.tag} Admin success and empty queue routes`, async ({
    page,
    pageObservation,
  }) => {
    assertProjectViewport(page, viewport);
    await loginClean(page, pageObservation, DEMO_ACCOUNTS.admin);

    await auditRoute(page, pageObservation, {
      label: "Admin overview success",
      path: "/admin",
      heading: "Admin-Übersicht",
      assertState: async (currentPage) => {
        await expect(
          currentPage.getByRole("region", {
            name: "Operative Kennzahlen",
          }),
        ).toBeVisible();
      },
    });
    await auditRoute(page, pageObservation, {
      label: "Admin completed Privacy queue empty state",
      path: "/admin/privacy-requests?status=COMPLETED",
      heading: "Datenschutzfälle",
      assertState: async (currentPage) => {
        await expect(
          currentPage.getByText("Keine Fälle in dieser Queue.", {
            exact: true,
          }),
        ).toBeVisible();
      },
    });
  });
}

async function auditRoute(
  page: Page,
  observation: PageObservation,
  route: QualityRoute,
) {
  observation.clear();
  const response = await page.goto(route.path, { waitUntil: "load" });
  expect(response, `${route.label} did not produce a document response`).not.toBeNull();
  expect(
    response!.status(),
    `${route.label} returned HTTP ${response!.status()}`,
  ).toBeGreaterThanOrEqual(200);
  expect(
    response!.status(),
    `${route.label} returned HTTP ${response!.status()}`,
  ).toBeLessThan(400);

  await expect(
    page.getByRole("heading", { level: 1, name: route.heading }),
  ).toBeVisible();
  await route.assertState?.(page);
  await assertCriticalAccessibility(page);
  await assertNoViewportClipping(page);
  await assertKeyboardFocusVisible(page);
  await assertPerformanceBudget(page, route.label);
  observation.assertClean();
}

async function loginClean(
  page: Page,
  observation: PageObservation,
  email: string,
) {
  observation.clear();
  await login(page, email, DEMO_PASSWORD);
  observation.assertClean();
}

function assertProjectViewport(page: Page, viewport: QualityViewport) {
  expect(page.viewportSize()).toEqual({
    width: viewport.width,
    height: viewport.height,
  });
}

async function assertPerformanceBudget(page: Page, label: string) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  const timing = await page.evaluate(() => {
    const navigation = performance.getEntriesByType(
      "navigation",
    )[0] as PerformanceNavigationTiming | undefined;
    if (navigation === undefined) return null;
    const firstContentfulPaint = performance.getEntriesByName(
      "first-contentful-paint",
    )[0];
    return Object.freeze({
      responseEnd: navigation.responseEnd,
      domContentLoadedEventEnd: navigation.domContentLoadedEventEnd,
      loadEventEnd: navigation.loadEventEnd,
      duration: navigation.duration,
      renderMilestone:
        firstContentfulPaint?.startTime ??
        navigation.domContentLoadedEventEnd,
    });
  });

  expect(timing, `${label} has no Navigation Timing entry`).not.toBeNull();
  for (const value of [
    timing!.responseEnd,
    timing!.domContentLoadedEventEnd,
    timing!.loadEventEnd,
    timing!.duration,
    timing!.renderMilestone,
  ]) {
    expect(Number.isFinite(value), `${label} emitted invalid timing data`).toBe(
      true,
    );
    expect(value, `${label} emitted negative timing data`).toBeGreaterThanOrEqual(
      0,
    );
  }
  expect(
    timing!.duration,
    `${label} exceeded the deterministic navigation budget`,
  ).toBeLessThanOrEqual(
    QUALITY_PERFORMANCE_BUDGET_V1.navigationMilliseconds,
  );
  expect(
    timing!.renderMilestone,
    `${label} exceeded the deterministic render budget`,
  ).toBeLessThanOrEqual(QUALITY_PERFORMANCE_BUDGET_V1.renderMilliseconds);
}
