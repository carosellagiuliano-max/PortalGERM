import { spawn, type ChildProcessByStdio } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import type { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

import { CANTON_FIXTURES } from "@/prisma/seed/fixtures/cantons";
import { CATEGORY_FIXTURES } from "@/prisma/seed/fixtures/categories";
import {
  buildJobFixtures,
  COMPANY_FIXTURES,
  DEMO_ACCOUNT_FIXTURES,
} from "@/prisma/seed/fixtures/companies-jobs";
import { DEMO_GUIDE_FIXTURES } from "@/prisma/seed/fixtures/content";
import { runDemoSeed } from "@/prisma/seed/orchestrator";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";
import { createDatabaseClient } from "@/lib/db/factory";
import { createSession } from "@/lib/auth/session";
import { createPrismaSessionStore } from "@/lib/auth/session-store";

const HOST = "127.0.0.1";
const DEFAULT_START_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_DIAGNOSTIC_CHARACTERS = 24_000;
const NOINDEX_POLICY = "noindex, nofollow, noarchive, nosnippet";
const PRODUCTION_HSTS_VALUE =
  "max-age=63072000; includeSubDomains; preload";
const EXPECT_STATIC_PUBLIC_INDEXING =
  process.env.HTTP_SMOKE_STATIC_PUBLIC_INDEXING === "true";
const HTTP_SMOKE_BUILD_ID = "phase16-http-smoke";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type ChildExit = Readonly<{
  code: number | null;
  signal: NodeJS.Signals | null;
}>;

type SmokeChild = ChildProcessByStdio<null, Readable, Readable>;
type SmokeMode = "local-full" | "production-hsts";

await main(resolveSmokeMode());

async function main(mode: SmokeMode) {
  try {
    const result = await runSmoke(mode);
    console.info(
      mode === "production-hsts"
        ? `Production-like HSTS smoke passed on ${result.baseUrl}: next start emitted Strict-Transport-Security exactly as configured. The loopback request is intentionally plain HTTP and proves header emission only, not browser-side TLS/HSTS enforcement.`
        : `HTTP smoke passed on ${result.baseUrl}: public routes, CSP nonce/hydration, Phase-15 robots/sitemap policy, sensitive-route privacy, health, anonymous auth redirects and protected response headers verified.`,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "HTTP smoke failed.";
    console.error(redactDiagnostics(message));
    process.exitCode = 1;
  }
}

async function runSmoke(mode: SmokeMode) {
  const buildIdPath = resolve(process.cwd(), ".next", "BUILD_ID");
  if (mode === "local-full" && !existsSync(buildIdPath)) {
    throw new Error(
      "No production build found at .next/BUILD_ID. Run `npm run build` before the HTTP smoke.",
    );
  }

  const database = await createMigratedTestDatabase("phase07_http_smoke");
  try {
    await runDemoSeed({
      APP_ENV: "local",
      DATABASE_URL: database.connectionString,
      ENABLE_DEMO_SEED: "true",
    });
    if (mode === "production-hsts") {
      await buildProductionHstsArtifact(database.connectionString);
    }
    return await runHttpSmoke(database.connectionString, mode);
  } finally {
    await database.dispose();
  }
}

async function runHttpSmoke(databaseUrl: string, mode: SmokeMode) {
  const port = await resolvePort();
  const baseUrl = `http://${HOST}:${port}`;
  const secretCanary =
    process.env.HTTP_SMOKE_SECRET_CANARY ??
    "smoke-secret-canary-7f37f395f3834b30a193";
  const startTimeout = parsePositiveInteger(
    "HTTP_SMOKE_START_TIMEOUT_MS",
    process.env.HTTP_SMOKE_START_TIMEOUT_MS,
    DEFAULT_START_TIMEOUT_MS,
  );
  const candidateSessionToken =
    mode === "local-full"
      ? await createCandidateSmokeSession(databaseUrl)
      : undefined;

  const nextBinary = resolve(
    process.cwd(),
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );
  if (!existsSync(nextBinary)) {
    throw new Error("The local Next.js CLI was not found. Run `npm ci` first.");
  }

  const childEnvironment: NodeJS.ProcessEnv =
    mode === "production-hsts"
      ? productionHstsEnvironment(databaseUrl, secretCanary)
      : {
          ...process.env,
          APP_ENV: "local",
          NODE_ENV: "production",
          APP_URL: baseUrl,
          APP_BUILD_ID: HTTP_SMOKE_BUILD_ID,
          DATABASE_URL: databaseUrl,
          TEST_DATABASE_URL: "",
          RATE_LIMIT_BACKEND: "postgres",
          TRUSTED_PROXY_HOPS: "0",
          ENABLE_LOCAL_MOCK_MAILBOX: "false",
          DEV_MAILBOX_SECRET: secretCanary,
          HTTP_SMOKE_SECRET_CANARY: secretCanary,
          NEXT_TELEMETRY_DISABLED: "1",
        };
  const child = spawn(
    process.execPath,
    [nextBinary, "start", "--hostname", HOST, "--port", String(port)],
    {
      cwd: process.cwd(),
      env: childEnvironment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  const exit = new Promise<ChildExit>((resolveExit) => {
    child.once("exit", (code: number | null, signal: NodeJS.Signals | null) =>
      resolveExit({ code, signal }),
    );
  });
  let diagnostics = "";
  let secretLeakDetected = false;

  const recordOutput = (chunk: Buffer | string) => {
    const output = chunk.toString();
    secretLeakDetected ||= output.includes(secretCanary);
    diagnostics = `${diagnostics}${output}`.slice(-MAX_DIAGNOSTIC_CHARACTERS);
  };
  child.stdout.on("data", recordOutput);
  child.stderr.on("data", recordOutput);

  let smokeFailure: unknown;
  try {
    await waitUntilLive(baseUrl, child, exit, startTimeout);
    if (mode === "production-hsts") {
      await verifyProductionHsts(baseUrl, secretCanary);
    } else {
      await verifyResponses(
        baseUrl,
        secretCanary,
        candidateSessionToken as string,
      );
    }
  } catch (error) {
    smokeFailure = error;
  } finally {
    await stopChild(child, exit);
  }

  if (secretLeakDetected) {
    throw new Error(
      "The production server emitted the secret canary in its process output.",
    );
  }

  if (smokeFailure !== undefined) {
    const message =
      smokeFailure instanceof Error
        ? smokeFailure.message
        : "Unknown smoke failure";
    const safeDiagnostics = redactDiagnostics(diagnostics.trim());
    throw new Error(
      safeDiagnostics.length > 0
        ? `${message}\nServer diagnostics:\n${safeDiagnostics}`
        : message,
    );
  }

  return { baseUrl };
}

async function buildProductionHstsArtifact(databaseUrl: string) {
  const npmCli = process.env.npm_execpath;
  if (npmCli === undefined || !existsSync(npmCli)) {
    throw new Error(
      "The npm CLI path is unavailable. Run the HSTS smoke through `npm run test:e2e:hsts`.",
    );
  }

  const child = spawn(process.execPath, [npmCli, "run", "build"], {
    cwd: process.cwd(),
    env: productionHstsEnvironment(databaseUrl),
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let diagnostics = "";
  const recordOutput = (chunk: Buffer | string) => {
    diagnostics = `${diagnostics}${chunk.toString()}`.slice(
      -MAX_DIAGNOSTIC_CHARACTERS,
    );
  };
  child.stdout.on("data", recordOutput);
  child.stderr.on("data", recordOutput);

  const exit = await new Promise<ChildExit>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code: number | null, signal: NodeJS.Signals | null) =>
      resolveExit({ code, signal }),
    );
  });
  if (exit.code !== 0) {
    throw new Error(
      `Production-like HSTS build failed (code ${String(exit.code)}, signal ${String(exit.signal)}):\n${redactDiagnostics(diagnostics.trim())}`,
    );
  }
}

function productionHstsEnvironment(
  databaseUrl: string,
  secretCanary?: string,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    APP_ENV: "production",
    NODE_ENV: "production",
    APP_URL: "https://hsts-smoke.invalid",
    APP_BUILD_ID: HTTP_SMOKE_BUILD_ID,
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: "",
    RATE_LIMIT_BACKEND: "postgres",
    TRUSTED_PROXY_HOPS: "1",
    ENABLE_LOCAL_MOCK_MAILBOX: "false",
    DEV_MAILBOX_SECRET: "",
    ABUSE_REPORT_ADMIN_EMAILS: "security-smoke@example.test",
    BACKUP_AGE_RECIPIENT: "",
    BACKUP_AGE_IDENTITY_FILE: "",
    STRIPE_SECRET_KEY: "",
    EMAIL_PROVIDER_API_KEY: "",
    OPENAI_API_KEY: "",
    STORAGE_ENDPOINT: "",
    JOBROOM_API_URL: "",
    MAPS_API_KEY: "",
    ...(secretCanary === undefined
      ? {}
      : { HTTP_SMOKE_SECRET_CANARY: secretCanary }),
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

async function verifyProductionHsts(
  baseUrl: string,
  secretCanary: string,
) {
  const live = await request(baseUrl, "/health/live", secretCanary, {
    // The production-like runtime requires one trusted ingress hop. This
    // synthetic value represents a header replaced by that ingress.
    "x-forwarded-for": "198.51.100.25",
  });
  expectStatus(live, 200);
  expectHealthJson(live, "ok", HTTP_SMOKE_BUILD_ID);
  expectNoStore(live);
  const actual = live.response.headers.get("strict-transport-security");
  if (actual !== PRODUCTION_HSTS_VALUE) {
    throw new Error(
      `/health/live returned Strict-Transport-Security ${JSON.stringify(actual)}; expected ${JSON.stringify(PRODUCTION_HSTS_VALUE)}.`,
    );
  }
}

async function waitUntilLive(
  baseUrl: string,
  child: SmokeChild,
  exit: Promise<ChildExit>,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      const state = await exit;
      throw new Error(formatEarlyExit(state));
    }

    let response: Response | undefined;
    try {
      response = await fetch(`${baseUrl}/health/live`, {
        cache: "no-store",
        signal: AbortSignal.timeout(1_500),
      });
    } catch {
      // The TCP listener may not be ready yet. The bounded loop retries.
    }

    if (response?.status === 200) {
      return;
    }
    if (response && response.status >= 500) {
      throw new Error(
        `Production server started but /health/live returned HTTP ${response.status}.`,
      );
    }

    await delay(200);
  }

  throw new Error(
    `Production server did not become live within ${timeoutMs}ms.`,
  );
}

async function verifyResponses(
  baseUrl: string,
  secretCanary: string,
  candidateSessionToken: string,
) {
  const suppliedCorrelationId = "0196f82d-3fb4-7f1a-8c9d-123456789abc";

  const home = await request(baseUrl, "/", secretCanary);
  expectStatus(home, 200);
  expectContent(
    home,
    "text/html",
    "Finde nicht irgendeinen Job. Finde den Job, der wirklich passt.",
  );
  await verifyPhase07PublicRoutes(baseUrl, secretCanary, home);
  await verifyPhase08PublicRoutes(baseUrl, secretCanary);
  const secondHome = await request(baseUrl, "/", secretCanary);
  if (responseNonce(home) === responseNonce(secondHome)) {
    throw new Error("Two homepage responses reused the same CSP nonce.");
  }
  expectNonceHtmlNotPubliclyCacheable(home);

  const anonymousPrivateRoutes = [
    {
      path: "/candidate/dashboard?tab=profile",
      next: "/candidate/dashboard?tab=profile",
    },
    {
      path: "/employer/dashboard?tab=team",
      next: "/employer/dashboard?tab=team",
    },
    { path: "/admin?view=overview", next: "/admin?view=overview" },
  ] as const;

  for (const route of anonymousPrivateRoutes) {
    const privateResponse = await request(baseUrl, route.path, secretCanary);
    expectStatus(privateResponse, 307);
    expectLoginRedirect(privateResponse, baseUrl, route.next);
    expectCacheDirectives(privateResponse, [
      "private",
      "no-store",
      "max-age=0",
    ]);
    expectNoIndex(privateResponse);
  }

  const candidateAdmin = await request(baseUrl, "/admin", secretCanary, {
    cookie: `session=${candidateSessionToken}`,
  });
  expectStatus(candidateAdmin, 403);
  expectContent(candidateAdmin, "text/html", "Zugriff nicht erlaubt");
  expectCacheDirectives(candidateAdmin, ["private", "no-store", "max-age=0"]);
  expectNoIndex(candidateAdmin);

  const resetPassword = await request(baseUrl, "/reset-password", secretCanary);
  expectStatus(resetPassword, 200);
  expectContent(resetPassword, "text/html", "Neues Passwort festlegen");
  expectCacheDirectives(resetPassword, ["no-store", "max-age=0"]);
  expectNoIndex(resetPassword);

  const forbidden = await request(baseUrl, "/forbidden", secretCanary);
  expectStatus(forbidden, 200);
  expectContent(forbidden, "text/html", "Zugriff nicht erlaubt");
  expectCacheDirectives(forbidden, ["private", "no-store", "max-age=0"]);
  expectNoIndex(forbidden);

  const unsubscribe = await request(
    baseUrl,
    "/alerts/unsubscribe/not-a-valid-token",
    secretCanary,
  );
  expectStatus(unsubscribe, 200);
  expectContent(unsubscribe, "text/html", "Jobabo sicher pausieren");
  expectCacheDirectives(unsubscribe, ["no-store", "max-age=0"]);
  expectNoIndex(unsubscribe);
  if (unsubscribe.response.headers.get("referrer-policy") !== "no-referrer") {
    throw new Error("The unsubscribe route must enforce no-referrer.");
  }

  const live = await request(baseUrl, "/health/live", secretCanary, {
    "x-correlation-id": suppliedCorrelationId,
  });
  expectStatus(live, 200);
  expectHealthJson(live, "ok", HTTP_SMOKE_BUILD_ID);
  if (live.response.headers.get("x-correlation-id") !== suppliedCorrelationId) {
    throw new Error("The live route did not preserve a valid correlation ID.");
  }
  expectNoStore(live);

  const ready = await request(baseUrl, "/health/ready", secretCanary);
  expectStatus(ready, 200);
  expectHealthJson(ready, "ready");
  expectNoStore(ready);

  const productionMailbox = await request(
    baseUrl,
    "/dev/mailbox",
    secretCanary,
    { authorization: `Bearer ${secretCanary}` },
  );
  expectStatus(productionMailbox, 404);
  expectNoStore(productionMailbox);
  if (
    productionMailbox.response.headers.get("x-robots-tag") !== NOINDEX_POLICY
  ) {
    throw new Error(
      "/dev/mailbox must remain noindex when it fails closed in Production.",
    );
  }

  const missing = await request(
    baseUrl,
    `/not-found-smoke-${Date.now().toString(36)}`,
    secretCanary,
  );
  expectStatus(missing, 404);
  expectContent(missing, "text/html", "Diese Seite ist nicht verfügbar");

  const extensionLookingMissing = await request(
    baseUrl,
    `/not-found-smoke-${Date.now().toString(36)}.js`,
    secretCanary,
  );
  expectStatus(extensionLookingMissing, 404);
  expectContent(
    extensionLookingMissing,
    "text/html",
    "Diese Seite ist nicht verfügbar",
  );
}

async function createCandidateSmokeSession(databaseUrl: string) {
  const candidate = DEMO_ACCOUNT_FIXTURES.find(
    (account) => account.role === "CANDIDATE",
  );
  if (candidate === undefined) {
    throw new Error("The deterministic candidate smoke account is missing.");
  }
  const database = createDatabaseClient(databaseUrl);
  try {
    const created = await createSession(
      {
        userId: candidate.id,
        production: false,
        userAgent: "phase16-http-smoke",
      },
      {
        store: createPrismaSessionStore(database),
        clock: { now: new Date() },
      },
    );
    return created.token;
  } finally {
    await database.$disconnect();
  }
}

async function verifyPhase08PublicRoutes(
  baseUrl: string,
  secretCanary: string,
) {
  const pages = [
    {
      path: "/pricing",
      expectedText: "Wähle den Plan, der dein Recruiting wachsen lässt",
    },
    {
      path: "/employers",
      expectedText: "Bessere Bewerbungen. Faires Recruiting.",
    },
    {
      path: "/employers/post-job",
      expectedText: "Ein klarer Ablauf für ein transparentes Stelleninserat.",
    },
    {
      path: "/employers/talent-radar",
      expectedText: "Anonyme Talente entdecken",
    },
    {
      path: "/employers/employer-branding",
      expectedText: "Zeige Arbeitsumfeld und Benefits",
    },
    {
      path: "/employers/xml-import",
      expectedText: "Wiederkehrende Stellen strukturiert vorbereiten",
    },
    {
      path: "/employers/demo",
      expectedText: "Lass uns deinen Recruiting-Bedarf einordnen.",
    },
  ] as const;

  for (const page of pages) {
    const response = await request(baseUrl, page.path, secretCanary);
    expectStatus(response, 200);
    expectContent(response, "text/html", page.expectedText);
    if (
      EXPECT_STATIC_PUBLIC_INDEXING &&
      page.path !== "/pricing" &&
      page.path !== "/employers/demo"
    ) {
      expectHtmlIndexable(response);
    } else {
      expectHtmlNoIndex(response);
    }
  }
  const pricing = await request(baseUrl, "/pricing", secretCanary);
  expectContent(pricing, "text/html", "CHF 149.00");
  expectContent(
    pricing,
    "text/html",
    "Erfolgsbasierte Vermittlungsmodelle werden erst nach rechtlicher Prüfung aktiviert.",
  );
  if (pricing.body.includes("Preise momentan nicht verfügbar")) {
    throw new Error(
      "/pricing failed closed despite a complete seeded catalog.",
    );
  }
}

async function verifyPhase07PublicRoutes(
  baseUrl: string,
  secretCanary: string,
  home: SmokeResponse,
) {
  const fixtures = phase07RouteFixtures();
  expectContent(home, "text/html", "Demo-Daten – keine reale Marktaktivität.");

  const publicPages = [
    { path: "/jobs", expectedText: "Finde deinen nächsten fairen Job." },
    {
      path: `/jobs/${fixtures.job.slug}`,
      expectedText: fixtures.job.title,
      key: "job" as const,
    },
    {
      path: `/jobs/kanton/${fixtures.canton.slug}`,
      expectedText: `Jobs im Kanton ${fixtures.canton.name}`,
      key: "cluster" as const,
    },
    {
      path: `/jobs/kategorie/${fixtures.category.slug}`,
      expectedText: `Jobs in ${fixtures.category.name}`,
      key: "cluster" as const,
    },
    {
      path: "/companies",
      expectedText: "Lerne Arbeitgeber kennen, bevor du dich bewirbst.",
    },
    {
      path: `/companies/${fixtures.company.slug}`,
      expectedText: fixtures.company.name,
    },
    {
      path: "/salary-radar",
      expectedText: "Ordne deinen Lohn nachvollziehbar ein.",
    },
    {
      path: "/guide",
      expectedText: "Orientierung, die dich weiterbringt.",
      key: "guide" as const,
    },
    {
      path: `/guide/${fixtures.guide.slug}`,
      expectedText: fixtures.guide.title,
      key: "guide" as const,
    },
  ] as const;

  for (const page of publicPages) {
    const response = await request(baseUrl, page.path, secretCanary);
    expectStatus(response, 200);
    expectContent(response, "text/html", page.expectedText);
    expectNoPrivatePublicMarkers(response, fixtures.privateMarkers);
    if (
      "key" in page &&
      (page.key === "job" || page.key === "cluster" || page.key === "guide")
    ) {
      expectHtmlNoIndex(response);
    }
    if ("key" in page && page.key === "job") {
      expectNoJobPostingJsonLd(response);
      expectCacheDirectives(response, ["private", "no-store", "max-age=0"]);
    }
  }
  expectNoPrivatePublicMarkers(home, fixtures.privateMarkers);

  // Metadata files are deliberately excluded from the request proxy alongside
  // static assets, so they do not carry an application correlation ID.
  const sitemap = await request(
    baseUrl,
    "/sitemap.xml",
    secretCanary,
    undefined,
    false,
  );
  expectStatus(sitemap, 200);
  expectContent(sitemap, "application/xml", "<urlset");
  if (/<url>/iu.test(sitemap.body)) {
    throw new Error(
      "/sitemap.xml exposed DEMO URLs in the local Phase-07 smoke runtime.",
    );
  }

  const robots = await request(
    baseUrl,
    "/robots.txt",
    secretCanary,
    undefined,
    false,
  );
  expectStatus(robots, 200);
  expectContent(robots, "text/plain", "User-Agent: *");
  for (const path of [
    "/candidate/",
    "/employer/",
    "/admin/",
    "/api/",
    "/reset-password",
    "/invite/",
    "/support/",
    "/alerts/unsubscribe/",
    "/mock/checkout/",
    "/dev/",
  ]) {
    expectContent(robots, "text/plain", `Disallow: ${path}`);
  }
  expectContent(robots, "text/plain", `Sitemap: ${baseUrl}/sitemap.xml`);

  const invalidPublicPaths = [
    "/jobs/http-smoke-job-does-not-exist",
    "/jobs/kanton/http-smoke-canton-does-not-exist",
    "/jobs/kategorie/http-smoke-category-does-not-exist",
    "/companies/http-smoke-company-does-not-exist",
    "/guide/http-smoke-guide-does-not-exist",
  ] as const;
  for (const path of invalidPublicPaths) {
    const response = await request(baseUrl, path, secretCanary);
    // Next App Router deliberately returns 200 for a streamed notFound()
    // response and 404 for a non-streamed one. In both cases the safe UI and
    // injected noindex directive are the binding public contract.
    expectStatusOneOf(response, [200, 404]);
    expectContent(response, "text/html", "Diese Seite ist nicht verfügbar");
    expectHtmlNoIndex(response);
    expectNoPrivatePublicMarkers(response, fixtures.privateMarkers);
  }
}

type SmokeResponse = Readonly<{
  path: string;
  response: Response;
  body: string;
}>;

async function request(
  baseUrl: string,
  path: string,
  secretCanary: string,
  headers?: Record<string, string>,
  requireCorrelationId = true,
): Promise<SmokeResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    cache: "no-store",
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.text();
  const serializedHeaders = JSON.stringify([...response.headers.entries()]);

  if (body.includes(secretCanary) || serializedHeaders.includes(secretCanary)) {
    throw new Error(`${path} exposed the secret canary in its HTTP response.`);
  }

  assertSecurityHeaders(path, response.headers, requireCorrelationId);
  const correlationId = response.headers.get("x-correlation-id");
  if (
    requireCorrelationId &&
    (!correlationId || !UUID_PATTERN.test(correlationId))
  ) {
    throw new Error(`${path} returned no valid x-correlation-id header.`);
  }
  if (requireCorrelationId && response.headers.get("content-type")?.includes("text/html")) {
    assertHtmlScriptNonces(path, response.headers, body);
  }

  return { path, response, body };
}

