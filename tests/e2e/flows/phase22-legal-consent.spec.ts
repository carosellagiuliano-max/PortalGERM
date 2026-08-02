import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  login,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";

test.describe.configure({ mode: "serial" });

test("[22-AC-05/06] @journey legal publication and optional analytics remain fail closed without their exact gates", async ({
  page,
}) => {
  const database = phase17Database();
  try {
    for (const route of [
      "/legal/privacy",
      "/legal/terms",
      "/legal/imprint",
    ]) {
      await page.goto(route);
      await expect(
        page.getByText("Noch nicht veröffentlicht", { exact: false }),
      ).toBeVisible();
      await expect(page.locator("main")).not.toContainText(
        "PHASE22_DRAFT_LEAK_CANARY",
      );
    }

    await login(page, DEMO_ACCOUNTS.admin, DEMO_PASSWORD);
    await page.goto("/admin/legal");
    await expect(
      page.getByRole("heading", { name: "Legal & Processing Gates" }),
    ).toBeVisible();
    await page.getByLabel("Dokumenttyp").selectOption("ANALYTICS");
    await page.getByLabel("Titel").fill("Analysehinweis Phase 22");
    await page.getByLabel("Kanonischer Slug").fill("analytics-phase22-browser");
    await page.getByLabel("Versionsbezeichnung").fill("phase22-browser-v1");
    await page
      .getByLabel("Änderungszusammenfassung")
      .fill("Browserprüfung des getrennten Legal-Workflows");
    await page
      .getByLabel("Inhalt (sicheres Markdown)")
      .fill(
        "# PHASE22_DRAFT_LEAK_CANARY\n\nDieser Entwurf ist lang genug für die technische Validierung und darf vor unabhängiger Prüfung niemals öffentlich erscheinen.",
      );
    await page.getByRole("button", { name: "Entwurf speichern" }).click();
    await expect(page).toHaveURL(/result=saved/u);
    await expect(page.getByText("DRAFT", { exact: true })).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Unabhängig freigeben" }),
    ).toHaveCount(0);
    const revision = await database.legalRevision.findFirstOrThrow({
      where: { versionLabel: "phase22-browser-v1" },
      select: { status: true, reviewedByUserId: true },
    });
    expect(revision).toEqual({ status: "DRAFT", reviewedByUserId: null });
    expect(
      await database.legalPublication.count({
        where: {
          legalRevision: { versionLabel: "phase22-browser-v1" },
        },
      }),
    ).toBe(0);

    await page.context().clearCookies();
    await login(page, DEMO_ACCOUNTS.candidate, DEMO_PASSWORD);
    await page.goto("/candidate/privacy");
    await expect(
      page.getByRole("button", { name: "Noch nicht freigegeben" }),
    ).toHaveCount(2);
    expect(
      await database.analyticsConsentEvent.count({
        where: { granted: true },
      }),
    ).toBe(0);
  } finally {
    await database.$disconnect();
  }
});
