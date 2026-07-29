import type {
  Browser,
  Cookie,
  Page,
  Response,
  TestInfo,
} from "@playwright/test";

import routeInventoryJson from "@/codex-plan/route-inventory.json" with {
  type: "json",
};
import {
  assertCriticalAccessibility,
  assertKeyboardFocusVisible,
  assertNoViewportClipping,
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  login,
  observePage,
  phase17Database,
  test,
  type PageObservation,
} from "@/tests/e2e/fixtures/phase17-test";

const EXPECTED_PAGE_COUNT = 129;
const EXPECTED_HANDLER_COUNT = 20;
const ROUTE_TEST_TIMEOUT_MILLISECONDS = 90_000;
const QUALITY_TAGS = "@quality-desktop @quality-mobile";
const MISSING_UUID = "00000000-0000-4000-8000-000000000018";
const MISSING_SLUG = "phase18-route-audit-missing";
const INVALID_TOKEN = "phase18-route-audit-invalid-token";

const RAW_ERROR_PATTERNS = Object.freeze([
  /Application error: a client-side exception has occurred/iu,
  /Internal Server Error/iu,
  /Unhandled Runtime Error/iu,
  /PrismaClient(?:KnownRequest)?Error/iu,
  /\b(?:TypeError|ReferenceError|SyntaxError):\s/iu,
  /\bECONN(?:REFUSED|RESET)\b/iu,
]);

type RouteKind = "page" | "handler";
type RouteRole =
  | "PUBLIC"
  | "PUBLIC_OPERATIONS"
  | "LOCAL_OPS_TOKEN"
  | "AUTHENTICATED"
  | "CANDIDATE"
  | "EMPLOYER"
  | "RECRUITER"
  | "ADMIN";
type InventoryRoute = Readonly<{
  kind: RouteKind;
  path: string;
  roles: readonly RouteRole[];
}>;
type PageRoute = InventoryRoute & Readonly<{ kind: "page" }>;
type RouteActor = "public" | "candidate" | "employer" | "admin";
type AuthenticatedActor = Exclude<RouteActor, "public">;
type ActorCookies = Readonly<
  Record<AuthenticatedActor, readonly Cookie[]>
>;
type RouteCase = Readonly<{
  actor: RouteActor;
  inventoryPath: string;
  requestPath: string;
}>;

const ROUTE_INVENTORY = parseRouteInventory(routeInventoryJson);
const PAGE_ROUTES = Object.freeze(
  ROUTE_INVENTORY.filter(
    (route): route is PageRoute => route.kind === "page",
  ),
);
const HANDLER_ROUTES = Object.freeze(
  ROUTE_INVENTORY.filter((route) => route.kind === "handler"),
);
const ROUTE_CASES = Object.freeze(PAGE_ROUTES.map(toRouteCase));

let actorCookies: ActorCookies | undefined;

test.describe("Phase 18 exhaustive route quality", () => {
  test.beforeAll(async ({ browser }, testInfo) => {
    await clearIsolatedLoginRateLimitBuckets();
    const baseURL = requiredLoopbackBaseUrl(testInfo);
    actorCookies = Object.freeze({
      candidate: await authenticateActor(
        browser,
        baseURL,
        DEMO_ACCOUNTS.candidate,
      ),
      employer: await authenticateActor(
        browser,
        baseURL,
        DEMO_ACCOUNTS.employer,
      ),
      admin: await authenticateActor(
        browser,
        baseURL,
        DEMO_ACCOUNTS.admin,
      ),
    });
  });

  test.afterAll(async () => {
    await clearIsolatedLoginRateLimitBuckets();
  });

  test(
    `${QUALITY_TAGS} route inventory is exactly ${EXPECTED_PAGE_COUNT} pages, tracks ${EXPECTED_HANDLER_COUNT} handlers and excludes handlers from page visits`,
    async ({ page }, testInfo) => {
      testInfo.setTimeout(ROUTE_TEST_TIMEOUT_MILLISECONDS);
      assertProjectViewport(page, testInfo);
      assertExhaustiveInventoryContract();
    },
  );

  for (const route of ROUTE_CASES) {
    test(
      `${QUALITY_TAGS} page ${route.inventoryPath}`,
      async ({ page, pageObservation }, testInfo) => {
        testInfo.setTimeout(ROUTE_TEST_TIMEOUT_MILLISECONDS);
        assertProjectViewport(page, testInfo);
        await applyActorSession(page, route.actor);
        await auditRoute(page, pageObservation, route, testInfo);
      },
    );
  }
});

