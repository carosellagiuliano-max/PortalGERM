import { expect, test } from "@/tests/e2e/fixtures/phase17-test";

test.describe.configure({ mode: "serial" });

test("[31-AC-09] @journey keeps pricing research-only without a production release", async ({
  page,
}) => {
  await page.goto("/pricing");
  await expect(
    page.getByText("Marktvalidierung · kein öffentliches Kaufangebot"),
  ).toBeVisible();
  await expect(
    page.getByText(/Demo, Testzahlung und Anfrage gelten nicht als Zahlungsnachweis/u),
  ).toBeVisible();
  await expect(
    page.getByText(/Lokaler Mock-Checkout · keine echte Belastung/u),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /jetzt kaufen|bezahlen|live checkout/iu }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/Boost und bezahlter Talent Radar bleiben/u),
  ).toBeVisible();
});
