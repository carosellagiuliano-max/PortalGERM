import AxeBuilder from "@axe-core/playwright";

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
  test(`${tag} Phase 24 financial states remain textual, private and accessible`, async ({
    page,
  }) => {
    await login(page, DEMO_ACCOUNTS.admin, DEMO_PASSWORD);

    await page.goto("/admin/finance/reconciliation");
    await expect(
      page.getByRole("heading", { name: "Payment-Abgleich" }),
    ).toBeVisible();
    await expect(page.getByText("Finance · Read-only")).toBeVisible();
    await expect(
      page.getByText("Manuelle Reparatur gesperrt", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /reparieren|refund|erstatten/iu }),
    ).toHaveCount(0);
    await assertPageQuality(page);

    await page.goto("/admin/finance/service-recovery");
    await expect(
      page.getByRole("heading", {
        name: "Nichterfüllung und Ersatzleistung",
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Automatische Remedies deaktiviert", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Normale Kandidatenablehnung/u)).toBeVisible();
    await assertPageQuality(page);
  });
}

async function assertPageQuality(
  page: Parameters<typeof assertNoViewportClipping>[0],
) {
  await assertKeyboardFocusVisible(page);
  await assertNoViewportClipping(page);
  const result = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    result.violations
      .filter(({ impact }) => impact === "critical" || impact === "serious")
      .map(({ id, impact, nodes }) => ({
        id,
        impact,
        targets: nodes.map(({ target }) => target),
      })),
  ).toEqual([]);
}
