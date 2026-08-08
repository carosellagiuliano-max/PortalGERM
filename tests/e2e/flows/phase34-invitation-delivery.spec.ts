import { createHmac, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { Browser, BrowserContext, Page } from "@playwright/test";

import { SESSION_POLICY_V1 } from "@/lib/auth/session";

import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  login,
  observePage,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";

const INVITATION_TOKEN_DOMAIN = "swisstalenthub.company-invitation-token.v2";
const LOCAL_INVITATION_FEEDBACK =
  "Einladung gespeichert. In dieser Umgebung ist kein erreichbarer E-Mail-Versand aktiv. Nutze „Neu senden“, sobald der Versand eingerichtet ist.";
const PREVIEW_INVITATION_FEEDBACK =
  "Einladung gespeichert. Die E-Mail liegt in der Versandwarteschlange, der Versand ist in dieser Umgebung aber derzeit pausiert.";
const PREVIEW_RESEND_FEEDBACK =
  "Ein neuer Link wurde gespeichert; der alte Link ist ungültig. Die E-Mail liegt in der Versandwarteschlange, der Versand ist in dieser Umgebung aber derzeit pausiert.";
const MAXIMUM_WORKER_OUTPUT_CHARACTERS = 16_000;
const WORKER_TIMEOUT_MILLISECONDS = 60_000;

type Database = ReturnType<typeof phase17Database>;

type CompanyActorFixture = Readonly<{
  companyId: string;
  companyName: string;
  ownerEmail: string;
  ownerUserId: string;
}>;

type InvitationDeliveryFixture = Readonly<{
  local: CompanyActorFixture;
  preview: CompanyActorFixture;
}>;

type InvitationEvidence = Awaited<
  ReturnType<typeof loadInvitationEvidence>
>;

test.describe.configure({ mode: "serial" });

test("[E2E-34-16][F34-NOT-005] @phase34 invitation delivery distinguishes the durable local worker sink from the paused preview fallback", async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const database = phase17Database();
  const suffix = `${testInfo.project.name.replaceAll(/[^a-z0-9]+/giu, "-")}-${randomUUID().slice(0, 8)}`.toLowerCase();
  let fixture: InvitationDeliveryFixture | undefined;
  let previewActor: Awaited<ReturnType<typeof openObservedActor>> | undefined;

  try {
    fixture = await createInvitationDeliveryFixture(database, suffix);

    await login(page, fixture.local.ownerEmail, DEMO_PASSWORD);
    await openTeamPage(page);
    const localInvitee = `phase34-local-invite-${suffix}@example.test`;
    const localFeedback = await submitInvitation(page, localInvitee);
    await expect(localFeedback).toHaveText(LOCAL_INVITATION_FEEDBACK);
    await assertNoDeliveryOverclaim(localFeedback);

    const localBeforeWorker = await loadInvitationEvidence(database, {
      companyId: fixture.local.companyId,
      email: localInvitee,
    });
    await assertInitialInvitationEvidence(database, {
      evidence: localBeforeWorker,
      companyId: fixture.local.companyId,
      email: localInvitee,
      ownerUserId: fixture.local.ownerUserId,
    });
    expect(await page.locator("body").innerText()).not.toContain(
      deriveInvitationToken(
        localBeforeWorker.invitation.id,
        localBeforeWorker.invitation.tokenVersion,
      ),
    );

    await waitForUnusedDispatchScheduleBucket(database);
    const workerId = `phase34-invite-${suffix}`.slice(0, 90);
    const worker = await runWorkerOnce(workerId);
    expect(worker.output).toContain(`"workerId":"${workerId}"`);

    const localAfterWorker = await loadInvitationEvidence(database, {
      companyId: fixture.local.companyId,
      email: localInvitee,
    });
    expect(localAfterWorker.invitation).toEqual(
      localBeforeWorker.invitation,
    );
    expect(localAfterWorker.audits).toEqual(localBeforeWorker.audits);
    expect(localAfterWorker.outboxes).toHaveLength(1);
    const deliveredOutbox = localAfterWorker.outboxes[0]!;
    expect(deliveredOutbox).toMatchObject({
      id: localBeforeWorker.outboxes[0]!.id,
      status: "DELIVERED",
      attemptCount: 1,
      deliveredAt: expect.any(Date),
      suppressedAt: null,
      deadLetteredAt: null,
      lastErrorCode: null,
      providerRequestActivationId: requiredEnvironment(
        "PHASE34_EMAIL_TRANSACTIONAL_PROVIDER_ACTIVATION_ID",
      ),
      attempts: [
        {
          attemptNumber: 1,
          outcome: "ACCEPTED",
          providerClass: "local-mock-v1",
          providerActivationId: requiredEnvironment(
            "PHASE34_EMAIL_TRANSACTIONAL_PROVIDER_ACTIVATION_ID",
          ),
          errorCode: null,
        },
      ],
    });
    const localEmailLogs = await database.emailLog.findMany({
      where: {
        recipient: localInvitee,
        templateKey: "company_invitation",
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(localEmailLogs).toHaveLength(1);
    const localEmailLog = localEmailLogs[0]!;
    expect(localEmailLog).toMatchObject({
      purpose: "company_invitation",
      status: "MOCK_RECORDED",
      errorCode: null,
      payload: {
        schemaVersion: "1",
        deliveryStatus: "mock_recorded",
        externalDeliveryClaimed: false,
      },
    });
    expect(deliveredOutbox.attempts[0]?.providerReceipt).toBe(
      localEmailLog.id,
    );
    const localRawToken = deriveInvitationToken(
      localAfterWorker.invitation.id,
      localAfterWorker.invitation.tokenVersion,
    );
    expect(JSON.stringify(localEmailLog.payload)).not.toContain(localRawToken);
    expect(JSON.stringify(deliveredOutbox.payload)).not.toContain(
      localRawToken,
    );

    previewActor = await openObservedActor(
      browser,
      requiredEnvironment("PHASE34_PREVIEW_BASE_URL"),
      fixture.preview.ownerEmail,
    );
    await openTeamPage(previewActor.page);
    const previewInvitee = `phase34-preview-invite-${suffix}@example.test`;
    const previewFeedback = await submitInvitation(
      previewActor.page,
      previewInvitee,
    );
    await expect(previewFeedback).toHaveText(PREVIEW_INVITATION_FEEDBACK);
    await assertNoDeliveryOverclaim(previewFeedback);

    const previewInitial = await loadInvitationEvidence(database, {
      companyId: fixture.preview.companyId,
      email: previewInvitee,
    });
    await assertInitialInvitationEvidence(database, {
      evidence: previewInitial,
      companyId: fixture.preview.companyId,
      email: previewInvitee,
      ownerUserId: fixture.preview.ownerUserId,
    });
    await assertPreviewHasNoDeliveryAuthority(database, previewInitial);

    const firstPreviewTokenHash = previewInitial.invitation.tokenHash;
    const invitationRow = previewActor.page.locator("div.rounded-lg.border").filter({
      has: previewActor.page.getByText(previewInvitee, { exact: true }),
    });
    await expect(invitationRow).toHaveCount(1);
    await invitationRow
      .getByRole("button", { name: "Neu senden" })
      .click();
    await expect(invitationRow.getByRole("status")).toHaveText(
      PREVIEW_RESEND_FEEDBACK,
    );
    await assertNoDeliveryOverclaim(invitationRow.getByRole("status"));

    const previewResent = await loadInvitationEvidence(database, {
      companyId: fixture.preview.companyId,
      email: previewInvitee,
    });
    expect(previewResent.invitation).toMatchObject({
      id: previewInitial.invitation.id,
      status: "PENDING",
      tokenVersion: 2,
      events: [
        {
          kind: "CREATED",
          actorUserId: fixture.preview.ownerUserId,
        },
        {
          kind: "RESENT",
          actorUserId: fixture.preview.ownerUserId,
        },
      ],
    });
    expect(previewResent.invitation.tokenHash).not.toBe(firstPreviewTokenHash);
    expect(previewResent.outboxes).toHaveLength(2);
    expect(
      previewResent.outboxes.map((outbox) => ({
        attemptCount: outbox.attemptCount,
        status: outbox.status,
        version: readInvitationVersion(outbox.payload),
      })),
    ).toEqual([
      { attemptCount: 0, status: "PENDING", version: 1 },
      { attemptCount: 0, status: "PENDING", version: 2 },
    ]);
    expect(previewResent.audits).toEqual([
      {
        action: "INVITATION_SENT",
        capability: "COMPANY_TEAM_INVITE",
        result: "SUCCEEDED",
      },
      {
        action: "INVITATION_SENT",
        capability: "COMPANY_TEAM_INVITE_RESEND",
        result: "SUCCEEDED",
      },
    ]);
    await assertPreviewHasNoDeliveryAuthority(database, previewResent);
    const previewRawToken = deriveInvitationToken(
      previewResent.invitation.id,
      previewResent.invitation.tokenVersion,
    );
    expect(await previewActor.page.locator("body").innerText()).not.toContain(
      previewRawToken,
    );
    expect(JSON.stringify(previewResent.outboxes)).not.toContain(
      previewRawToken,
    );
  } finally {
    try {
      await containFixture(database, suffix, fixture);
    } finally {
      const closeResult = await Promise.allSettled([previewActor?.close()]);
      await database.$disconnect();
      const closeFailure = closeResult.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (closeFailure !== undefined) throw closeFailure.reason;
    }
  }
});

async function openTeamPage(page: Page) {
  const response = await page.goto("/employer/team");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Team und Job-Zuweisungen",
    }),
  ).toBeVisible();
}

