import {
  expect,
  openActor,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";

const EMPLOYER = Object.freeze({
  email: "phase17-employer@example.test",
  name: "Eva Freigabepfad",
  password: "Phase17!Employer123",
  companyName: "Phase 17 Prüfwerk AG",
});
const JOB_TITLE = "Phase 17 Verifikationsingenieur:in";

test("[E2E-02] @journey employer onboarding to reviewed publication", async ({
  browser,
  page,
}) => {
  const database = phase17Database();
  try {
    await page.goto("/register/employer");
    await expect(
      page.getByRole("heading", { name: "Arbeitgeberkonto erstellen" }),
    ).toBeVisible();
    await page.getByLabel("Kontaktperson").fill(EMPLOYER.name);
    await page.getByLabel("Geschäftliche E-Mail").fill(EMPLOYER.email);
    await page
      .getByLabel("Passwort", { exact: true })
      .fill(EMPLOYER.password);
    await page
      .getByLabel("Passwort bestätigen")
      .fill(EMPLOYER.password);
    await page.getByLabel("Unternehmensname").fill(EMPLOYER.companyName);
    await page.getByLabel("Kanton").selectOption("ZH");
    await page.getByLabel("Unternehmensgrösse").selectOption("10-49");
    await page
      .getByLabel(/Ich akzeptiere die aktuellen Nutzungsbedingungen/u)
      .check();
    await page
      .getByRole("button", { name: "Arbeitgeberkonto erstellen" })
      .click();
    await expect(page).toHaveURL(/\/employer\/dashboard(?:\?|$)/u);
    await page.goto("/employer/company");

    const company = await database.company.findFirstOrThrow({
      where: {
        memberships: {
          some: { user: { emailNormalized: EMPLOYER.email } },
        },
      },
      select: {
        id: true,
        slug: true,
        status: true,
        verificationRequests: { select: { id: true } },
      },
    });
    expect(company.status).toBe("DRAFT");
    expect(company.verificationRequests).toHaveLength(0);

    await page.getByLabel("Branche").fill("Prüftechnik");
    await page.getByLabel("Website").fill("https://phase17-pruefwerk.example");
    await page
      .getByLabel("Öffentliche Beschreibung")
      .fill(
        "Fiktive Schweizer Prüftechnikfirma für den vollständigen Phase-17-Verifikationspfad.",
      );
    await page.locator("#location-0-canton").selectOption({
      label: "Zürich (ZH)",
    });
    await page.locator("#location-0-city").selectOption({
      label: "Zürich",
    });
    await page
      .getByRole("button", { name: "Firmenprofil speichern" })
      .click();
    await expect(
      page.getByText("Firmenprofil sicher gespeichert.", { exact: true }),
    ).toBeVisible();
    await page.reload();

    await expect(
      page.getByRole("button", { name: "Firmen-Onboarding abschliessen" }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Firmen-Onboarding abschliessen" })
      .click();
    await expect(
      page.getByText(
        "Das Firmenprofil ist aktiv. Der Prüfstatus unten bleibt davon unabhängig und kann nicht über den Onboarding-Abschluss verändert werden.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect
      .poll(async () =>
        database.company.findUnique({
          where: { id: company.id },
          select: { status: true },
        }),
      )
      .toEqual({ status: "ACTIVE" });
    const activeUnverifiedCompany = await page.request.get(
      `/companies/${company.slug}`,
    );
    expect(activeUnverifiedCompany.status()).toBe(200);
    expect(await activeUnverifiedCompany.text()).toContain(
      EMPLOYER.companyName,
    );

    await page.reload();
    await page
      .getByLabel("Beschreibung des Nachweises")
      .fill(
        "Der Handelsregisterauszug bestätigt den fiktiven Firmennamen und den Schweizer Hauptsitz.",
      );
    await page
      .getByLabel("Nachweis-Referenz")
      .fill("HR-PHASE17-VERIFICATION-001");
    await page
      .getByRole("button", {
        name: "Prüfzyklus starten und einreichen",
      })
      .click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Aktueller Prüfstatus" })
        .getByText("In Prüfung", { exact: true }),
    ).toBeVisible();

    const verification = await database.companyVerificationRequest.findFirstOrThrow({
      where: { companyId: company.id, supersededBy: null },
      select: { id: true, status: true },
    });
    expect(verification.status).toBe("PENDING");
    expect(
      (await page.request.get(`/companies/${company.slug}`)).status(),
    ).toBe(200);

    const admin = await openActor(browser, "admin@demo.ch");
    try {
      await admin.page.goto(`/admin/companies/${company.id}`);
      await expect(
        admin.page.getByRole("heading", { name: EMPLOYER.companyName }),
      ).toBeVisible();
      await admin.page
        .getByRole("button", { name: "Verifizieren" })
        .click();
      await expect(
        admin.page.getByText("VERIFIED", { exact: true }).first(),
      ).toBeVisible();
      await expect
        .poll(async () =>
          database.companyVerificationRequest.findUnique({
            where: { id: verification.id },
            select: { status: true },
          }),
        )
        .toEqual({ status: "VERIFIED" });
    } finally {
      await admin.close();
    }

    const publicCompany = await page.request.get(`/companies/${company.slug}`);
    expect(publicCompany.status()).toBe(200);
    expect(await publicCompany.text()).toContain(EMPLOYER.companyName);
    await page.goto(`/companies/${company.slug}`);
    await expect(
      page.getByText("Verifiziert", { exact: true }),
    ).toBeVisible();

    await page.goto("/employer/jobs/new");
    await page.getByLabel("Stellentitel").fill(JOB_TITLE);
    await page.getByLabel("Kategorie").selectOption({
      label: "Informatik",
    });
    await page.getByLabel("Arbeitsmodell").selectOption("REMOTE");
    await page
      .getByLabel("Remote-Land (nur bei vollständig Remote)")
      .fill("CH");
    await page.getByLabel("Freie Ortsangabe").fill("Schweiz");
    await page
      .getByRole("button", { name: "Entwurf anlegen und weiter" })
      .click();
    await expect(page).toHaveURL(
      /\/employer\/jobs\/[0-9a-f-]+\?step=2&created=1/u,
    );

    await page
      .getByLabel("Firmenintro")
      .fill("Phase 17 Prüfwerk entwickelt nachvollziehbare Prüfsysteme.");
    await page
      .getByLabel("Aufgaben (eine konkrete Aufgabe pro Zeile)")
      .fill(
        "Automatisierte Prüfpipelines entwickeln\nPrüfergebnisse nachvollziehbar dokumentieren",
      );
    await page
      .getByLabel("Muss-Anforderungen (eine pro Zeile)")
      .fill("Erfahrung mit TypeScript\nSorgfältige technische Dokumentation");
    await page
      .getByLabel("Unser Angebot")
      .fill(
        "Klare Prozesse, flexible Arbeitszeiten und ein transparentes Schweizer Arbeitsumfeld.",
      );
    await page
      .getByLabel("Benefits (CODE|konkrete Beschreibung, max. 10)")
      .fill(
        "FLEXIBLE_WORK|Flexible Arbeitszeiten mit dokumentiertem Gleitzeitrahmen",
      );
    await page.getByLabel("TypeScript", { exact: true }).check();
    await page
      .getByRole("button", { name: "Schritt 2 speichern" })
      .click();
    await expect(page).toHaveURL(/step=3&saved=1/u);

    await page.getByLabel("Lohnperiode").selectOption("YEARLY");
    await page.getByLabel("Lohn min. CHF").fill("85000");
    await page.getByLabel("Lohn max. CHF").fill("105000");
    await page.getByLabel("Antwortziel in Tagen").fill("10");
    await page
      .getByLabel("Bewerbungsprozess (ein Schritt pro Zeile)")
      .fill("Unterlagen prüfen\nStrukturiertes Fachgespräch");
    await page.getByLabel("NONE", { exact: true }).check();
    await page
      .getByLabel("Inklusionshinweis")
      .fill(
        "Wir begrüssen Bewerbungen unabhängig von Herkunft, Geschlecht oder Lebenslauf.",
      );
    await page
      .getByRole("button", { name: "Schritt 3 speichern" })
      .click();
    await expect(page).toHaveURL(/step=4&saved=1/u);

    const occupation = page.getByLabel("Berufsart");
    const occupationValue = await occupation
      .locator("option:not([value=''])")
      .first()
      .getAttribute("value");
    expect(occupationValue).not.toBeNull();
    await occupation.selectOption(occupationValue!);
    await page
      .getByRole("button", {
        name: "Meldepflicht prüfen und speichern",
      })
      .click();
    await expect(page).toHaveURL(/step=5&checked=1/u);
    await expect(
      page.getByRole("heading", { name: JOB_TITLE, level: 1 }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Zur Prüfung einreichen" })
      .click();
    await expect(page).toHaveURL(/submitted=1/u);

    const job = await database.job.findFirstOrThrow({
      where: {
        companyId: company.id,
        currentRevision: { title: JOB_TITLE },
      },
      select: {
        id: true,
        slug: true,
        status: true,
        version: true,
        currentRevision: {
          select: {
            id: true,
            version: true,
            scoreSnapshots: {
              select: { id: true, scoreVersion: true },
            },
          },
        },
      },
    });
    expect(job.status).toBe("SUBMITTED");
    expect(job.currentRevision?.scoreSnapshots).toHaveLength(1);

    const reviewAdmin = await openActor(browser, "admin@demo.ch");
    try {
      await reviewAdmin.page.goto(`/admin/jobs/${job.id}`);
      await reviewAdmin.page
        .getByRole("button", { name: "Prüfung starten" })
        .click();
      await expect
        .poll(async () =>
          database.job.findUnique({
            where: { id: job.id },
            select: { status: true },
          }),
        )
        .toEqual({ status: "IN_REVIEW" });
      await reviewAdmin.page.reload();
      await reviewAdmin.page
        .getByRole("button", { name: "Job freigeben" })
        .click();
      await expect
        .poll(async () =>
          database.job.findUnique({
            where: { id: job.id },
            select: { status: true },
          }),
        )
        .toEqual({ status: "APPROVED" });
      await reviewAdmin.page.reload();
      await reviewAdmin.page
        .getByRole("button", { name: "Atomar veröffentlichen" })
        .click();
      await expect
        .poll(async () =>
          database.job.findUnique({
            where: { id: job.id },
            select: {
              status: true,
              publishedAt: true,
              publishedRevisionId: true,
              statusEvents: {
                where: { toStatus: "PUBLISHED" },
                select: { id: true },
              },
            },
          }),
        )
        .toMatchObject({
          status: "PUBLISHED",
          publishedAt: expect.any(Date),
          publishedRevisionId: job.currentRevision!.id,
          statusEvents: [expect.objectContaining({ id: expect.any(String) })],
        });
    } finally {
      await reviewAdmin.close();
    }

    const publicJob = await page.request.get(`/jobs/${job.slug}`);
    expect(publicJob.status()).toBe(200);
    const publicBody = await publicJob.text();
    expect(publicBody).toContain(JOB_TITLE);
    expect(publicBody).toContain(EMPLOYER.companyName);
  } finally {
    await database.$disconnect();
  }
});