function assertSecurityHeaders(
  path: string,
  headers: Headers,
  requireDynamicSecurityHeaders: boolean,
) {
  const expected = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy":
      path === "/dev/mailbox" ||
      path === "/reset-password" ||
      /^\/jobs\/[^/]+$/u.test(path.split("?")[0] ?? path) ||
      path.startsWith("/alerts/unsubscribe/")
        ? "no-referrer"
        : "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  } as const;

  for (const [name, value] of Object.entries(expected)) {
    if (headers.get(name) !== value) {
      throw new Error(`${path} returned an invalid or missing ${name} header.`);
    }
  }

  if (requireDynamicSecurityHeaders) {
    responseNonce({ path, response: { headers } as Response });
  }
}

function expectStatus(result: SmokeResponse, expectedStatus: number) {
  if (result.response.status !== expectedStatus) {
    throw new Error(
      `${result.path} returned HTTP ${result.response.status}; expected ${expectedStatus}.`,
    );
  }
}

function expectStatusOneOf(
  result: SmokeResponse,
  expectedStatuses: readonly number[],
) {
  if (!expectedStatuses.includes(result.response.status)) {
    throw new Error(
      `${result.path} returned HTTP ${result.response.status}; expected one of ${expectedStatuses.join(", ")}.`,
    );
  }
}

