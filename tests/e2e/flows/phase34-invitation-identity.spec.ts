import { createHash, createHmac, randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";

import { INVITE_RESUME_COOKIE_POLICY_V1 } from "@/lib/auth/invite-resume";
import { buildNotificationStorageDedupeKey } from "@/lib/notifications/writer";
import {
  DEMO_ACCOUNTS,
  expect,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";

const INVITATION_TOKEN_DOMAIN = "swisstalenthub.company-invitation-token.v2";

test.describe.configure({ mode: "serial" });

test("[E2E-34-04] @phase34 invitation registration rejects a foreign address and expiry, then accepts exactly once with the intended company role", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const database = phase17Database();
  const suffix = `${testInfo.project.name.replaceAll(/[^a-z0-9]+/giu, "-")}-${randomUUID().slice(0, 8)}`;
  const intendedEmail = `phase34-invite-${suffix}@example.test`.toLowerCase();
  const rejectedIntendedEmail =
    `phase34-invite-rejected-${suffix}@example.test`.toLowerCase();
  const foreignEmail =
    `phase34-invite-foreign-${suffix}@example.test`.toLowerCase();
  const acceptedPassword = "Phase34!InvitationSafe42";

  try {
    const company = await createInvitableCompany(database, suffix);
    const rejectedInvitation = await createInvitation(database, {
      companyId: company.id,
      inviterUserId: company.ownerUserId,
      inviteeEmail: rejectedIntendedEmail,
    });

    await openInvitation(page, rejectedInvitation.rawToken);
    await expect(
      page.getByRole("heading", { name: "Sicher beitreten" }),
    ).toBeVisible();
    await submitInvitationRegistration(page, {
      email: foreignEmail,
      name: `Foreign Invitation ${suffix}`,
      password: acceptedPassword,
    });
    await expect(
      page.getByRole("alert").filter({
        hasText:
          "Die Einladung ist ungültig, abgelaufen oder nicht für dieses Konto bestimmt.",
      }),
    ).toBeVisible();
    await expect(
      database.user.count({
        where: {
          emailNormalized: { in: [rejectedIntendedEmail, foreignEmail] },
        },
      }),
    ).resolves.toBe(0);
    await expect(
      database.companyMembership.count({
        where: {
          companyId: company.id,
          user: {
            emailNormalized: { in: [rejectedIntendedEmail, foreignEmail] },
          },
        },
      }),
    ).resolves.toBe(0);
    await expect(
      database.companyInvitation.findUniqueOrThrow({
        where: { id: rejectedInvitation.id },
        select: { status: true, acceptedAt: true, acceptedByUserId: true },
      }),
    ).resolves.toEqual({
      status: "PENDING",
      acceptedAt: null,
      acceptedByUserId: null,
    });

    const rejectedExpiredAt = new Date(Date.now() - 60_000);
    await database.companyInvitation.update({
      where: { id: rejectedInvitation.id },
      data: {
        createdAt: new Date(rejectedExpiredAt.getTime() - 60_000),
        expiresAt: rejectedExpiredAt,
      },
    });
    await openInvitation(page, rejectedInvitation.rawToken);
    await expect(
      page.getByText(
        "Diese Einladung ist abgelaufen. Bitte fordere einen neuen Link an.",
      ),
    ).toBeVisible();
    await expect(
      database.user.count({
        where: { emailNormalized: rejectedIntendedEmail },
      }),
    ).resolves.toBe(0);

    const acceptedInvitation = await createInvitation(database, {
      companyId: company.id,
      inviterUserId: company.ownerUserId,
      inviteeEmail: intendedEmail,
    });
    await openInvitation(page, acceptedInvitation.rawToken);
    await submitInvitationRegistration(page, {
      email: intendedEmail,
      name: `Phase 34 Invite ${suffix}`,
      password: acceptedPassword,
    });
    await expect(page).toHaveURL(
      /\/employer\/dashboard\?invitation=accepted$/u,
    );
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: `Guten Tag bei Phase 34 Invitation ${suffix} AG`,
      }),
    ).toBeVisible();

    const acceptedUser = await database.user.findUniqueOrThrow({
      where: { emailNormalized: intendedEmail },
      select: {
        id: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        identityAssurance: true,
        personaAssignments: {
          where: { kind: "EMPLOYER" },
          select: { status: true, source: true },
        },
        companyMemberships: {
          where: { companyId: company.id },
          select: { id: true, role: true, status: true },
        },
        sessions: {
          where: { revokedAt: null },
          select: { activeCompanyId: true, activePortal: true },
        },
      },
    });
    expect(acceptedUser).toMatchObject({
      role: "RECRUITER",
      status: "ACTIVE",
      emailVerifiedAt: expect.any(Date),
      identityAssurance: "VERIFIED_EMAIL",
      personaAssignments: [{ status: "ACTIVE" }],
      companyMemberships: [
        {
          role: "RECRUITER",
          status: "ACTIVE",
        },
      ],
      sessions: [
        {
          activeCompanyId: company.id,
          activePortal: "EMPLOYER",
        },
      ],
    });
    expect(acceptedUser.personaAssignments[0]?.source).toMatch(
      /REGISTRATION|COMPANY_INVITATION/u,
    );

    await expect(
      database.companyInvitation.findUniqueOrThrow({
        where: { id: acceptedInvitation.id },
        select: {
          status: true,
          acceptedAt: true,
          acceptedByUserId: true,
          events: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: { kind: true, actorUserId: true },
          },
        },
      }),
    ).resolves.toMatchObject({
      status: "ACCEPTED",
      acceptedAt: expect.any(Date),
      acceptedByUserId: acceptedUser.id,
      events: [
        { kind: "CREATED", actorUserId: company.ownerUserId },
        { kind: "ACCEPTED", actorUserId: acceptedUser.id },
      ],
    });
    await expect(
      database.companyMembershipEvent.count({
        where: {
          membershipId: acceptedUser.companyMemberships[0]!.id,
          kind: "CREATED",
          reasonCode: "INVITATION_ACCEPTED",
          actorUserId: acceptedUser.id,
        },
      }),
    ).resolves.toBe(1);
    await expect(
      database.auditLog.count({
        where: {
          action: "INVITATION_ACCEPTED",
          actorUserId: acceptedUser.id,
          targetId: acceptedInvitation.id,
          result: "SUCCEEDED",
        },
      }),
    ).resolves.toBe(1);
    await expect(
      database.notification.count({
        where: {
          recipientUserId: acceptedUser.id,
          kind: "TEAM_MEMBERSHIP_CHANGED",
          dedupeKey: buildNotificationStorageDedupeKey({
            recipientUserId: acceptedUser.id,
            kind: "TEAM_MEMBERSHIP_CHANGED",
            dedupeKey: `invitation-accepted:${acceptedInvitation.id}`,
          }),
        },
      }),
    ).resolves.toBe(1);
    await expect(
      database.userConsentEvent.count({
        where: { userId: acceptedUser.id, kind: "TERMS" },
      }),
    ).resolves.toBe(1);

    const membershipCountBeforeReplay = await database.companyMembership.count({
      where: { companyId: company.id, userId: acceptedUser.id },
    });
    await openInvitation(page, acceptedInvitation.rawToken);
    await expect(
      page.getByText("Dieser Link wurde bereits verwendet."),
    ).toBeVisible();
    await expect(
      database.companyMembership.count({
        where: { companyId: company.id, userId: acceptedUser.id },
      }),
    ).resolves.toBe(membershipCountBeforeReplay);
    await expect(
      database.companyInvitationEvent.count({
        where: { invitationId: acceptedInvitation.id, kind: "ACCEPTED" },
      }),
    ).resolves.toBe(1);
  } finally {
    await containInvitationFixture(database, suffix);
    await database.$disconnect();
  }
});

