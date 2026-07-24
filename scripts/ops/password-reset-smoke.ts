import {
  spawn,
  type ChildProcessByStdio,
} from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { resolve } from "node:path";
import type { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

import { chromium, type Page } from "@playwright/test";

import { resolveReleaseSmokeDatabase } from "@/lib/ops/recovery-contract";
import { loadLocalEnvironment } from "@/scripts/load-local-environment";
import { redact } from "@/scripts/ops/process-tools";
import { isCriticalBrowserConsoleMessage } from "@/tests/e2e/console-policy";

const HOST = "127.0.0.1";
const EMAIL = "candidate@demo.ch";
const OLD_PASSWORD = "Demo12345!";
const NEW_PASSWORD = "Phase18!Reset987";
const MAX_DIAGNOSTIC_CHARACTERS = 16_000;

type RuntimeChild = ChildProcessByStdio<null, Readable, Readable>;

loadLocalEnvironment();

try {
  const database = resolveReleaseSmokeDatabase(process.env);
  const port = await allocatePort();
  const baseUrl = `http://${HOST}:${port}`;
  const mailboxSecret = randomBytes(32).toString("base64url");
  const runtime = startDevelopmentServer(
    database.url,
    baseUrl,
    port,
    mailboxSecret,
  );
  try {
    await waitUntilReady(baseUrl, runtime);
    await runPasswordResetJourney(baseUrl, mailboxSecret);
  } finally {
    await stopChild(runtime.child, runtime.exit);
  }
  console.info(
    `Local password-reset browser journey passed for ${EMAIL}: request, one-time protected mailbox read, fragment-only reset, old-password denial and new-password login.`,
  );
} catch (error) {
  console.error(
    redact(
      error instanceof Error ? error.message : "Password-reset smoke failed.",
    ),
  );
  process.exitCode = 1;
}

function startDevelopmentServer(
  databaseUrl: string,
  baseUrl: string,
  port: number,
  mailboxSecret: string,
) {
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
    [nextBinary, "dev", "--hostname", HOST, "--port", String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_ENV: "local",
        NODE_ENV: "development",
        APP_URL: baseUrl,
        APP_BUILD_ID: "phase18-password-reset",
        DATABASE_URL: databaseUrl,
        TEST_DATABASE_URL: "",
        RATE_LIMIT_BACKEND: "postgres",
        TRUSTED_PROXY_HOPS: "0",
        ENABLE_LOCAL_MOCK_MAILBOX: "true",
        DEV_MAILBOX_SECRET: mailboxSecret,
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

async function runPasswordResetJourney(
  baseUrl: string,
  mailboxSecret: string,
) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      baseURL: baseUrl,
      locale: "de-CH",
      timezoneId: "Europe/Zurich",
      viewport: { width: 1_440, height: 900 },
      serviceWorkers: "block",
    });
    const blockedExternalHosts: string[] = [];
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (
        ["http:", "https:", "ws:", "wss:"].includes(url.protocol) &&
        !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
      ) {
        blockedExternalHosts.push(url.hostname);
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });
    const page = await context.newPage();
    const errors = observePage(page);

    await page.goto("/forgot-password");
    await page.getByLabel("E-Mail-Adresse").fill(EMAIL);
    await page
      .getByRole("button", { name: "Zurücksetzlink anfordern" })
      .click();
    await page
      .getByText(
        "Falls ein passendes Konto existiert, wurde eine Nachricht zum Zurücksetzen vorbereitet.",
      )
      .waitFor();

    const mailbox = await fetch(`${baseUrl}/dev/mailbox`, {
      headers: { Authorization: `Bearer ${mailboxSecret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (mailbox.status !== 200) {
      throw new Error("Protected local mailbox did not return the reset envelope.");
    }
    const payload = (await mailbox.json()) as {
      email?: {
        actionUrl?: unknown;
        templateKey?: unknown;
        to?: unknown;
      } | null;
    };
    const actionUrl = payload.email?.actionUrl;
    if (
      payload.email?.templateKey !== "password_reset_mock" ||
      payload.email.to !== EMAIL ||
      typeof actionUrl !== "string"
    ) {
      throw new Error("Local mailbox returned an invalid reset envelope.");
    }
    const resetUrl = new URL(actionUrl);
    if (
      resetUrl.origin !== baseUrl ||
      resetUrl.pathname !== "/reset-password" ||
      resetUrl.search !== "" ||
      !/^#token=[A-Za-z0-9_-]{32,512}$/u.test(resetUrl.hash)
    ) {
      throw new Error("Reset link violated its fragment-only same-origin contract.");
    }

    await page.goto(actionUrl);
    await page.getByLabel("Passwort", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Passwort bestätigen").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Passwort sicher ändern" }).click();
    await page.waitForURL(/\/login\?reset=success$/u);
    if (new URL(page.url()).hash !== "") {
      throw new Error("Reset bearer remained in the browser URL.");
    }

    await assertLoginDenied(page, OLD_PASSWORD);
    await login(page, NEW_PASSWORD);
    if (/\/login(?:\?|$)/u.test(new URL(page.url()).pathname)) {
      throw new Error("New password login did not leave the login route.");
    }

    const consumed = await fetch(`${baseUrl}/dev/mailbox`, {
      headers: { Authorization: `Bearer ${mailboxSecret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const consumedPayload = (await consumed.json()) as { email?: unknown };
    if (consumed.status !== 200 || consumedPayload.email !== null) {
      throw new Error("Local mailbox envelope was not consumed exactly once.");
    }
    if (blockedExternalHosts.length > 0) {
      throw new Error(
        `Password-reset browser attempted external requests: ${[
          ...new Set(blockedExternalHosts),
        ].join(", ")}`,
      );
    }
    errors.assertClean();
    await context.close();
  } finally {
    await browser.close();
  }
}

async function assertLoginDenied(page: Page, password: string) {
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(EMAIL);
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sicher anmelden" }).click();
  await page
    .getByText("E-Mail oder Passwort falsch.")
    .waitFor();
}

async function login(page: Page, password: string) {
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(EMAIL);
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await Promise.all([
    page.waitForURL((url) => url.pathname !== "/login"),
    page.getByRole("button", { name: "Sicher anmelden" }).click(),
  ]);
}

function observePage(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      isCriticalBrowserConsoleMessage(message.text())
    ) {
      errors.push(message.text());
    }
  });
  return Object.freeze({
    assertClean() {
      if (errors.length > 0) {
        throw new Error(`Password-reset browser errors: ${errors.join(" | ")}`);
      }
    },
  });
}

async function waitUntilReady(
  baseUrl: string,
  runtime: ReturnType<typeof startDevelopmentServer>,
) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (runtime.child.exitCode !== null || runtime.child.signalCode !== null) {
      const exit = await runtime.exit;
      throw new Error(
        `Reset server exited early (${String(exit.code)}/${String(exit.signal)}): ${runtime.diagnostics()}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/health/ready`, {
        cache: "no-store",
        signal: AbortSignal.timeout(2_000),
      });
      if (response.status === 200) return;
    } catch {
      // Bounded readiness polling.
    }
    await delay(300);
  }
  throw new Error(`Reset server readiness timed out: ${runtime.diagnostics()}`);
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
        reject(new Error("Unable to allocate a reset-smoke port."));
        return;
      }
      server.close((error) =>
        error ? reject(error) : resolvePort(address.port),
      );
    });
  });
}