function expectContent(
  result: SmokeResponse,
  expectedContentType: string,
  expectedText: string,
) {
  if (
    !result.response.headers.get("content-type")?.includes(expectedContentType)
  ) {
    throw new Error(`${result.path} returned the wrong content type.`);
  }
  if (!result.body.includes(expectedText)) {
    throw new Error(
      `${result.path} did not contain the expected safe marker ${JSON.stringify(expectedText)}.`,
    );
  }
}

function expectHealthJson(
  result: SmokeResponse,
  expectedStatus: "ok" | "ready",
  expectedBuildId?: string,
) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.body);
  } catch {
    throw new Error(`${result.path} did not return valid JSON.`);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    !("status" in parsed) ||
    parsed.status !== expectedStatus ||
    (expectedBuildId !== undefined &&
      (!("buildId" in parsed) ||
        typeof parsed.buildId !== "string" ||
        parsed.buildId !== expectedBuildId)) ||
    (expectedBuildId === undefined && "buildId" in parsed)
  ) {
    throw new Error(`${result.path} returned an unexpected JSON payload.`);
  }
}

function responseNonce(
  result: Pick<SmokeResponse, "path" | "response">,
) {
  const policy = result.response.headers.get("content-security-policy");
  const match = policy?.match(/(?:^|;\s*)script-src\s+[^;]*'nonce-([^']+)'/u);
  const nonce = match?.[1];
  if (
    nonce === undefined ||
    !/^[a-f0-9]{32}$/u.test(nonce) ||
    !policy?.includes("'strict-dynamic'") ||
    /script-src[^;]*'unsafe-inline'/u.test(policy) ||
    /script-src[^;]*'unsafe-eval'/u.test(policy)
  ) {
    throw new Error(`${result.path} returned an invalid production CSP.`);
  }
  return nonce;
}