async function auditRoute(
  page: Page,
  observation: PageObservation,
  route: RouteCase,
  testInfo: TestInfo,
) {
  observation.clear();
  const sameOriginServerFailures: string[] = [];
  const origin = requiredLoopbackBaseUrl(testInfo).origin;
  const responseListener = (response: Response) => {
    if (
      new URL(response.url()).origin === origin &&
      response.status() >= 500
    ) {
      sameOriginServerFailures.push(
        `${response.status()} ${new URL(response.url()).pathname}`,
      );
    }
  };
  page.on("response", responseListener);

  try {
    const response = await page.goto(route.requestPath, {
      waitUntil: "load",
    });
    expect(
      response,
      `${route.inventoryPath} did not produce a document response`,
    ).not.toBeNull();
    expect(
      response!.status(),
      `${route.inventoryPath} returned HTTP ${response!.status()}`,
    ).toBeLessThan(500);

    await expect(page.locator("body")).toBeVisible();
    await settleRenderedPage(page);
    await assertNoRawErrorSurface(page, route.inventoryPath);
    await assertCriticalAccessibility(page);
    await assertNoViewportClipping(page);
    await assertKeyboardFocusVisible(page);

    expect(
      sameOriginServerFailures,
      `${route.inventoryPath} emitted same-origin 5xx responses`,
    ).toEqual([]);
    observation.assertClean();
  } finally {
    page.off("response", responseListener);
  }
}

function assertExhaustiveInventoryContract() {
  const pagePaths = PAGE_ROUTES.map(({ path }) => path);
  const handlerPaths = HANDLER_ROUTES.map(({ path }) => path);
  const exercisedPaths = ROUTE_CASES.map(({ inventoryPath }) => inventoryPath);

  expect(PAGE_ROUTES).toHaveLength(EXPECTED_PAGE_COUNT);
  expect(HANDLER_ROUTES).toHaveLength(EXPECTED_HANDLER_COUNT);
  expect(new Set(pagePaths).size).toBe(EXPECTED_PAGE_COUNT);
  expect(new Set(handlerPaths).size).toBe(EXPECTED_HANDLER_COUNT);
  expect(exercisedPaths).toEqual(pagePaths);
  expect(
    exercisedPaths.filter((path) => handlerPaths.includes(path)),
  ).toEqual([]);
}

async function applyActorSession(page: Page, actor: RouteActor) {
  if (actor === "public") return;
  if (actorCookies === undefined) {
    throw new Error("All-routes actor sessions were not initialized.");
  }
  await page.context().addCookies([...actorCookies[actor]]);
}

async function authenticateActor(
  browser: Browser,
  baseURL: URL,
  email: string,
): Promise<readonly Cookie[]> {
  const context = await browser.newContext({
    baseURL: baseURL.href,
    locale: "de-CH",
    timezoneId: "Europe/Zurich",
    viewport: { width: 1_440, height: 900 },
    colorScheme: "light",
    serviceWorkers: "block",
  });
  try {
    const page = await context.newPage();
    const observation = await observePage(page);
    await login(page, email, DEMO_PASSWORD);
    observation.assertClean();
    return Object.freeze(await context.cookies());
  } finally {
    await context.close();
  }
}

function toRouteCase(route: PageRoute): RouteCase {
  const actor = actorFor(route);
  assertActorMatchesInventory(route, actor);
  return Object.freeze({
    actor,
    inventoryPath: route.path,
    requestPath: substituteDynamicSegments(route.path),
  });
}

function actorFor(route: PageRoute): RouteActor {
  if (route.path === "/support" || route.path.startsWith("/support/")) {
    return "candidate";
  }
  if (route.path === "/mock/checkout/[orderId]") return "employer";
  if (route.path === "/admin" || route.path.startsWith("/admin/")) {
    return "admin";
  }
  if (route.path.startsWith("/candidate/")) return "candidate";
  if (route.path.startsWith("/employer/")) return "employer";
  return "public";
}