async function submitInvitation(page: Page, email: string) {
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Einladen" }),
  });
  await expect(form).toHaveCount(1);
  await form.getByLabel("E-Mail", { exact: true }).fill(email);
  await form.getByLabel("Rolle", { exact: true }).selectOption("RECRUITER");
  await form.getByRole("button", { name: "Einladen" }).click();
  return form.getByRole("status");
}

async function assertNoDeliveryOverclaim(feedback: import("@playwright/test").Locator) {
  const text = (await feedback.innerText()).toLocaleLowerCase("de-CH");
  expect(text).not.toMatch(/(?:gesendet|zugestellt|erfolgreich versendet)/u);
}

async function loadInvitationEvidence(
  database: Database,
  input: Readonly<{ companyId: string; email: string }>,
) {
  const invitation = await database.companyInvitation.findFirstOrThrow({
    where: {
      companyId: input.companyId,
      inviteeEmailNormalized: input.email,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      companyId: true,
      inviterUserId: true,
      inviteeEmailNormalized: true,
      intendedRole: true,
      tokenHash: true,
      tokenVersion: true,
      status: true,
      expiresAt: true,
      acceptedAt: true,
      acceptedByUserId: true,
      revokedAt: true,
      events: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { actorUserId: true, kind: true },
      },
    },
  });
  const [outboxes, audits] = await Promise.all([
    database.notificationOutbox.findMany({
      where: {
        dedupeKey: { startsWith: `company-invitation:${invitation.id}:` },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        recipientUserId: true,
        recipientAddressCiphertext: true,
        recipientAddressNonce: true,
        recipientAddressTag: true,
        recipientAddressKeyVersion: true,
        recipientAddressBindingVersion: true,
        recipientAddressDigest: true,
        recipientAddressDigestKeyVersion: true,
        recipientAddressExpiresAt: true,
        recipientAddressDestroyedAt: true,
        purpose: true,
        purposeClass: true,
        channel: true,
        templateKey: true,
        payloadSchemaVersion: true,
        payload: true,
        dedupeKey: true,
        providerDedupeKey: true,
        providerRequestActivationId: true,
        providerRequestDigest: true,
        providerRequestDestroyedAt: true,
        status: true,
        availableAt: true,
        attemptCount: true,
        maxAttempts: true,
        lastErrorCode: true,
        deliveredAt: true,
        suppressedAt: true,
        deadLetteredAt: true,
        attempts: {
          orderBy: [{ attemptNumber: "asc" }, { id: "asc" }],
          select: {
            attemptNumber: true,
            outcome: true,
            providerClass: true,
            providerReceipt: true,
            providerActivationId: true,
            errorCode: true,
          },
        },
      },
    }),
    database.auditLog.findMany({
      where: {
        action: "INVITATION_SENT",
        actorUserId: invitation.inviterUserId,
        companyId: input.companyId,
        targetId: invitation.id,
        targetType: "INVITATION",
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { action: true, capability: true, result: true },
    }),
  ]);
  return Object.freeze({ invitation, outboxes, audits });
}