function assertHtmlScriptNonces(
  path: string,
  headers: Headers,
  body: string,
) {
  const nonce = responseNonce({
    path,
    response: { headers } as Response,
  });
  const openingScriptTags = body.match(/<script\b[^>]*>/giu) ?? [];
  if (openingScriptTags.length === 0) {
    throw new Error(`${path} returned HTML without framework bootstrap scripts.`);
  }
  for (const tag of openingScriptTags) {
    if (htmlAttribute(tag, "nonce") !== nonce) {
      throw new Error(
        `${path} returned a script without the response CSP nonce.`,
      );
    }
  }
}

function expectNonceHtmlNotPubliclyCacheable(result: SmokeResponse) {
  const cacheControl = result.response.headers.get("cache-control") ?? "";
  if (
    /(?:^|,)\s*(?:public|s-maxage\s*=)/iu.test(cacheControl) ||
    !/(?:^|,)\s*(?:private|no-store|no-cache)(?:,|$)/iu.test(cacheControl)
  ) {
    throw new Error(
      `${result.path} returned nonce-bearing HTML with a public cache policy.`,
    );
  }
}

function expectNoStore(result: SmokeResponse) {
  expectCacheDirectives(result, ["no-store"]);
}

function expectCacheDirectives(
  result: SmokeResponse,
  expectedDirectives: readonly string[],
) {
  const value = result.response.headers.get("cache-control");
  const actualDirectives = new Set(
    value?.split(",").map((directive) => directive.trim().toLowerCase()) ?? [],
  );
  const missing = expectedDirectives.filter(
    (directive) => !actualDirectives.has(directive.toLowerCase()),
  );

  if (missing.length > 0) {
    throw new Error(
      `${result.path} is missing required Cache-Control directives: ${missing.join(", ")}.`,
    );
  }
}

