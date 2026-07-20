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
} from "@/prisma/seed/fixtures/companies-jobs";
import { DEMO_GUIDE_FIXTURES } from "@/prisma/seed/fixtures/content";
import { runDemoSeed } from "@/prisma/seed/orchestrator";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

const HOST = "127.0.0.1";
const DEFAULT_START_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_DIAGNOSTIC_CHARACTERS = 24_000;
const NOINDEX_POLICY = "noindex, nofollow, noarchive, nosnippet";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type ChildExit = Readonly<{
  code: number | null;
  signal: NodeJS.Signals | null;
}>;

type SmokeChild = ChildProcessByStdio<null, Readable, Readable>;

await main();

async function main() {
  try {
    const result = await runSmoke();
    console.info(
      `HTTP smoke passed on ${result.baseUrl}: Phase-07/08 public routes, Phase-09 unsubscribe privacy, health, anonymous auth redirects and protected response headers verified.`,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "HTTP smoke failed.";
    console.error(redactDiagnostics(message));
    process.exitCode = 1;
  }
}

async function runSmoke() {
  const buildIdPath = resolve(process.cwd(), ".next", "BUILD_ID");
  if (!existsSync(buildIdPath)) {
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
    return await runHttpSmoke(database.connectionString);
  } finally {
    await database.dispose();
  }
}

async function runHttpSmoke(databaseUrl: string) {
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

  const childEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    APP_ENV: "local",
    NODE_ENV: "production",
    APP_URL: baseUrl,
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
    await verifyResponses(baseUrl, secretCanary);
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

async function verifyResponses(baseUrl: string, secretCanary: string) {
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
  expectJson(live, { status: "ok" });
  if (live.response.headers.get("x-correlation-id") !== suppliedCorrelationId) {
    throw new Error("The live route did not preserve a valid correlation ID.");
  }
  expectNoStore(live);

  const ready = await request(baseUrl, "/health/ready", secretCanary);
  expectStatus(ready, 200);
  expectJson(ready, { status: "ready" });
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
    expectHtmlNoIndex(response);
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
      expectedText: `Jobs in ${fixtures.canton.name}`,
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

  assertSecurityHeaders(path, response.headers);
  const correlationId = response.headers.get("x-correlation-id");
  if (
    requireCorrelationId &&
    (!correlationId || !UUID_PATTERN.test(correlationId))
  ) {
    throw new Error(`${path} returned no valid x-correlation-id header.`);
  }

  return { path, response, body };
}

function assertSecurityHeaders(path: string, headers: Headers) {
  const expected = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy":
      path === "/dev/mailbox" ||
      path === "/reset-password" ||
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
      `${result.path} did not contain its expected safe content.`,
    );
  }
}

function expectJson(result: SmokeResponse, expected: Record<string, string>) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.body);
  } catch {
    throw new Error(`${result.path} did not return valid JSON.`);
  }

  if (JSON.stringify(parsed) !== JSON.stringify(expected)) {
    throw new Error(`${result.path} returned an unexpected JSON payload.`);
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
