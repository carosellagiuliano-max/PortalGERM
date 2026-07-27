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
  test(`${tag} Phase 23 Ops lists remain usable, textual and accessible`, async ({
    page,
  }) => {
    await login(page, DEMO_ACCOUNTS.admin, DEMO_PASSWORD);
    await page.goto("/admin/system");
    await expect(
      page.getByRole("heading", { name: "Worker Runtime" }),
    ).toBeVisible();
    await expect(
      page.getByText(/Mutationen bleiben bis Phase 25/u),
    ).toBeVisible();
    await expect(page.getByText("DISABLED", { exact: true }).first()).toBeVisible();

    await assertKeyboardFocusVisible(page);
    await assertNoViewportClipping(page);
    const overflowState = await page
      .locator("[data-e2e-phase23-ops]")
      .evaluate((element) => {
        const root = element as HTMLElement;
        const rootBounds = root.getBoundingClientRect();
        return {
          rootOverflow: root.scrollWidth - root.clientWidth,
          offenders: [...root.querySelectorAll<HTMLElement>("*")]
            .map((candidate) => {
              const bounds = candidate.getBoundingClientRect();
              return {
                tag: candidate.tagName,
                className: candidate.className,
                text: candidate.textContent?.trim().slice(0, 80) ?? "",
                ownOverflow: candidate.scrollWidth - candidate.clientWidth,
                rightOverflow: Math.ceil(bounds.right - rootBounds.right),
              };
            })
            .filter(
              ({ ownOverflow, rightOverflow }) =>
                ownOverflow > 1 || rightOverflow > 1,
            )
            .slice(0, 12),
        };
      });
    expect(
      overflowState.rootOverflow,
      JSON.stringify(overflowState.offenders),
    ).toBeLessThanOrEqual(1);

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
  });
}