type Database = ReturnType<typeof phase17Database>;

async function createInvitableCompany(database: Database, suffix: string) {
  const [owner, paidPlanVersion] = await Promise.all([
    database.user.findUniqueOrThrow({
      where: { emailNormalized: DEMO_ACCOUNTS.employer },
      select: { id: true },
    }),
    database.planVersion.findFirstOrThrow({
      where: { plan: { isDefaultFree: false }, status: "ACTIVE" },
      orderBy: { id: "asc" },
      select: {
        id: true,
        billingInterval: true,
        termMonths: true,
        netPriceRappen: true,
        monthlyEquivalentRappen: true,
        currency: true,
      },
    }),
  ]);
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000);
  const location = await loadCompanyLocationTemplate(database);
  const company = await database.company.create({
    data: {
      name: `Phase 34 Invitation ${suffix} AG`,
      slug: `phase34-invitation-${suffix}`.slice(0, 190),
      status: "DRAFT",
      dataProvenance: "TEST",
      industry: "Technology",
      size: "11-50",
      website: `https://phase34-invitation-${suffix}.example.test`,
      about: "Isolierte Firma für die browsergestützte Einladungsevidence.",
      locations: {
        create: {
          address: "Einladungsstrasse 34",
          cantonId: location.cantonId,
          cityId: location.id,
          isPrimary: true,
          postalCode: "8000",
        },
      },
      memberships: {
        create: {
          userId: owner.id,
          role: "OWNER",
          status: "ACTIVE",
          joinedAt: now,
        },
      },
      subscriptions: {
        create: {
          planVersionId: paidPlanVersion.id,
          status: "ACTIVE",
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          billingIntervalSnapshot: paidPlanVersion.billingInterval,
          termMonthsSnapshot: paidPlanVersion.termMonths,
          recurringNetRappenSnapshot: requiredMoney(
            paidPlanVersion.netPriceRappen,
            "paid plan net price",
          ),
          monthlyEquivalentRappenSnapshot: requiredMoney(
            paidPlanVersion.monthlyEquivalentRappen,
            "paid plan monthly equivalent",
          ),
          currencySnapshot: paidPlanVersion.currency,
          activatedAt: now,
        },
      },
    },
    select: { id: true },
  });
  await database.company.update({
    where: { id: company.id },
    data: { status: "ACTIVE", updatedAt: now },
  });
  return Object.freeze({ id: company.id, ownerUserId: owner.id });
}

