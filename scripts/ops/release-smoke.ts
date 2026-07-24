import {
  spawn,
  type ChildProcessByStdio,
} from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import type { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

import { chromium, type BrowserContext, type Page } from "@playwright/test";

import { resolveReleaseSmokeDatabase } from "@/lib/ops/recovery-contract";
import { loadLocalEnvironment } from "@/scripts/load-local-environment";
import { redact } from "@/scripts/ops/process-tools";

const HOST = "127.0.0.1";
const PASSWORD = "Demo12345!";
const MAX_DIAGNOSTIC_CHARACTERS = 16_000;

type RuntimeChild = ChildProcessByStdio<null, Readable, Readable>;

loadLocalEnvironment();

try {
  const database = resolveReleaseSmokeDatabase(process.env);
  const build = resolve(process.cwd(), ".next", "BUILD_ID");
  if (!existsSync(build)) {
    throw new Error("Release smoke requires an existing production build.");
  }

  const port = await allocatePort();
  const baseUrl = `http://${HOST}:${port}`;
  const runtime = startServer(database.url, baseUrl, port);
  try {
    await waitUntilReady(baseUrl, runtime);
    await runBrowserSmoke(baseUrl);
  } finally {
    await stopChild(runtime.child, runtime.exit);
  }
  console.info(
    `Post-restore release smoke passed for public desktop/360px and Candidate, Employer, Recruiter and Admin demo logins against ${database.databaseName}.`,
  );
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : "Release smoke failed."));
  process.exitCode = 1;
}

function startServer(databaseUrl: string, baseUrl: string, port: number) {
  const nextBinary = resolve(
    process.cwd(),
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );
  const child = spawn(
    process.execPath,
    [nextBinary, "start", "--hostname", HOST, "--port", String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_ENV: "local",
        NODE_ENV: "production",
        APP_URL: baseUrl,
        APP_BUILD_ID: "phase18-restore-smoke",
        DATABASE_URL: databaseUrl,
        TEST_DATABASE_URL: "",
        RATE_LIMIT_BACKEND: "postgres",
        TRUSTED_PROXY_HOPS: "0",
        ENABLE_LOCAL_MOCK_MAILBOX: "false",
        DEV_MAILBOX_SECRET: "",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolveExit, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolveExit({ code, signal }));
    },
  );
  let diagnostics = "";
  const capture = (chunk: Buffer | string) => {
    diagnostics = `${diagnostics}${chunk.toString()}`.slice(
      -MAX_DIAGNOSTIC_CHARACTERS,
    );
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  return Object.freeze({ child, exit, diagnostics: () => diagnostics });
}

async function runBrowserSmoke(baseUrl: string) {
  const browser = await chromium.launch({ headless: true });
  try {
    const desktop = await browser.newContext({
      baseURL: baseUrl,
      locale: "de-CH",
      timezoneId: "Europe/Zurich",
      viewport: { width: 1_440, height: 900 },
      serviceWorkers: "block",
    });
    await blockExternalNetwork(desktop);
    try {
      const publicPage = await desktop.newPage();
      const failures = observePage(publicPage);
      await assertPage(publicPage, "/", "SwissTalentHub");
      await assertPage(publicPage, "/jobs", "Jobs");
      failures.assertClean();
      await publicPage.close();
    } finally {
      await desktop.close();
    }

    const actors = [
      {
        email: "candidate@demo.ch",
        route: "/candidate/dashboard",
        label: "Candidate",
      },
      {
        email: "employer@demo.ch",
        route: "/employer/dashboard",
        label: "Employer",
      },
      {
        email: "recruiter@demo.ch",
        route: "/employer/jobs",
        label: "Recruiter",
      },
      {
        email: "admin@demo.ch",
        route: "/admin",
        label: "Admin",
      },
    ] as const;
    for (const actor of actors) {
      const context = await browser.newContext({
        baseURL: baseUrl,
        locale: "de-CH",
        timezoneId: "Europe/Zurich",
        viewport: { width: 1_440, height: 900 },
        serviceWorkers: "block",
      });
      await blockExternalNetwork(context);
      try {
        const page = await context.newPage();
        const failures = observePage(page);
        await login(page, actor.email);
        const response = await page.goto(actor.route, {
          waitUntil: "domcontentloaded",
        });
        if (
          response === null ||
          response.status() !== 200 ||
          /\/(?:login|forbidden)(?:\?|$)/u.test(page.url())
        ) {
          throw new Error(`${actor.label} release route was not accessible.`);
        }
        failures.assertClean();
      } finally {
        await context.close();
      }
    }

    const mobile = await browser.newContext({
      baseURL: baseUrl,
      locale: "de-CH",
      timezoneId: "Europe/Zurich",
      viewport: { width: 360, height: 800 },
      isMobile: true,
      hasTouch: true,
      serviceWorkers: "block",
    });
    await blockExternalNetwork(mobile);
    try {
      const page = await mobile.newPage();
      const failures = observePage(page);
      await assertPage(page, "/jobs", "Jobs");
      const dimensions = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
      }));
      if (dimensions.document > dimensions.viewport) {
        throw new Error("Public 360px route has horizontal overflow.");
      }
      failures.assertClean();
    } finally {
      await mobile.close();
    }
  } finally {
    await browser.close();
  }
}

async function login(page: Page, email: string) {
  const response = await page.goto("/login", { waitUntil: "domcontentloaded" });
  if (response === null || response.status() !== 200) {
    throw new Error("Login page was unavailable.");
  }
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill(PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !/\/login(?:\?|$)/u.test(url.pathname + url.search)),
    page.getByRole("button", { name: "Sicher anmelden" }).click(),
  ]);
}

async function assertPage(page: Page, path: string, marker: string) {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  if (
    response === null ||
    response.status() !== 200 ||
    !(await page.locator("body").innerText()).includes(marker)
  ) {
    throw new Error(`${path} failed its release smoke assertion.`);
  }
}

function observePage(page: Page) {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
  return Object.freeze({
    assertClean() {
      if (failures.length > 0) {
        throw new Error(`Browser emitted errors: ${failures.join(" | ")}`);
      }
    },
  });
}

async function blockExternalNetwork(context: BrowserContext) {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      ["http:", "https:", "ws:", "wss:"].includes(url.protocol) &&
      !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
    ) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
}

async function waitUntilReady(
  baseUrl: string,
  runtime: ReturnType<typeof startServer>,
) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (runtime.child.exitCode !== null || runtime.child.signalCode !== null) {
      const exit = await runtime.exit;
      throw new Error(
        `Release server exited early (${String(exit.code)}/${String(exit.signal)}): ${runtime.diagnostics()}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/health/ready`, {
        cache: "no-store",
        signal: AbortSignal.timeout(1_500),
      });
      if (response.status === 200) return;
    } catch {
      // Bounded readiness polling.
    }
    await delay(250);
  }
  throw new Error(`Release server readiness timed out: ${runtime.diagnostics()}`);
}

async function stopChild(
  child: RuntimeChild,
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>,
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

function allocatePort() {
  return new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: HOST, port: 0, exclusive: true }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate a release-smoke port."));
        return;
      }
      server.close((error) =>
        error ? reject(error) : resolvePort(address.port),
      );
    });
  });
}
