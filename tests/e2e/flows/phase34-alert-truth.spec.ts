import { randomUUID } from "node:crypto";

import type { BrowserContext, Page } from "@playwright/test";

import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  login,
  observePage,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";

test.describe.configure({ mode: "serial" });

test("[F34-NOT-004] @phase34 job alerts distinguish a durable local mock from an unavailable preview delivery path", async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const database = phase17Database();
  let previewContext: BrowserContext | undefined;
  try {
    const candidate = await database.user.findUniqueOrThrow({
      where: { emailNormalized: DEMO_ACCOUNTS.candidate },
      select: {
        id: true,
        emailNormalized: true,
        candidateProfile: { select: { id: true } },
      },
    });
    if (candidate.candidateProfile === null) {
      throw new Error("The seeded candidate profile is missing.");
    }

    await login(page, DEMO_ACCOUNTS.candidate, DEMO_PASSWORD);
    await page.goto("/candidate/alerts");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Passende Stellen im Blick behalten",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "Transparenter lokaler Testmodus",
      }),
    ).toBeVisible();

    // Begin every browser-project run from a denied consent projection so the
    // positive path proves the real consent, audit and activation boundary.
    const revokeConsent = page.getByRole("button", {
      name: "Jobabo-Einwilligung global widerrufen",
    });
    if ((await revokeConsent.count()) === 1) {
      await revokeConsent.click();
      await expect(
        page.getByRole("status").filter({
          hasText: "Service-Zustellung widerrufen.",
        }),
      ).toBeVisible();
    }

    const alertKeyword = `Phase 34 lokaler Alert ${randomUUID().slice(0, 8)}`;
    const outboxBeforeLocal = await database.notificationOutbox.count({
      where: { recipientUserId: candidate.id },
    });
    const emailLogBeforeLocal = await database.emailLog.count({
      where: { recipient: candidate.emailNormalized },
    });
    const consentAuditsBeforeLocal = await database.auditLog.count({
      where: {
        actorUserId: candidate.id,
        capability: "JOB_ALERT_DELIVERY_CONSENT",
      },
    });

    const localForm = newAlertForm(page);
    await localForm.getByLabel("Suchbegriff").fill(alertKeyword);
    await localForm.getByLabel("Dieses Jobabo ausdrücklich aktivieren").check();
    await localForm.getByLabel(/per Service-E-Mail erhalten/u).check();
    await localForm.getByRole("button", { name: "Jobabo erstellen" }).click();
    await expect(
      localForm.getByRole("status").filter({
        hasText:
          "Es ist ausschliesslich für den lokalen Mock-Test vorgemerkt; es wird keine echte E-Mail versendet.",
      }),
    ).toBeVisible();

    const alert = await database.jobAlert.findFirstOrThrow({
      where: {
        candidateProfileId: candidate.candidateProfile.id,
        query: { path: ["keyword"], equals: alertKeyword },
      },
      select: {
        id: true,
        createdAt: true,
        status: true,
        events: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { actorUserId: true, kind: true, reasonCode: true },
        },
      },
    });
    expect(alert).toMatchObject({
      status: "ACTIVE",
      events: [
        {
          actorUserId: candidate.id,
          kind: "CREATED",
          reasonCode: "EXPLICIT_ACTIVATION",
        },
      ],
    });
    await expect(
      database.userConsentEvent.findFirstOrThrow({
        where: { userId: candidate.id, kind: "JOB_ALERT_DELIVERY" },
        orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
        select: { granted: true },
      }),
    ).resolves.toEqual({ granted: true });
    await expect(
      database.auditLog.count({
        where: {
          actorUserId: candidate.id,
          capability: "JOB_ALERT_DELIVERY_CONSENT",
        },
      }),
    ).resolves.toBe(consentAuditsBeforeLocal + 1);
    await expect(
      database.notificationOutbox.count({
        where: { recipientUserId: candidate.id },
      }),
    ).resolves.toBe(outboxBeforeLocal);

    // The manual local button is a real browser action. Only its schedule is
    // moved into the due window as test setup; all domain effects go through
    // the application entrypoint.
    await database.jobAlert.update({
      where: { id: alert.id },
      data: { nextDueAt: alert.createdAt },
    });
    await page.reload();
    const localAlertCard = alertCard(page, alertKeyword);
    await expect(
      localAlertCard.getByText("Aktiv · Zustellpfad freigegeben", {
        exact: true,
      }),
    ).toBeVisible();
    await localAlertCard
      .getByRole("button", { name: "Fälligen Mock-Digest ausführen" })
      .click();
    await expect(
      localAlertCard.getByRole("status").filter({
        hasText: /Mock-Digest mit \d+ neuen Stellen sicher erfasst\./u,
      }),
    ).toBeVisible();

    await expect(
      database.jobAlertDigest.count({ where: { jobAlertId: alert.id } }),
    ).resolves.toBe(1);
    await expect(
      database.jobAlertEvent.count({
        where: { jobAlertId: alert.id, kind: "DIGEST_MOCK_RECORDED" },
      }),
    ).resolves.toBe(1);
    await expect(
      database.emailLog.count({
        where: { recipient: candidate.emailNormalized },
      }),
    ).resolves.toBe(emailLogBeforeLocal + 1);
    await expect(
      database.notificationOutbox.count({
        where: { recipientUserId: candidate.id },
      }),
    ).resolves.toBe(outboxBeforeLocal);
    await expect(
      database.jobAlert.findUniqueOrThrow({
        where: { id: alert.id },
        select: { lastSuccessfulCutoffAt: true, status: true },
      }),
    ).resolves.toEqual({
      lastSuccessfulCutoffAt: expect.any(Date),
      status: "ACTIVE",
    });

    previewContext = await browser.newContext({
      baseURL: requiredEnvironment("PHASE34_PREVIEW_BASE_URL"),
      locale: "de-CH",
      timezoneId: "Europe/Zurich",
      serviceWorkers: "block",
      extraHTTPHeaders: { "x-forwarded-for": "198.51.100.78" },
      storageState: await page.context().storageState(),
    });
    const previewPage = await previewContext.newPage();
    const previewObservation = await observePage(previewPage);
    await previewPage.goto("/candidate/alerts");
    await expect(
      previewPage.getByRole("heading", {
        level: 2,
        name: "Zustellung derzeit gesperrt",
      }),
    ).toBeVisible();
    await expect(
      previewPage.getByText(
        /keinen vollständig freigegebenen und erreichbaren Provider-, Worker- und Scheduler-Pfad/u,
      ),
    ).toBeVisible();
    const previewForm = newAlertForm(previewPage);
    const previewActivation = previewForm.getByLabel(
      "Dieses Jobabo ausdrücklich aktivieren",
    );
    await expect(previewActivation).toBeDisabled();
    await expect(
      previewForm.getByLabel(/per Service-E-Mail erhalten/u),
    ).toBeDisabled();
    await expect(
      previewPage.getByRole("button", {
        name: "Fälligen Mock-Digest ausführen",
      }),
    ).toHaveCount(0);

    const previewAlertCard = alertCard(previewPage, alertKeyword);
    await expect(
      previewAlertCard.getByText("Aktivierungswunsch · Zustellung gesperrt", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      previewAlertCard.getByText("Aktiv · Zustellpfad freigegeben", {
        exact: true,
      }),
    ).toHaveCount(0);
    const pause = previewAlertCard.getByRole("button", { name: "Pausieren" });
    await expect(pause).toBeEnabled();
    await expect(
      previewAlertCard.getByRole("button", { name: "Löschen" }),
    ).toBeEnabled();
    await pause.click();
    await expect(
      previewAlertCard.getByRole("status").filter({
        hasText: "Jobabo pausiert.",
      }),
    ).toBeVisible();
    await expect
      .poll(() =>
        database.jobAlert.findUniqueOrThrow({
          where: { id: alert.id },
          select: { status: true },
        }),
      )
      .toEqual({ status: "PAUSED" });

    // Disabled HTML controls are only the first barrier. Re-enable and submit
    // the genuine Next form in the browser to prove the server action itself
    // denies activation with no domain, outbox, consent or audit mutation.
    const deniedKeyword = `Phase 34 Preview Denial ${randomUUID().slice(0, 8)}`;
    await previewForm.getByLabel("Suchbegriff").fill(deniedKeyword);
    const beforeDeniedSubmit = await jobAlertMutationFingerprint(
      database,
      candidate.id,
      candidate.candidateProfile.id,
      candidate.emailNormalized,
    );
    await previewActivation.evaluate((element: HTMLInputElement) => {
      element.disabled = false;
      element.checked = true;
    });
    await expect(previewActivation).toBeChecked();
    await previewForm.getByRole("button", { name: "Jobabo erstellen" }).click();
    await expect(
      previewForm.getByRole("alert").filter({
        hasText: "Der Jobabo-Zustellpfad ist derzeit nicht betriebsbereit.",
      }),
    ).toBeVisible();
    await expect(
      database.jobAlert.count({
        where: {
          candidateProfileId: candidate.candidateProfile.id,
          query: { path: ["keyword"], equals: deniedKeyword },
        },
      }),
    ).resolves.toBe(0);
    await expect(
      jobAlertMutationFingerprint(
        database,
        candidate.id,
        candidate.candidateProfile.id,
        candidate.emailNormalized,
      ),
    ).resolves.toEqual(beforeDeniedSubmit);

    await previewPage.reload();
    const pausedCard = alertCard(previewPage, alertKeyword);
    const deleteAlert = pausedCard.getByRole("button", { name: "Löschen" });
    await expect(deleteAlert).toBeEnabled();
    await deleteAlert.click();
    await expect
      .poll(() =>
        database.jobAlert.findUniqueOrThrow({
          where: { id: alert.id },
          select: { status: true },
        }),
      )
      .toEqual({ status: "DELETED" });
    await expect(
      database.jobAlertEvent.count({
        where: { jobAlertId: alert.id, kind: "DELETED" },
      }),
    ).resolves.toBe(1);
    await expect(
      database.notificationOutbox.count({
        where: { recipientUserId: candidate.id },
      }),
    ).resolves.toBe(outboxBeforeLocal);
    previewObservation.assertClean();
  } finally {
    await previewContext?.close();
    await database.$disconnect();
  }
});

