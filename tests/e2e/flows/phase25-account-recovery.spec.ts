import { randomUUID } from "node:crypto";

import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  login,
  phase17Database,
  test,
  verificationTokenForEmail,
} from "@/tests/e2e/fixtures/phase17-test";
import { enrollTotp } from "@/tests/e2e/fixtures/phase25-security";

const ENFORCED = process.env.PHASE25_SECURITY_MODE === "enforce";

test.describe.configure({ mode: "serial" });

test("[P25B-AC-03] @journey binds login e-mail recovery to AAL2 and revokes old grants", async ({
  page,
}) => {
  const database = phase17Database();
  const nextEmail = `phase25-recovery-${randomUUID().slice(0, 12)}@example.test`;
  try {
    await login(page, DEMO_ACCOUNTS.candidate, DEMO_PASSWORD);
    if (!ENFORCED) {
      await page.goto("/candidate/notifications");
      await expect(
        page.getByRole("heading", { name: "Benachrichtigungen" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "Sicherheitsbestätigung ausstellen",
        }),
      ).toHaveCount(0);
      return;
    }

    await enrollTotp(
      page,
      "/candidate/settings/security",
      "Phase 25 Recovery TOTP",
    );
    const user = await database.user.findUniqueOrThrow({
      where: { emailNormalized: DEMO_ACCOUNTS.candidate },
      select: { id: true },
    });
    const initiatingSession = await database.session.findFirstOrThrow({
      where: { userId: user.id, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    await page.goto("/candidate/notifications");
    await page.getByLabel("Neue E-Mail-Adresse").fill(nextEmail);
    await page
      .getByLabel("Aktuelles Passwort")
      .fill(DEMO_PASSWORD);
    await page
      .getByRole("button", {
        name: "Sicherheitsbestätigung ausstellen",
      })
      .click();
    await expect(
      page.getByText(/Bestätigung ausgestellt; einmalig gültig/u),
    ).toBeVisible();
    await page
      .getByLabel("Aktuelles Passwort")
      .fill(DEMO_PASSWORD);
    await page
      .getByRole("button", { name: "Neue Adresse sicher vormerken" })
      .click();
    await expect(
      page.getByText(
        /Die neue Adresse ist vorgemerkt\. Bis zur Bestätigung bleibt deine bisherige Login-Adresse gültig\./u,
      ),
    ).toBeVisible();
    const pending = await database.pendingEmailChange.findFirstOrThrow({
      where: {
        userId: user.id,
        targetEmailNormalized: nextEmail,
        status: "PENDING",
      },
      select: { id: true },
    });
    expect(
      await database.authAssuranceEvidence.count({
        where: {
          userId: user.id,
          purpose: "ACCOUNT_SECURITY",
          action: "LOGIN_EMAIL_CHANGE",
          usedAt: { not: null },
        },
      }),
    ).toBe(1);

    const token = await verificationTokenForEmail(DEMO_ACCOUNTS.candidate);
    await page.goto(`/verify-email#token=${token}`);
    await page
      .getByRole("button", { name: "E-Mail jetzt bestätigen" })
      .click();
    await expect(
      page.getByText("Deine E-Mail-Adresse wurde bestätigt."),
    ).toBeVisible();
    expect(
      await database.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          emailNormalized: true,
          emailAddressEpoch: true,
          identityAssurance: true,
        },
      }),
    ).toMatchObject({
      emailNormalized: nextEmail,
      identityAssurance: "VERIFIED_EMAIL",
    });
    expect(
      (
        await database.session.findUniqueOrThrow({
          where: { id: initiatingSession.id },
          select: { revokedAt: true },
        })
      ).revokedAt,
    ).not.toBeNull();
    expect(
      await database.authAssuranceEvidence.count({
        where: {
          userId: user.id,
          revokedAt: null,
          usedAt: null,
        },
      }),
    ).toBe(0);
    expect(
      await database.notificationOutbox.count({
        where: {
          OR: [
            { dedupeKey: `login-email-change:${pending.id}` },
            { dedupeKey: `login-email-changed:${pending.id}` },
          ],
        },
      }),
    ).toBeGreaterThanOrEqual(1);

    await page.goto(`/verify-email#token=${token}`);
    await page
      .getByRole("button", { name: "E-Mail jetzt bestätigen" })
      .click();
    await expect(
      page.getByText(
        "Der Link ist ungültig, abgelaufen oder wurde bereits verwendet.",
      ),
    ).toBeVisible();
  } finally {
    await database.$disconnect();
  }
});