async function assertInitialInvitationEvidence(
  database: Database,
  input: Readonly<{
    evidence: InvitationEvidence;
    companyId: string;
    email: string;
    ownerUserId: string;
  }>,
) {
  expect(input.evidence.invitation).toMatchObject({
    companyId: input.companyId,
    inviterUserId: input.ownerUserId,
    inviteeEmailNormalized: input.email,
    intendedRole: "RECRUITER",
    tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
    tokenVersion: 1,
    status: "PENDING",
    acceptedAt: null,
    acceptedByUserId: null,
    revokedAt: null,
    events: [{ kind: "CREATED", actorUserId: input.ownerUserId }],
  });
  expect(input.evidence.invitation.expiresAt.getTime()).toBeGreaterThan(
    Date.now(),
  );
  expect(input.evidence.outboxes).toHaveLength(1);
  const outbox = input.evidence.outboxes[0]!;
  expect(outbox).toMatchObject({
    recipientUserId: null,
    recipientAddressBindingVersion: "v2",
    recipientAddressKeyVersion: expect.any(String),
    recipientAddressDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
    recipientAddressDigestKeyVersion: expect.any(String),
    recipientAddressExpiresAt: input.evidence.invitation.expiresAt,
    recipientAddressDestroyedAt: null,
    purpose: "COMPANY_INVITATION",
    purposeClass: "MANDATORY",
    channel: "EMAIL",
    templateKey: "company_invitation",
    payloadSchemaVersion: "company-invitation-v2",
    payload: {
      invitationId: input.evidence.invitation.id,
      invitationVersion: 1,
    },
    dedupeKey: `company-invitation:${input.evidence.invitation.id}:1`,
    providerDedupeKey: expect.stringMatching(/^sth-[0-9a-f]{64}$/u),
    providerRequestActivationId: null,
    providerRequestDigest: null,
    providerRequestDestroyedAt: null,
    status: "PENDING",
    attemptCount: 0,
    maxAttempts: 5,
    lastErrorCode: null,
    deliveredAt: null,
    suppressedAt: null,
    deadLetteredAt: null,
    attempts: [],
  });
  expect(outbox.recipientAddressCiphertext?.byteLength).toBeGreaterThan(0);
  expect(outbox.recipientAddressNonce?.byteLength).toBeGreaterThan(0);
  expect(outbox.recipientAddressTag?.byteLength).toBeGreaterThan(0);
  expect(outbox.availableAt.getTime()).toBeLessThanOrEqual(Date.now());
  expect(input.evidence.audits).toEqual([
    {
      action: "INVITATION_SENT",
      capability: "COMPANY_TEAM_INVITE",
      result: "SUCCEEDED",
    },
  ]);
  await expect(
    database.notificationDeliveryAttempt.count({
      where: { outboxId: outbox.id },
    }),
  ).resolves.toBe(0);
  await expect(
    database.emailLog.count({
      where: { recipient: input.email, templateKey: "company_invitation" },
    }),
  ).resolves.toBe(0);
}

