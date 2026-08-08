import { randomUUID } from "node:crypto";

import type {
  Browser,
  BrowserContext,
  Page,
  Request as PlaywrightRequest,
} from "@playwright/test";

import {
  expect,
  observePage,
  phase17Database,
  test,
  type PageObservation,
} from "@/tests/e2e/fixtures/phase17-test";

type CapturedServerAction = Readonly<{
  body: Buffer;
  headers: Readonly<Record<string, string>>;
  path: string;
}>;

test.describe.configure({ mode: "serial" });

test("[F34-LEG-007] @phase34 public Lead and Abuse intake bind local evidence and remain zero-write locked in preview", async ({
  browser,
  page,
}, testInfo) => {
  const database = phase17Database();
  const localObservation = await observePage(page);
  let previewContext: BrowserContext | undefined;
  let previewObservation: PageObservation | undefined;
  try {
    const suffix = `${testInfo.project.name}-${randomUUID().slice(0, 8)}`;
    const email = `phase34-intake-${suffix}@example.test`.toLowerCase();
    const companyName = `Phase 34 Intake ${suffix}`;

    const localLeadResponse = await page.goto("/employers/demo");
    expect(localLeadResponse?.status()).toBe(200);
    await page.getByLabel("Unternehmen", { exact: true }).fill(companyName);
    await page.getByLabel("Kontaktperson").fill("Mara Phase 34");
    await page.getByLabel("Geschäftliche E-Mail").fill(email);
    await page.getByLabel("Unternehmensgrösse").selectOption("10_49");
    await page.getByLabel("Einstellungsbedarf").selectOption("ONE_ROLE");
    await page.getByLabel("Interesse").selectOption("GENERAL");
    await page
      .getByLabel("Worum geht es?")
      .fill("Wir möchten den verifizierten Datenschutzpfad gemeinsam prüfen.");
    await page
      .getByRole("checkbox", {
        name: /Ich bitte SwissTalentHub, mich zu dieser Anfrage zu kontaktieren/u,
      })
      .check();
    const [leadRequest] = await Promise.all([
      page.waitForRequest(isNextServerActionRequest),
      page.getByRole("button", { name: "Demo anfragen" }).click(),
    ]);
    const capturedLead = await captureServerAction(leadRequest);
    await expect(
      page.getByRole("heading", { name: "Anfrage erfasst" }),
    ).toBeVisible();

    const lead = await database.salesLead.findFirstOrThrow({
      where: { emailNormalized: email },
      select: {
        intakes: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            privacyEvidenceMode: true,
            privacyLegalPublicationId: true,
            privacyPublicationHash: true,
            privacyPublicationVersion: true,
          },
        },
      },
    });
    expect(lead.intakes).toEqual([
      {
        privacyEvidenceMode: "LOCAL_SYNTHETIC",
        privacyLegalPublicationId: null,
        privacyPublicationHash: null,
        privacyPublicationVersion: null,
      },
    ]);

    const reportDescription =
      `Phase 34 Browsermeldung ${suffix} mit ausreichend konkreter Beschreibung.`;
    const localCompanyResponse = await page.goto(
      "/companies/novarigi-digital",
    );
    expect(localCompanyResponse?.status()).toBe(200);
    const report = reportDetails(page);
    await report.locator("summary").click();
    await report.getByLabel("Grund").selectOption("MISLEADING");
    await report.getByLabel("Beschreibung").fill(reportDescription);
    const [reportRequest] = await Promise.all([
      page.waitForRequest(isNextServerActionRequest),
      report.getByRole("button", { name: "Meldung absenden" }).click(),
    ]);
    const capturedReport = await captureServerAction(reportRequest);
    await expect(
      report.getByText(
        "Danke. Deine Meldung wurde sicher erfasst und wird geprüft.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      database.abuseReport.findFirst({
        where: { description: reportDescription },
        select: {
          privacyEvidenceMode: true,
          privacyLegalPublicationId: true,
          privacyNoticeVersion: true,
          privacyNoticeHash: true,
        },
      }),
    ).resolves.toMatchObject({
      privacyEvidenceMode: "LOCAL_SYNTHETIC",
      privacyLegalPublicationId: null,
      privacyNoticeVersion: "abuse-report-privacy-v1",
      privacyNoticeHash:
        "70db3e2735065e414b44b9f958467c99a0323a79e1099f0ca54b6e7c20788de7",
    });

    previewContext = await createPreviewContext(browser);
    const previewPage = await previewContext.newPage();
    previewObservation = await observePage(previewPage);
    const previewLeadResponse = await previewPage.goto("/employers/demo");
    expect(previewLeadResponse?.status()).toBe(200);
    await expect(
      previewPage.getByText("Demo-Anfrage derzeit gesperrt", { exact: true }),
    ).toBeVisible();
    await expect(
      previewPage.getByRole("button", { name: "Demo anfragen" }),
    ).toHaveCount(0);

    const leadBeforeReplay = await leadEffectFingerprint(database, email);
    const leadReplay = await replayCapturedAction(
      previewContext,
      capturedLead,
      "/employers/demo",
      "198.51.100.134",
    );
    expect(leadReplay.status()).toBe(200);
    expect(await leadReplay.text()).toContain("Datenschutzhinweis");
    expect(await leadEffectFingerprint(database, email)).toEqual(
      leadBeforeReplay,
    );

    const previewCompanyResponse = await previewPage.goto(
      "/companies/novarigi-digital",
    );
    expect(previewCompanyResponse?.status()).toBe(200);
    const previewReport = reportDetails(previewPage);
    await previewReport.locator("summary").click();
    await expect(
      previewReport.getByText("Meldung derzeit gesperrt", { exact: true }),
    ).toBeVisible();
    await expect(
      previewReport.getByRole("button", { name: "Meldung absenden" }),
    ).toHaveCount(0);

    const reportBeforeReplay = await reportEffectFingerprint(database);
    const reportReplay = await replayCapturedAction(
      previewContext,
      capturedReport,
      "/companies/novarigi-digital",
      "198.51.100.135",
    );
    expect(reportReplay.status()).toBe(200);
    expect(await reportReplay.text()).toContain("Datenschutzhinweis");
    expect(await reportEffectFingerprint(database)).toEqual(
      reportBeforeReplay,
    );
  } finally {
    localObservation.assertClean();
    previewObservation?.assertClean();
    await previewContext?.close();
    await database.$disconnect();
  }
});

