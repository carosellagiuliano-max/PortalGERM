import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  login,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";
import { hashSessionToken, SESSION_POLICY_V1 } from "@/lib/auth/session";
import { enrollTotp } from "@/tests/e2e/fixtures/phase25-security";

test.describe.configure({ mode: "serial" });

test("[P25A-AC-02] @journey enrolls TOTP and consumes recovery evidence once", async ({
  page,
}) => {
  const database = phase17Database();
  try {
    await login(page, DEMO_ACCOUNTS.admin, DEMO_PASSWORD);
    const admin = await database.user.findUniqueOrThrow({
      where: { emailNormalized: DEMO_ACCOUNTS.admin },
      select: { id: true },
    });
    const sessionCookie = (await page.context().cookies()).find(
      ({ name }) => name === SESSION_POLICY_V1.cookieName,
    );
    if (sessionCookie === undefined) {
      throw new Error("The authenticated admin session cookie is missing.");
    }
    const adminSession = await database.session.findUniqueOrThrow({
      where: { tokenHash: hashSessionToken(sessionCookie.value) },
      select: { id: true, userId: true, revokedAt: true },
    });
    expect(adminSession.userId).toBe(admin.id);
    expect(adminSession.revokedAt).toBeNull();
    const enrolled = await enrollTotp(
      page,
      "/admin/security/authenticators",
      "Phase 25 Admin TOTP",
    );
    const factor = await database.authenticator.findFirstOrThrow({
      where: {
        userId: admin.id,
        kind: "TOTP",
        status: "ACTIVE",
        label: enrolled.label,
      },
      include: { totp: true },
    });
    const currentRecoveryCodes = await database.recoveryCode.findMany({
      where: {
        userId: admin.id,
        usedAt: null,
        revokedAt: null,
      },
      select: { batchId: true },
    });
    expect(currentRecoveryCodes).toHaveLength(10);
    const currentRecoveryBatchId = currentRecoveryCodes[0]?.batchId;
    if (currentRecoveryBatchId === undefined) {
      throw new Error("The active recovery-code batch is missing.");
    }
    expect(
      new Set(currentRecoveryCodes.map(({ batchId }) => batchId)),
    ).toEqual(new Set([currentRecoveryBatchId]));
    expect(factor.totp?.lastAcceptedStep).not.toBeNull();
    expect(
      await database.sessionAssurance.count({
        where: {
          userId: admin.id,
          sessionId: adminSession.id,
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
          batchId: currentRecoveryBatchId,
          usedAt: { not: null },
          revokedAt: null,
        },
      }),
    ).toBe(1);
    expect(
      await database.recoveryCode.count({
        where: {
          userId: admin.id,
          batchId: currentRecoveryBatchId,
          usedAt: null,
          revokedAt: null,
        },
      }),
    ).toBe(9);
    expect(
      await database.auditLog.count({
        where: {
          actorUserId: admin.id,
          action: "AUTHENTICATOR_ACTIVATED",
          targetType: "AUTHENTICATOR",
          targetId: factor.id,
        },
      }),
    ).toBe(1);
    expect(
      await database.auditLog.count({
        where: {
          actorUserId: admin.id,
          action: "RECOVERY_CODE_USED",
          targetType: "SESSION_ASSURANCE",
          targetId: adminSession.id,
        },
      }),
    ).toBe(1);
  } finally {
    await database.$disconnect();
  }
});
