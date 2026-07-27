import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  login,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";
import {
  createCompanyTrustCase,
  enrollTotp,
} from "@/tests/e2e/fixtures/phase25-security";

const ENFORCED = process.env.PHASE25_SECURITY_MODE === "enforce";

test.describe.configure({ mode: "serial" });

test("[P25C-AC-02] @journey reviews a compromised company and revokes public eligibility immediately", async ({
  browser,
  page,
}) => {
  const database = phase17Database();
  try {
    const admin = await database.user.findUniqueOrThrow({
      where: { emailNormalized: DEMO_ACCOUNTS.admin },
      select: { id: true },
    });
    const trustCase = await createCompanyTrustCase(database, {
      status: "OPEN",
      effectScope: [
        "SESSION",
        "COMPANY",
        "BADGE",
        "PUBLIC_JOBS",
        "MESSAGING",
        "RADAR",
        "EXPORT",
        "PAYMENT",
      ],
    });
    await login(page, DEMO_ACCOUNTS.admin, DEMO_PASSWORD);
    if (!ENFORCED) {
      await page.goto("/admin/trust-safety");
      await expect(
        page.getByRole("heading", { name: "Trust-&-Safety-Fälle" }),
      ).toBeVisible();
      await expect(
        page.locator(`a[href="/admin/trust-safety/${trustCase.caseId}"]`),
      ).toBeVisible();
      expect(
        (
          await database.company.findUniqueOrThrow({
            where: { id: trustCase.companyId },
            select: { status: true },
          })
        ).status,
      ).toBe("ACTIVE");
      return;
    }

    await enrollTotp(
      page,
      "/admin/security/authenticators",
      "Phase 25 Trust Reviewer TOTP",
    );
    await page.goto(`/admin/trust-safety/${trustCase.caseId}`);
    await expect(
      page.getByRole("heading", {
        name: `Fall ${trustCase.caseId.slice(0, 8)}`,
      }),
    ).toBeVisible();
    await page.getByLabel("Berechtigte Review-User-ID").fill(admin.id);
    await page.getByRole("button", { name: "Fall zuweisen" }).click();
    await expect(
      page.getByText(
        "Der Fall ist einer berechtigten Review-Person zugewiesen.",
      ),
    ).toBeVisible();
    await page.reload();

    await page.getByLabel("Entscheid").selectOption("REVOKE");
    await page
      .getByLabel("Sicher sichtbare Begründung")
      .fill(
        "Der bestätigte Vorfall wird begrenzt und nachvollziehbar widerrufen.",
      );
    await page
      .getByRole("button", {
        name: "Sicherheitsbestätigung ausstellen",
      })
      .click();
    await expect(
      page.getByText(/Bestätigung ausgestellt; einmalig gültig/u),
    ).toBeVisible();
    await page.getByRole("button", { name: "Entscheid ausführen" }).click();
    await expect(
      page.getByText("REVOKED", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("REVOKED · MANUAL_TRUST_REVIEW"),
    ).toBeVisible();

    const [company, job, persistedCase, effects] = await Promise.all([
      database.company.findUniqueOrThrow({
        where: { id: trustCase.companyId },
        select: { status: true },
      }),
      database.job.findUniqueOrThrow({
        where: { id: trustCase.jobId },
        select: { status: true },
      }),
      database.trustSafetyCase.findUniqueOrThrow({
        where: { id: trustCase.caseId },
        select: { status: true },
      }),
      database.trustSafetyContainmentEffect.findMany({
        where: { trustSafetyCaseId: trustCase.caseId },
        select: { effectScope: true },
      }),
    ]);
    expect(company.status).toBe("SUSPENDED");
    expect(job.status).toBe("PAUSED");
    expect(persistedCase.status).toBe("REVOKED");
    expect(effects.map(({ effectScope }) => effectScope)).toEqual(
      expect.arrayContaining([
        "COMPANY_STATUS",
        "PUBLIC_JOB",
        "COMPANY_VERIFICATION",
      ]),
    );

    const publicContext = await browser.newContext({
      baseURL: process.env.PHASE17_BASE_URL,
    });
    try {
      const publicPage = await publicContext.newPage();
      await publicPage.goto(`/jobs/${trustCase.jobSlug}`);
      await expect(
        publicPage.getByRole("heading", {
          name: "Diese Seite ist nicht verfügbar.",
        }),
      ).toBeVisible();
      await expect(
        publicPage.getByRole("heading", {
          name: "Phase 25 Browser Trust Teststelle",
        }),
      ).toHaveCount(0);
    } finally {
      await publicContext.close();
    }
  } finally {
    await database.$disconnect();
  }
});