async function assertPreviewHasNoDeliveryAuthority(
  database: Database,
  evidence: InvitationEvidence,
) {
  const outboxIds = evidence.outboxes.map(({ id }) => id);
  const [previewProviders, previewHandlers, attempts, emailLogs] =
    await Promise.all([
      database.providerActivation.count({
        where: {
          environment: "preview",
          useCase: "email.transactional",
          revokedAt: null,
        },
      }),
      database.workerHandlerActivation.count({
        where: {
          environment: "preview",
          handlerKey: "notifications.dispatch",
          handlerVersion: "v1",
          revokedAt: null,
        },
      }),
      database.notificationDeliveryAttempt.count({
        where: { outboxId: { in: outboxIds } },
      }),
      database.emailLog.count({
        where: {
          recipient: evidence.invitation.inviteeEmailNormalized,
          templateKey: "company_invitation",
        },
      }),
    ]);
  expect({ previewProviders, previewHandlers, attempts, emailLogs }).toEqual({
    previewProviders: 0,
    previewHandlers: 0,
    attempts: 0,
    emailLogs: 0,
  });
  for (const outbox of evidence.outboxes) {
    expect(outbox).toMatchObject({
      status: "PENDING",
      attemptCount: 0,
      providerRequestActivationId: null,
      providerRequestDigest: null,
      deliveredAt: null,
      suppressedAt: null,
      deadLetteredAt: null,
      attempts: [],
    });
  }
}

