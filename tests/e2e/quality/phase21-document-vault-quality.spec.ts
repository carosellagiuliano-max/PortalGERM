import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";

import {
  assertKeyboardFocusVisible,
  assertNoViewportClipping,
  DEMO_PASSWORD,
  expect,
  login,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";

type QualityTag = "@quality-desktop" | "@quality-mobile";

test.describe.configure({ mode: "serial" });

defineQualityContract("@quality-desktop");
defineQualityContract("@quality-mobile");

function defineQualityContract(tag: QualityTag) {
  test(`${tag} Phase 21 empty, rejected, progress, clean and expired-grant states`, async ({
    page,
  }, testInfo) => {
    const candidate = await qualityCandidate(tag, 0);
    await login(page, candidate.email, DEMO_PASSWORD);
    await page.goto("/candidate/jobpass");
    await expect(page.locator('[data-vault-state="EMPTY"]')).toBeVisible();

    const input = page.getByLabel(
      "CV hochladen oder ersetzen (PDF, PNG, JPEG, WebP)",
    );
    await input.setInputFiles({
      name: "rejected.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not a document", "utf8"),
    });
    await expect(page.locator('[data-vault-state="REJECTED"]')).toBeFocused();
    await expect(page.getByText(/ausschliesslich PDF/u)).toBeVisible();

    let releaseUpload: () => void = () => {};
    let signalUploadStarted: () => void = () => {};
    const uploadStarted = new Promise<void>((resolveStarted) => {
      signalUploadStarted = resolveStarted;
    });
    const uploadGate = new Promise<void>((resolveUpload) => {
      releaseUpload = resolveUpload;
    });
    await page.route(/\/api\/documents\/upload-intents\/[^/]+\/body$/u, async (route) => {
      signalUploadStarted();
      await uploadGate;
      await route.continue();
    });
    await input.setInputFiles({
      name: "phase21-quality-clean.pdf",
      mimeType: "application/pdf",
      buffer: cleanPdf("quality-clean"),
    });
    const uploadClick = page
      .getByRole("button", { name: "Sicher hochladen" })
      .click();
    await uploadStarted;
    await expect(page.locator('[data-vault-state="UPLOADING"]')).toBeVisible();
    await expect(
      page.getByRole("progressbar", { name: /Uploadfortschritt/u }),
    ).toHaveAttribute(
      "aria-label",
      /Uploadfortschritt/u,
    );
    releaseUpload();
    await uploadClick;
    await page.unroute(/\/api\/documents\/upload-intents\/[^/]+\/body$/u);
    await expect(page.locator('[data-vault-state="CLEAN"]')).toBeFocused();

    await page.route(/\/api\/documents\/versions\/[^/]+\/read-grants$/u, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ token: "phase21-expired-token" }),
      }),
    );
    await page.route(/\/api\/documents\/read$/u, (route) =>
      route.fulfill({
        status: 410,
        contentType: "application/json",
        body: JSON.stringify({ code: "GRANT_EXPIRED" }),
      }),
    );
    await page
      .getByRole("button", { name: "Einmalig herunterladen" })
      .click();
    await expect(
      page.locator('[data-vault-state="EXPIRED_GRANT"]'),
    ).toBeFocused();

    await assertVaultQuality(page, testInfo);
  });

  test(`${tag} Phase 21 conflict, provider-degraded, retry and delete-pending states`, async ({
    page,
  }, testInfo) => {
    const candidate = await qualityCandidate(tag, 1);
    await login(page, candidate.email, DEMO_PASSWORD);
    await page.goto("/candidate/jobpass");
    const input = page.getByLabel(
      "CV hochladen oder ersetzen (PDF, PNG, JPEG, WebP)",
    );
    await input.setInputFiles({
      name: "phase21-quality-retry.pdf",
      mimeType: "application/pdf",
      buffer: cleanPdf("quality-retry"),
    });
    await page.route(/\/api\/documents\/upload-intents$/u, (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ code: "UPLOAD_CONFLICT" }),
      }),
    );
    await page.getByRole("button", { name: "Sicher hochladen" }).click();
    await expect(page.locator('[data-vault-state="CONFLICT"]')).toBeFocused();
    await page.unroute(/\/api\/documents\/upload-intents$/u);

    let scanCalls = 0;
    await page.route(/\/api\/documents\/versions\/[^/]+\/scan$/u, async (route) => {
      scanCalls += 1;
      if (scanCalls === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ code: "PROVIDER_DEGRADED" }),
        });
        return;
      }
      await route.continue();
    });
    await page.getByRole("button", { name: "Sicher hochladen" }).click();
    await expect(
      page.locator('[data-vault-state="PROVIDER_DEGRADED"]'),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Scan erneut versuchen" })
      .click();
    await expect(page.locator('[data-vault-state="CLEAN"]')).toBeFocused();
    expect(scanCalls).toBe(2);

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Löschung vormerken" }).click();
    await expect(
      page.locator('[data-vault-state="DELETE_PENDING"]'),
    ).toBeFocused();
    await assertVaultQuality(page, testInfo);
  });
}

