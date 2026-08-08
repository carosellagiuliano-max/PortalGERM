import { randomUUID } from "node:crypto";

import type {
  Browser,
  BrowserContext,
  Page,
  Request as PlaywrightRequest,
} from "@playwright/test";

import { COMPANY_CONTEXT_COOKIE_POLICY_V1 } from "@/lib/auth/company-context-cookie";
import { SESSION_POLICY_V1 } from "@/lib/auth/session";
import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  login,
  observePage,
  phase17Database,
  test,
  type PageObservation,
} from "@/tests/e2e/fixtures/phase17-test";

const COMPANY_SLUG = "novarigi-digital";
const LEGAL_LOCK_COPY =
  "Talent Radar bleibt ausserhalb der lokalen Testumgebung gesperrt, bis die aktuelle Datenschutz-, AVG- und DSFA-Freigabe für genau diesen Ablauf dokumentiert ist.";
const CONTACT_BLOCK_COPY = "Neue Talent-Radar-Kontakte bleiben gesperrt";
const COOLDOWN_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;

type Database = ReturnType<typeof phase17Database>;

type CapturedServerAction = Readonly<{
  body: Buffer;
  headers: Readonly<Record<string, string>>;
  path: string;
}>;

test.describe.configure({ mode: "serial" });

test("[F34-LEG-002] @phase34 Radar stays usable locally, fails closed in preview and preserves decline recovery", async ({
  browser,
  page,
}, testInfo) => {
  const database = phase17Database();
  let previewEmployerContext: BrowserContext | undefined;
  let previewEmployerObservation: PageObservation | undefined;
  let previewCandidateContext: BrowserContext | undefined;
  let previewCandidateObservation: PageObservation | undefined;
  let radarAccessGrantId: string | undefined;

  try {
    const suffix = `${testInfo.project.name}-${randomUUID().slice(0, 8)}`;
    const fixture = await prepareLocalRadarAccess(database, suffix);
    radarAccessGrantId = fixture.entitlementGrantId;
    const subject = `Phase 34 Radar-Rechtsgrenze ${suffix}`;
    const message =
      "Dieser lokale Testkontakt belegt den synthetischen Positivpfad und wird anschliessend in Preview sicher abgewiesen.";

    await login(page, DEMO_ACCOUNTS.employer, DEMO_PASSWORD);
    await selectEmployerCompanyContext(
      page,
      fixture.companyId,
      fixture.companyName,
    );
    const localResponse = await page.goto("/employer/talent-radar");
    expect(localResponse?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "Talent Radar" }),
    ).toBeVisible();
    await expect(
      page.getByText("Anonym geschützt", { exact: true }),
    ).toBeVisible();

    const cards = radarCandidateCards(page);
    const cardCount = await cards.count();
    expect(cardCount).toBeGreaterThanOrEqual(1);

    await cards
      .first()
      .getByRole("button", { name: "Kontakt anfragen" })
      .click();
    const discoveryDialog = page.getByRole("dialog", {
      name: "Kontaktanfrage senden",
    });
    const signedSearchSession = await discoveryDialog
      .locator('input[name="signedSearchSession"]')
      .inputValue();
    await discoveryDialog.getByRole("button", { name: "Abbrechen" }).click();

    const cardPosition = await findContactableCardPosition(database, {
      cardCount,
      companyId: fixture.companyId,
      signedSearchSession,
    });
    const card = cards.nth(cardPosition);
    await card.getByRole("button", { name: "Kontakt anfragen" }).click();
    const contactDialog = page.getByRole("dialog", {
      name: "Kontaktanfrage senden",
    });
    await contactDialog.getByLabel("Betreff").fill(subject);
    await contactDialog.getByLabel("Nachricht").fill(message);

    const [localActionRequest] = await Promise.all([
      page.waitForRequest(isNextServerActionRequest),
      contactDialog.getByRole("button", { name: "1 Credit einsetzen" }).click(),
    ]);
    const capturedAction = await captureServerAction(localActionRequest);
    await expect(
      contactDialog.getByText(
        "Kontaktanfrage gesendet. Die Identität bleibt bis zu einer separaten Freigabe anonym.",
        { exact: true },
      ),
    ).toBeVisible();

    const createdRequest =
      await database.employerContactRequest.findFirstOrThrow({
        where: { companyId: fixture.companyId, subject },
        select: {
          id: true,
          candidateProfileId: true,
          creditLedgerEntryId: true,
          status: true,
          candidateProfile: {
            select: {
              user: { select: { id: true, emailNormalized: true } },
            },
          },
        },
      });
    expect(createdRequest.status).toBe("PENDING");
    expect(
      await database.contactRequestEvent.findMany({
        where: { contactRequestId: createdRequest.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { kind: true },
      }),
    ).toEqual([{ kind: "CREATED" }]);

    await giveCandidateDemoCredential(
      database,
      createdRequest.candidateProfile.user.id,
    );

    const legalEvidence = await database.processingApproval.count({
      where: {
        scope: { in: ["TALENT_RADAR", "RECRUITING_CONVERSATION"] },
        status: "APPROVED",
        revokedAt: null,
      },
    });
    expect(legalEvidence).toBe(0);

    previewEmployerContext = await createPreviewContext(
      browser,
      "198.51.100.84",
    );
    const previewEmployerPage = await previewEmployerContext.newPage();
    previewEmployerObservation = await observePage(previewEmployerPage);
    await login(previewEmployerPage, DEMO_ACCOUNTS.employer, DEMO_PASSWORD);
    await rebindPhase34PreviewCookiesForHttpLoopback(
      previewEmployerContext,
      requiredEnvironment("PHASE34_PREVIEW_BASE_URL"),
      [SESSION_POLICY_V1.cookieName],
    );
    await selectEmployerCompanyContext(
      previewEmployerPage,
      fixture.companyId,
      fixture.companyName,
    );
    await rebindPhase34PreviewCookiesForHttpLoopback(
      previewEmployerContext,
      requiredEnvironment("PHASE34_PREVIEW_BASE_URL"),
      [SESSION_POLICY_V1.cookieName],
      [COMPANY_CONTEXT_COOKIE_POLICY_V1.cookieName],
    );

    const readBoundaryBefore = await radarReadBoundaryFingerprint(database);
    const previewResponse = await previewEmployerPage.goto(
      "/employer/talent-radar",
    );
    expect(previewResponse?.status()).toBe(200);
    await expect(
      previewEmployerPage.getByRole("heading", {
        level: 1,
        name: "Talent Radar",
      }),
    ).toBeVisible();
    await expect(
      previewEmployerPage.getByText("Gesperrt", { exact: true }),
    ).toBeVisible();
    await expect(
      previewEmployerPage.getByText(LEGAL_LOCK_COPY, { exact: true }),
    ).toBeVisible();
    await expect(
      previewEmployerPage.getByText("Anonym geschützt", { exact: true }),
    ).toHaveCount(0);
    await expect(
      previewEmployerPage.getByRole("button", { name: "Kontakt anfragen" }),
    ).toHaveCount(0);
    await expect(
      previewEmployerPage.locator('input[name="opaqueCandidateId"]'),
    ).toHaveCount(0);
    expect(await radarReadBoundaryFingerprint(database)).toEqual(
      readBoundaryBefore,
    );

    const mutationBeforeReplay = await contactMutationFingerprint(
      database,
      fixture.companyId,
      createdRequest.id,
    );
    const directActionResponse = await replayServerActionFromPage(
      previewEmployerPage,
      capturedAction,
      "198.51.100.84",
    );
    expect(directActionResponse.status).toBe(200);
    expect(directActionResponse.body).toContain(CONTACT_BLOCK_COPY);
    expect(
      await contactMutationFingerprint(
        database,
        fixture.companyId,
        createdRequest.id,
      ),
    ).toEqual(mutationBeforeReplay);

    previewCandidateContext = await createPreviewContext(
      browser,
      "198.51.100.85",
    );
    const previewCandidatePage = await previewCandidateContext.newPage();
    previewCandidateObservation = await observePage(previewCandidatePage);
    await login(
      previewCandidatePage,
      createdRequest.candidateProfile.user.emailNormalized,
      DEMO_PASSWORD,
    );
    await rebindPhase34PreviewCookiesForHttpLoopback(
      previewCandidateContext,
      requiredEnvironment("PHASE34_PREVIEW_BASE_URL"),
      [SESSION_POLICY_V1.cookieName],
    );
    const candidateRequestResponse = await previewCandidatePage.goto(
      `/candidate/talent-radar/requests/${createdRequest.id}`,
    );
    expect(candidateRequestResponse?.status()).toBe(200);
    await expect(
      previewCandidatePage.getByText("Neue Radar-Verarbeitung gesperrt", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      previewCandidatePage.getByRole("button", {
        name: "Kontaktanfrage annehmen",
      }),
    ).toHaveCount(0);
    await previewCandidatePage
      .getByRole("button", { name: "Ablehnen", exact: true })
      .click();
    const declineDialog = previewCandidatePage.getByRole("dialog", {
      name: "Kontaktanfrage ablehnen?",
    });
    await declineDialog
      .getByLabel("Ich möchte diese Kontaktanfrage ablehnen.")
      .check();
    await declineDialog
      .getByRole("button", { name: "Verbindlich ablehnen" })
      .click();
    await expect(previewCandidatePage).toHaveURL(
      new RegExp(
        `/candidate/talent-radar/requests/${createdRequest.id}\\?updated=declined$`,
        "u",
      ),
    );
    await expect(
      previewCandidatePage.getByText(
        "Kontaktanfrage abgelehnt. Es wurde kein Gespräch erstellt.",
        { exact: true },
      ),
    ).toBeVisible();

    const recoveryEvidence =
      await database.employerContactRequest.findUniqueOrThrow({
        where: { id: createdRequest.id },
        select: {
          status: true,
          terminalAt: true,
          creditLedgerEntryId: true,
          events: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: { kind: true },
          },
          conversation: { select: { id: true } },
          revealGrant: { select: { id: true } },
        },
      });
    expect(recoveryEvidence).toEqual({
      status: "DECLINED",
      terminalAt: expect.any(Date),
      creditLedgerEntryId: createdRequest.creditLedgerEntryId,
      events: [{ kind: "CREATED" }, { kind: "DECLINED" }],
      conversation: null,
      revealGrant: null,
    });
    expect(
      await database.auditLog.count({
        where: {
          action: "CONTACT_REQUEST_DECLINED",
          result: "SUCCEEDED",
          targetId: createdRequest.id,
          targetType: "CONTACT_REQUEST",
        },
      }),
    ).toBe(1);
  } finally {
    await Promise.allSettled([
      previewEmployerContext?.close() ?? Promise.resolve(),
      previewCandidateContext?.close() ?? Promise.resolve(),
    ]);
    try {
      if (radarAccessGrantId !== undefined) {
        const revoked = await database.entitlementGrant.updateMany({
          where: {
            id: radarAccessGrantId,
            reasonCode: "PHASE34_RADAR_LEGAL_E2E",
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });
        if (revoked.count !== 1) {
          throw new Error("PHASE34_RADAR_ENTITLEMENT_FIXTURE_CLEANUP_FAILED");
        }
      }
    } finally {
      await database.$disconnect();
      previewEmployerObservation?.assertClean();
      previewCandidateObservation?.assertClean();
    }
  }
});

