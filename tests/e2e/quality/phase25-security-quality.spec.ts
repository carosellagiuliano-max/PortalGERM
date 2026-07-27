import type { Page } from "@playwright/test";

import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  assertCriticalAccessibility,
  assertKeyboardFocusVisible,
  assertNoViewportClipping,
  expect,
  login,
  test,
} from "@/tests/e2e/fixtures/phase17-test";

const ROUTES = Object.freeze([
  Object.freeze({
    email: DEMO_ACCOUNTS.candidate,
    path: "/candidate/settings/security",
    heading: "Sicherheitsfaktoren verwalten",
  }),
  Object.freeze({
    email: DEMO_ACCOUNTS.employer,
    path: "/employer/settings/security",
    heading: "Sicherheitsfaktoren verwalten",
  }),
  Object.freeze({
    email: DEMO_ACCOUNTS.admin,
    path: "/admin/security/authenticators",
    heading: "Passkeys, TOTP und Recovery",
  }),
  Object.freeze({
    email: DEMO_ACCOUNTS.admin,
    path: "/admin/trust-safety",
    heading: "Trust-&-Safety-Fälle",
  }),
]);

test("[P25-AC-14] @quality-desktop security and Trust UIs are keyboard and screenreader safe", async ({
  page,
}) => {
  for (const route of ROUTES) {
    await openAs(page, route.email, route.path);
    await expect(
      page.getByRole("heading", { name: route.heading }),
    ).toBeVisible();
    const accessibility = await assertCriticalAccessibility(page);
    expect(accessibility.serious).toBe(0);
    await assertNoViewportClipping(page);
    await assertKeyboardFocusVisible(page);
  }
});

test("[P25-AC-14] @quality-mobile security and Trust UIs fit 360 px without secret leaks", async ({
  page,
}) => {
  for (const route of ROUTES) {
    await openAs(page, route.email, route.path);
    await expect(
      page.getByRole("heading", { name: route.heading }),
    ).toBeVisible();
    const accessibility = await assertCriticalAccessibility(page);
    expect(accessibility.serious).toBe(0);
    await assertNoViewportClipping(page);
    await assertKeyboardFocusVisible(page);
    await expect(page.locator("body")).not.toContainText(
      /evidenceDigest|challengeDigest|grantDigest/u,
    );
  }
});

async function openAs(page: Page, email: string, path: string) {
  await page.context().clearCookies();
  await login(page, email, DEMO_PASSWORD);
  await page.goto(path);
}