async function qualityCandidate(tag: QualityTag, caseIndex: number) {
  const database = phase17Database();
  try {
    const candidates = await database.user.findMany({
      where: {
        role: "CANDIDATE",
        status: "ACTIVE",
        emailNormalized: { endsWith: "@demo.swisstalenthub.invalid" },
        candidateProfile: {
          is: {
            onboardingStatus: "COMPLETE",
            vaultDocuments: { none: {} },
          },
        },
      },
      orderBy: [{ emailNormalized: "asc" }],
      take: 12,
      select: { id: true, email: true },
    });
    const offset = (tag === "@quality-mobile" ? 4 : 0) + caseIndex;
    const candidate = candidates[offset];
    if (candidate === undefined) {
      throw new Error("Not enough isolated Phase 21 quality candidates.");
    }
    const demo = await database.user.findUniqueOrThrow({
      where: { emailNormalized: "candidate@demo.ch" },
      select: {
        credential: {
          select: {
            passwordHash: true,
            algorithm: true,
            algorithmVersion: true,
            passwordChangedAt: true,
          },
        },
      },
    });
    if (demo.credential === null) {
      throw new Error("Candidate demo credentials are unavailable.");
    }
    await database.credential.upsert({
      where: { userId: candidate.id },
      update: { ...demo.credential, updatedAt: new Date() },
      create: {
        userId: candidate.id,
        ...demo.credential,
        updatedAt: new Date(),
      },
    });
    return { email: candidate.email };
  } finally {
    await database.$disconnect();
  }
}

async function assertVaultQuality(page: Page, testInfo: TestInfo) {
  await assertTouchTargets(page);
  await assertKeyboardFocusVisible(page);
  await assertNoViewportClipping(page);
  const original = page.viewportSize();
  if (testInfo.project.name === "chromium-journeys") {
    await page.setViewportSize({ width: 720, height: 800 });
    await assertNoViewportClipping(page);
    await expect(page.locator('[data-document-vault="true"]')).toBeVisible();
    if (original !== null) await page.setViewportSize(original);
  }
  const result = await new AxeBuilder({ page })
    .include('[data-document-vault="true"]')
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

async function assertTouchTargets(page: Page) {
  const undersized = await page
    .locator(
      '[data-document-vault="true"] button:not([disabled]), [data-document-vault="true"] input[type="file"]:not([disabled])',
    )
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const rectangle = element.getBoundingClientRect();
        return rectangle.width < 44 || rectangle.height < 44
          ? [
              {
                tag: element.tagName,
                text: element.textContent?.trim().slice(0, 50) ?? "",
                width: rectangle.width,
                height: rectangle.height,
              },
            ]
          : [];
      }),
    );
  expect(undersized).toEqual([]);
}

function cleanPdf(label: string) {
  return Buffer.from(`%PDF-1.4\nphase21-${label}\n%%EOF`, "utf8");
}