function radarCandidateCards(page: Page) {
  return page.locator('[data-slot="card"]').filter({
    has: page.getByRole("button", { name: "Kontakt anfragen" }),
  });
}

function isNextServerActionRequest(request: PlaywrightRequest) {
  return (
    request.method() === "POST" &&
    request.headers()["next-action"] !== undefined &&
    new URL(request.url()).pathname === "/employer/talent-radar"
  );
}

async function captureServerAction(
  request: PlaywrightRequest,
): Promise<CapturedServerAction> {
  const body = request.postDataBuffer();
  if (body === null || body.byteLength === 0) {
    throw new Error("The genuine local Next Server Action body is missing.");
  }
  const url = new URL(request.url());
  return Object.freeze({
    body,
    headers: Object.freeze(await request.allHeaders()),
    path: `${url.pathname}${url.search}`,
  });
}

function replayHeaders(
  captured: Readonly<Record<string, string>>,
  forwardedFor: string,
) {
  const headers: Record<string, string> = {
    "x-forwarded-for": forwardedFor,
  };
  for (const name of [
    "accept",
    "content-type",
    "next-action",
    "next-router-state-tree",
    "next-url",
  ]) {
    const value = captured[name];
    if (value !== undefined) headers[name] = value;
  }
  return headers;
}