async function loadCompanyLocationTemplate(database: Database) {
  return database.city.findFirstOrThrow({
    where: { isActive: true, canton: { isActive: true } },
    orderBy: [{ canton: { sortOrder: "asc" } }, { sortOrder: "asc" }, { id: "asc" }],
    select: { cantonId: true, id: true },
  });
}

async function createInvitation(
  database: Database,
  input: Readonly<{
    companyId: string;
    inviterUserId: string;
    inviteeEmail: string;
  }>,
) {
  const id = randomUUID();
  const rawToken = deriveInvitationToken(id, 1);
  await database.companyInvitation.create({
    data: {
      id,
      companyId: input.companyId,
      inviterUserId: input.inviterUserId,
      inviteeEmailNormalized: input.inviteeEmail,
      intendedRole: "RECRUITER",
      tokenHash: createHash("sha256").update(rawToken, "utf8").digest("hex"),
      tokenVersion: 1,
      status: "PENDING",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      events: {
        create: {
          kind: "CREATED",
          actorUserId: input.inviterUserId,
          correlationId: `phase34-invitation-${id}`,
        },
      },
    },
  });
  return Object.freeze({ id, rawToken });
}

async function submitInvitationRegistration(
  page: Page,
  input: Readonly<{ email: string; name: string; password: string }>,
) {
  await page.getByLabel("Name", { exact: true }).fill(input.name);
  await page.getByLabel("E-Mail der Einladung").fill(input.email);
  await page.getByLabel("Passwort", { exact: true }).fill(input.password);
  await page
    .getByRole("checkbox", {
      name: /Ich akzeptiere die Nutzungsbedingungen/u,
    })
    .check();
  await page
    .getByRole("button", { name: "Konto erstellen und beitreten" })
    .click();
}

