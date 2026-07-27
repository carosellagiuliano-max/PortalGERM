import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  login,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";
import { enrollTotp } from "@/tests/e2e/fixtures/phase25-security";

const ENFORCED = process.env.PHASE25_SECURITY_MODE === "enforce";

test.describe.configure({ mode: "serial" });

test("[P25B-AC-02] @journey @quality-mobile Owner team action consumes one bound grant", async ({
  page,
}) => {
  const database = phase17Database();
  try {
    await login(page, DEMO_ACCOUNTS.employer, DEMO_PASSWORD);
    if (!ENFORCED) {
      await page.goto("/employer/team");
      await expect(
        page.getByRole("heading", {
          name: "Team und Job-Zuweisungen",
        }),
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
      "/employer/settings/security",
      "Phase 25 Employer TOTP",
    );
    await page.goto("/employer/team");
    const roleSelects = page.locator('select[aria-label^="Rolle für"]');
    const count = await roleSelects.count();
    let target = roleSelects.first();
    for (let index = 0; index < count; index += 1) {
      const candidate = roleSelects.nth(index);
      if ((await candidate.inputValue()) === "RECRUITER") {
        target = candidate;
        break;
      }
    }
    expect(await target.inputValue()).toBe("RECRUITER");
    const form = target.locator("xpath=ancestor::form[1]");
    const membershipId = await form
      .locator('input[name="membershipId"]')
      .inputValue();
    await target.selectOption("VIEWER");
    await form.getByRole("button", { name: "Rolle speichern" }).click();
    await expect(
      page.getByRole("alert").filter({
        hasText: "Die frische, exakt an diese Teamaktion gebundene",
      }),
    ).toBeVisible();
    expect(
      (
        await database.companyMembership.findUniqueOrThrow({
          where: { id: membershipId },
          select: { role: true },
        })
      ).role,
    ).toBe("RECRUITER");

    await target.selectOption("VIEWER");
    await form
      .getByRole("button", {
        name: "Sicherheitsbestätigung ausstellen",
      })
      .click();
    await expect(
      form.getByText(/Bestätigung ausgestellt; einmalig gültig/u),
    ).toBeVisible();
    await form.getByRole("button", { name: "Rolle speichern" }).click();
    await expect(page.getByText("Rolle aktualisiert.")).toBeVisible();
    expect(
      (
        await database.companyMembership.findUniqueOrThrow({
          where: { id: membershipId },
          select: { role: true },
        })
      ).role,
    ).toBe("VIEWER");
    expect(
      await database.authAssuranceEvidence.count({
        where: { user: { emailNormalized: DEMO_ACCOUNTS.employer }, usedAt: { not: null } },
      }),
    ).toBe(1);
  } finally {
    await database.$disconnect();
  }
});

test("[P25B-AC-02] @journey @quality-mobile Candidate privacy correction requires and consumes a bound grant", async ({
  page,
}) => {
  const database = phase17Database();
  try {
    await login(page, DEMO_ACCOUNTS.candidate, DEMO_PASSWORD);
    if (!ENFORCED) {
      await page.goto("/candidate/privacy");
      await expect(
        page.getByRole("heading", {
          name: "Deine Daten, deine Entscheidungen",
        }),
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
      "Phase 25 Candidate TOTP",
    );
    await page.goto("/candidate/privacy");
    const form = page
      .getByRole("button", { name: "Korrektur anfordern" })
      .locator("xpath=ancestor::form[1]");
    await form.getByLabel("Anzeigename").check();
    await form
      .getByPlaceholder(/Beschreibe die gewünschte Korrektur/u)
      .fill(
        "Der Anzeigename soll nach unabhängiger Prüfung korrekt aktualisiert werden.",
      );
    await form.getByRole("button", { name: "Korrektur anfordern" }).click();
    await expect(
      form.getByText(
        "Deine Sitzung ist für diese Datenschutzanfrage nicht mehr gültig.",
      ),
    ).toBeVisible();
    expect(
      await database.privacyRequest.count({
        where: {
          requester: { emailNormalized: DEMO_ACCOUNTS.candidate },
          type: "CORRECT",
          createdAt: { gt: new Date(Date.now() - 60_000) },
        },
      }),
    ).toBe(0);
    await form
      .getByRole("button", {
        name: "Sicherheitsbestätigung ausstellen",
      })
      .click();
    await expect(
      form.getByText(/Bestätigung ausgestellt; einmalig gültig/u),
    ).toBeVisible();
    await form.getByLabel("Anzeigename").check();
    await form
      .getByPlaceholder(/Beschreibe die gewünschte Korrektur/u)
      .fill(
        "Der Anzeigename soll nach unabhängiger Prüfung korrekt aktualisiert werden.",
      );
    await form.getByRole("button", { name: "Korrektur anfordern" }).click();
    await expect(
      form.getByText("Deine Datenschutzanfrage wurde erfasst."),
    ).toBeVisible();
    expect(
      await database.privacyRequest.count({
        where: {
          requester: { emailNormalized: DEMO_ACCOUNTS.candidate },
          type: "CORRECT",
          createdAt: { gt: new Date(Date.now() - 60_000) },
        },
      }),
    ).toBe(1);
  } finally {
    await database.$disconnect();
  }
});