async function replayServerActionFromPage(
  page: Page,
  captured: CapturedServerAction,
  forwardedFor: string,
) {
  return page.evaluate(
    async ({ bodyBase64, headers, path }) => {
      const binary = atob(bodyBase64);
      const body = Uint8Array.from(binary, (character) =>
        character.charCodeAt(0),
      );
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        redirect: "manual",
        headers,
        body,
      });
      return Object.freeze({
        status: response.status,
        body: await response.text(),
      });
    },
    {
      bodyBase64: captured.body.toString("base64"),
      headers: replayHeaders(captured.headers, forwardedFor),
      path: captured.path,
    },
  );
}

function createPreviewContext(
  browser: Browser,
  forwardedFor: string,
): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: requiredEnvironment("PHASE34_PREVIEW_BASE_URL"),
    locale: "de-CH",
    timezoneId: "Europe/Zurich",
    viewport: { width: 1_440, height: 900 },
    colorScheme: "light",
    serviceWorkers: "block",
    extraHTTPHeaders: { "x-forwarded-for": forwardedFor },
  });
}

async function selectEmployerCompanyContext(
  page: Page,
  companyId: string,
  companyName: string,
) {
  const selector = page.getByLabel("Aktives Unternehmen");
  const selectorCount = await selector.count();
  if (selectorCount > 1) {
    throw new Error("PHASE34_RADAR_COMPANY_CONTEXT_SELECTOR_AMBIGUOUS");
  }
  if (selectorCount === 1 && (await selector.inputValue()) !== companyId) {
    await selector.selectOption(companyId);
    await page
      .getByRole("button", { name: "Firmenkontext wechseln" })
      .click();
  }
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: `Guten Tag bei ${companyName}`,
    }),
  ).toBeVisible();
}