function reportDetails(page: Page) {
  return page.locator("details").filter({ hasText: "Inhalt melden" });
}

function isNextServerActionRequest(request: PlaywrightRequest) {
  return (
    request.method() === "POST" && request.headers()["next-action"] !== undefined
  );
}

async function captureServerAction(
  request: PlaywrightRequest,
): Promise<CapturedServerAction> {
  const body = request.postDataBuffer();
  if (body === null || body.byteLength === 0) {
    throw new Error("The genuine public-intake Server Action body is missing.");
  }
  const url = new URL(request.url());
  return Object.freeze({
    body,
    headers: Object.freeze(await request.allHeaders()),
    path: `${url.pathname}${url.search}`,
  });
}

function createPreviewContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: requiredEnvironment("PHASE34_PREVIEW_BASE_URL"),
    locale: "de-CH",
    timezoneId: "Europe/Zurich",
    viewport: { width: 1_440, height: 900 },
    serviceWorkers: "block",
    extraHTTPHeaders: { "x-forwarded-for": "198.51.100.133" },
  });
}

function replayCapturedAction(
  context: BrowserContext,
  captured: CapturedServerAction,
  refererPath: string,
  forwardedFor: string,
) {
  const previewBaseUrl = requiredEnvironment("PHASE34_PREVIEW_BASE_URL");
  const origin = new URL(previewBaseUrl).origin;
  const headers: Record<string, string> = {
    origin,
    referer: `${origin}${refererPath}`,
    "x-forwarded-for": forwardedFor,
  };
  for (const name of [
    "accept",
    "content-type",
    "next-action",
    "next-router-state-tree",
    "next-url",
  ]) {
    const value = captured.headers[name];
    if (value !== undefined) headers[name] = value;
  }
  return context.request.post(`${previewBaseUrl}${captured.path}`, {
    data: captured.body,
    failOnStatusCode: false,
    headers,
  });
}

async function leadEffectFingerprint(
  database: ReturnType<typeof phase17Database>,
  email: string,
) {
  const [lead, activities, intakes, tasks, rates, audits, outbox] =
    await Promise.all([
      database.salesLead.findFirst({
        where: { emailNormalized: email },
        select: { id: true, updatedAt: true },
      }),
      database.salesActivity.count({
        where: { salesLead: { emailNormalized: email } },
      }),
      database.salesLeadIntake.count({
        where: { salesLead: { emailNormalized: email } },
      }),
      database.systemTask.count({
        where: { kind: "SALES_FOLLOW_UP" },
      }),
      database.rateLimitBucket.count(),
      database.auditLog.count(),
      database.notificationOutbox.count(),
    ]);
  return { lead, activities, intakes, tasks, rates, audits, outbox };
}

async function reportEffectFingerprint(
  database: ReturnType<typeof phase17Database>,
) {
  const [reports, events, rates, audits, outbox] = await Promise.all([
    database.abuseReport.count(),
    database.abuseReportEvent.count(),
    database.rateLimitBucket.count(),
    database.auditLog.count(),
    database.notificationOutbox.count(),
  ]);
  return { reports, events, rates, audits, outbox };
}

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required for the Phase-34 public-intake test.`);
  }
  return value;
}