function readInvitationVersion(payload: unknown) {
  if (
    payload === null ||
    typeof payload !== "object" ||
    !("invitationVersion" in payload) ||
    typeof payload.invitationVersion !== "number"
  ) {
    throw new Error("The invitation outbox payload version is missing.");
  }
  return payload.invitationVersion;
}

async function createInvitationDeliveryFixture(
  database: Database,
  suffix: string,
): Promise<InvitationDeliveryFixture> {
  const [credential, paidPlanVersion] = await Promise.all([
    database.credential.findFirstOrThrow({
      where: { user: { emailNormalized: DEMO_ACCOUNTS.employer } },
      select: {
        algorithm: true,
        algorithmVersion: true,
        passwordChangedAt: true,
        passwordHash: true,
      },
    }),
    loadPaidPlanVersion(database),
  ]);
  const now = new Date();
  const [localOwner, previewOwner] = await Promise.all([
    createOwner(database, {
      credential,
      email: `phase34-invite-local-owner-${suffix}@example.test`,
      name: `Phase 34 Local Invite Owner ${suffix}`,
      now,
    }),
    createOwner(database, {
      credential,
      email: `phase34-invite-preview-owner-${suffix}@example.test`,
      name: `Phase 34 Preview Invite Owner ${suffix}`,
      now,
    }),
  ]);
  const [localCompany, previewCompany] = await Promise.all([
    createCompany(database, {
      label: "Local",
      owner: localOwner,
      paidPlanVersion,
      suffix,
      now,
    }),
    createCompany(database, {
      label: "Preview",
      owner: previewOwner,
      paidPlanVersion,
      suffix,
      now,
    }),
  ]);
  return Object.freeze({ local: localCompany, preview: previewCompany });
}

async function loadPaidPlanVersion(database: Database) {
  return database.planVersion.findFirstOrThrow({
    where: {
      plan: { isDefaultFree: false },
      status: "ACTIVE",
      entitlements: {
        some: {
          key: "SEAT_LIMIT",
          integerValue: { gte: 2 },
        },
      },
    },
    orderBy: [{ validFrom: "asc" }, { id: "asc" }],
    select: {
      id: true,
      billingInterval: true,
      termMonths: true,
      netPriceRappen: true,
      monthlyEquivalentRappen: true,
      currency: true,
    },
  });
}

async function createOwner(
  database: Database,
  input: Readonly<{
    credential: Readonly<{
      algorithm: string;
      algorithmVersion: number;
      passwordChangedAt: Date;
      passwordHash: string;
    }>;
    email: string;
    name: string;
    now: Date;
  }>,
) {
  return database.user.create({
    data: {
      email: input.email,
      emailNormalized: input.email,
      role: "EMPLOYER",
      name: input.name,
      status: "ACTIVE",
      dataProvenance: "TEST",
      emailVerifiedAt: input.now,
      identityAssurance: "VERIFIED_EMAIL",
      credential: { create: input.credential },
      personaAssignments: {
        create: {
          kind: "EMPLOYER",
          status: "ACTIVE",
          source: "SUPPORT_LINK",
          version: 1,
          activatedAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
          events: {
            create: {
              kind: "CREATED",
              toStatus: "ACTIVE",
              source: "SUPPORT_LINK",
              reasonCode: "PHASE34_INVITATION_DELIVERY_E2E",
              correlationId: `phase34-invite-owner-${randomUUID()}`,
              createdAt: input.now,
            },
          },
        },
      },
    },
    select: { email: true, id: true },
  });
}

