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
} from "@/tests/e2e/fixtures/phase17-test";

test("[P29-AC-06] @quality-desktop critical public and private routes have zero serious or critical Axe findings", async ({
  page,
}) => {
  await assertAccessibleRoute(page, "/jobs", "Finde deinen nächsten fairen Job.");

  await login(page, DEMO_ACCOUNTS.candidate, DEMO_PASSWORD);
  await assertAccessibleRoute(page, "/candidate/jobpass", "Dein SwissJobPass");

  await page.context().clearCookies();
  await login(page, DEMO_ACCOUNTS.employer, DEMO_PASSWORD);
  await assertAccessibleRoute(page, "/employer/jobs", "Inserate & Revisionen");

  await page.context().clearCookies();
  await login(page, DEMO_ACCOUNTS.admin, DEMO_PASSWORD);
  await assertAccessibleRoute(page, "/admin/jobs?status=ALL", "Job-Prüfung");
});

test("[P29-AC-06] @quality-desktop SwissJobPass steps and primary save remain keyboard operable", async ({
  page,
}) => {
  await login(page, DEMO_ACCOUNTS.candidate, DEMO_PASSWORD);
  await page.goto("/candidate/jobpass");

  const professionStep = page.getByRole("button", { name: /Beruf/u });
  await professionStep.focus();
  await expect(professionStep).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("group", { name: "Berufliche Ziele" }),
  ).toBeVisible();

  const frameworkStep = page.getByRole("button", { name: /Rahmen/u });
  await frameworkStep.focus();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("group", { name: "Rahmenbedingungen" }),
  ).toBeVisible();

  const visibilityStep = page.getByRole("button", { name: /Sichtbarkeit/u });
  await visibilityStep.focus();
  await page.keyboard.press("Enter");
  const save = page.getByRole("button", { name: "Jetzt speichern" });
  await save.focus();
  await expect(save).toBeFocused();
  await expect(save).toBeVisible();
  await assertNoViewportClipping(page);
});

test("[P29-AC-06] @quality-desktop 200/400 percent reflow, high contrast and reduced motion preserve operation", async ({
  page,
}) => {
  await page.emulateMedia({
    forcedColors: "active",
    reducedMotion: "reduce",
  });
  await page.goto("/jobs");
  await expect(
    page.getByRole("heading", { name: "Finde deinen nächsten fairen Job." }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        forcedColors: matchMedia("(forced-colors: active)").matches,
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      })),
    )
    .toEqual({ forcedColors: true, reducedMotion: true });
  await assertKeyboardFocusVisible(page);

  await page.setViewportSize({ width: 640, height: 900 });
  await assertNoViewportClipping(page);
  await expect(page.getByRole("button", { name: "Stellen finden" })).toBeVisible();

  await page.setViewportSize({ width: 320, height: 800 });
  await assertNoViewportClipping(page);
  await expect(page.getByRole("button", { name: "Stellen finden" })).toBeVisible();
});

async function assertAccessibleRoute(
  page: Page,
  path: string,
  heading: string,
) {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
  const accessibility = await assertCriticalAccessibility(page);
  expect(
    accessibility.serious,
    JSON.stringify(accessibility.seriousViolations),
  ).toBe(0);
  await assertNoViewportClipping(page);
}