function expectNoIndex(result: SmokeResponse) {
  if (result.response.headers.get("x-robots-tag") !== NOINDEX_POLICY) {
    throw new Error(`${result.path} must remain noindex.`);
  }
}

function expectHtmlNoIndex(result: SmokeResponse) {
  const robotsHeader = result.response.headers.get("x-robots-tag") ?? "";
  if (hasRobotsDirective(robotsHeader, "noindex")) return;

  const metaTags = result.body.match(/<meta\b[^>]*>/giu) ?? [];
  const robotsTag = metaTags.find(
    (tag) => htmlAttribute(tag, "name")?.toLowerCase() === "robots",
  );
  const directives =
    robotsTag === undefined ? "" : (htmlAttribute(robotsTag, "content") ?? "");
  if (!hasRobotsDirective(directives, "noindex")) {
    throw new Error(
      `${result.path} did not expose its required noindex policy.`,
    );
  }
}

function expectHtmlIndexable(result: SmokeResponse) {
  const robotsHeader = result.response.headers.get("x-robots-tag") ?? "";
  const metaTags = result.body.match(/<meta\b[^>]*>/giu) ?? [];
  const robotsTag = metaTags.find(
    (tag) => htmlAttribute(tag, "name")?.toLowerCase() === "robots",
  );
  const directives =
    robotsTag === undefined ? "" : (htmlAttribute(robotsTag, "content") ?? "");
  if (
    hasRobotsDirective(robotsHeader, "noindex") ||
    hasRobotsDirective(directives, "noindex")
  ) {
    throw new Error(
      `${result.path} unexpectedly exposed noindex in the production build.`,
    );
  }
}