async function createCompany(
  database: Database,
  input: Readonly<{
    label: "Local" | "Preview";
    owner: Readonly<{ email: string; id: string }>;
    paidPlanVersion: Awaited<ReturnType<typeof loadPaidPlanVersion>>;
    suffix: string;
    now: Date;
  }>,
): Promise<CompanyActorFixture> {
  const periodEnd = new Date(input.now.getTime() + 30 * 24 * 60 * 60 * 1_000);
  const location = await loadCompanyLocationTemplate(database);
  const company = await database.company.create({
    data: {
      name: `Phase 34 ${input.label} Invitation ${input.suffix} AG`,
      slug: `phase34-${input.label.toLowerCase()}-invite-${input.suffix}`.slice(
        0,
        190,
      ),
      status: "DRAFT",
      dataProvenance: "TEST",
      industry: "Technology",
      size: "11-50",
      website:
        `https://phase34-${input.label.toLowerCase()}-invite-${input.suffix}.example.test`,
      about: "Isolierte Firmenfixture für ehrliche Einladungszustellung.",
      locations: {
        create: {
          address: `${input.label}-Strasse 34`,
          cantonId: location.cantonId,
          cityId: location.id,
          isPrimary: true,
          postalCode: "8000",
        },
      },
      memberships: {
        create: {
          userId: input.owner.id,
          role: "OWNER",
          status: "ACTIVE",
          joinedAt: input.now,
        },
      },
      subscriptions: {
        create: {
          planVersionId: input.paidPlanVersion.id,
          status: "ACTIVE",
          currentPeriodStart: input.now,
          currentPeriodEnd: periodEnd,
          billingIntervalSnapshot: input.paidPlanVersion.billingInterval,
          termMonthsSnapshot: input.paidPlanVersion.termMonths,
          recurringNetRappenSnapshot: requiredMoney(
            input.paidPlanVersion.netPriceRappen,
            "paid plan net price",
          ),
          monthlyEquivalentRappenSnapshot: requiredMoney(
            input.paidPlanVersion.monthlyEquivalentRappen,
            "paid plan monthly equivalent",
          ),
          currencySnapshot: input.paidPlanVersion.currency,
          activatedAt: input.now,
        },
      },
    },
    select: { id: true, name: true },
  });
  await database.company.update({
    where: { id: company.id },
    data: { status: "ACTIVE", updatedAt: input.now },
  });
  return Object.freeze({
    companyId: company.id,
    companyName: company.name,
    ownerEmail: input.owner.email,
    ownerUserId: input.owner.id,
  });
}

async function loadCompanyLocationTemplate(database: Database) {
  return database.city.findFirstOrThrow({
    where: { isActive: true, canton: { isActive: true } },
    orderBy: [{ canton: { sortOrder: "asc" } }, { sortOrder: "asc" }, { id: "asc" }],
    select: { cantonId: true, id: true },
  });
}

async function openObservedActor(
  browser: Browser,
  baseURL: string,
  email: string,
) {
  const context = await browser.newContext({
    baseURL,
    locale: "de-CH",
    timezoneId: "Europe/Zurich",
    viewport: { width: 1_440, height: 900 },
    colorScheme: "light",
    serviceWorkers: "block",
    extraHTTPHeaders: { "x-forwarded-for": "198.51.100.84" },
  });
  const page = await context.newPage();
  const observation = await observePage(page);
  await login(page, email, DEMO_PASSWORD);
  await rebindPhase34PreviewCookiesForHttpLoopback(context, baseURL, [
    SESSION_POLICY_V1.cookieName,
  ]);
  return Object.freeze({
    context,
    page,
    async close() {
      observation.assertClean();
      await context.close();
    },
  });
}

