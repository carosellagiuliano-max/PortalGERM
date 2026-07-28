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

const PRIVATE_TRUST_PATTERN =
  /challengeToken|tokenHash|proofDigest|responseDigest|evidenceDigest|providerReference|sth-domain-verification=/u;

test("[P26-AC-11] @quality-desktop employer, review and public trust UIs are understandable and accessible", async ({
  page,
}) => {
  await openAs(
    page,
    DEMO_ACCOUNTS.employer,
    "/employer/verification",
    "Firmenidentität prüfen",
  );
  await verifyPageQuality(page);
  await expect(
    page.getByRole("heading", { name: "Was das Abzeichen aussagt" }),
  ).toBeVisible();

  await openAs(
    page,
    DEMO_ACCOUNTS.admin,
    "/admin/company-verification",
    "Firmenprüfungen",
  );
  await verifyPageQuality(page);
  await expect(page.getByText("SLA überschritten")).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/companies/novarigi-digital");
  await expect(
    page.getByRole("heading", {
      name: "NovaRigi Digital AG",
      exact: true,
    }),
  ).toBeVisible();
  await verifyPageQuality(page);
  await expect(
    page.getByText("Firmenidentität geprüft", { exact: true }).first(),
  ).toBeVisible();
});

test("[P26-AC-11] @quality-mobile trust UIs fit 360 px and expose no evidence secrets", async ({
  page,
}) => {
  await openAs(
    page,
    DEMO_ACCOUNTS.employer,
    "/employer/verification",
    "Firmenidentität prüfen",
  );
  await verifyPageQuality(page);

  await openAs(
    page,
    DEMO_ACCOUNTS.admin,
    "/admin/company-verification",
    "Firmenprüfungen",
  );
  await verifyPageQuality(page);

  await page.context().clearCookies();
  await page.goto("/companies/novarigi-digital");
  await expect(
    page.getByRole("heading", {
      name: "NovaRigi Digital AG",
      exact: true,
    }),
  ).toBeVisible();
  await verifyPageQuality(page);
});

async function openAs(
  page: Page,
  email: string,
  path: string,
  heading: string,
) {
  await page.context().clearCookies();
  await login(page, email, DEMO_PASSWORD);
  await page.goto(path);
  await expect(page.getByRole("heading", { name: heading })).toBeVisible();
}

async function verifyPageQuality(page: Page) {
  const accessibility = await assertCriticalAccessibility(page);
  expect(accessibility.critical).toBe(0);
  expect(accessibility.seriousViolations).toEqual([]);
  await assertNoViewportClipping(page);
  await assertKeyboardFocusVisible(page);
  expect(await page.locator("body").innerText()).not.toMatch(
    PRIVATE_TRUST_PATTERN,
  );
}
