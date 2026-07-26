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
  test(`${tag} Phase 20 verification missing, invalid and generic resend states`, async ({
    page,
  }) => {
    await page.goto("/verify-email");
    await expect(
      page.getByRole("heading", { name: "E-Mail-Adresse bestätigen" }),
    ).toBeVisible();
    await expect(
      page.getByText(/Öffne den einmaligen Link/u),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "E-Mail jetzt bestätigen" }),
    ).toBeDisabled();
    await assertPhase20PageQuality(page);

    const invalidToken = "x".repeat(32);
    await page.goto(`/verify-email#token=${invalidToken}`);
    await expect(page).toHaveURL(/\/verify-email$/u);
    await page
      .getByRole("button", { name: "E-Mail jetzt bestätigen" })
      .click();
    await expect(
      page.getByText(
        "Der Link ist ungültig, abgelaufen oder wurde bereits verwendet.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("alert").filter({
        hasText:
          "Der Link ist ungültig, abgelaufen oder wurde bereits verwendet.",
      }),
    ).toBeFocused();
    await assertPhase20PageQuality(page);

    await page.getByLabel("E-Mail-Adresse").fill(
      `phase20-${tag === "@quality-mobile" ? "mobile" : "desktop"}-unknown@example.test`,
    );
    await page
      .getByRole("button", { name: "Bestätigungslink anfordern" })
      .click();
    await expect(
      page.getByText(/Falls ein passendes Konto existiert/u),
    ).toBeVisible();
    await expect(
      page.getByRole("alert").filter({
        hasText: "Falls ein passendes Konto existiert",
      }),
    ).toBeFocused();
    await assertPhase20PageQuality(page);
  });

  test(`${tag} Phase 20 Candidate notification settings states`, async ({
    page,
  }) => {
    await login(page, DEMO_ACCOUNTS.candidate, DEMO_PASSWORD);
    await page.goto("/candidate/notifications");
    await expect(
      page.getByRole("heading", { name: "Benachrichtigungen" }),
    ).toBeVisible();
    await expect(
      page.getByText(/Pflichtnachrichten zu Sicherheit/u),
    ).toBeVisible();
    await expect(
      page.getByText(/optionale externe Zustellung.*pausiert/iu),
    ).toHaveCount(2);
    await expect(
      page.getByRole("button", {
        name: "Neue Adresse sicher vormerken",
      }),
    ).toBeVisible();
    await assertPhase20PageQuality(page);
  });

  test(`${tag} Phase 20 redacted admin delivery states`, async ({ page }) => {
    await login(page, DEMO_ACCOUNTS.admin, DEMO_PASSWORD);
    await page.goto("/admin/system");
    await expect(
      page.getByRole("heading", { name: "Systemstatus" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Benachrichtigungszustellung" }),
    ).toBeVisible();
    await expect(page.getByText("DLQ", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Provider degradiert / pausiert", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/Production-Replay.*gesperrt/u),
    ).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("@example.test");
    expect(body).not.toMatch(/v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}/u);
    await assertPhase20PageQuality(page);
  });
}

async function assertPhase20PageQuality(page: Page) {
  await assertNoViewportClipping(page);
  await assertKeyboardFocusVisible(page);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = result.violations.filter(
    ({ impact }) => impact === "critical" || impact === "serious",
  );
  expect(
    blocking.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map(({ target }) => target),
    })),
  ).toEqual([]);
}