async function waitForUnusedDispatchScheduleBucket(database: Database) {
  const deadline = Date.now() + 65_000;
  while (Date.now() < deadline) {
    const bucket = Math.floor(Date.now() / 60_000);
    const dedupeKey = `notifications.dispatch:v1:${bucket}`;
    if ((await database.workItem.count({ where: { dedupeKey } })) === 0) {
      return;
    }
    const nextBoundary = (bucket + 1) * 60_000;
    await delay(Math.max(50, Math.min(500, nextBoundary - Date.now() + 25)));
  }
  throw new Error("PHASE34_UNUSED_NOTIFICATION_SCHEDULE_BUCKET_TIMEOUT");
}

async function runWorkerOnce(workerId: string) {
  const tsxCli = resolve(
    process.cwd(),
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs",
  );
  const runtimeGuard = resolve(
    process.cwd(),
    "scripts",
    "e2e",
    "runtime-guard.cjs",
  );
  const workerScript = resolve(process.cwd(), "scripts", "phase23-worker.ts");
  if (
    !existsSync(tsxCli) ||
    !existsSync(runtimeGuard) ||
    !existsSync(workerScript)
  ) {
    throw new Error("PHASE34_WORKER_RUNTIME_MISSING");
  }

  const child = spawn(
    process.execPath,
    [
      "--require",
      runtimeGuard,
      tsxCli,
      "--conditions",
      "react-server",
      workerScript,
      "--once",
      `--worker-id=${workerId}`,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_ENV: "local",
        NODE_ENV: "production",
        APP_URL: requiredEnvironment("PHASE34_LOCAL_BASE_URL"),
        APP_BUILD_ID: requiredEnvironment("PHASE34_CANDIDATE_DIGEST"),
        DATABASE_URL: requiredEnvironment("DATABASE_URL"),
        TEST_DATABASE_URL: "",
        TRUSTED_PROXY_HOPS: "1",
        EMAIL_PROVIDER_MODE: "local_mock",
        NOTIFICATION_DISPATCH: "command",
        ENABLE_LOCAL_MOCK_MAILBOX: "false",
        DEV_MAILBOX_SECRET: "",
        PHASE33_LOCAL_MOCK_RUNTIME_CONTRACT: "false",
        PAYMENT_PROVIDER_MODE: "disabled",
        WORKER_RUNTIME: "sandbox_command",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let output = "";
  const record = (chunk: Buffer | string) => {
    output = `${output}${chunk.toString()}`.slice(
      -MAXIMUM_WORKER_OUTPUT_CHARACTERS,
    );
  };
  child.stdout.on("data", record);
  child.stderr.on("data", record);

  const result = await new Promise<
    Readonly<{
      code: number | null;
      signal: NodeJS.Signals | null;
      timedOut: boolean;
    }>
  >((resolveExit, reject) => {
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, WORKER_TIMEOUT_MILLISECONDS);
    timeout.unref();
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolveExit(Object.freeze({ code, signal, timedOut }));
    });
  });
  if (result.timedOut || result.code !== 0) {
    throw new Error(
      `Phase 34 invitation worker failed (code ${String(result.code)}, signal ${String(result.signal)}, timeout ${String(result.timedOut)}):\n${redact(output)}`,
    );
  }
  return Object.freeze({ ...result, output });
}

