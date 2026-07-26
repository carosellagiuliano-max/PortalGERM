import { randomUUID } from "node:crypto";

import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  login,
  openActor,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";

test.describe.configure({ mode: "serial" });

test("[E2E-22] @journey privacy rights stay owner-only and fail closed while Phase-22 activation gates are disabled", async ({
  browser,
  page,
}) => {
  const database = phase17Database();
  try {
    const candidate = await createBrowserCandidate(database);
    const admin = await database.user.findUniqueOrThrow({
      where: { emailNormalized: DEMO_ACCOUNTS.admin },
      select: { id: true },
    });
    const approvalEmail = `phase22-approval-${randomUUID()}@example.test`;
    const approvalAdmin = await database.user.create({
      data: {
        email: approvalEmail,
        emailNormalized: approvalEmail,
        role: "ADMIN",
        name: "Phase 22 Approval Actor",
        status: "ACTIVE",
        dataProvenance: "TEST",
        emailVerifiedAt: new Date(),
        identityAssurance: "VERIFIED_EMAIL",
      },
    });

    await login(page, candidate.email, DEMO_PASSWORD);
    await page.goto("/candidate/privacy");
    await expect(
      page.getByRole("heading", {
        name: "Deine Daten, deine Entscheidungen",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Optionale Produktanalyse" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Noch nicht freigegeben" }),
    ).toHaveCount(2);
    await expect(
      page.getByRole("button", { name: "Noch nicht freigegeben" }).first(),
    ).toBeDisabled();

    await page.getByRole("button", { name: "Export-Fall erstellen" }).click();
    await expect(
      page.getByText("Deine Datenschutzanfrage wurde erfasst."),
    ).toBeVisible();
    const request = await database.privacyRequest.findFirstOrThrow({
      where: {
        requesterUserId: candidate.id,
        type: "EXPORT",
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    await page.goto(`/candidate/privacy/requests/${request.id}`);
    await expect(
      page.getByRole("heading", { name: request.id }),
    ).toBeVisible();
    await expect(page.getByText("EXPORT", { exact: true })).toBeVisible();
    await expect(page.getByText("PENDING", { exact: true })).toBeVisible();

    const foreign = await openActor(
      browser,
      DEMO_ACCOUNTS.candidate,
      DEMO_PASSWORD,
    );
    try {
      await foreign.page.goto(`/candidate/privacy/requests/${request.id}`);
      await expect(
        foreign.page.getByText(/nicht gefunden|404/iu).first(),
      ).toBeVisible();
    } finally {
      await foreign.close();
    }

    await database.privacyRequest.update({
      where: { id: request.id },
      data: {
        assignedAdminUserId: admin.id,
        assignmentReasonCode: "E2E_PHASE22",
        status: "IN_PROGRESS",
        verifiedAt: new Date(),
        processingStartedAt: new Date(),
        version: { increment: 1 },
      },
    });
    const adminActor = await openActor(
      browser,
      DEMO_ACCOUNTS.admin,
      DEMO_PASSWORD,
    );
    try {
      await adminActor.page.goto(`/admin/privacy-requests/${request.id}`);
      await expect(
        adminActor.page.getByRole("button", {
          name: "Verschlüsseltes Exportartefakt erstellen",
        }),
      ).toBeVisible();
      await adminActor.page
        .getByPlaceholder("UUID des unabhängigen Approval-Actors")
        .fill(approvalAdmin.id);
      await adminActor.page
        .getByPlaceholder("sandbox:approval:evidence-reference")
        .fill("sandbox:phase22-browser-approval-evidence");
      await adminActor.page
        .getByPlaceholder("sandbox:step-up:evidence-reference")
        .fill("sandbox:phase22-browser-step-up-evidence");
      await adminActor.page
        .getByRole("button", {
          name: "Verschlüsseltes Exportartefakt erstellen",
        })
        .click();
      await expect(
        adminActor.page.getByText(
          "Export V2 ist serverseitig gesperrt. Es wird kein Mock-Abschluss erzeugt.",
        ),
      ).toBeVisible();
    } finally {
      await adminActor.close();
    }
    expect(
      await database.privacyExecution.count({
        where: { privacyRequestId: request.id },
      }),
    ).toBe(0);
    expect(
      await database.privacyRequest.findUniqueOrThrow({
        where: { id: request.id },
        select: { status: true },
      }),
    ).toEqual({ status: "IN_PROGRESS" });
  } finally {
    await database.$disconnect();
  }
});

async function createBrowserCandidate(
  database: ReturnType<typeof phase17Database>,
) {
  const demo = await database.user.findUniqueOrThrow({
    where: { emailNormalized: DEMO_ACCOUNTS.candidate },
    select: {
      credential: {
        select: {
          passwordHash: true,
          algorithm: true,
          algorithmVersion: true,
          passwordChangedAt: true,
        },
      },
    },
  });
  if (demo.credential === null) {
    throw new Error("Candidate demo credentials are unavailable.");
  }
  const candidate = await database.user.findFirstOrThrow({
    where: {
      role: "CANDIDATE",
      status: "ACTIVE",
      emailNormalized: { endsWith: "@demo.swisstalenthub.invalid" },
      privacyRequests: { none: {} },
      candidateProfile: {
        is: { onboardingStatus: "COMPLETE" },
      },
    },
    orderBy: { emailNormalized: "asc" },
    select: { id: true, email: true },
  });
  await database.credential.upsert({
    where: { userId: candidate.id },
    update: { ...demo.credential, updatedAt: new Date() },
    create: {
      userId: candidate.id,
      ...demo.credential,
      updatedAt: new Date(),
    },
  });
  return candidate;
}
