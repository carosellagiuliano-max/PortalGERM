import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  login,
  test,
} from "@/tests/e2e/fixtures/phase17-test";

test.describe.configure({ mode: "serial" });

test("[24-AC-01][E2E-34-09] @journey @phase34 keeps hosted checkout fail-closed until every external gate exists", async ({
  browser,
  page,
}) => {
  const publicContext = await browser.newContext();
  try {
    const publicPage = await publicContext.newPage();
    await publicPage.goto("/employer/billing/subscription");
    await expect(publicPage).toHaveURL(/\/login/u);
  } finally {
    await publicContext.close();
  }

  await login(page, DEMO_ACCOUNTS.employer, DEMO_PASSWORD);
  await page.goto("/employer/billing/subscription");
  await expect(
    page.getByRole("heading", { name: "Bezahltes Abonnement" }),
  ).toBeVisible();
  await expect(page.getByText("Serverseitig gesperrt")).toBeVisible();
  await expect(
    page.getByText("Noch kein realer Kauf möglich", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Kein Kauf-CTA")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: /kaufen|checkout|bezahlen/iu }),
  ).toHaveCount(0);
  await expect(
    page.locator('form:has(input[name="planSlug"])'),
  ).toHaveCount(0);
  await expect(page.getByText(/Ohne gültigen WTP-Entscheid/u)).toBeVisible();
  await expect(
    page.getByText(/Step-up-Orchestrierung folgt mit Phase 25B/u),
  ).toHaveCount(0);
});
