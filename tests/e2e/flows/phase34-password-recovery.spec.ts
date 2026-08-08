import { createHmac, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { Page } from "@playwright/test";

import {
  expect,
  observePage,
  phase17Database,
  test,
  verificationTokenForEmail,
} from "@/tests/e2e/fixtures/phase17-test";
import { phase34LocalSourceIp } from "@/tests/e2e/fixtures/phase34-network";

const PASSWORD_RESET_TOKEN_DOMAIN = "swisstalenthub.password-reset-token.v2";
const LOCAL_PASSWORD_RESET_FEEDBACK =
  "Die Anfrage wurde sicher verarbeitet. In dieser Umgebung ist kein erreichbarer E-Mail-Versand aktiv; ein Zurücksetzlink kann deshalb nicht zugestellt werden.";
const MAXIMUM_WORKER_OUTPUT_CHARACTERS = 16_000;
const WORKER_TIMEOUT_MILLISECONDS = 60_000;

test.describe.configure({ mode: "serial" });

test("[E2E-34-05][F34-SEC-001][F34-SEC-002][F34-NOT-005] @phase34 password recovery is enumeration-safe, single-use and revokes every old session", async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const database = phase17Database();
  const suffix = `${testInfo.project.name.replaceAll(/[^a-z0-9]+/giu, "-")}-${randomUUID().slice(0, 8)}`;
  const email = `phase34-reset-${suffix}@example.test`.toLowerCase();
  const unknownEmail =
    `phase34-reset-unknown-${suffix}@example.test`.toLowerCase();
  const oldPassword = "Phase34!RecoveryOld42";
  const newPassword = "Phase34!RecoveryNew43";
  const rejectedPassword = "Phase34!RecoveryRejected44";
  const sourceIp = phase34LocalSourceIp(testInfo.project.name);
  let secondSession:
    Awaited<ReturnType<typeof openObservedContext>> | undefined;
  let recovery: Awaited<ReturnType<typeof openObservedContext>> | undefined;
  try {
    await registerAndVerifyCandidate(page, {
      email,
      name: `Phase 34 Recovery ${suffix}`,
      password: oldPassword,
    });
    const user = await database.user.findUniqueOrThrow({
      where: { emailNormalized: email },
      select: { id: true },
    });

    secondSession = await openObservedContext(browser, baseUrl(), sourceIp);
    await login(secondSession.page, email, oldPassword);
    await expect
      .poll(() =>
        database.session.count({
          where: { userId: user.id, revokedAt: null },
        }),
      )
      .toBeGreaterThanOrEqual(2);
    const liveSessions = await database.session.findMany({
      where: { userId: user.id, revokedAt: null },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    const credentialBefore = await database.credential.findUniqueOrThrow({
      where: { userId: user.id },
      select: { passwordChangedAt: true },
    });

    recovery = await openObservedContext(browser, baseUrl(), sourceIp);
    const knownMessage = await requestReset(recovery.page, email);
    expect(knownMessage).toBe(LOCAL_PASSWORD_RESET_FEEDBACK);
    const reset = await database.passwordResetToken.findFirstOrThrow({
      where: { userId: user.id, usedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, expiresAt: true, tokenHash: true },
    });
    expect(reset.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const resetOutbox = await database.notificationOutbox.findFirstOrThrow({
      where: {
        recipientUserId: user.id,
        dedupeKey: `password-reset:${reset.id}`,
        purpose: "PASSWORD_RESET",
      },
      select: { id: true },
    });
    await expect(
      database.auditLog.count({
        where: {
          action: "PASSWORD_RESET_REQUESTED",
          targetId: user.id,
          result: "SUCCEEDED",
        },
      }),
    ).resolves.toBe(1);
    await expect(
      database.emailLog.count({
        where: { recipient: email, templateKey: "password_reset_mock" },
      }),
    ).resolves.toBe(0);
    await expect(
      database.notificationDeliveryAttempt.count({
        where: { outboxId: resetOutbox.id },
      }),
    ).resolves.toBe(0);

    await waitForUnusedDispatchScheduleBucket(database);
    const workerId = `phase34-reset-${suffix}`.slice(0, 90);
    const worker = await runWorkerOnce(workerId);
    expect(worker.output).toContain(`"workerId":"${workerId}"`);
    const deliveredOutbox = await database.notificationOutbox.findUniqueOrThrow(
      {
        where: { id: resetOutbox.id },
        include: {
          attempts: {
            orderBy: [{ attemptNumber: "asc" }, { id: "asc" }],
            select: {
              attemptNumber: true,
              outcome: true,
              providerActivationId: true,
              errorCode: true,
            },
          },
        },
      },
    );
    expect(deliveredOutbox).toMatchObject({
      status: "DELIVERED",
      attemptCount: 1,
      deliveredAt: expect.any(Date),
      deadLetteredAt: null,
      lastErrorCode: null,
      providerRequestActivationId: requiredEnvironment(
        "PHASE34_EMAIL_TRANSACTIONAL_PROVIDER_ACTIVATION_ID",
      ),
      attempts: [
        {
          attemptNumber: 1,
          outcome: "ACCEPTED",
          providerActivationId: requiredEnvironment(
            "PHASE34_EMAIL_TRANSACTIONAL_PROVIDER_ACTIVATION_ID",
          ),
          errorCode: null,
        },
      ],
    });
    await expect(
      database.emailLog.count({
        where: {
          recipient: email,
          templateKey: "password_reset_mock",
          status: "MOCK_RECORDED",
        },
      }),
    ).resolves.toBe(1);
    await expect(
      database.workItem.count({
        where: {
          handlerKey: "notifications.dispatch",
          handlerVersion: "v1",
          subjectType: "SCHEDULE_TICK",
          status: "SUCCEEDED",
          attempts: {
            some: {
              workerId,
              handlerActivationId: requiredEnvironment(
                "PHASE34_NOTIFICATION_DISPATCH_HANDLER_ACTIVATION_ID",
              ),
              outcome: "SUCCEEDED",
            },
          },
        },
      }),
    ).resolves.toBe(1);

    const resetRowsBeforeUnknown = await database.passwordResetToken.count();
    const outboxRowsBeforeUnknown = await database.notificationOutbox.count();
    const unknownMessage = await requestReset(recovery.page, unknownEmail);
    expect(unknownMessage).toBe(knownMessage);
    await expect(database.passwordResetToken.count()).resolves.toBe(
      resetRowsBeforeUnknown,
    );
    await expect(database.notificationOutbox.count()).resolves.toBe(
      outboxRowsBeforeUnknown,
    );

    const rawToken = derivePasswordResetToken(reset.id);
    const tamperedToken = `${rawToken.slice(0, -1)}${
      rawToken.endsWith("A") ? "B" : "A"
    }`;
    await attemptReset(recovery.page, tamperedToken, rejectedPassword);
    await expectInvalidReset(recovery.page);
    await expect(
      database.passwordResetToken.findUniqueOrThrow({
        where: { id: reset.id },
        select: { usedAt: true },
      }),
    ).resolves.toEqual({ usedAt: null });

    const emailCountBeforeReplayWorker = await database.emailLog.count({
      where: { recipient: email, templateKey: "password_reset_mock" },
    });
    await runWorkerOnce(`${workerId}-replay`);
    await expect(
      database.notificationDeliveryAttempt.count({
        where: { outboxId: resetOutbox.id },
      }),
    ).resolves.toBe(1);
    await expect(
      database.emailLog.count({
        where: { recipient: email, templateKey: "password_reset_mock" },
      }),
    ).resolves.toBe(emailCountBeforeReplayWorker);
    await expect(
      database.credential.findUniqueOrThrow({
        where: { userId: user.id },
        select: { passwordChangedAt: true },
      }),
    ).resolves.toEqual(credentialBefore);
    await expect(
      database.session.count({
        where: {
          id: { in: liveSessions.map(({ id }) => id) },
          revokedAt: null,
        },
      }),
    ).resolves.toBe(liveSessions.length);

    await attemptReset(recovery.page, rawToken, newPassword);
    await expect(recovery.page).toHaveURL(/\/login\?reset=success$/u);
    await expect(
      recovery.page.getByText(
        "Dein Passwort wurde geändert. Du kannst dich jetzt mit dem neuen Passwort anmelden.",
      ),
    ).toBeVisible();
    const completedCredential = await database.credential.findUniqueOrThrow({
      where: { userId: user.id },
      select: { passwordChangedAt: true },
    });
    expect(completedCredential.passwordChangedAt.getTime()).toBeGreaterThan(
      credentialBefore.passwordChangedAt.getTime(),
    );
    await expect(
      database.passwordResetToken.findUniqueOrThrow({
        where: { id: reset.id },
        select: { usedAt: true },
      }),
    ).resolves.toEqual({ usedAt: expect.any(Date) });
    await expect(
      database.session.count({
        where: {
          id: { in: liveSessions.map(({ id }) => id) },
          revokedAt: null,
        },
      }),
    ).resolves.toBe(0);
    await expect(
      database.auditLog.count({
        where: {
          action: "SESSION_REVOKED",
          targetId: { in: liveSessions.map(({ id }) => id) },
          reasonCode: "PASSWORD_RESET_COMPLETED",
          result: "SUCCEEDED",
        },
      }),
    ).resolves.toBe(liveSessions.length);
    await expect(
      database.auditLog.count({
        where: {
          action: "PASSWORD_RESET_COMPLETED",
          targetId: user.id,
          result: "SUCCEEDED",
        },
      }),
    ).resolves.toBe(1);

    await secondSession.page.goto("/candidate/dashboard");
    await expect(secondSession.page).toHaveURL(/\/login(?:\?|$)/u);

    await attemptReset(recovery.page, rawToken, rejectedPassword);
    await expectInvalidReset(recovery.page);
    await expect(
      database.auditLog.count({
        where: {
          action: "PASSWORD_RESET_COMPLETED",
          targetId: user.id,
          result: "SUCCEEDED",
        },
      }),
    ).resolves.toBe(1);
    await expect(
      database.credential.findUniqueOrThrow({
        where: { userId: user.id },
        select: { passwordChangedAt: true },
      }),
    ).resolves.toEqual(completedCredential);

    await recovery.page.goto("/login");
    await loginForm(recovery.page, email, oldPassword);
    await expect(
      recovery.page.getByText("E-Mail oder Passwort falsch."),
    ).toBeVisible();
    await loginForm(recovery.page, email, newPassword);
    await expect(recovery.page).not.toHaveURL(/\/login(?:\?|$)/u);

    await recovery.page.goto("/forgot-password");
    await requestReset(recovery.page, email);
    const expired = await database.passwordResetToken.findFirstOrThrow({
      where: { userId: user.id, usedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    const expiredAt = new Date(Date.now() - 60_000);
    await database.passwordResetToken.update({
      where: { id: expired.id },
      data: {
        // Keep the database invariant (`createdAt < expiresAt`) valid while
        // making the fixture unambiguously expired on every browser/runtime.
        createdAt: new Date(expiredAt.getTime() - 60_000),
        expiresAt: expiredAt,
      },
    });
    const credentialBeforeExpiredAttempt =
      await database.credential.findUniqueOrThrow({
        where: { userId: user.id },
        select: { passwordChangedAt: true },
      });
    await attemptReset(
      recovery.page,
      derivePasswordResetToken(expired.id),
      rejectedPassword,
    );
    await expectInvalidReset(recovery.page);
    await expect(
      database.credential.findUniqueOrThrow({
        where: { userId: user.id },
        select: { passwordChangedAt: true },
      }),
    ).resolves.toEqual(credentialBeforeExpiredAttempt);
    await expect(
      database.passwordResetToken.findUniqueOrThrow({
        where: { id: expired.id },
        select: { usedAt: true },
      }),
    ).resolves.toEqual({ usedAt: null });
  } finally {
    try {
      await containRecoveryFixture(database, email);
    } finally {
      const closeResults = await Promise.allSettled([
        secondSession?.close(),
        recovery?.close(),
      ]);
      await database.$disconnect();
      const closeFailure = closeResults.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (closeFailure !== undefined) throw closeFailure.reason;
    }
  }
});

async function registerAndVerifyCandidate(
  page: Page,
  account: Readonly<{ email: string; name: string; password: string }>,
) {
  await page.goto("/register/candidate");
  await page.getByLabel("Vor- und Nachname").fill(account.name);
  await page.getByLabel("E-Mail-Adresse").fill(account.email);
  await page.getByLabel("Passwort", { exact: true }).fill(account.password);
  await page.getByLabel("Passwort bestätigen").fill(account.password);
  await page
    .getByLabel(/Ich akzeptiere die aktuellen Nutzungsbedingungen/u)
    .check();
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  // Phase 34 verifies the production identity boundary: a newly registered
  // candidate cannot enter the private onboarding until the one-time address
  // challenge below has succeeded.
  await expect(page).toHaveURL(/\/verify-email\?registered=1$/u);
  const token = await verificationTokenForEmail(account.email);
  await page.goto(`/verify-email#token=${token}`);
  await page.getByRole("button", { name: "E-Mail jetzt bestätigen" }).click();
  await expect(
    page.getByText("Deine E-Mail-Adresse wurde bestätigt."),
  ).toBeVisible();
}

async function requestReset(page: Page, email: string) {
  await page.goto("/forgot-password");
  await expect(
    page.getByRole("heading", { level: 1, name: "Passwort zurücksetzen" }),
  ).toBeVisible();
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Zurücksetzlink anfordern" }),
  });
  await expect(form).toHaveCount(1);
  await form.getByLabel("E-Mail-Adresse").fill(email);
  await form.getByRole("button", { name: "Zurücksetzlink anfordern" }).click();
  const feedback = form.getByRole("alert");
  await expect(feedback).toBeVisible();
  const description = feedback.locator('[data-slot="alert-description"]');
  await expect(description).toBeVisible();
  return (await description.textContent())?.trim() ?? "";
}

async function containRecoveryFixture(
  database: ReturnType<typeof phase17Database>,
  email: string,
) {
  const user = await database.user.findUnique({
    where: { emailNormalized: email },
    select: { id: true },
  });
  if (user === null) return;

  const now = new Date();
  await database.$transaction(async (transaction) => {
    await transaction.notificationOutbox.updateMany({
      where: {
        recipientUserId: user.id,
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
    await transaction.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now },
    });
    await transaction.user.update({
      where: { id: user.id },
      data: { status: "SUSPENDED", updatedAt: now },
    });
  });
}

async function attemptReset(page: Page, token: string, password: string) {
  // A second hash-only navigation on the same route does not remount the
  // client component after it has scrubbed the first fragment. A test-only
  // nonce forces a fresh document so each attempt hydrates exactly the token
  // supplied for that attempt.
  await page.goto(`/reset-password?attempt=${randomUUID()}#token=${token}`);
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page.getByLabel("Passwort bestätigen").fill(password);
  await page.getByRole("button", { name: "Passwort sicher ändern" }).click();
}

async function expectInvalidReset(page: Page) {
  await expect(
    page.getByRole("alert").filter({
      hasText:
        "Der Link ist ungültig, abgelaufen oder wurde bereits verwendet.",
    }),
  ).toBeVisible();
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await loginForm(page, email, password);
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
}

async function loginForm(page: Page, email: string, password: string) {
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sicher anmelden" }).click();
}

async function openObservedContext(
  browser: import("@playwright/test").Browser,
  applicationBaseUrl: string,
  sourceIp: string,
) {
  const context = await browser.newContext({
    baseURL: applicationBaseUrl,
    locale: "de-CH",
    timezoneId: "Europe/Zurich",
    serviceWorkers: "block",
    extraHTTPHeaders: { "x-forwarded-for": sourceIp },
  });
  const page = await context.newPage();
  const observation = await observePage(page);
  return Object.freeze({
    context,
    page,
    async close() {
      observation.assertClean();
      await context.close();
    },
  });
}

function derivePasswordResetToken(resetId: string) {
  return createHmac(
    "sha256",
    Buffer.from(requiredEnvironment("SESSION_SECRET"), "base64"),
  )
    .update(PASSWORD_RESET_TOKEN_DOMAIN, "utf8")
    .update("\0", "utf8")
    .update(resetId, "utf8")
    .digest("base64url");
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
        APP_URL: baseUrl(),
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
      `Phase 34 password worker failed (code ${String(result.code)}, signal ${String(result.signal)}, timeout ${String(result.timedOut)}):\n${redact(output)}`,
    );
  }
  return Object.freeze({ ...result, output });
}

async function waitForUnusedDispatchScheduleBucket(
  database: ReturnType<typeof phase17Database>,
) {
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

function redact(value: string) {
  return value
    .replaceAll(/postgres(?:ql)?:\/\/[^\s]+/giu, "[REDACTED_DATABASE_URL]")
    .replaceAll(/[A-Za-z0-9_-]{32,}/gu, "[REDACTED_TOKEN]");
}

function baseUrl() {
  return requiredEnvironment("PHASE34_LOCAL_BASE_URL");
}

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required by the Phase 34 browser suite.`);
  }
  return value;
}
