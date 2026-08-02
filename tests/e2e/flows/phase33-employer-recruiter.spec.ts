import { randomUUID } from "node:crypto";

import { buildNotificationStorageDedupeKey } from "@/lib/notifications/writer";
import {
  assertCriticalAccessibility,
  assertKeyboardFocusVisible,
  assertNoViewportClipping,
  DEMO_ACCOUNTS,
  expect,
  openActor,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";

test.describe.configure({ mode: "serial" });

test("[P33-AC-11][P33-AC-14] @journey an assigned recruiter messages once while same-tenant and cross-tenant applications remain opaque", async ({
  browser,
}) => {
  const database = phase17Database();
  let recruiter: Awaited<ReturnType<typeof openActor>> | undefined;
  try {
    const recruiterUser = await database.user.findUniqueOrThrow({
      where: { emailNormalized: DEMO_ACCOUNTS.recruiter },
      select: { id: true },
    });
    const now = new Date();
    const allowedAssignment = await database.jobAssignment.findFirstOrThrow({
      where: {
        userId: recruiterUser.id,
        role: { in: ["PIPELINE", "EDITOR"] },
        status: "ACTIVE",
        revokedAt: null,
        validFrom: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        job: { applications: { some: {} } },
      },
      orderBy: [{ validFrom: "asc" }, { id: "asc" }],
      select: {
        companyId: true,
        membershipId: true,
        jobId: true,
        company: { select: { name: true } },
      },
    });
    const application = await database.application.findFirstOrThrow({
      where: { jobId: allowedAssignment.jobId },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        candidateProfile: { select: { userId: true } },
        submissionSnapshot: {
          select: {
            candidateFirstName: true,
            candidateLastName: true,
          },
        },
      },
    });
    expect(application.submissionSnapshot).not.toBeNull();

    const sameTenantDenied = await database.application.findFirstOrThrow({
      where: {
        job: {
          companyId: allowedAssignment.companyId,
          id: { not: allowedAssignment.jobId },
          assignments: {
            none: {
              membershipId: allowedAssignment.membershipId,
              userId: recruiterUser.id,
              role: { in: ["PIPELINE", "EDITOR"] },
              status: "ACTIVE",
              revokedAt: null,
              validFrom: { lte: now },
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            },
          },
        },
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        submissionSnapshot: {
          select: {
            candidateFirstName: true,
            candidateLastName: true,
            candidateEmail: true,
          },
        },
      },
    });
    const crossTenantDenied = await database.application.findFirstOrThrow({
      where: { job: { companyId: { not: allowedAssignment.companyId } } },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        submissionSnapshot: {
          select: {
            candidateFirstName: true,
            candidateLastName: true,
            candidateEmail: true,
          },
        },
      },
    });

    recruiter = await openActor(browser, DEMO_ACCOUNTS.recruiter);
    await recruiter.page.goto("/employer/dashboard");
    const companyContext = recruiter.page.getByLabel("Aktives Unternehmen");
    if (
      (await companyContext.count()) > 0 &&
      (await companyContext.inputValue()) !== allowedAssignment.companyId
    ) {
      await companyContext.selectOption(allowedAssignment.companyId);
      await recruiter.page
        .getByRole("button", { name: "Firmenkontext wechseln" })
        .click();
      await expect(
        recruiter.page.getByRole("heading", {
          level: 1,
          name: `Guten Tag bei ${allowedAssignment.company.name}`,
        }),
      ).toBeVisible();
    }

    await recruiter.page.goto(`/employer/applicants/${application.id}`);
    await expect(
      recruiter.page.getByRole("heading", {
        level: 1,
        name: `${application.submissionSnapshot!.candidateFirstName} ${application.submissionSnapshot!.candidateLastName}`,
      }),
    ).toBeVisible();
    await recruiter.page.setViewportSize({ width: 360, height: 800 });
    await assertAccessibleAndOperable(recruiter.page);

    const body = `Phase 33 Recruiter-Nachricht ${randomUUID()}`;
    await recruiter.page
      .getByPlaceholder("Nachricht an Kandidat:in")
      .fill(body);
    await recruiter.page
      .getByRole("button", { name: "Nachricht senden" })
      .click();
    await expect(
      recruiter.page.getByText("Nachricht gesendet.", { exact: true }),
    ).toBeVisible();

    const message = await database.message.findFirstOrThrow({
      where: {
        senderUserId: recruiterUser.id,
        body,
        conversation: { applicationId: application.id },
      },
      select: { id: true, conversationId: true, createdAt: true },
    });
    const [eventCount, notificationCount, outboxCount, auditCount] =
      await Promise.all([
        database.applicationEvent.count({
          where: {
            applicationId: application.id,
            actorUserId: recruiterUser.id,
            kind: "MESSAGE_SENT",
            createdAt: message.createdAt,
          },
        }),
        database.notification.count({
          where: {
            recipientUserId: application.candidateProfile.userId,
            kind: "MESSAGE_RECEIVED",
            dedupeKey: buildNotificationStorageDedupeKey({
              recipientUserId: application.candidateProfile.userId,
              kind: "MESSAGE_RECEIVED",
              dedupeKey: `message:${message.id}`,
            }),
          },
        }),
        database.notificationOutbox.count({
          where: {
            recipientUserId: application.candidateProfile.userId,
            templateKey: "employer_message_received",
            payload: { path: ["messageId"], equals: message.id },
          },
        }),
        database.auditLog.count({
          where: {
            actorUserId: recruiterUser.id,
            action: "MESSAGE_SENT",
            capability: "COMPANY_APPLICATION_MESSAGE",
            targetId: message.id,
            result: "SUCCEEDED",
          },
        }),
      ]);
    expect({ eventCount, notificationCount, outboxCount, auditCount }).toEqual({
      eventCount: 1,
      notificationCount: 1,
      outboxCount: 1,
      auditCount: 1,
    });

    for (const deniedTarget of [sameTenantDenied, crossTenantDenied]) {
      const before = await applicationEffectFingerprint(
        database,
        deniedTarget.id,
      );
      const response = await recruiter.context.request.get(
        `/employer/applicants/${deniedTarget.id}`,
        { failOnStatusCode: false, maxRedirects: 0 },
      );
      expect(response.status()).toBe(404);
      const responseBody = await response.text();
      for (const protectedValue of Object.values(
        deniedTarget.submissionSnapshot ?? {},
      )) {
        expect(responseBody).not.toContain(protectedValue);
      }
      await expect(
        applicationEffectFingerprint(database, deniedTarget.id),
      ).resolves.toEqual(before);
    }
  } finally {
    await recruiter?.close();
    await database.$disconnect();
  }
});

type Database = ReturnType<typeof phase17Database>;

async function applicationEffectFingerprint(
  database: Database,
  applicationId: string,
) {
  const [application, eventCount, messageCount, notificationCount, outboxCount, auditCount] =
    await Promise.all([
      database.application.findUniqueOrThrow({ where: { id: applicationId } }),
      database.applicationEvent.count({ where: { applicationId } }),
      database.message.count({
        where: { conversation: { applicationId } },
      }),
      database.notification.count({
        where: { payload: { path: ["applicationId"], equals: applicationId } },
      }),
      database.notificationOutbox.count({
        where: { payload: { path: ["applicationId"], equals: applicationId } },
      }),
      database.auditLog.count({
        where: { targetId: applicationId },
      }),
    ]);
  return Object.freeze({
    application,
    eventCount,
    messageCount,
    notificationCount,
    outboxCount,
    auditCount,
  });
}

async function assertAccessibleAndOperable(
  page: import("@playwright/test").Page,
) {
  const accessibility = await assertCriticalAccessibility(page);
  expect(
    accessibility.serious,
    JSON.stringify(accessibility.seriousViolations),
  ).toBe(0);
  await assertNoViewportClipping(page);
  await assertKeyboardFocusVisible(page);
}
