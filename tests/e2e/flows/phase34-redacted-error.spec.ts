import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import {
  expect,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";

const SEARCH_DOCUMENT_COLUMN = "searchDocument";
const FAULT_COLUMN = "searchDocumentPhase34ControlledFault";

test.describe.configure({ mode: "serial" });

test("[F34-SEARCH-009][F34-SEC-005] @phase34 a controlled search failure exposes only a safe reference and recovers without a business write", async ({
  page,
  pageObservation,
}, testInfo) => {
  test.setTimeout(180_000);
  const database = phase17Database();
  const canary = `phase34-secret-canary-${testInfo.project.name}-${randomUUID()}`;
  let columnRenamed = false;
  try {
    const before = await businessFingerprint(database);
    await database.$executeRawUnsafe(
      `ALTER TABLE "JobRevision" RENAME COLUMN "${SEARCH_DOCUMENT_COLUMN}" TO "${FAULT_COLUMN}"`,
    );
    columnRenamed = true;

    await page.goto(`/jobs?keyword=${encodeURIComponent(canary)}`, {
      waitUntil: "networkidle",
    });
    await settleClientWork(page);
    const boundary = page.getByRole("alert").filter({
      has: page.getByRole("heading", {
        level: 1,
        name: "Die Stellensuche ist gerade nicht verfügbar.",
      }),
    });
    await expect(boundary).toBeVisible();
    await expect(
      boundary.getByText(
        "Deine Eingaben wurden nicht veröffentlicht oder gespeichert. Versuche die Suche erneut oder öffne sie ohne Filter.",
      ),
    ).toBeVisible();
    const reference = boundary.getByText(/^Referenz: /u);
    await expect(reference).not.toContainText("wird erstellt");
    const referenceText = (await reference.textContent()) ?? "";
    expect(referenceText).toMatch(
      /^Referenz: (?:[A-Za-z0-9_-]{6,128}|[0-9a-f-]{36})$/u,
    );
    expect(referenceText).not.toContain(canary);
    expect(referenceText).not.toContain("postgres");
    expect(referenceText).not.toContain("searchDocument");
    await expect(page.locator("body")).not.toContainText(canary);
    await expect(page.locator("body")).not.toContainText("DATABASE_URL");
    await expect(page.locator("body")).not.toContainText("Prisma");
    await expect(page.locator("body")).not.toContainText("JobRevision");
    expect(await businessFingerprint(database)).toEqual(before);

    const expectedBrowserDiagnostics = pageObservation.failures();
    expect(
      expectedBrowserDiagnostics.every(
        (entry) =>
          isControlledSearchFailureDiagnostic(entry) &&
          !entry.includes(canary) &&
          !/postgres(?:ql)?:\/\//iu.test(entry) &&
          !/SESSION_SECRET|DATABASE_URL|token=/iu.test(entry),
      ),
      expectedBrowserDiagnostics.join("\n"),
    ).toBe(true);
    pageObservation.clear();

    await database.$executeRawUnsafe(
      `ALTER TABLE "JobRevision" RENAME COLUMN "${FAULT_COLUMN}" TO "${SEARCH_DOCUMENT_COLUMN}"`,
    );
    columnRenamed = false;
    await boundary.getByRole("button", { name: "Suche erneut laden" }).click();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Finde deinen nächsten fairen Job.",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Die Stellensuche ist gerade nicht verfügbar.",
      }),
    ).toHaveCount(0);
    expect(await businessFingerprint(database)).toEqual(before);

    // React reports #419 when a streamed server Suspense boundary could not
    // finish because of this test's deliberate database fault. Firefox and
    // WebKit can deliver that diagnostic after the fallback is already
    // visible. Let successful recovery fully hydrate, then accept only this
    // exact framework fallback message; every other delayed browser failure
    // remains a test failure.
    await page.waitForLoadState("networkidle");
    await settleClientWork(page);
    const delayedDiagnostics = pageObservation.failures();
    expect(
      delayedDiagnostics.every(
        (entry) =>
          isControlledSearchFailureDiagnostic(entry) &&
          !entry.includes(canary) &&
          !/postgres(?:ql)?:\/\//iu.test(entry) &&
          !/SESSION_SECRET|DATABASE_URL|token=/iu.test(entry),
      ),
      delayedDiagnostics.join("\n"),
    ).toBe(true);
    pageObservation.clear();
  } finally {
    if (columnRenamed) {
      await database.$executeRawUnsafe(
        `ALTER TABLE "JobRevision" RENAME COLUMN "${FAULT_COLUMN}" TO "${SEARCH_DOCUMENT_COLUMN}"`,
      );
    }
    await database.$disconnect();
  }
});

function isControlledSearchFailureDiagnostic(value: string) {
  return (
    /^Uncaught page error: Minified React error #419;/u.test(value) ||
    value ===
      "Critical console error: Error: An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details. A digest property is included on this error instance which may provide additional details about the nature of the error."
  );
}

async function settleClientWork(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function businessFingerprint(
  database: ReturnType<typeof phase17Database>,
) {
  const [applications, savedJobs, jobs, companies, leads, reports] =
    await Promise.all([
      database.application.count(),
      database.savedJob.count(),
      database.job.count(),
      database.company.count(),
      database.salesLead.count(),
      database.abuseReport.count(),
    ]);
  return Object.freeze({
    applications,
    savedJobs,
    jobs,
    companies,
    leads,
    reports,
  });
}
