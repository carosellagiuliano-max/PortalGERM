import AxeBuilder from "@axe-core/playwright";

import {
  assertNoViewportClipping,
  DEMO_PASSWORD,
  expect,
  login,
  test,
} from "@/tests/e2e/fixtures/phase17-test";
import {
  ensurePhase27DualPersonaBrowserFixture,
  PHASE27_DUAL_ACCOUNT,
} from "@/tests/e2e/fixtures/phase27-test";

type QualityTag = "@quality-desktop" | "@quality-mobile";

test.beforeAll(async () => {
  await ensurePhase27DualPersonaBrowserFixture();
});

defineQualityContract("@quality-desktop");
defineQualityContract("@quality-mobile");

function defineQualityContract(tag: QualityTag) {
  test(`[P27-AC-12] ${tag} portal switch is explicit, keyboard reachable and unclipped`, async ({
    page,
  }) => {
    await login(page, PHASE27_DUAL_ACCOUNT, DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/account\/portal(?:\?|$)/u);
    const heading = page.getByRole("heading", {
      name: "In welchem Arbeitsbereich möchtest du handeln?",
    });
    await expect(heading).toBeVisible();
    await expect(
      page.getByText("Aktiver Arbeitsbereich", { exact: true }),
    ).toBeVisible();
    const switchButton = page.getByRole("button", {
      name: "Zu Kandidatenportal wechseln",
    });
    await expect(switchButton).toBeVisible();
    await switchButton.focus();
    await expect(switchButton).toBeFocused();

    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      accessibility.violations
        .filter(
          ({ impact }) => impact === "critical" || impact === "serious",
        )
        .map(({ id, impact }) => ({ id, impact })),
    ).toEqual([]);
    await assertNoViewportClipping(page);

    await switchButton.press("Enter");
    await expect(page).toHaveURL(/\/candidate\/dashboard(?:\?|$)/u);
    await expect(
      page.getByText("Kandidatenportal", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Zu Arbeitgeberportal wechseln",
      }),
    ).toBeVisible();
    await assertNoViewportClipping(page);
  });
}
