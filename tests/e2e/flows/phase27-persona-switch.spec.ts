import {
  DEMO_PASSWORD,
  expect,
  login,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";
import {
  ensurePhase27DualPersonaBrowserFixture,
  PHASE27_DUAL_ACCOUNT,
} from "@/tests/e2e/fixtures/phase27-test";

test.describe.configure({ mode: "serial" });

let employerUserId = "";

test.beforeAll(async () => {
  const fixture = await ensurePhase27DualPersonaBrowserFixture();
  employerUserId = fixture.employerUserId;
});

test("[P27-AC-11] @journey switches Candidate↔Employer without tenant or admin capability union", async ({
  page,
}) => {
  const database = phase17Database();
  try {
    await login(page, PHASE27_DUAL_ACCOUNT, DEMO_PASSWORD);
    await expect(page).toHaveURL(/\/account\/portal(?:\?|$)/u);
    await expect(
      page.getByRole("heading", {
        name: "In welchem Arbeitsbereich möchtest du handeln?",
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Arbeitgeberportal", { exact: true }).first(),
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Zu Kandidatenportal wechseln" })
      .click();
    await expect(page).toHaveURL(/\/candidate\/dashboard(?:\?|$)/u);
    await expect(
      page.getByText("Kandidatenportal", { exact: true }).first(),
    ).toBeVisible();

    const forbiddenEmployer = await page.goto("/employer/dashboard");
    expect(forbiddenEmployer?.status()).toBe(403);
    await page.goto("/account/portal");
    await page
      .getByRole("button", { name: "Zu Arbeitgeberportal wechseln" })
      .click();
    await expect(page).toHaveURL(/\/employer\/dashboard(?:\?|$)/u);
    await expect(
      page.getByText("Arbeitgeberportal", { exact: true }).first(),
    ).toBeVisible();

    const [user, memberships, grants, switches] = await Promise.all([
      database.user.findUniqueOrThrow({
        where: { id: employerUserId },
        select: { role: true },
      }),
      database.companyMembership.count({
        where: { userId: employerUserId, status: "ACTIVE" },
      }),
      database.adminCapabilityGrant.count({
        where: { userId: employerUserId },
      }),
      database.auditLog.findMany({
        where: {
          actorUserId: employerUserId,
          action: "PERSONA_CONTEXT_SWITCHED",
        },
        orderBy: { createdAt: "desc" },
        take: 2,
      }),
    ]);
    expect(user.role).toBe("EMPLOYER");
    expect(memberships).toBeGreaterThanOrEqual(1);
    expect(grants).toBe(0);
    expect(
      switches.map(({ portalContext }) => portalContext).sort(),
    ).toEqual(["CANDIDATE", "EMPLOYER"]);
  } finally {
    await database.$disconnect();
  }
});
