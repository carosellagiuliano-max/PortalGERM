import { spawn, type ChildProcessByStdio } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import type { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

import { getIsolatedTestDatabaseConfiguration } from "@/tests/fixtures/test-database";

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
      `HTTP smoke passed on ${result.baseUrl}: public, health, anonymous auth redirects and protected response headers verified.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "HTTP smoke failed.";
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

  const database = getIsolatedTestDatabaseConfiguration();
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
    DATABASE_URL: database.connectionString,
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
    child.once(
      "exit",
      (code: number | null, signal: NodeJS.Signals | null) =>
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
      smokeFailure instanceof Error ? smokeFailure.message : "Unknown smoke failure";
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

  throw new Error(`Production server did not become live within ${timeoutMs}ms.`);
}

async function verifyResponses(baseUrl: string, secretCanary: string) {
  const suppliedCorrelationId = "0196f82d-3fb4-7f1a-8c9d-123456789abc";

  const home = await request(baseUrl, "/", secretCanary);
  expectStatus(home, 200);
  expectContent(home, "text/html", "Sicher starten");

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
    const privateResponse = await request(
      baseUrl,
      route.path,
      secretCanary,
    );
    expectStatus(privateResponse, 307);
    expectLoginRedirect(privateResponse, baseUrl, route.next);
    expectCacheDirectives(privateResponse, ["private", "no-store", "max-age=0"]);
    expectNoIndex(privateResponse);
  }

  const resetPassword = await request(
    baseUrl,
    "/reset-password",
    secretCanary,
  );
  expectStatus(resetPassword, 200);
  expectContent(resetPassword, "text/html", "Neues Passwort festlegen");
  expectCacheDirectives(resetPassword, ["no-store", "max-age=0"]);
  expectNoIndex(resetPassword);

  const forbidden = await request(baseUrl, "/forbidden", secretCanary);
  expectStatus(forbidden, 200);
  expectContent(forbidden, "text/html", "Zugriff nicht erlaubt");
  expectCacheDirectives(forbidden, ["private", "no-store", "max-age=0"]);
  expectNoIndex(forbidden);

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
  if (productionMailbox.response.headers.get("x-robots-tag") !== NOINDEX_POLICY) {
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
  if (!correlationId || !UUID_PATTERN.test(correlationId)) {
    throw new Error(`${path} returned no valid x-correlation-id header.`);
  }

  return { path, response, body };
}

function assertSecurityHeaders(path: string, headers: Headers) {
  const expected = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": path === "/dev/mailbox" || path === "/reset-password"
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

function expectContent(
  result: SmokeResponse,
  expectedContentType: string,
  expectedText: string,
) {
  if (!result.response.headers.get("content-type")?.includes(expectedContentType)) {
    throw new Error(`${result.path} returned the wrong content type.`);
  }
  if (!result.body.includes(expectedText)) {
    throw new Error(`${result.path} did not contain its expected safe content.`);
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
    value
      ?.split(",")
      .map((directive) => directive.trim().toLowerCase()) ?? [],
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

async function stopChild(
  child: SmokeChild,
  exit: Promise<ChildExit>,
) {
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
