import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  login,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";
import { enrollTotp } from "@/tests/e2e/fixtures/phase25-security";

test.describe.configure({ mode: "serial" });

test("[P25A-AC-02] @journey enrolls TOTP and consumes recovery evidence once", async ({
  page,
}) => {
  const database = phase17Database();
  try {
    await login(page, DEMO_ACCOUNTS.admin, DEMO_PASSWORD);
    const enrolled = await enrollTotp(
      page,
      "/admin/security/authenticators",
      "Phase 25 Admin TOTP",
    );
    const admin = await database.user.findUniqueOrThrow({
      where: { emailNormalized: DEMO_ACCOUNTS.admin },
      select: { id: true },
    });
    const factor = await database.authenticator.findFirstOrThrow({
      where: {
        userId: admin.id,
        kind: "TOTP",
        status: "ACTIVE",
        label: enrolled.label,
      },
      include: { totp: true },
    });
    expect(
      await database.recoveryCode.count({
        where: { userId: admin.id },
      }),
    ).toBe(10);
    expect(factor.totp?.lastAcceptedStep).not.toBeNull();
    expect(
      await database.sessionAssurance.count({
        where: {
          userId: admin.id,
          level: "AAL2",
          revokedAt: null,
        },
      }),
    ).toBe(1);

    await page.reload();
    await page
      .getByLabel("6-stelliger Code", { exact: true })
      .fill(enrolled.code);
    await page.getByRole("button", { name: "Bestätigen" }).click();
    await expect(
      page.getByRole("alert").filter({
        hasText: "Der Sicherheitsnachweis war nicht gültig.",
      }),
    ).toBeVisible();

    const recoveryCode = enrolled.recoveryCodes[0]!;
    await page.getByLabel("Wiederherstellungscode").fill(recoveryCode);
    await page.getByRole("button", { name: "Code verwenden" }).click();
    await expect(
      page.getByText(
        "Der Wiederherstellungscode wurde einmalig verbraucht.",
      ),
    ).toBeVisible();
    await page.getByLabel("Wiederherstellungscode").fill(recoveryCode);
    await page.getByRole("button", { name: "Code verwenden" }).click();
    await expect(
      page.getByRole("alert").filter({
        hasText: "Der Sicherheitsnachweis war nicht gültig.",
      }),
    ).toBeVisible();
    expect(
      await database.recoveryCode.count({
        where: {
          userId: admin.id,
          usedAt: { not: null },
        },
      }),
    ).toBe(1);
    expect(
      await database.auditLog.count({
        where: {
          actorUserId: admin.id,
          action: {
            in: [
              "AUTHENTICATOR_ACTIVATED",
              "RECOVERY_CODE_USED",
            ],
          },
        },
      }),
    ).toBeGreaterThanOrEqual(2);
  } finally {
    await database.$disconnect();
  }
});