async function rebindPhase34PreviewCookiesForHttpLoopback(
  context: BrowserContext,
  baseUrl: string,
  requiredNames: readonly string[],
  optionalNames: readonly string[] = [],
) {
  const origin = new URL(baseUrl);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1") {
    throw new Error("PHASE34_PREVIEW_COOKIE_REBIND_REQUIRES_HTTP_LOOPBACK");
  }
  // Supplying an HTTP URL to context.cookies() intentionally filters Secure
  // cookies. Read the full jar, but accept values only from explicit loopback
  // domains and prefer the exact Preview hostname over localhost aliases.
  const cookies = await context.cookies();
  const selectCookie = (name: string) => {
    const candidates = cookies.filter(
      (candidate) =>
        candidate.name === name && isLoopbackCookieDomain(candidate.domain),
    );
    return (
      candidates.find(
        (candidate) => normalizeCookieDomain(candidate.domain) === origin.hostname,
      ) ?? candidates[0]
    );
  };
  const selected = requiredNames.map((name) => {
    const cookie = selectCookie(name);
    if (cookie === undefined) {
      throw new Error(`PHASE34_PREVIEW_COOKIE_MISSING:${name}`);
    }
    return cookie;
  });
  for (const name of optionalNames) {
    const cookie = selectCookie(name);
    if (cookie !== undefined) selected.push(cookie);
  }
  const secure = selected.filter((cookie) => cookie.secure);
  if (secure.length > 0) {
    // Production Preview remains HTTPS-only. This changes only the isolated
    // 127.0.0.1 browser cookie jar so Chromium, Firefox and WebKit exercise
    // the same genuine server-issued authenticated session over the gate's
    // deliberately non-TLS loopback transport.
    await context.addCookies(
      secure.map((cookie) => ({
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
  }
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
  for (const original of selected) {
    const cookie = rebound.find(
      (candidate) =>
        candidate.name === original.name &&
        normalizeCookieDomain(candidate.domain) === origin.hostname,
    );
    if (cookie === undefined || cookie.secure) {
      throw new Error(
        `PHASE34_PREVIEW_COOKIE_REBIND_FAILED:${original.name}`,
      );
    }
  }
}

function isLoopbackCookieDomain(domain: string) {
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
    normalizeCookieDomain(domain),
  );
}

function normalizeCookieDomain(domain: string) {
  return domain.replace(/^\./u, "").toLowerCase();
}

async function prepareLocalRadarAccess(database: Database, suffix: string) {
  const now = new Date();
  const validFrom = new Date(now.getTime() - 60_000);
  const validTo = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1_000);
  const [company, admin] = await Promise.all([
    database.company.findUniqueOrThrow({
      where: { slug: COMPANY_SLUG },
      select: { id: true, name: true },
    }),
    database.user.findUniqueOrThrow({
      where: { emailNormalized: DEMO_ACCOUNTS.admin },
      select: { id: true },
    }),
  ]);

  return database.$transaction(async (transaction) => {
    const entitlement = await transaction.entitlementGrant.create({
      data: {
        companyId: company.id,
        key: "TALENT_RADAR_ACCESS",
        valueType: "BOOLEAN",
        booleanValue: true,
        reasonCode: "PHASE34_RADAR_LEGAL_E2E",
        grantedByUserId: admin.id,
        validFrom,
        validTo,
        idempotencyKey: `phase34:radar-access:${suffix}`,
      },
      select: { id: true },
    });
    const account = await transaction.creditAccount.create({
      data: {
        companyId: company.id,
        creditType: "TALENT_CONTACT",
        fundingSource: "ADMIN_GRANT",
        periodStart: validFrom,
        periodEnd: validTo,
      },
      select: { id: true },
    });
    await transaction.creditLedgerEntry.create({
      data: {
        accountId: account.id,
        fundingSource: "ADMIN_GRANT",
        kind: "GRANT",
        amount: 1,
        validFrom,
        validTo,
        idempotencyKey: `phase34:radar-credit:${suffix}`,
        reasonCode: "PHASE34_RADAR_LEGAL_E2E",
        actorUserId: admin.id,
      },
    });
    return Object.freeze({
      companyId: company.id,
      companyName: company.name,
      entitlementGrantId: entitlement.id,
    });
  });
}

async function findContactableCardPosition(
  database: Database,
  input: Readonly<{
    cardCount: number;
    companyId: string;
    signedSearchSession: string;
  }>,
) {
  const encoded = input.signedSearchSession.split(".")[0];
  if (encoded === undefined) {
    throw new Error("The Radar search-session proof is malformed.");
  }
  const payload = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  ) as {
    searchSessionId?: unknown;
  };
  if (typeof payload.searchSessionId !== "string") {
    throw new Error("The Radar search-session ID is missing.");
  }
  const session = await database.radarSearchSession.findUniqueOrThrow({
    where: { id: payload.searchSessionId },
    select: {
      candidates: {
        where: { position: { lt: input.cardCount } },
        orderBy: { position: "asc" },
        select: { candidateProfileId: true, position: true },
      },
    },
  });
  const cooldownBoundary = new Date(Date.now() - COOLDOWN_MILLISECONDS);
  for (const candidate of session.candidates) {
    const blocked = await database.employerContactRequest.count({
      where: {
        companyId: input.companyId,
        candidateProfileId: candidate.candidateProfileId,
        OR: [{ status: "PENDING" }, { terminalAt: { gt: cooldownBoundary } }],
      },
    });
    if (blocked === 0) return candidate.position;
  }
  throw new Error(
    "No contactable Radar card remains for this browser project.",
  );
}

