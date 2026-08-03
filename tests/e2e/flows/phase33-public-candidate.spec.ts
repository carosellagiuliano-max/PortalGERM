import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import {
  assertCriticalAccessibility,
  assertKeyboardFocusVisible,
  assertNoViewportClipping,
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  openActor,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";

test.describe.configure({ mode: "serial" });

// The database contract permits 10 seconds of pool wait plus a 15-second
// transaction. Keep one click and one bounded observation window so a slow
// terminal result is not mistaken for failure under the exhaustive gate.
const SAVE_CONFIRMATION_TIMEOUT_MILLISECONDS = 30_000;

test("[P33-AC-10][P33-AC-14] @journey public discovery persists a private save and an owned alert without role leakage", async ({
  browser,
  page,
}) => {
  const database = phase17Database();
  let wrongRole: Awaited<ReturnType<typeof openActor>> | undefined;
  try {
    const candidate = await database.user.findUniqueOrThrow({
      where: { emailNormalized: DEMO_ACCOUNTS.candidate },
      select: {
        id: true,
        candidateProfile: { select: { id: true } },
      },
    });
    expect(candidate.candidateProfile).not.toBeNull();
    const job = await findPublicUnsavedJob(
      page,
      candidate.candidateProfile!.id,
    );

    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/jobs?keyword=${encodeURIComponent(job.title)}`);
    await expect(
      page.getByRole("heading", {
        name: "Finde deinen nächsten fairen Job.",
      }),
    ).toBeVisible();
    const result = page.locator(`a[href="/jobs/${job.slug}"]`).first();
    await expect(result).toHaveText(job.title);
    await assertAccessibleAndOperable(page);

    await result.click();
    await expect(
      page.getByRole("heading", { level: 1, name: job.title }),
    ).toBeVisible();
    await saveButton(page, job.slug).click();
    await expect(page).toHaveURL(/\/login\?next=/u);
    await loginCurrentPage(page, DEMO_ACCOUNTS.candidate, DEMO_PASSWORD);
    await expect(
      page.getByRole("heading", { level: 2, name: "Stelle speichern" }),
    ).toBeVisible();
    await confirmSaveAndExpectTerminalState(page, job.slug);
    await expect(
      page.getByRole("status").filter({
        hasText: "Die Stelle wurde in deiner privaten Merkliste gespeichert.",
      }),
    ).toBeVisible();

    const saved = await database.savedJob.findUniqueOrThrow({
      where: {
        candidateProfileId_jobId: {
          candidateProfileId: candidate.candidateProfile!.id,
          jobId: job.id,
        },
      },
      select: { id: true },
    });
    // JOB_SAVED is optional product analytics. The save is deliberately
    // persisted without silently opting this candidate into analytics.
    expect(
      await database.analyticsEvent.count({
        where: {
          producer: "candidate-saved-job",
          dedupeKey: `JOB_SAVED:${saved.id}`,
        },
      }),
    ).toBe(0);

    // A second signed confirmation is a real replay through the public UI. The
    // database uniqueness contract must still represent exactly one private
    // save, while privacy-safe analytics remain absent.
    await saveButton(page, job.slug).click();
    await expect(
      page.getByRole("heading", { level: 2, name: "Stelle speichern" }),
    ).toBeVisible();
    await confirmSaveAndExpectTerminalState(page, job.slug);
    await expect(
      page.getByRole("status").filter({
        hasText: "Die Stelle wurde in deiner privaten Merkliste gespeichert.",
      }),
    ).toBeVisible();
    expect(
      await database.savedJob.count({
        where: {
          candidateProfileId: candidate.candidateProfile!.id,
          jobId: job.id,
        },
      }),
    ).toBe(1);
    expect(
      await database.analyticsEvent.count({
        where: {
          producer: "candidate-saved-job",
          dedupeKey: `JOB_SAVED:${saved.id}`,
        },
      }),
    ).toBe(0);

    const alertKeyword = `Phase 33 ${randomUUID().slice(0, 8)}`;
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/candidate/alerts");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Passende Stellen im Blick behalten",
      }),
    ).toBeVisible();
    const alertForm = page.locator("form").filter({
      has: page.getByRole("button", { name: "Jobabo erstellen" }),
    });
    await alertForm.getByLabel("Suchbegriff").fill(alertKeyword);
    await alertForm.getByLabel("Dieses Jobabo ausdrücklich aktivieren").check();
    await alertForm.getByLabel(/per Service-E-Mail erhalten/u).check();
    await alertForm.getByRole("button", { name: "Jobabo erstellen" }).click();
    await expect(
      page.getByRole("status").filter({
        hasText: "Jobabo erstellt und ausdrücklich aktiviert.",
      }),
    ).toBeVisible();
    await assertAccessibleAndOperable(page);

    const alert = await database.jobAlert.findFirstOrThrow({
      where: {
        candidateProfileId: candidate.candidateProfile!.id,
        query: { path: ["keyword"], equals: alertKeyword },
      },
      select: {
        id: true,
        status: true,
        events: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { kind: true, actorUserId: true, reasonCode: true },
        },
      },
    });
    expect(alert).toMatchObject({
      status: "ACTIVE",
      events: [
        {
          kind: "CREATED",
          actorUserId: candidate.id,
          reasonCode: "EXPLICIT_ACTIVATION",
        },
      ],
    });

    wrongRole = await openActor(browser, DEMO_ACCOUNTS.employer);
    const denied = await wrongRole.context.request.get("/candidate/alerts", {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect(denied.status()).toBe(403);
    expect(await denied.text()).not.toContain(alertKeyword);
    await expect(
      database.jobAlert.findUnique({
        where: { id: alert.id },
        select: { status: true, candidateProfileId: true },
      }),
    ).resolves.toEqual({
      status: "ACTIVE",
      candidateProfileId: candidate.candidateProfile!.id,
    });
  } finally {
    await wrongRole?.close();
    await database.$disconnect();
  }
});

async function findPublicUnsavedJob(page: Page, candidateProfileId: string) {
  const database = phase17Database();
  try {
    const candidates = await database.job.findMany({
      where: {
        status: "PUBLISHED",
        publishedRevisionId: { not: null },
        savedBy: { none: { candidateProfileId } },
      },
      orderBy: [{ publishedAt: "asc" }, { id: "asc" }],
      take: 50,
      select: {
        id: true,
        slug: true,
        publishedRevision: { select: { title: true } },
      },
    });
    for (const candidate of candidates) {
      const title = candidate.publishedRevision?.title;
      if (title === undefined) continue;
      const response = await page.request.get(`/jobs/${candidate.slug}`, {
        failOnStatusCode: false,
      });
      if (
        response.status() === 200 &&
        (await response.text()).includes(title)
      ) {
        return Object.freeze({
          id: candidate.id,
          slug: candidate.slug,
          title,
        });
      }
    }
    throw new Error(
      "Phase 33 requires one publicly visible unsaved seeded Job.",
    );
  } finally {
    await database.$disconnect();
  }
}

async function loginCurrentPage(page: Page, email: string, password: string) {
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sicher anmelden" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
}

function saveButton(page: Page, jobSlug: string) {
  return page.locator(
    `form:has(input[name="jobSlug"][value="${jobSlug}"]):has(input[name="action"][value="SAVE"]) button[type="submit"]`,
  );
}

async function confirmSaveAndExpectTerminalState(page: Page, jobSlug: string) {
  const confirmationForm = page.locator('form:has(input[name="signedIntent"])');
  await confirmationForm
    .getByRole("button", { name: "Jetzt speichern" })
    .click();

  const savedUrl = new RegExp(`/jobs/${jobSlug}\\?saved=1(?:&|$)`, "u");
  const actionAlert = confirmationForm.getByRole("alert").first();
  await expect
    .poll(
      async () => {
        if (savedUrl.test(page.url())) return "SAVED";
        if (await actionAlert.isVisible().catch(() => false)) {
          const message = (await actionAlert.textContent())
            ?.replaceAll(/\s+/gu, " ")
            .trim()
            .slice(0, 240);
          return `REJECTED:${message ?? "GENERIC_ACTION_ERROR"}`;
        }
        const pending = await confirmationForm
          .getByRole("button", { name: "Wird gespeichert …" })
          .isVisible()
          .catch(() => false);
        return pending ? "PENDING" : "AWAITING_ACTION_RESULT";
      },
      {
        message: `Save confirmation did not reach a terminal state for ${jobSlug}.`,
        timeout: SAVE_CONFIRMATION_TIMEOUT_MILLISECONDS,
      },
    )
    .toBe("SAVED");
}

async function assertAccessibleAndOperable(page: Page) {
  const accessibility = await assertCriticalAccessibility(page);
  expect(
    accessibility.serious,
    JSON.stringify(accessibility.seriousViolations),
  ).toBe(0);
  await assertNoViewportClipping(page);
  await assertKeyboardFocusVisible(page);
}
