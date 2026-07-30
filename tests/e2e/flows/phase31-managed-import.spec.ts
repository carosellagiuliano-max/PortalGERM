import { expect, test } from "@/tests/e2e/fixtures/phase17-test";

test.describe.configure({ mode: "serial" });

test("[31-AC-10] @journey explains rights-to-preview-to-Draft without selling sync", async ({
  page,
}) => {
  await page.goto("/employers/xml-import");
  await expect(
    page.getByRole("heading", {
      name: /Wiederkehrende Stellen strukturiert vorbereiten/u,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(/weder freigeschaltet noch kaufbar/u),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Quellenrecht → Mapping → Preview → explizite Bestätigung → Draft-only Commit/u,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(/Wiederkehrender Sync und automatische Publikation bleiben deaktiviert/u),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /kaufen|bezahlen|import starten/iu }),
  ).toHaveCount(0);
});
