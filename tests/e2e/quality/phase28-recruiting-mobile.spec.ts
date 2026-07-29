import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import {
  assertNoViewportClipping,
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  login,
  test,
} from "@/tests/e2e/fixtures/phase17-test";
import {
  ensurePhase28BrowserFixture,
  ensurePhase28QualityRecords,
} from "@/tests/e2e/fixtures/phase28-test";

type QualityTag = "@quality-desktop" | "@quality-mobile";

let qualityTrackerId = "";
let qualityInterviewId = "";

test.beforeAll(async () => {
  const fixture = await ensurePhase28BrowserFixture();
  const quality = await ensurePhase28QualityRecords(fixture);
  qualityTrackerId = quality.trackerId;
  qualityInterviewId = quality.interviewId;
});

defineQualityContract("@quality-desktop");
defineQualityContract("@quality-mobile");

function defineQualityContract(tag: QualityTag) {
  test(`[P28-AC-08] ${tag} external tracker keeps source, status and reminder actions accessible`, async ({
    page,
  }) => {
    await login(page, DEMO_ACCOUNTS.candidate, DEMO_PASSWORD);
    await page.goto(`/candidate/applications/external/${qualityTrackerId}`);
    await expect(
      page.getByRole("heading", {
        name: /Phase 28 External Software Engineer/u,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Quelle: CANDIDATE_CONFIRMED"),
    ).toBeVisible();
    const status = page.getByLabel("Neuer, von dir bestätigter Status");
    await expect(status).toBeVisible();
    await expect(
      page.getByLabel("Freiwillige Erinnerung (Zürich)"),
    ).toBeVisible();
    await status.focus();
    await expect(status).toBeFocused();
    await assertZeroSeriousAccessibility(page);
    await assertNoViewportClipping(page);
    if (tag === "@quality-mobile") {
      await verifyAt320(page, async () => {
        await expect(
          page.getByLabel("Neuer, von dir bestätigter Status"),
        ).toBeVisible();
        await expect(
          page.getByLabel("Freiwillige Erinnerung (Zürich)"),
        ).toBeVisible();
      });
    }
  });

  test(`[P28-AC-08] ${tag} interview proposal and RSVP remain keyboard reachable and unclipped`, async ({
    page,
  }) => {
    await login(page, DEMO_ACCOUNTS.candidate, DEMO_PASSWORD);
    await page.goto(`/candidate/interviews/${qualityInterviewId}`);
    await expect(
      page.getByRole("heading", {
        name: "Phase 28 Qualitätsinterview",
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Europe/Zurich", { exact: false }).first(),
    ).toBeVisible();
    const proposal = page.getByLabel("Terminvorschlag");
    await expect(proposal).toBeVisible();
    await proposal.focus();
    await expect(proposal).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Termin bestätigen" }),
    ).toBeVisible();
    await assertZeroSeriousAccessibility(page);
    await assertNoViewportClipping(page);
    if (tag === "@quality-mobile") {
      await verifyAt320(page, async () => {
        await expect(page.getByLabel("Terminvorschlag")).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Termin bestätigen" }),
        ).toBeVisible();
      });
    }
  });
}

async function verifyAt320(page: Page, verifyPrimaryActions: () => Promise<void>) {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.reload();
  await verifyPrimaryActions();
  await assertZeroSeriousAccessibility(page);
  await assertNoViewportClipping(page);
}

async function assertZeroSeriousAccessibility(page: Page) {
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
