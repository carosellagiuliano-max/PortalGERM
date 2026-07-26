import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import {
  assertKeyboardFocusVisible,
  assertNoViewportClipping,
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  login,
  test,
} from "@/tests/e2e/fixtures/phase17-test";

type QualityTag = "@quality-desktop" | "@quality-mobile";

test.describe.configure({ mode: "serial" });

defineQualityContract("@quality-desktop");
defineQualityContract("@quality-mobile");

function defineQualityContract(tag: QualityTag) {
  test(`${tag} Phase 22 legal placeholders are understandable and accessible`, async ({
    page,
  }) => {
    for (const route of [
      "/legal/privacy",
      "/legal/terms",
      "/legal/imprint",
    ]) {
      await page.goto(route);
      await expect(
        page.getByText("Noch nicht veröffentlicht", { exact: false }),
      ).toBeVisible();
      await assertPageQuality(page);
    }
  });

  test(`${tag} Phase 22 privacy choices remain readable, keyboard reachable and default-off`, async ({
    page,
  }) => {
    await login(page, DEMO_ACCOUNTS.candidate, DEMO_PASSWORD);
    await page.goto("/candidate/privacy");
    await expect(
      page.getByRole("heading", {
        name: "Deine Daten, deine Entscheidungen",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Noch nicht freigegeben" }),
    ).toHaveCount(2);
    await expect(
      page.getByRole("heading", { name: "Datenexport anfordern" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Konto-Löschung beantragen" }),
    ).toBeVisible();
    await expect(
      page.getByText(/eng begrenzte Holds und Aufbewahrung/iu),
    ).toBeVisible();
    await assertPageQuality(page);
  });
}

async function assertPageQuality(page: Page) {
  await assertNoViewportClipping(page);
  await assertKeyboardFocusVisible(page);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    result.violations
      .filter(
        ({ impact }) => impact === "critical" || impact === "serious",
      )
      .map(({ id, impact, nodes }) => ({
        id,
        impact,
        targets: nodes.map(({ target }) => target),
      })),
  ).toEqual([]);
}
