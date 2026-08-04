import { randomUUID } from "node:crypto";

import type { Page, Request, Response, Route } from "@playwright/test";

import {
  assertCriticalAccessibility,
  assertKeyboardFocusVisible,
  assertNoViewportClipping,
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  openActor,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";
import { createPrismaSessionStore } from "@/lib/auth/session-store";
import {
  hashSessionToken,
  rotateSession,
  SESSION_POLICY_V1,
} from "@/lib/auth/session";
import type { SecretHandle } from "@/lib/config/env-schema";
import {
  SESSION_REFRESH_STATE_HEADER,
  SESSION_REFRESH_STATES,
} from "@/lib/auth/session-refresh-contract";

test.describe.configure({ mode: "serial" });

// A user-visible Save must reach a terminal UI state within one bounded
// interaction window. Backend retries never authorize a second browser click.
const SAVE_CONFIRMATION_TIMEOUT_MILLISECONDS = 30_000;
const PUBLIC_JOB_ANALYTICS_ROUTE = "**/api/analytics/public-jobs";

test("[P33-AC-10][P33-AC-14] @journey public discovery persists a private save and an owned alert without role leakage", async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  const database = phase17Database();
  let sessionRefreshRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/session/refresh") {
      sessionRefreshRequests += 1;
    }
  });
  let wrongRole: Awaited<ReturnType<typeof openActor>> | undefined;
  try {
    const candidate = await database.user.findUniqueOrThrow({
      where: { emailNormalized: DEMO_ACCOUNTS.candidate },
      select: {
        id: true,
        candidateProfile: { select: { id: true } },
      },
    });
    expect(candidate.candidateProfile).not.toBeNull();
    const job = await findPublicUnsavedJob(
      page,
      candidate.candidateProfile!.id,
    );

    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/jobs?keyword=${encodeURIComponent(job.title)}`);
    await expect(
      page.getByRole("heading", {
        name: "Finde deinen nächsten fairen Job.",
      }),
    ).toBeVisible();
    const result = page.locator(`a[href="/jobs/${job.slug}"]`).first();
    await expect(result).toHaveText(job.title);
    await assertAccessibleAndOperable(page);

    await result.click();
    await expect(
      page.getByRole("heading", { level: 1, name: job.title }),
    ).toBeVisible();
    await saveButton(page, job.slug).click();
    await expect(page).toHaveURL(/\/login\?next=/u);
    await loginCurrentPage(page, DEMO_ACCOUNTS.candidate, DEMO_PASSWORD);
    await expect(
      page.getByRole("heading", { level: 2, name: "Stelle speichern" }),
    ).toBeVisible();
    await confirmSaveAndExpectTerminalState(page, job.slug);
    await expect(
      page.getByRole("status").filter({
        hasText: "Die Stelle wurde in deiner privaten Merkliste gespeichert.",
      }),
    ).toBeVisible();
    assertScrubbedSavedJobUrl(page, job.slug);
    await page.getByRole("link", { name: "Private Merkliste öffnen" }).click();
    await expect(page).toHaveURL(/\/candidate\/saved-jobs(?:\?|$)/u);
    await page.goBack();
    await expect(
      page.getByRole("heading", { level: 1, name: job.title }),
    ).toBeVisible();
    assertScrubbedSavedJobUrl(page, job.slug);
    expect(sessionRefreshRequests).toBe(0);

    const sessionCookie = (await page.context().cookies()).find(
      (cookie) => cookie.name === SESSION_POLICY_V1.cookieName,
    );
    if (sessionCookie === undefined) {
      throw new Error("The authenticated candidate session cookie is missing.");
    }
    const originalTokenHash = hashSessionToken(sessionCookie.value);
    const originalSession = await database.session.findUniqueOrThrow({
      where: { tokenHash: originalTokenHash },
      select: {
        id: true,
        userId: true,
        pendingTokenHash: true,
        absoluteExpiresAt: true,
      },
    });
    expect(originalSession).toMatchObject({
      userId: candidate.id,
      pendingTokenHash: null,
    });
    const dueClock = new Date();
    await database.session.update({
      where: { id: originalSession.id },
      data: {
        createdAt: new Date(
          dueClock.getTime() -
            SESSION_POLICY_V1.rotationAgeMilliseconds -
            1_000,
        ),
        rotatedAt: null,
      },
    });

    // Stage the successor without writing it into the browser cookie jar. This
    // models a lost Set-Cookie response without putting the raw HttpOnly bearer
    // into Playwright request traces. The real browser route must idempotently
    // re-stage that same successor and immediately confirm it.
    const staged = await rotateSession(sessionCookie.value, {
      store: createPrismaSessionStore(database),
      clock: { now: dueClock },
      rotationKey: sessionRotationKey(),
    });
    if (staged === null) {
      throw new Error("The due candidate session was not staged for rotation.");
    }
    const stagedTokenHash = hashSessionToken(staged.token);
    await expect(
      database.session.findUniqueOrThrow({
        where: { id: originalSession.id },
        select: { tokenHash: true, pendingTokenHash: true, rotatedAt: true },
      }),
    ).resolves.toEqual({
      tokenHash: originalTokenHash,
      pendingTokenHash: stagedTokenHash,
      rotatedAt: null,
    });
    const unchangedBrowserCookie = (await page.context().cookies()).find(
      (cookie) => cookie.name === SESSION_POLICY_V1.cookieName,
    );
    expect(
      unchangedBrowserCookie === undefined
        ? null
        : hashSessionToken(unchangedBrowserCookie.value),
    ).toBe(originalTokenHash);

    const refreshDuringNavigation = await holdNextSessionRefresh(page);
    try {
      await page.goto("/candidate/saved-jobs");
      await refreshDuringNavigation.waitUntilBlocked();
      await page.goto(`/jobs/${job.slug}`);
      await expect(
        page.getByRole("heading", { level: 1, name: job.title }),
      ).toBeVisible();
    } finally {
      await refreshDuringNavigation.releaseAndRemove();
    }
    expect(sessionRefreshRequests).toBe(1);
    const cookieAfterPageHide = (await page.context().cookies()).find(
      (cookie) => cookie.name === SESSION_POLICY_V1.cookieName,
    );
    expect(
      cookieAfterPageHide === undefined
        ? null
        : hashSessionToken(cookieAfterPageHide.value),
    ).toBe(originalTokenHash);

    const refreshResponses: string[] = [];
    const observeRefreshResponse = (response: Response) => {
      if (new URL(response.url()).pathname !== "/session/refresh") return;
      const headers = response.headers();
      refreshResponses.push(
        `${response.status()}:${headers[SESSION_REFRESH_STATE_HEADER.toLowerCase()] ?? "NONE"}`,
      );
    };
    page.on("response", observeRefreshResponse);
    await page.goto("/candidate/saved-jobs");
    await expect(page).toHaveURL(/\/candidate\/saved-jobs(?:\?|$)/u);
    await expect
      .poll(() => refreshResponses, { timeout: 15_000 })
      .toEqual([
        `204:${SESSION_REFRESH_STATES.staged}`,
        `204:${SESSION_REFRESH_STATES.current}`,
      ]);
    page.off("response", observeRefreshResponse);

    const currentBrowserCookie = (await page.context().cookies()).find(
      (cookie) => cookie.name === SESSION_POLICY_V1.cookieName,
    );
    if (currentBrowserCookie === undefined) {
      throw new Error("The confirmed candidate session cookie is missing.");
    }
    const currentTokenHash = hashSessionToken(currentBrowserCookie.value);
    expect(currentTokenHash).toBe(stagedTokenHash);
    expect(currentTokenHash).not.toBe(originalTokenHash);
    await expect(
      database.session.findUniqueOrThrow({
        where: { id: originalSession.id },
        select: {
          tokenHash: true,
          pendingTokenHash: true,
          previousTokenHash: true,
          rotatedAt: true,
        },
      }),
    ).resolves.toEqual({
      tokenHash: currentTokenHash,
      pendingTokenHash: null,
      previousTokenHash: originalTokenHash,
      rotatedAt: expect.any(Date),
    });
    expect(sessionRefreshRequests).toBe(3);
    await page.goBack();
    await expect(
      page.getByRole("heading", { level: 1, name: job.title }),
    ).toBeVisible();
    expect(sessionRefreshRequests).toBe(3);

    const saved = await database.savedJob.findUniqueOrThrow({
      where: {
        candidateProfileId_jobId: {
          candidateProfileId: candidate.candidateProfile!.id,
          jobId: job.id,
        },
      },
      select: { id: true },
    });
    // JOB_SAVED is optional product analytics. The save is deliberately
    // persisted without silently opting this candidate into analytics.
    expect(
      await database.analyticsEvent.count({
        where: {
          producer: "candidate-saved-job",
          dedupeKey: `JOB_SAVED:${saved.id}`,
        },
      }),
    ).toBe(0);

    // A second signed confirmation is a real replay through the public UI. The
    // database uniqueness contract must still represent exactly one private
    // save, while privacy-safe analytics remain absent.
    await page.goto("/candidate/saved-jobs");
    await expect(
      page.getByRole("heading", { level: 1, name: "Gespeicherte Jobs" }),
    ).toBeVisible();
    expect(sessionRefreshRequests).toBe(3);
    const analyticsHold = await holdNextJobDetailAnalytics(page);
    try {
      await page.goto(`/jobs/${job.slug}`);
      await expect(
        page.getByRole("heading", { level: 1, name: job.title }),
      ).toBeVisible();
      await analyticsHold.waitUntilBlocked();
      await saveButton(page, job.slug).click();
      await expect(
        page.getByRole("heading", { level: 2, name: "Stelle speichern" }),
      ).toBeVisible();
      await confirmSaveAndExpectTerminalState(page, job.slug);
      await expect(
        page.getByRole("status").filter({
          hasText: "Die Stelle wurde in deiner privaten Merkliste gespeichert.",
        }),
      ).toBeVisible();
      expect(analyticsHold.isBlocked()).toBe(true);
    } finally {
      await analyticsHold.releaseAndRemove();
    }
    expect(
      await database.savedJob.count({
        where: {
          candidateProfileId: candidate.candidateProfile!.id,
          jobId: job.id,
        },
      }),
    ).toBe(1);
    expect(
      await database.analyticsEvent.count({
        where: {
          producer: "candidate-saved-job",
          dedupeKey: `JOB_SAVED:${saved.id}`,
        },
      }),
    ).toBe(0);

    const alertKeyword = `Phase 33 ${randomUUID().slice(0, 8)}`;
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/candidate/alerts");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Passende Stellen im Blick behalten",
      }),
    ).toBeVisible();
    const alertForm = page.locator("form").filter({
      has: page.getByRole("button", { name: "Jobabo erstellen" }),
    });
    await alertForm.getByLabel("Suchbegriff").fill(alertKeyword);
    await alertForm.getByLabel("Dieses Jobabo ausdrücklich aktivieren").check();
    await alertForm.getByLabel(/per Service-E-Mail erhalten/u).check();
    await alertForm.getByRole("button", { name: "Jobabo erstellen" }).click();
    await expect(
      page.getByRole("status").filter({
        hasText: "Jobabo erstellt und ausdrücklich aktiviert.",
      }),
    ).toBeVisible();
    await assertAccessibleAndOperable(page);

    const alert = await database.jobAlert.findFirstOrThrow({
      where: {
        candidateProfileId: candidate.candidateProfile!.id,
        query: { path: ["keyword"], equals: alertKeyword },
      },
      select: {
        id: true,
        status: true,
        events: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { kind: true, actorUserId: true, reasonCode: true },
        },
      },
    });
    expect(alert).toMatchObject({
      status: "ACTIVE",
      events: [
        {
          kind: "CREATED",
          actorUserId: candidate.id,
          reasonCode: "EXPLICIT_ACTIVATION",
        },
      ],
    });

    wrongRole = await openActor(browser, DEMO_ACCOUNTS.employer);
    const denied = await wrongRole.context.request.get("/candidate/alerts", {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect(denied.status()).toBe(403);
    expect(await denied.text()).not.toContain(alertKeyword);
    await expect(
      database.jobAlert.findUnique({
        where: { id: alert.id },
        select: { status: true, candidateProfileId: true },
      }),
    ).resolves.toEqual({
      status: "ACTIVE",
      candidateProfileId: candidate.candidateProfile!.id,
    });
  } finally {
    await wrongRole?.close();
    await database.$disconnect();
  }
});

async function findPublicUnsavedJob(page: Page, candidateProfileId: string) {
  const database = phase17Database();
  try {
    const candidates = await database.job.findMany({
      where: {
        status: "PUBLISHED",
        publishedRevisionId: { not: null },
        savedBy: { none: { candidateProfileId } },
      },
      orderBy: [{ publishedAt: "asc" }, { id: "asc" }],
      take: 50,
      select: {
        id: true,
        slug: true,
        publishedRevision: { select: { title: true } },
      },
    });
    for (const candidate of candidates) {
      const title = candidate.publishedRevision?.title;
      if (title === undefined) continue;
      const response = await page.request.get(`/jobs/${candidate.slug}`, {
        failOnStatusCode: false,
      });
      if (
        response.status() === 200 &&
        (await response.text()).includes(title)
      ) {
        return Object.freeze({
          id: candidate.id,
          slug: candidate.slug,
          title,
        });
      }
    }
    throw new Error(
      "Phase 33 requires one publicly visible unsaved seeded Job.",
    );
  } finally {
    await database.$disconnect();
  }
}

async function loginCurrentPage(page: Page, email: string, password: string) {
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sicher anmelden" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
}

function saveButton(page: Page, jobSlug: string) {
  return page.locator(
    `form:has(input[name="jobSlug"][value="${jobSlug}"]):has(input[name="action"][value="SAVE"]) button[type="submit"]`,
  );
}

async function confirmSaveAndExpectTerminalState(page: Page, jobSlug: string) {
  const confirmationForm = page.locator('form:has(input[name="signedIntent"])');
  await confirmationForm
    .getByRole("button", { name: "Jetzt speichern" })
    .click();

  const savedUrl = new RegExp(`/jobs/${jobSlug}\\?saved=1(?:&|$)`, "u");
  const successStatus = page.getByRole("status").filter({
    hasText: "Die Stelle wurde in deiner privaten Merkliste gespeichert.",
  });
  const actionAlert = confirmationForm.getByRole("alert").first();
  const deadline = Date.now() + SAVE_CONFIRMATION_TIMEOUT_MILLISECONDS;
  let lastState = "AWAITING_ACTION_RESULT";
  while (Date.now() < deadline) {
    if (
      savedUrl.test(page.url()) &&
      (await successStatus.isVisible().catch(() => false))
    )
      return;
    if (await successStatus.isVisible().catch(() => false)) {
      lastState = "SUCCESS_WITH_UNSCRUBBED_URL";
      await page.waitForTimeout(100);
      continue;
    }
    if (await actionAlert.isVisible().catch(() => false)) {
      const message = (await actionAlert.textContent())
        ?.replaceAll(/\s+/gu, " ")
        .trim()
        .slice(0, 240);
      throw new Error(
        `Save confirmation was rejected for ${jobSlug}: ${message ?? "GENERIC_ACTION_ERROR"}.`,
      );
    }
    const pending = await confirmationForm
      .getByRole("button", { name: "Wird gespeichert …" })
      .isVisible()
      .catch(() => false);
    lastState = pending ? "PENDING" : "AWAITING_ACTION_RESULT";
    await page.waitForTimeout(100);
  }
  throw new Error(
    `Save confirmation did not reach a terminal state for ${jobSlug}; last state ${lastState}.`,
  );
}

function assertScrubbedSavedJobUrl(page: Page, jobSlug: string) {
  const url = new URL(page.url());
  expect(url.pathname).toBe(`/jobs/${jobSlug}`);
  expect(url.searchParams.get("saved")).toBe("1");
  expect(url.searchParams.has("intent")).toBe(false);
  expect(url.searchParams.has("signedIntent")).toBe(false);
}

async function holdNextJobDetailAnalytics(page: Page) {
  let blocked = false;
  let releasedRequest = false;
  let completionError: unknown;
  let releaseRequest: (() => void) | undefined;
  let signalBlocked: (() => void) | undefined;
  let signalHandlerCompleted: (() => void) | undefined;
  const blockedRequest = new Promise<void>((resolveBlocked) => {
    signalBlocked = resolveBlocked;
  });
  const released = new Promise<void>((resolveReleased) => {
    releaseRequest = resolveReleased;
  });
  const handlerCompleted = new Promise<void>((resolveCompleted) => {
    signalHandlerCompleted = resolveCompleted;
  });

  const handler = async (route: Route, request: Request) => {
    let kind: unknown;
    try {
      kind = (request.postDataJSON() as { kind?: unknown }).kind;
    } catch {
      await route.continue();
      return;
    }
    if (blocked || kind !== "JOB_DETAIL_VIEWED") {
      await route.continue();
      return;
    }
    blocked = true;
    signalBlocked?.();
    await released;
    try {
      await route.fulfill({
        status: 204,
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      });
    } catch (error) {
      completionError = error;
    } finally {
      signalHandlerCompleted?.();
    }
  };
  await page.route(PUBLIC_JOB_ANALYTICS_ROUTE, handler);

  return Object.freeze({
    isBlocked() {
      return blocked && !releasedRequest;
    },
    async releaseAndRemove() {
      releasedRequest = true;
      releaseRequest?.();
      if (blocked) await handlerCompleted;
      await page.unroute(PUBLIC_JOB_ANALYTICS_ROUTE, handler);
      if (completionError !== undefined) throw completionError;
    },
    async waitUntilBlocked() {
      await new Promise<void>((resolveBlocked, rejectBlocked) => {
        const timeout = setTimeout(
          () =>
            rejectBlocked(
              new Error("Job-detail analytics request did not start."),
            ),
          10_000,
        );
        void blockedRequest.then(() => {
          clearTimeout(timeout);
          resolveBlocked();
        });
      });
    },
  });
}

async function holdNextSessionRefresh(page: Page) {
  let blocked = false;
  let releaseRequest: (() => void) | undefined;
  let signalBlocked: (() => void) | undefined;
  let signalHandlerCompleted: (() => void) | undefined;
  const blockedRequest = new Promise<void>((resolveBlocked) => {
    signalBlocked = resolveBlocked;
  });
  const released = new Promise<void>((resolveReleased) => {
    releaseRequest = resolveReleased;
  });
  const handlerCompleted = new Promise<void>((resolveCompleted) => {
    signalHandlerCompleted = resolveCompleted;
  });
  const routePattern = "**/session/refresh";
  const handler = async (route: Route) => {
    if (blocked) {
      await route.continue();
      return;
    }
    blocked = true;
    signalBlocked?.();
    await released;
    try {
      await route.fulfill({
        status: 204,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          [SESSION_REFRESH_STATE_HEADER]: SESSION_REFRESH_STATES.current,
        },
      });
    } catch {
      // Navigation may already have cancelled the old document's request. The
      // browser observation asserts that this produces no uncaught page error.
    } finally {
      signalHandlerCompleted?.();
    }
  };
  await page.route(routePattern, handler);

  return Object.freeze({
    async releaseAndRemove() {
      releaseRequest?.();
      if (blocked) await handlerCompleted;
      await page.unroute(routePattern, handler);
    },
    async waitUntilBlocked() {
      await new Promise<void>((resolveBlocked, rejectBlocked) => {
        const timeout = setTimeout(
          () =>
            rejectBlocked(
              new Error(
                "Session refresh request did not start before navigation.",
              ),
            ),
          10_000,
        );
        void blockedRequest.then(() => {
          clearTimeout(timeout);
          resolveBlocked();
        });
      });
    },
  });
}

async function assertAccessibleAndOperable(page: Page) {
  const accessibility = await assertCriticalAccessibility(page);
  expect(
    accessibility.serious,
    JSON.stringify(accessibility.seriousViolations),
  ).toBe(0);
  await assertNoViewportClipping(page);
  await assertKeyboardFocusVisible(page);
}

function sessionRotationKey(): SecretHandle<"SESSION_SECRET"> {
  const encodedKey = process.env.SESSION_SECRET;
  if (encodedKey === undefined || encodedKey.length === 0) {
    throw new Error(
      "SESSION_SECRET is required for the session rotation proof.",
    );
  }
  return {
    withValue: <T>(consumer: (value: string) => T) => consumer(encodedKey),
  } as SecretHandle<"SESSION_SECRET">;
}
