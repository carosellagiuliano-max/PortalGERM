import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  login,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";

test.describe.configure({ mode: "serial" });

test("[P26-AC-06][P26-AC-11] @journey completes sandbox register/domain review and publishes only the safe strong badge", async ({
  browser,
  page,
}) => {
  const database = phase17Database();
  try {
    await login(page, DEMO_ACCOUNTS.employer, DEMO_PASSWORD);
    await page.goto("/employer/verification");
    await expect(
      page.getByRole("heading", { name: "Firmenidentität prüfen" }),
    ).toBeVisible();
    await expect(
      page.getByText("Firmenidentität geprüft", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Aktuelle Prüfung erneuern" }),
    ).toBeVisible();

    await page
      .getByRole("button", {
        name: "Register prüfen und Challenge starten",
      })
      .click();
    await expect(
      page.getByRole("heading", { name: "Domainkontrolle bestätigen" }),
    ).toBeVisible();
    const challengeToken = await page
      .getByLabel("Challenge-Geheimnis")
      .inputValue();
    expect(challengeToken).toMatch(/^[A-Za-z0-9_-]{32,128}$/u);
    await expect(page.getByLabel("Gefundener Nachweis")).toHaveValue(
      `sth-domain-verification=${challengeToken}`,
    );

    await page
      .getByRole("button", { name: "Domainnachweis prüfen" })
      .click();
    await expect(
      page.getByText(
        "Domainkontrolle bestätigt. Der Antrag ist bereit für die unabhängige Prüfung.",
      ),
    ).toBeVisible();

    const request =
      await database.companyVerificationRequest.findFirstOrThrow({
        where: {
          company: { slug: "novarigi-digital" },
          status: "PENDING",
          policyVersion: "COMPANY_TRUST_POLICY_V2",
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          companyId: true,
          evidence: {
            select: { type: true, status: true },
            orderBy: { type: "asc" },
          },
        },
      });
    expect(request.evidence).toEqual([
      { type: "UID_REGISTER", status: "VALID" },
      { type: "DOMAIN_CHALLENGE", status: "VALID" },
    ]);

    await page.context().clearCookies();
    await login(page, DEMO_ACCOUNTS.admin, DEMO_PASSWORD);
    await page.goto(`/admin/company-verification/${request.id}`);
    await expect(
      page.getByRole("heading", { name: "NovaRigi Digital AG" }),
    ).toBeVisible();
    await expect(page.getByText("UID_REGISTER", { exact: true })).toBeVisible();
    await expect(
      page.getByText("DOMAIN_CHALLENGE", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Mir zur Prüfung zuweisen" })
      .click();
    await expect
      .poll(
        async () =>
          database.companyVerificationRequest.findUnique({
            where: { id: request.id },
            select: { assignedReviewerUserId: true },
          }),
        { timeout: 30_000 },
      )
      .toMatchObject({ assignedReviewerUserId: expect.any(String) });
    await page.reload();
    await page.getByRole("button", { name: "Identität freigeben" }).click();
    await expect
      .poll(
        async () =>
          database.companyVerificationRequest.findUnique({
            where: { id: request.id },
            select: { status: true },
          }),
        { timeout: 30_000 },
      )
      .toEqual({ status: "VERIFIED" });

    const [persisted, projection, auditCount] = await Promise.all([
      database.companyVerificationRequest.findUniqueOrThrow({
        where: { id: request.id },
        select: { status: true, decidedAt: true },
      }),
      database.companyTrustProjection.findUniqueOrThrow({
        where: {
          companyId_scope: {
            companyId: request.companyId,
            scope: "COMPANY_IDENTITY",
          },
        },
        select: {
          verificationRequestId: true,
          level: true,
          status: true,
          policyVersion: true,
        },
      }),
      database.auditLog.count({
        where: {
          companyId: request.companyId,
          action: {
            in: [
              "COMPANY_VERIFICATION_SUBMITTED_V2",
              "COMPANY_VERIFICATION_DECIDED_V2",
            ],
          },
        },
      }),
    ]);
    expect(persisted).toMatchObject({ status: "VERIFIED" });
    expect(persisted.decidedAt).not.toBeNull();
    expect(projection).toEqual({
      verificationRequestId: request.id,
      level: "STRONG",
      status: "ACTIVE",
      policyVersion: "COMPANY_TRUST_POLICY_V2",
    });
    expect(auditCount).toBeGreaterThanOrEqual(2);

    const publicContext = await browser.newContext({
      baseURL: process.env.PHASE17_BASE_URL,
      locale: "de-CH",
      timezoneId: "Europe/Zurich",
    });
    try {
      const publicPage = await publicContext.newPage();
      await publicPage.goto("/companies/novarigi-digital");
      await expect(
        publicPage
          .getByText("Firmenidentität geprüft", { exact: true })
          .first(),
      ).toBeVisible();
      await expect(
        publicPage.getByText(/UID-Register und Domainkontrolle/u).first(),
      ).toBeVisible();
      const publicBody = await publicPage.locator("body").innerText();
      expect(publicBody).not.toMatch(
        /challengeToken|tokenHash|proofDigest|responseDigest|evidenceDigest|providerReference|sth-domain-verification=/u,
      );
    } finally {
      await publicContext.close();
    }
  } finally {
    await database.$disconnect();
  }
});