function newAlertForm(page: Page) {
  return page.locator("form").filter({
    has: page.getByRole("button", { name: "Jobabo erstellen" }),
  });
}

function alertCard(page: Page, keyword: string) {
  return page.locator('[data-slot="card"]').filter({
    has: page.getByRole("heading", { level: 2, name: keyword }),
  });
}

async function jobAlertMutationFingerprint(
  database: ReturnType<typeof phase17Database>,
  userId: string,
  candidateProfileId: string,
  email: string,
) {
  const [
    alerts,
    events,
    digests,
    unsubscribeTokens,
    outbox,
    emailLogs,
    consents,
    preferenceEvents,
    audits,
    activationAnalytics,
  ] = await Promise.all([
    database.jobAlert.count({ where: { candidateProfileId } }),
    database.jobAlertEvent.count({
      where: { jobAlert: { candidateProfileId } },
    }),
    database.jobAlertDigest.count({
      where: { jobAlert: { candidateProfileId } },
    }),
    database.jobAlertUnsubscribeToken.count({
      where: { jobAlert: { candidateProfileId } },
    }),
    database.notificationOutbox.count({ where: { recipientUserId: userId } }),
    database.emailLog.count({ where: { recipient: email } }),
    database.userConsentEvent.count({
      where: { userId, kind: "JOB_ALERT_DELIVERY" },
    }),
    database.notificationPreferenceEvent.count({
      where: { userId, purpose: "JOB_ALERT", channel: "EMAIL" },
    }),
    database.auditLog.count({ where: { actorUserId: userId } }),
    database.analyticsEvent.count({
      where: { producer: "candidate-job-alert" },
    }),
  ]);
  return Object.freeze({
    activationAnalytics,
    alerts,
    audits,
    consents,
    digests,
    emailLogs,
    events,
    outbox,
    preferenceEvents,
    unsubscribeTokens,
  });
}

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required by the Phase 34 browser suite.`);
  }
  return value;
}
