import {
  DEMO_ACCOUNTS,
  expect,
  openActor,
  phase17Database,
  test,
  verificationTokenForEmail,
} from "@/tests/e2e/fixtures/phase17-test";

const CANDIDATE = Object.freeze({
  email: "phase20-browser-candidate@example.test",
  changedEmail: "phase20-browser-candidate-new@example.test",
  name: "Nina Identitätspfad",
  password: "Phase20!BrowserSafe42",
});

test.describe.configure({ mode: "serial" });

test("[20-AC-01/03/06/09] @journey registration, verify, Privacy, preferences and safe login e-mail change", async ({
  page,
}) => {
  const database = phase17Database();
  try {
    await page.goto("/register/candidate");
    await page.getByLabel("Vor- und Nachname").fill(CANDIDATE.name);
    await page.getByLabel("E-Mail-Adresse").fill(CANDIDATE.email);
    await page
      .getByLabel("Passwort", { exact: true })
      .fill(CANDIDATE.password);
    await page
      .getByLabel("Passwort bestätigen")
      .fill(CANDIDATE.password);
    await page
      .getByLabel(/Ich akzeptiere die aktuellen Nutzungsbedingungen/u)
      .check();
    await page.getByRole("button", { name: "Konto erstellen" }).click();
    await expect(page).toHaveURL(/\/verify-email\?registered=1/u);

    let user = await database.user.findUniqueOrThrow({
      where: { emailNormalized: CANDIDATE.email },
      include: {
        emailVerificationChallenges: true,
        notificationOutbox: true,
      },
    });
    expect(user).toMatchObject({
      emailVerifiedAt: null,
      identityAssurance: "LOW_ASSURANCE",
    });
    expect(user.emailVerificationChallenges).toHaveLength(1);
    expect(user.notificationOutbox).toHaveLength(1);
    await page.goto("/candidate/privacy");
    await expect(page).toHaveURL(/\/verify-email/u);

    const registrationToken = await verificationTokenForEmail(
      CANDIDATE.email,
    );
    await page.goto(`/verify-email#token=${registrationToken}`);
    await expect(page).toHaveURL(/\/verify-email$/u);
    await page
      .getByRole("button", { name: "E-Mail jetzt bestätigen" })
      .click();
    await expect(
      page.getByText("Deine E-Mail-Adresse wurde bestätigt."),
    ).toBeVisible();
    await expect(
      page.getByRole("alert").filter({
        hasText: "Deine E-Mail-Adresse wurde bestätigt.",
      }),
    ).toBeFocused();
    user = await database.user.findUniqueOrThrow({
      where: { id: user.id },
      include: {
        emailVerificationChallenges: true,
        notificationOutbox: true,
      },
    });
    expect(user).toMatchObject({
      identityAssurance: "VERIFIED_EMAIL",
    });
    expect(user.emailVerifiedAt).not.toBeNull();

    await page.goto("/candidate/privacy");
    await expect(
      page.getByRole("heading", { name: "Deine Daten, deine Entscheidungen" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Export-Fall erstellen" })
      .click();
    await expect(
      page.getByText("Deine Datenschutzanfrage wurde erfasst."),
    ).toBeVisible();
    expect(
      await database.privacyRequest.count({
        where: { requesterUserId: user.id, type: "EXPORT" },
      }),
    ).toBe(1);

    await page.goto("/candidate/notifications");
    await expect(
      page.getByRole("heading", { name: "Benachrichtigungen" }),
    ).toBeVisible();
    await expect(
      page.getByText(/optionale externe Zustellung.*pausiert/iu).first(),
    ).toBeVisible();
    const jobAlerts = page.getByLabel("Jobabos und passende Stellen");
    await jobAlerts.check();
    await page
      .locator("form", { has: jobAlerts })
      .getByRole("button", { name: "Speichern" })
      .click();
    await expect(
      page.getByText(
        "Optionale E-Mails für diesen Zweck sind vorgemerkt.",
      ),
    ).toBeVisible();

    await page.getByLabel("Neue E-Mail-Adresse").fill(CANDIDATE.changedEmail);
    await page
      .getByLabel("Aktuelles Passwort")
      .fill(CANDIDATE.password);
    await page
      .getByRole("button", { name: "Neue Adresse sicher vormerken" })
      .click();
    await expect(
      page.getByText(/Bis zur Bestätigung bleibt deine bisherige/u),
    ).toBeVisible();
    const pending = await database.pendingEmailChange.findFirstOrThrow({
      where: { userId: user.id, status: "PENDING" },
      include: { challenge: true },
    });
    expect(pending.targetEmailNormalized).toBe(CANDIDATE.changedEmail);
    expect(
      await database.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).toMatchObject({
      emailNormalized: CANDIDATE.email,
      emailAddressEpoch: 1,
    });

    const changeToken = await verificationTokenForEmail(CANDIDATE.email);
    await page.goto(`/verify-email#token=${changeToken}`);
    await page
      .getByRole("button", { name: "E-Mail jetzt bestätigen" })
      .click();
    await expect(
      page.getByText("Deine E-Mail-Adresse wurde bestätigt."),
    ).toBeVisible();
    expect(
      await database.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).toMatchObject({
      emailNormalized: CANDIDATE.changedEmail,
      emailAddressEpoch: 2,
      identityAssurance: "VERIFIED_EMAIL",
    });
    expect(
      await database.notificationOutbox.count({
        where: {
          dedupeKey: `login-email-changed:${pending.id}`,
          purpose: "LOGIN_EMAIL_CHANGED_NOTICE",
        },
      }),
    ).toBe(1);

    await page.goto(`/verify-email#token=${changeToken}`);
    await page
      .getByRole("button", { name: "E-Mail jetzt bestätigen" })
      .click();
    await expect(
      page.getByText(
        "Der Link ist ungültig, abgelaufen oder wurde bereits verwendet.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("alert").filter({
        hasText:
          "Der Link ist ungültig, abgelaufen oder wurde bereits verwendet.",
      }),
    ).toBeFocused();
  } finally {
    await database.$disconnect();
  }
});

test("[20-AC-01/05/09] @journey Employer settings and enumeration-safe resend", async ({
  browser,
  page,
}) => {
  await page.goto("/verify-email");
  await page
    .getByLabel("E-Mail-Adresse")
    .fill("phase20-browser-unknown@example.test");
  await page
    .getByRole("button", { name: "Bestätigungslink anfordern" })
    .click();
  await expect(
    page.getByText(
      "Falls ein passendes Konto existiert, wurde eine neue Bestätigungsnachricht vorbereitet.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({
      hasText:
        "Falls ein passendes Konto existiert, wurde eine neue Bestätigungsnachricht vorbereitet.",
    }),
  ).toBeFocused();

  const employer = await openActor(browser, DEMO_ACCOUNTS.employer);
  try {
    await employer.page.goto("/employer/notifications");
    await expect(
      employer.page.getByRole("heading", { name: "Benachrichtigungen" }),
    ).toBeVisible();
    await expect(
      employer.page.getByText(/Pflichtnachrichten.*können/iu),
    ).toBeVisible();
    await expect(
      employer.page.getByRole("button", {
        name: "Neue Adresse sicher vormerken",
      }),
    ).toBeVisible();
  } finally {
    await employer.close();
  }
});
