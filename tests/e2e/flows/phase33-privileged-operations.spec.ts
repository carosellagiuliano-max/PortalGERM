import { randomUUID } from "node:crypto";

import {
  assertCriticalAccessibility,
  assertKeyboardFocusVisible,
  assertNoViewportClipping,
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  login,
  openActor,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";

const SECURITY_ADMIN_EMAIL =
  "security-admin@demo.swisstalenthub.test" as const;

test.describe.configure({ mode: "serial" });

test("[P33-AC-12][P33-AC-14] @journey support triage persists once while an unrelated privileged role receives no case or PII", async ({
  browser,
  page,
}) => {
  const database = phase17Database();
  let operator: Awaited<ReturnType<typeof openActor>> | undefined;
  let unrelatedAdmin: Awaited<ReturnType<typeof openActor>> | undefined;
  try {
    const subject = `Phase 33 Support ${randomUUID().slice(0, 8)}`;
    const description =
      "Synthetische Phase-33-Anfrage für die capability-gebundene Support-Triage.";
    await login(page, DEMO_ACCOUNTS.candidate, DEMO_PASSWORD);
    await page.goto("/support");
    await expect(
      page.getByRole("heading", { level: 1, name: "Meine Support-Anfragen" }),
    ).toBeVisible();
    const createForm = page.locator("form").filter({
      has: page.getByRole("button", { name: "Anfrage senden" }),
    });
    await createForm.getByLabel("Bereich").selectOption("APPLICATION");
    await createForm.getByLabel("Betreff").fill(subject);
    await createForm.getByLabel("Beschreibung").fill(description);
    await createForm
      .getByLabel("Bevorzugter Kontakt")
      .selectOption("EMAIL");
    await createForm.getByRole("button", { name: "Anfrage senden" }).click();
    await expect(
      page.getByText("Support-Anfrage wurde erfasst.", { exact: true }),
    ).toBeVisible();

    const requester = await database.user.findUniqueOrThrow({
      where: { emailNormalized: DEMO_ACCOUNTS.candidate },
      select: { id: true, email: true },
    });
    const supportCase = await database.supportCase.findFirstOrThrow({
      where: { requesterUserId: requester.id, subject },
      select: {
        id: true,
        status: true,
        priority: true,
        version: true,
        events: {
          select: { kind: true, actorUserId: true, reasonCode: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
      },
    });
    expect(supportCase).toMatchObject({
      status: "OPEN",
      priority: "NORMAL",
      version: 1,
      events: [
        {
          kind: "CREATED",
          actorUserId: requester.id,
          reasonCode: "REQUESTER_CREATED",
        },
      ],
    });

    unrelatedAdmin = await openActor(
      browser,
      SECURITY_ADMIN_EMAIL,
      DEMO_PASSWORD,
    );
    const beforeDeniedRead = await supportFingerprint(
      database,
      supportCase.id,
    );
    const denied = await unrelatedAdmin.context.request.get(
      `/admin/support/${supportCase.id}`,
      { failOnStatusCode: false, maxRedirects: 0 },
    );
    expect(denied.status()).toBe(404);
    const deniedBody = await denied.text();
    for (const protectedValue of [
      subject,
      description,
      requester.email,
    ]) {
      expect(deniedBody).not.toContain(protectedValue);
    }
    await expect(
      supportFingerprint(database, supportCase.id),
    ).resolves.toEqual(beforeDeniedRead);

    operator = await openActor(browser, DEMO_ACCOUNTS.admin);
    await operator.page.goto(`/admin/support/${supportCase.id}`);
    await expect(
      operator.page.getByRole("heading", { level: 1, name: subject }),
    ).toBeVisible();
    await operator.page.setViewportSize({ width: 320, height: 800 });
    const accessibility = await assertCriticalAccessibility(operator.page);
    expect(
      accessibility.serious,
      JSON.stringify(accessibility.seriousViolations),
    ).toBe(0);
    await assertNoViewportClipping(operator.page);
    await assertKeyboardFocusVisible(operator.page);

    const triageForm = operator.page.locator("form").filter({
      has: operator.page.getByRole("button", { name: "Triage speichern" }),
    });
    await triageForm.locator('select[name="priority"]').selectOption("HIGH");
    await triageForm.getByRole("button", { name: "Triage speichern" }).click();
    await expect(
      operator.page.getByRole("status").filter({
        hasText:
          "Dieser Fall ist triagiert; Priorität und Verlauf wurden sicher gespeichert.",
      }),
    ).toBeVisible();

    const operatorUser = await database.user.findUniqueOrThrow({
      where: { emailNormalized: DEMO_ACCOUNTS.admin },
      select: { id: true },
    });
    const [persisted, notificationCount, auditCount] = await Promise.all([
      database.supportCase.findUniqueOrThrow({
        where: { id: supportCase.id },
        select: {
          status: true,
          priority: true,
          version: true,
          events: {
            where: { kind: "TRIAGED" },
            select: { actorUserId: true, reasonCode: true },
          },
        },
      }),
      database.notification.count({
        where: {
          recipientUserId: requester.id,
          kind: "SUPPORT_CASE_CHANGED",
          payload: { path: ["caseId"], equals: supportCase.id },
        },
      }),
      database.auditLog.count({
        where: {
          actorUserId: operatorUser.id,
          action: "SUPPORT_CASE_TRIAGED",
          capability: "ADMIN_SUPPORT_MANAGE",
          targetId: supportCase.id,
          result: "SUCCEEDED",
        },
      }),
    ]);
    expect(persisted).toEqual({
      status: "TRIAGED",
      priority: "HIGH",
      version: 2,
      events: [
        {
          actorUserId: operatorUser.id,
          reasonCode: "INITIAL_TRIAGE",
        },
      ],
    });
    expect(notificationCount).toBe(1);
    expect(auditCount).toBe(1);

    await page.goto(`/support/${supportCase.id}`);
    await expect(
      page.locator("header").getByText("TRIAGED", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: subject })).toBeVisible();
  } finally {
    await unrelatedAdmin?.close();
    await operator?.close();
    await database.$disconnect();
  }
});

type Database = ReturnType<typeof phase17Database>;

async function supportFingerprint(database: Database, caseId: string) {
  const [supportCase, eventCount, notificationCount, auditCount] =
    await Promise.all([
      database.supportCase.findUniqueOrThrow({ where: { id: caseId } }),
      database.supportCaseEvent.count({ where: { supportCaseId: caseId } }),
      database.notification.count({
        where: { payload: { path: ["caseId"], equals: caseId } },
      }),
      database.auditLog.count({ where: { targetId: caseId } }),
    ]);
  return Object.freeze({
    supportCase,
    eventCount,
    notificationCount,
    auditCount,
  });
}