async function openInvitation(page: Page, rawToken: string) {
  const configuredOrigin = new URL(requiredEnvironment("PHASE34_LOCAL_BASE_URL"));
  await page.goto(`/invite/${rawToken}`);
  await expect(page).toHaveURL(/\/invite\/resume$/u);

  const redirectedOrigin = new URL(page.url());
  if (redirectedOrigin.origin === configuredOrigin.origin) return;
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (
    configuredOrigin.protocol !== "http:" ||
    redirectedOrigin.protocol !== "http:" ||
    configuredOrigin.port !== redirectedOrigin.port ||
    !loopbackHosts.has(configuredOrigin.hostname) ||
    !loopbackHosts.has(redirectedOrigin.hostname)
  ) {
    throw new Error("PHASE34_INVITATION_REDIRECT_ORIGIN_MISMATCH");
  }

  const allCookies = await page.context().cookies();
  const resumeCandidates = allCookies.filter(
    ({ domain, name }) =>
      name === INVITE_RESUME_COOKIE_POLICY_V1.cookieName &&
      loopbackHosts.has(normalizeCookieDomain(domain)),
  );
  const resumeCookie =
    resumeCandidates.find(
      ({ domain }) =>
        normalizeCookieDomain(domain) === configuredOrigin.hostname,
    ) ?? resumeCandidates.sort((left, right) => right.expires - left.expires)[0];
  if (resumeCookie === undefined) {
    throw new Error("PHASE34_INVITATION_RESUME_COOKIE_MISSING");
  }
  // Next's isolated loopback server canonicalises this redirect from
  // 127.0.0.1 to localhost. Rebind only the genuine HttpOnly resume value in
  // the browser fixture so the host-only cookie reaches the redirected page.
  await page.context().addCookies([
    {
      name: resumeCookie.name,
      value: resumeCookie.value,
      domain: redirectedOrigin.hostname,
      path: resumeCookie.path,
      expires: resumeCookie.expires,
      httpOnly: resumeCookie.httpOnly,
      secure: false,
      sameSite: resumeCookie.sameSite,
    },
  ]);
  const rebound = (await page.context().cookies()).find(
    ({ domain, name, secure }) =>
      name === INVITE_RESUME_COOKIE_POLICY_V1.cookieName &&
      normalizeCookieDomain(domain) === redirectedOrigin.hostname &&
      !secure,
  );
  if (rebound === undefined) {
    throw new Error("PHASE34_INVITATION_RESUME_COOKIE_REBIND_FAILED");
  }
  await page.reload();
}

function normalizeCookieDomain(domain: string) {
  return domain.replace(/^\./u, "").toLowerCase();
}

async function containInvitationFixture(database: Database, suffix: string) {
  const [companies, users] = await Promise.all([
    database.company.findMany({
      where: {
        dataProvenance: "TEST",
        slug: { contains: suffix.toLowerCase() },
      },
      select: { id: true },
    }),
    database.user.findMany({
      where: {
        dataProvenance: "TEST",
        emailNormalized: { contains: suffix.toLowerCase() },
      },
      select: { id: true },
    }),
  ]);
  const companyIds = companies.map(({ id }) => id);
  const userIds = users.map(({ id }) => id);
  const now = new Date();

  await database.$transaction(async (transaction) => {
    await transaction.companyInvitation.updateMany({
      where: { companyId: { in: companyIds }, status: "PENDING" },
      data: { status: "REVOKED", revokedAt: now, updatedAt: now },
    });
    await transaction.session.updateMany({
      where: { userId: { in: userIds }, revokedAt: null },
      data: { revokedAt: now },
    });
    await transaction.company.updateMany({
      where: { id: { in: companyIds } },
      data: { status: "SUSPENDED", updatedAt: now },
    });
    await transaction.user.updateMany({
      where: { id: { in: userIds } },
      data: { status: "SUSPENDED", updatedAt: now },
    });
  });
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
  if (!Number.isSafeInteger(value) || value === null || value < 0) {
    throw new Error(`The ${label} is not a valid money snapshot.`);
  }
  return value;
}

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required by the Phase 34 browser suite.`);
  }
  return value;
}