async function containFixture(
  database: Database,
  suffix: string,
  fixture: InvitationDeliveryFixture | undefined,
) {
  const now = new Date();
  const [discoveredCompanies, discoveredUsers] = await Promise.all([
    database.company.findMany({
      where: {
        dataProvenance: "TEST",
        slug: { contains: suffix },
      },
      select: { id: true },
    }),
    database.user.findMany({
      where: {
        dataProvenance: "TEST",
        emailNormalized: { contains: suffix },
      },
      select: { id: true },
    }),
  ]);
  const companyIds = [
    ...new Set([
      ...discoveredCompanies.map(({ id }) => id),
      ...(fixture === undefined
        ? []
        : [fixture.local.companyId, fixture.preview.companyId]),
    ]),
  ];
  const ownerUserIds = [
    ...new Set([
      ...discoveredUsers.map(({ id }) => id),
      ...(fixture === undefined
        ? []
        : [fixture.local.ownerUserId, fixture.preview.ownerUserId]),
    ]),
  ];
  const invitationIds = (
    await database.companyInvitation.findMany({
      where: { companyId: { in: companyIds } },
      select: { id: true },
    })
  ).map(({ id }) => id);
  await database.$transaction(async (transaction) => {
    for (const invitationId of invitationIds) {
      await transaction.notificationOutbox.updateMany({
        where: {
          dedupeKey: { startsWith: `company-invitation:${invitationId}:` },
          status: { in: ["PENDING", "RETRY", "LEASED"] },
        },
        data: {
          status: "PAUSED",
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: "E2E_FIXTURE_CONTAINED",
          updatedAt: now,
        },
      });
    }
    await transaction.companyInvitation.updateMany({
      where: { id: { in: invitationIds }, status: "PENDING" },
      data: { status: "REVOKED", revokedAt: now, updatedAt: now },
    });
    await transaction.company.updateMany({
      where: { id: { in: companyIds } },
      data: { status: "SUSPENDED", updatedAt: now },
    });
    await transaction.user.updateMany({
      where: { id: { in: ownerUserIds } },
      data: { status: "SUSPENDED", updatedAt: now },
    });
  });
}

async function rebindPhase34PreviewCookiesForHttpLoopback(
  context: BrowserContext,
  baseUrl: string,
  requiredNames: readonly string[],
) {
  const origin = new URL(baseUrl);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1") {
    throw new Error("PHASE34_PREVIEW_COOKIE_REBIND_REQUIRES_HTTP_LOOPBACK");
  }
  // URL-filtered cookie reads omit Secure cookies for an HTTP URL even when
  // a browser engine accepts/sends them for loopback. Read the isolated jar
  // first, then bind only genuine loopback cookies to the gate origin.
  const cookies = await context.cookies();
  const selected = requiredNames.map((name) => {
    const cookie = cookies.find(
      (candidate) =>
        candidate.name === name &&
        isPhase34LoopbackCookieDomain(candidate.domain),
    );
    if (cookie === undefined) {
      throw new Error(`PHASE34_PREVIEW_COOKIE_MISSING:${name}`);
    }
    return cookie;
  });
  // Preview remains HTTPS-only outside this isolated 127.0.0.1 gate. The
  // rebind keeps the genuine server-issued value while making all browser
  // engines exercise the same authenticated flow over loopback HTTP.
  await context.addCookies(
    selected.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: origin.hostname,
      path: cookie.path,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: false,
      sameSite: cookie.sameSite,
    })),
  );
  const rebound = await context.cookies();
  for (const name of requiredNames) {
    const cookie = rebound.find(
      (candidate) =>
        candidate.name === name &&
        normalizeCookieDomain(candidate.domain) === origin.hostname,
    );
    if (cookie === undefined || cookie.secure) {
      throw new Error(`PHASE34_PREVIEW_COOKIE_REBIND_FAILED:${name}`);
    }
  }
}

function isPhase34LoopbackCookieDomain(domain: string) {
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
    normalizeCookieDomain(domain),
  );
}

function normalizeCookieDomain(domain: string) {
  return domain.replace(/^\./u, "").toLowerCase();
}

function deriveInvitationToken(invitationId: string, version: number) {
  return createHmac(
    "sha256",
    Buffer.from(requiredEnvironment("SESSION_SECRET"), "base64"),
  )
    .update(INVITATION_TOKEN_DOMAIN, "utf8")
    .update("\0", "utf8")
    .update(invitationId, "utf8")
    .update("\0", "utf8")
    .update(String(version), "utf8")
    .digest("base64url");
}

function requiredMoney(value: number | null, label: string) {
  if (value === null || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`The ${label} is not a valid money snapshot.`);
  }
  return value;
}

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required by the Phase 34 invitation E2E.`);
  }
  return value;
}

function redact(value: string) {
  return value
    .replaceAll(/postgres(?:ql)?:\/\/[^\s]+/giu, "[REDACTED_DATABASE_URL]")
    .replaceAll(/[A-Za-z0-9_-]{32,}/gu, "[REDACTED_TOKEN]");
}
