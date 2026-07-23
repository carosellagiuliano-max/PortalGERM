import { test, expect, openActor, PHASE17_CANDIDATE, phase17Database } from "@/tests/e2e/fixtures/phase17-test";

test.describe.configure({ mode: "serial" });

test("[E2E-01] @journey candidate search to employer status update", async ({
  browser,
  page,
}) => {
  const database = phase17Database();
  try {
    const job = await database.job.findUniqueOrThrow({
      where: { slug: "zh-engineering-demo-024" },
      select: {
        id: true,
        slug: true,
        companyId: true,
        publishedRevision: {
          select: {
            title: true,
            requiredDocumentKinds: true,
          },
        },
      },
    });
    expect(job.publishedRevision?.requiredDocumentKinds).toEqual(["NONE"]);
    const jobTitle = job.publishedRevision!.title;

    await page.goto(`/jobs?keyword=${encodeURIComponent(jobTitle)}`);
    await expect(
      page.getByRole("heading", {
        name: "Finde deinen nächsten fairen Job.",
      }),
    ).toBeVisible();
    const searchResult = page.locator(`a[href="/jobs/${job.slug}"]`).first();
    await expect(searchResult).toHaveText(jobTitle);
    await searchResult.click();
    await expect(page).toHaveURL(`/jobs/${job.slug}`);
    await expect(page.getByRole("heading", { name: jobTitle })).toBeVisible();

    await applyButton(page, job.slug).click();
    await expect(page).toHaveURL(/\/login\?next=/u);
    await page.getByRole("link", { name: "Jetzt registrieren" }).click();
    await expect(
      page.getByRole("heading", { name: "Dein Kandidatenkonto" }),
    ).toBeVisible();
    await page.getByLabel("Vor- und Nachname").fill(PHASE17_CANDIDATE.name);
    await page.getByLabel("E-Mail-Adresse").fill(PHASE17_CANDIDATE.email);
    await page.getByLabel("Passwort", { exact: true }).fill(
      PHASE17_CANDIDATE.password,
    );
    await page
      .getByLabel("Passwort bestätigen")
      .fill(PHASE17_CANDIDATE.password);
    await page
      .getByLabel(/Ich akzeptiere die aktuellen Nutzungsbedingungen/u)
      .check();
    await page.getByRole("button", { name: "Konto erstellen" }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${job.slug}\\?intent=`, "u"));

    await completeSwissJobPass(page);

    await page.goto(`/jobs/${job.slug}`);
    await applyButton(page, job.slug).click();
    await expect(
      page.getByRole("heading", { name: "Bewerbung prüfen" }),
    ).toBeVisible();
    await page.locator('input[name="confirmed"]').check();
    await page
      .getByRole("button", {
        name: /Schnellbewerbung senden|Bewerbung senden/u,
      })
      .click();
    await expect(page).toHaveURL(
      /\/candidate\/applications\/[0-9a-f-]+\?submitted=1/u,
    );
    await expect(
      page.getByText(/Bewerbung.*erfasst|eingereicht/iu).first(),
    ).toBeVisible();

    const application = await database.application.findFirstOrThrow({
      where: {
        jobId: job.id,
        candidateProfile: { user: { email: PHASE17_CANDIDATE.email } },
      },
      select: {
        id: true,
        status: true,
        submissionSnapshot: true,
        submissionDocuments: true,
        conversation: { select: { id: true } },
        events: { select: { kind: true, toStatus: true } },
      },
    });
    expect(application.status).toBe("SUBMITTED");
    expect(application.submissionSnapshot).not.toBeNull();
    expect(application.submissionDocuments).toHaveLength(0);
    expect(application.conversation).not.toBeNull();
    expect(application.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "STATUS_CHANGE",
          toStatus: "SUBMITTED",
        }),
      ]),
    );

    const employer = await openActor(browser, "employer@demo.ch");
    try {
      await employer.page.goto(
        `/employer/applicants?q=${encodeURIComponent(PHASE17_CANDIDATE.firstName)}`,
      );
      await expect(
        employer.page.getByRole("heading", {
          name: PHASE17_CANDIDATE.name,
        }),
      ).toBeVisible();
      await employer.page
        .getByRole("link", { name: "Bewerbung öffnen" })
        .click();
      await employer.page
        .getByLabel("Nächster erlaubter Status")
        .selectOption("IN_REVIEW");
      await employer.page
        .getByRole("button", { name: "Status sicher setzen" })
        .click();
      await expect(
        employer.page.getByText(
          "Status aktualisiert; Kandidat:in wurde einmalig informiert.",
        ),
      ).toBeVisible();
    } finally {
      await employer.close();
    }

    await page.goto(`/candidate/applications/${application.id}`);
    await expect(page.getByText("In Prüfung", { exact: true }).first()).toBeVisible();
    const updated = await database.application.findUniqueOrThrow({
      where: { id: application.id },
      select: {
        status: true,
        events: {
          where: { toStatus: "IN_REVIEW" },
          select: { id: true },
        },
        candidateProfile: {
          select: {
            userId: true,
            onboardingStatus: true,
            radarProfile: {
              select: { publishedAt: true, withdrawnAt: true },
            },
          },
        },
      },
    });
    expect(updated.status).toBe("IN_REVIEW");
    expect(updated.events).toHaveLength(1);
    expect(updated.candidateProfile.onboardingStatus).toBe("COMPLETE");
    expect(updated.candidateProfile.radarProfile?.publishedAt).not.toBeNull();
    expect(updated.candidateProfile.radarProfile?.withdrawnAt).toBeNull();
  } finally {
    await database.$disconnect();
  }
});

async function completeSwissJobPass(page: import("@playwright/test").Page) {
  await page.goto("/candidate/jobpass");
  await expect(
    page.getByRole("heading", { name: "Dein SwissJobPass" }),
  ).toBeVisible();
  await page.locator('input[name="firstName"]').fill(PHASE17_CANDIDATE.firstName);
  await page.locator('input[name="lastName"]').fill(PHASE17_CANDIDATE.lastName);
  await page
    .locator('select[name="cantonId"]')
    .selectOption({ label: "Zürich (ZH)" });
  await page.locator('input[name="cityLabel"]').fill("Zürich");
  await page
    .locator('textarea[name="desiredTitles"]')
    .fill("Phase 17 Service Specialist");

  const category = page.locator('select[name="categoryIds"]');
  const categoryValue = await category
    .locator("option")
    .filter({ hasText: /Kundendienst|Callcenter/iu })
    .first()
    .getAttribute("value");
  expect(categoryValue).not.toBeNull();
  await category.selectOption(categoryValue!);

  await page
    .getByLabel("Kompetenzen suchen")
    .fill(PHASE17_CANDIDATE.uniqueSkill);
  await page
    .getByLabel(PHASE17_CANDIDATE.uniqueSkill, { exact: true })
    .check();
  await page.getByLabel("Festanstellung", { exact: true }).check();
  await page.getByLabel("Deutsch", { exact: true }).check();
  await page.locator('input[name="workloadMin"]').fill("80");
  await page.locator('input[name="workloadMax"]').fill("100");
  await page.locator('select[name="remotePreference"]').selectOption("ANY");
  await page.locator('input[name="radarVisible"]').check();

  await page
    .getByRole("button", { name: "SwissJobPass speichern" })
    .click();
  await expect(
    page.getByText(/SwissJobPass.*gespeichert\./u).first(),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "SwissJobPass verbindlich abschliessen",
    })
    .click();
  await expect(
    page.getByText(/SwissJobPass abgeschlossen/u).first(),
  ).toBeVisible();
}

function applyButton(page: import("@playwright/test").Page, jobSlug: string) {
  return page.locator(
    `form:has(input[name="jobSlug"][value="${jobSlug}"]):has(input[name="action"][value="APPLY"]) button[type="submit"]`,
  );
}
