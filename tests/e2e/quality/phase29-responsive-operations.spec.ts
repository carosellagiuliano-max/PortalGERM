import type { Page } from "@playwright/test";

import {
  assertNoViewportClipping,
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  login,
  test,
} from "@/tests/e2e/fixtures/phase17-test";

type QualityTag = "@quality-desktop" | "@quality-mobile";

defineResponsiveContract("@quality-desktop");
defineResponsiveContract("@quality-mobile");

function defineResponsiveContract(tag: QualityTag) {
  test(`[P29-AC-03] ${tag} employer job cards preserve the desktop action contract`, async ({
    page,
  }) => {
    await login(page, DEMO_ACCOUNTS.employer, DEMO_PASSWORD);
    await page.goto("/employer/jobs");
    await verifyEmployerJobActions(page);
    await verifyAdditionalViewport(page, tag, verifyEmployerJobActions);
  });

  test(`[P29-AC-03] ${tag} admin queue and audit records remain operable without table scrolling`, async ({
    page,
  }) => {
    await login(page, DEMO_ACCOUNTS.admin, DEMO_PASSWORD);
    await page.goto("/admin/jobs?status=ALL");
    await verifyAdminJobActions(page);
    await verifyAdditionalViewport(page, tag, verifyAdminJobActions);

    await page.goto("/admin/audit");
    await verifyAuditTable(page);
    await verifyAdditionalViewport(page, tag, verifyAuditTable);
  });
}

async function verifyEmployerJobActions(page: Page) {
  const region = page.getByRole("region", {
    name: "Jobs und verfügbare Aktionen",
  });
  await expect(region).toBeVisible();
  await expect(region.locator('[data-responsive-table="true"]')).toHaveCount(1);
  await expect(region.getByRole("link", { name: "Öffnen" }).first()).toBeVisible();
  await expect(
    region.locator('[data-responsive-actions="true"]').first(),
  ).toBeVisible();
  await expect(region.locator('[data-e2e-horizontal-scroll="true"]')).toHaveCount(0);
  await assertNoViewportClipping(page);
}

async function verifyAdminJobActions(page: Page) {
  const region = page.getByRole("region", {
    name: "Job-Prüfung und verfügbare Aktionen",
  });
  await expect(region).toBeVisible();
  await expect(region.getByRole("link", { name: "Prüfen" }).first()).toBeVisible();
  await expect(
    region.locator('[data-responsive-actions="true"]').first(),
  ).toBeVisible();
  await expect(region.locator('[data-e2e-horizontal-scroll="true"]')).toHaveCount(0);
  await assertNoViewportClipping(page);
}

async function verifyAuditTable(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Audit-Evidenz", level: 1 }),
  ).toBeVisible();
  const region = page.getByRole("region", { name: "Audit-Evidenz" });
  await expect(region).toBeVisible();
  await expect(
    region.locator('[data-responsive-primary="true"]').first(),
  ).toBeVisible();
  await expect(region.locator('[data-e2e-horizontal-scroll="true"]')).toHaveCount(0);
  await assertNoViewportClipping(page);
}

async function verifyAdditionalViewport(
  page: Page,
  tag: QualityTag,
  verify: (page: Page) => Promise<void>,
) {
  await page.setViewportSize(
    tag === "@quality-mobile"
      ? { width: 320, height: 800 }
      : { width: 768, height: 900 },
  );
  await page.reload();
  await verify(page);
}