async function giveCandidateDemoCredential(
  database: Database,
  candidateUserId: string,
) {
  const credential = await database.credential.findFirstOrThrow({
    where: { user: { emailNormalized: DEMO_ACCOUNTS.candidate } },
    select: {
      passwordHash: true,
      algorithm: true,
      algorithmVersion: true,
      passwordChangedAt: true,
    },
  });
  await database.credential.upsert({
    where: { userId: candidateUserId },
    create: { userId: candidateUserId, ...credential },
    update: credential,
  });
}

async function radarReadBoundaryFingerprint(database: Database) {
  const [sessions, budgets, mappings] = await Promise.all([
    database.radarSearchSession.count(),
    database.radarSearchBudget.count(),
    database.radarOpaqueMapping.count(),
  ]);
  return Object.freeze({ sessions, budgets, mappings });
}

async function contactMutationFingerprint(
  database: Database,
  companyId: string,
  requestId: string,
) {
  const [request, companyConsumeCount, notificationIds, outboxIds, auditIds] =
    await Promise.all([
      database.employerContactRequest.findUniqueOrThrow({
        where: { id: requestId },
        select: {
          id: true,
          status: true,
          terminalAt: true,
          updatedAt: true,
          creditLedgerEntry: {
            select: { id: true, kind: true, amount: true },
          },
          events: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: { id: true, kind: true },
          },
          conversation: { select: { id: true } },
          revealGrant: { select: { id: true } },
        },
      }),
      database.creditLedgerEntry.count({
        where: {
          kind: "CONSUME",
          account: { companyId, creditType: "TALENT_CONTACT" },
        },
      }),
      database.notification.findMany({
        where: { dedupeKey: `contact:${requestId}:received` },
        orderBy: { id: "asc" },
        select: { id: true },
      }),
      database.notificationOutbox.findMany({
        where: { dedupeKey: `contact:${requestId}:email` },
        orderBy: { id: "asc" },
        select: { id: true, status: true },
      }),
      database.auditLog.findMany({
        where: { targetId: requestId, targetType: "CONTACT_REQUEST" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, action: true, result: true },
      }),
    ]);
  return Object.freeze({
    request,
    companyConsumeCount,
    notificationIds,
    outboxIds,
    auditIds,
  });
}

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required for the Phase 34 Radar browser test.`);
  }
  return value;
}
