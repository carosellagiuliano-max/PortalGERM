import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  login,
  openActor,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";
import {
  applyReversibleBrowserContainment,
  createCompanyTrustCase,
  enrollTotp,
} from "@/tests/e2e/fixtures/phase25-security";

const SECURITY_ADMIN_EMAIL =
  "security-admin@demo.swisstalenthub.test";
const ENFORCED = process.env.PHASE25_SECURITY_MODE === "enforce";

test.describe.configure({ mode: "serial" });

test("[P25C-AC-05] @journey submits one safe appeal and restores only through an independent approver", async ({
  browser,
  page,
}) => {
  const database = phase17Database();
  try {
    const reviewer = await database.user.findUniqueOrThrow({
      where: { emailNormalized: DEMO_ACCOUNTS.admin },
      select: { id: true },
    });
    const trustCase = await createCompanyTrustCase(database, {
      status: "HELD",
      effectScope: ["COMPANY", "PUBLIC_JOBS"],
      assigneeUserId: reviewer.id,
      safeReasonCode: "COMPANY_COMPROMISE_REVIEW",
    });
    if (ENFORCED) {
      await applyReversibleBrowserContainment(database, trustCase);
    }

    await login(page, trustCase.employerEmail, DEMO_PASSWORD);
    await page.goto("/employer/settings/security");
    await expect(
      page.getByRole("heading", {
        name: "Sicherheitsprüfung und Widerspruch",
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Sicherer Grund: COMPANY_COMPROMISE_REVIEW"),
    ).toBeVisible();
    await page
      .getByLabel("Warum soll der Entscheid erneut geprüft werden?")
      .fill(
        "Wir haben den Vorfall nachvollziehbar geprüft und bitten um eine unabhängige Wiederprüfung.",
      );
    await page.getByRole("button", { name: "Widerspruch einreichen" }).click();
    await expect(
      page.getByText(
        "Dein Widerspruch ist offen und einer unabhängigen Prüfung zugeführt.",
      ),
    ).toBeVisible();
    const appealed = await database.trustSafetyCase.findUniqueOrThrow({
      where: { id: trustCase.caseId },
      select: { status: true, version: true, appeals: true },
    });
    expect(appealed.status).toBe("APPEALED");
    expect(appealed.appeals).toHaveLength(1);

    const approver = await openActor(
      browser,
      SECURITY_ADMIN_EMAIL,
      DEMO_PASSWORD,
    );
    try {
      await enrollTotp(
        approver.page,
        "/admin/security/authenticators",
        "Phase 25 Independent Approver TOTP",
      );
      await approver.page.goto(
        `/admin/trust-safety/${trustCase.caseId}`,
      );
      await expect(
        approver.page.getByRole("heading", {
          name: "Offener Widerspruch",
        }),
      ).toBeVisible();
      await approver.page
        .getByLabel("Unabhängiger Appeal-Entscheid")
        .selectOption("APPROVE");
      await approver.page
        .getByLabel("Appeal Reason Code")
        .fill("APPEAL_VERIFIED_RESTORE");
      await approver.page
        .getByRole("button", {
          name: "Sicherheitsbestätigung ausstellen",
        })
        .click();
      await expect(
        approver.page.getByText(
          /Bestätigung ausgestellt; einmalig gültig/u,
        ),
      ).toBeVisible();
      await approver.page
        .getByRole("button", { name: "Appeal final entscheiden" })
        .click();
      await expect(
        approver.page.getByText("RESOLVED", { exact: true }),
      ).toBeVisible();
      await expect(
        approver.page.getByText(
          "APPEAL_APPROVED · APPEAL_VERIFIED_RESTORE",
        ),
      ).toBeVisible();
      await expect(approver.page.locator("body")).not.toContainText(
        "evidenceDigest",
      );
    } finally {
      await approver.close();
    }

    const [restoredCase, company, job, effects] = await Promise.all([
      database.trustSafetyCase.findUniqueOrThrow({
        where: { id: trustCase.caseId },
        select: {
          status: true,
          appeals: { select: { status: true, decidedByUserId: true } },
        },
      }),
      database.company.findUniqueOrThrow({
        where: { id: trustCase.companyId },
        select: { status: true },
      }),
      database.job.findUniqueOrThrow({
        where: { id: trustCase.jobId },
        select: { status: true },
      }),
      database.trustSafetyContainmentEffect.findMany({
        where: { trustSafetyCaseId: trustCase.caseId },
        select: { reversedAt: true },
      }),
    ]);
    expect(restoredCase.status).toBe("RESOLVED");
    expect(restoredCase.appeals).toEqual([
      expect.objectContaining({
        status: "APPROVED",
      }),
    ]);
    if (ENFORCED) {
      expect(company.status).toBe("ACTIVE");
      expect(job.status).toBe("PUBLISHED");
      expect(effects).toHaveLength(2);
      expect(effects.every(({ reversedAt }) => reversedAt !== null)).toBe(
        true,
      );
    }
  } finally {
    await database.$disconnect();
  }
});