function assertActorMatchesInventory(route: PageRoute, actor: RouteActor) {
  const expectedRole: Readonly<Record<RouteActor, RouteRole>> = {
    public: "PUBLIC",
    candidate: "CANDIDATE",
    employer: "EMPLOYER",
    admin: "ADMIN",
  };
  if (!route.roles.includes(expectedRole[actor])) {
    throw new Error(
      `${route.path} cannot be audited as ${actor}; inventory roles are ${route.roles.join(", ")}.`,
    );
  }
}

function substituteDynamicSegments(path: string) {
  const substituted = path.replaceAll(
    /\[([A-Za-z][A-Za-z0-9]*)\]/gu,
    (_match, segment: string) =>
      encodeURIComponent(safeInvalidSegmentValue(segment)),
  );
  if (/[[\]]/u.test(substituted)) {
    throw new Error(`Dynamic route substitution is incomplete for ${path}.`);
  }
  return substituted;
}

function safeInvalidSegmentValue(segment: string) {
  if (["id", "threadId", "orderId", "interviewId"].includes(segment)) {
    return MISSING_UUID;
  }
  if (segment === "token") return INVALID_TOKEN;
  if (["slug", "category"].includes(segment)) return MISSING_SLUG;
  throw new Error(`No reviewed safe invalid value exists for [${segment}].`);
}

async function assertNoRawErrorSurface(page: Page, route: string) {
  const bodyText = await page.locator("body").innerText();
  for (const pattern of RAW_ERROR_PATTERNS) {
    expect(
      bodyText,
      `${route} rendered a raw framework/runtime error matching ${pattern.source}`,
    ).not.toMatch(pattern);
  }
  await expect(
    page.locator("nextjs-portal"),
    `${route} rendered the Next.js development error overlay`,
  ).toHaveCount(0);
}

async function settleRenderedPage(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

function assertProjectViewport(page: Page, testInfo: TestInfo) {
  const expected =
    testInfo.project.name === "chromium-mobile-360"
      ? { width: 360, height: 800 }
      : testInfo.project.name === "chromium-journeys"
        ? { width: 1_440, height: 900 }
        : null;
  if (expected === null) {
    throw new Error(
      `All-routes quality does not recognize project ${testInfo.project.name}.`,
    );
  }
  expect(page.viewportSize()).toEqual(expected);
}

function requiredLoopbackBaseUrl(testInfo: TestInfo) {
  const value = testInfo.project.use.baseURL;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("All-routes quality requires a Playwright baseURL.");
  }
  const url = new URL(value);
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) {
    throw new Error("All-routes quality permits only a loopback baseURL.");
  }
  return url;
}

async function clearIsolatedLoginRateLimitBuckets() {
  const database = phase17Database();
  try {
    await database.rateLimitBucket.deleteMany({
      where: { namespace: { startsWith: "v1:LOGIN:" } },
    });
  } finally {
    await database.$disconnect();
  }
}

function parseRouteInventory(value: unknown): readonly InventoryRoute[] {
  if (!Array.isArray(value)) {
    throw new Error("Route inventory must be an array.");
  }
  return Object.freeze(
    value.map((entry, index) => {
      if (
        typeof entry !== "object" ||
        entry === null ||
        !("kind" in entry) ||
        !("path" in entry) ||
        !("roles" in entry) ||
        (entry.kind !== "page" && entry.kind !== "handler") ||
        typeof entry.path !== "string" ||
        !entry.path.startsWith("/") ||
        !Array.isArray(entry.roles) ||
        !entry.roles.every(isRouteRole)
      ) {
        throw new Error(`Route inventory entry ${index} is invalid.`);
      }
      return Object.freeze({
        kind: entry.kind,
        path: entry.path,
        roles: Object.freeze([...entry.roles]),
      });
    }),
  );
}

function isRouteRole(value: unknown): value is RouteRole {
  return (
    typeof value === "string" &&
    [
      "PUBLIC",
      "PUBLIC_OPERATIONS",
      "LOCAL_OPS_TOKEN",
      "AUTHENTICATED",
      "CANDIDATE",
      "EMPLOYER",
      "RECRUITER",
      "ADMIN",
    ].includes(value)
  );
}