function expectNoJobPostingJsonLd(result: SmokeResponse) {
  const scriptTags =
    result.body.match(/<script\b[^>]*>[\s\S]*?<\/script>/giu) ?? [];
  const jsonLdTag = scriptTags.find((tag) => {
    const openingTag = tag.slice(0, tag.indexOf(">") + 1);
    return htmlAttribute(openingTag, "type") === "application/ld+json";
  });
  if (jsonLdTag !== undefined) {
    throw new Error(
      `${result.path} exposed JobPosting JSON-LD for local DEMO data.`,
    );
  }
}

function expectNoPrivatePublicMarkers(
  result: SmokeResponse,
  privateMarkers: readonly string[],
) {
  for (const [index, marker] of privateMarkers.entries()) {
    const encoded = encodeURIComponent(marker);
    if (result.body.includes(marker) || result.body.includes(encoded)) {
      throw new Error(
        `${result.path} exposed private public-read marker ${index + 1}.`,
      );
    }
  }
}

function hasRobotsDirective(value: string, expected: string) {
  return value
    .split(",")
    .some((directive) => directive.trim().toLowerCase() === expected);
}

function htmlAttribute(tag: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = tag.match(
    new RegExp(
      `\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
      "iu",
    ),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function phase07RouteFixtures() {
  // Slugs are deterministic fixture identities; the anchor affects dates only.
  const jobs = buildJobFixtures(new Date("2026-01-15T12:00:00.000Z"));
  const job = jobs.find(
    (candidate) =>
      candidate.status === "PUBLISHED" &&
      candidate.cantonCode === "ZH" &&
      candidate.categorySlug === "engineering-technik",
  );
  if (job === undefined) {
    throw new Error("No stable public Job fixture exists for the HTTP smoke.");
  }

  const canton = CANTON_FIXTURES.find(
    (candidate) => candidate.code === job.cantonCode,
  );
  const category = CATEGORY_FIXTURES.find(
    (candidate) => candidate.slug === job.categorySlug,
  );
  const company = COMPANY_FIXTURES.find(
    (candidate) => candidate.slug === job.companySlug,
  );
  const guide = DEMO_GUIDE_FIXTURES[0];
  if (
    canton === undefined ||
    category === undefined ||
    company === undefined ||
    guide === undefined
  ) {
    throw new Error("The Phase-07 HTTP smoke fixture contract is incomplete.");
  }

  const privateMarkers = Object.freeze(
    [
      job.revisionId,
      company.ownerUserId,
      company.ownerMembershipId,
      company.ownerEmail,
      company.locationId,
      company.billingProfileId,
      "mock-storage/",
      "logoStorageKey",
      "coverStorageKey",
      "registrationEmailDomainNormalized",
      "PRIVATE_EMPLOYER_NOTE_CANARY",
      "cvStorageKey",
    ].filter(
      (marker): marker is string => marker !== null && marker.length > 0,
    ),
  );

  return Object.freeze({
    job,
    canton,
    category,
    company,
    guide,
    privateMarkers,
  });
}

function expectLoginRedirect(
  result: SmokeResponse,
  baseUrl: string,
  expectedNext: string,
) {
  const expectedLocation = new URL("/login", baseUrl);
  expectedLocation.searchParams.set("next", expectedNext);
  const actualLocation = result.response.headers.get("location");
  let actualUrl: URL | undefined;

  if (actualLocation !== null) {
    try {
      actualUrl = new URL(actualLocation, baseUrl);
    } catch {
      // The validation below reports one generic, non-sensitive failure.
    }
  }

  if (
    actualUrl === undefined ||
    actualUrl.origin !== expectedLocation.origin ||
    actualUrl.pathname !== expectedLocation.pathname ||
    actualUrl.search !== expectedLocation.search ||
    actualUrl.hash !== ""
  ) {
    throw new Error(
      `${result.path} redirected to an unexpected or unsafely encoded login URL.`,
    );
  }
}

function resolveSmokeMode(): SmokeMode {
  const argumentsSet = new Set(process.argv.slice(2));
  const productionHsts = argumentsSet.delete("--production-hsts");
  if (argumentsSet.size > 0) {
    throw new Error(
      `Unsupported HTTP smoke arguments: ${[...argumentsSet].join(", ")}.`,
    );
  }
  return productionHsts ? "production-hsts" : "local-full";
}

async function resolvePort() {
  const configured = process.env.HTTP_SMOKE_PORT;
  if (configured !== undefined) {
    const port = parsePositiveInteger("HTTP_SMOKE_PORT", configured);
    if (port > 65_535) {
      throw new Error("HTTP_SMOKE_PORT must be at most 65535.");
    }
    return port;
  }

  return new Promise<number>((resolvePortNumber, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: HOST, port: 0, exclusive: true }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate a free local port."));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolvePortNumber(address.port);
        }
      });
    });
  });
}

function parsePositiveInteger(
  variable: string,
  rawValue: string | undefined,
  fallback?: number,
) {
  if (rawValue === undefined && fallback !== undefined) {
    return fallback;
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${variable} must be a positive integer.`);
  }
  return value;
}

async function stopChild(child: SmokeChild, exit: Promise<ChildExit>) {
  if (child.exitCode !== null || child.signalCode !== null) {
    await exit;
    return;
  }

  child.kill("SIGTERM");
  const stopped = await Promise.race([
    exit.then(() => true),
    delay(5_000).then(() => false),
  ]);

  if (!stopped && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await exit;
  }
}

function formatEarlyExit(exit: ChildExit) {
  return `Production server exited before becoming live (code ${String(exit.code)}, signal ${String(exit.signal)}).`;
}

function redactDiagnostics(value: string) {
  return value
    .replaceAll(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[REDACTED_DATABASE_URL]")
    .replaceAll(
      /((?:secret|token|password|authorization|cookie)[\w.-]*\s*[:=]\s*)[^\s,;]+/gi,
      "$1[REDACTED]",
    );
}
