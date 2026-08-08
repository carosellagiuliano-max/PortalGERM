import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { BrowserContext, Locator, Page } from "@playwright/test";

import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  login,
  observePage,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";

const JOB_ALERT_HANDLER_KEY = "candidate.job-alert-digest";
const JOB_ALERT_HANDLER_VERSION = "v1";
const JOB_ALERT_EMAIL_TEMPLATE = "job_alert_digest_mock";
const MAXIMUM_WORKER_OUTPUT_CHARACTERS = 24_000;
const WORKER_TIMEOUT_MILLISECONDS = 90_000;

type Phase34Database = ReturnType<typeof phase17Database>;

test.describe.configure({ mode: "serial" });

test("[F34-NOT-004][E2E-34-12] @phase34 a real local worker schedules and delivers one durable mock job-alert digest exactly once", async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const database = phase17Database();
  let previewContext: BrowserContext | undefined;
  try {
    const candidateDigest = requiredEnvironment("PHASE34_CANDIDATE_DIGEST");
    const handlerActivationId = requiredEnvironment(
      "PHASE34_JOB_ALERT_HANDLER_ACTIVATION_ID",
    );
    const providerActivationId = requiredEnvironment(
      "PHASE34_JOB_ALERT_PROVIDER_ACTIVATION_ID",
    );
    const candidate = await database.user.findUniqueOrThrow({
      where: { emailNormalized: DEMO_ACCOUNTS.candidate },
      select: {
        id: true,
        emailNormalized: true,
        candidateProfile: { select: { id: true } },
      },
    });
    if (candidate.candidateProfile === null) {
      throw new Error("The seeded candidate profile is missing.");
    }

    const [handlerActivationBefore, providerActivationBefore] =
      await Promise.all([
        database.workerHandlerActivation.findUniqueOrThrow({
          where: { id: handlerActivationId },
          select: {
            id: true,
            generation: true,
            environment: true,
            handlerKey: true,
            handlerVersion: true,
            payloadVersion: true,
            mode: true,
            configurationDigest: true,
            deploymentDigest: true,
            providerUseCase: true,
            killSwitchEngaged: true,
            effectiveAt: true,
            expiresAt: true,
            revokedAt: true,
            updatedAt: true,
          },
        }),
        database.providerActivation.findUniqueOrThrow({
          where: { id: providerActivationId },
          select: {
            id: true,
            environment: true,
            useCase: true,
            adapterKey: true,
            adapterVersion: true,
            mode: true,
            configurationDigest: true,
            secretVersionRef: true,
            region: true,
            health: true,
            killSwitchEngaged: true,
            effectiveAt: true,
            expiresAt: true,
            revokedAt: true,
          },
        }),
      ]);
    expect(handlerActivationBefore).toMatchObject({
      environment: "local",
      handlerKey: JOB_ALERT_HANDLER_KEY,
      handlerVersion: JOB_ALERT_HANDLER_VERSION,
      mode: "SANDBOX",
      deploymentDigest: candidateDigest,
      providerUseCase: "email.job-alert",
      killSwitchEngaged: false,
      effectiveAt: expect.any(Date),
      expiresAt: null,
      revokedAt: null,
    });
    expect(providerActivationBefore).toMatchObject({
      environment: "local",
      useCase: "email.job-alert",
      adapterKey: "local_mock",
      adapterVersion: "v1",
      mode: "SANDBOX",
      secretVersionRef: "builtin:local-mock-mailbox:v1",
      region: "local-test",
      health: "HEALTHY",
      killSwitchEngaged: false,
      effectiveAt: expect.any(Date),
      expiresAt: null,
      revokedAt: null,
    });
    await assertNoPreviewJobAlertAuthority(database);

    await login(page, DEMO_ACCOUNTS.candidate, DEMO_PASSWORD);
    await page.goto("/candidate/alerts");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Passende Stellen im Blick behalten",
      }),
    ).toBeVisible();

    const projectToken = testInfo.project.name.replaceAll(/[^a-z0-9]+/giu, "-");
    const uniqueToken = randomUUID().slice(0, 8);
    const alertKeyword = `Phase 34 Worker ${projectToken} ${uniqueToken}`;
    const workerPrefix = `phase34-alert-${projectToken}-${uniqueToken}`;
    const emailLogBefore = await database.emailLog.count({
      where: {
        recipient: candidate.emailNormalized,
        templateKey: JOB_ALERT_EMAIL_TEMPLATE,
      },
    });

    const alertForm = newAlertForm(page);
    await alertForm.getByLabel("Suchbegriff").fill(alertKeyword);
    await alertForm.getByLabel("Dieses Jobabo ausdrücklich aktivieren").check();
    await alertForm.getByLabel(/per Service-E-Mail erhalten/u).check();
    await alertForm.getByRole("button", { name: "Jobabo erstellen" }).click();
    await expect(
      alertForm.getByRole("status").filter({
        hasText:
          "Es ist ausschliesslich für den lokalen Mock-Test vorgemerkt; es wird keine echte E-Mail versendet.",
      }),
    ).toBeVisible();

    const alert = await database.jobAlert.findFirstOrThrow({
      where: {
        candidateProfileId: candidate.candidateProfile.id,
        query: { path: ["keyword"], equals: alertKeyword },
      },
      select: {
        id: true,
        createdAt: true,
        status: true,
        nextDueAt: true,
        events: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { actorUserId: true, kind: true, reasonCode: true },
        },
      },
    });
    expect(alert).toMatchObject({
      status: "ACTIVE",
      events: [
        {
          actorUserId: candidate.id,
          kind: "CREATED",
          reasonCode: "EXPLICIT_ACTIVATION",
        },
      ],
    });
    await expect(
      database.jobAlertDigest.count({ where: { jobAlertId: alert.id } }),
    ).resolves.toBe(0);

    // This is the only direct business-data mutation in the scenario. The
    // browser owns creation/activation and the real worker owns every effect.
    await database.jobAlert.update({
      where: { id: alert.id },
      data: { nextDueAt: alert.createdAt },
    });
    await page.reload();
    const beforeWorkerCard = alertCard(page, alertKeyword);
    await expect(
      beforeWorkerCard.getByText("Aktiv · Zustellpfad freigegeben", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(alertStat(beforeWorkerCard, "Letzter Digest")).toHaveText(
      "Noch keiner",
    );

    // The scheduler uses a minute-wide durable dedupe key. A prior browser
    // project may have consumed the current bucket, so wait for an unused one
    // instead of deleting or rewriting operations evidence.
    await waitForUnusedDigestScheduleBucket(database);
    const firstWorkerId = `${workerPrefix}-first`;
    const firstWorker = await runWorkerOnce(firstWorkerId);
    expect(firstWorker.output).toContain(`"workerId":"${firstWorkerId}"`);
    expect(firstWorker.output).toContain('"runtime":"sandbox_command"');

    const firstWorkerRun = await database.workerRun.findFirstOrThrow({
      where: { workerId: firstWorkerId },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    });
    expect(firstWorkerRun).toMatchObject({
      environment: "local",
      deploymentDigest: candidateDigest,
      runtimeVersion: "v1",
      status: "STOPPED",
      shutdownOutcome: "CLEAN",
      lastErrorDigest: null,
      failedCount: 0,
      drainingAt: expect.any(Date),
      stoppedAt: expect.any(Date),
      heartbeatAt: expect.any(Date),
    });
    expect(firstWorkerRun.claimedCount).toBeGreaterThanOrEqual(1);
    expect(firstWorkerRun.succeededCount).toBe(firstWorkerRun.claimedCount);
    assertWorkerRunTimeline(firstWorkerRun);

    const digest = await database.jobAlertDigest.findFirstOrThrow({
      where: { jobAlertId: alert.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        itemCount: true,
        runAt: true,
        scheduledFor: true,
        recipientEmailSnapshot: true,
      },
    });
    expect(digest).toMatchObject({
      runAt: expect.any(Date),
      scheduledFor: alert.createdAt,
      recipientEmailSnapshot: candidate.emailNormalized,
    });

    const workItem = await database.workItem.findFirstOrThrow({
      where: {
        handlerKey: JOB_ALERT_HANDLER_KEY,
        handlerVersion: JOB_ALERT_HANDLER_VERSION,
        attempts: { some: { workerId: firstWorkerId } },
      },
      include: {
        attempts: { orderBy: [{ attemptNumber: "asc" }, { id: "asc" }] },
        effectReceipts: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      },
    });
    expect(workItem).toMatchObject({
      handlerKey: JOB_ALERT_HANDLER_KEY,
      handlerVersion: JOB_ALERT_HANDLER_VERSION,
      payloadVersion: "v1",
      subjectType: "SCHEDULE_TICK",
      status: "SUCCEEDED",
      attemptCount: 1,
      completedAt: expect.any(Date),
      lastFailureClass: null,
      lastErrorCode: null,
      lastErrorDigest: null,
    });
    expect(workItem.attempts).toHaveLength(1);
    expect(workItem.attempts[0]).toMatchObject({
      workerRunId: firstWorkerRun.id,
      handlerActivationId,
      handlerActivationGeneration: handlerActivationBefore.generation,
      handlerActivationCurrentAtCompletion: true,
      attemptNumber: 1,
      workerId: firstWorkerId,
      deploymentDigest: candidateDigest,
      outcome: "SUCCEEDED",
      failureClass: null,
      errorCode: null,
      errorDigest: null,
    });
    expect(workItem.effectReceipts).toHaveLength(1);
    const effectReceipt = workItem.effectReceipts[0];
    expect(effectReceipt).toMatchObject({
      workItemId: workItem.id,
      effectKey: workItem.effectKey,
      handlerKey: JOB_ALERT_HANDLER_KEY,
      handlerVersion: JOB_ALERT_HANDLER_VERSION,
      handlerActivationId,
      handlerActivationGeneration: handlerActivationBefore.generation,
      handlerActivationCurrentAtReceipt: true,
      leaseWorkerRunId: firstWorkerRun.id,
      providerReceiptDigest: null,
    });
    expect(effectReceipt?.effectDigest).toBe(
      digestSummary({
        completed: [
          {
            alertId: alert.id,
            digestId: digest.id,
            itemCount: digest.itemCount,
          },
        ],
        skipped: 0,
      }),
    );

    const emailIdentity = mockEmailOperationIdentity(
      candidate.emailNormalized,
      JOB_ALERT_EMAIL_TEMPLATE,
      `job-alert-digest:${digest.id}`,
    );
    const email = await database.emailLog.findUniqueOrThrow({
      where: { id: emailIdentity.id },
    });
    expect(email).toMatchObject({
      recipient: candidate.emailNormalized,
      purpose: JOB_ALERT_EMAIL_TEMPLATE,
      templateKey: JOB_ALERT_EMAIL_TEMPLATE,
      status: "MOCK_RECORDED",
      errorCode: null,
    });
    expect(
      email.providerReference?.startsWith(
        `mock-email-v2:${emailIdentity.digest}:`,
      ),
    ).toBe(true);
    expect(email.payload).toMatchObject({
      schemaVersion: "1",
      deliveryStatus: "mock_recorded",
      externalDeliveryClaimed: false,
    });
    await expect(
      database.jobAlertDigest.count({ where: { jobAlertId: alert.id } }),
    ).resolves.toBe(1);
    await expect(
      database.jobAlertEvent.count({
        where: { jobAlertId: alert.id, kind: "DIGEST_MOCK_RECORDED" },
      }),
    ).resolves.toBe(1);
    await expect(
      database.emailLog.count({
        where: {
          recipient: candidate.emailNormalized,
          templateKey: JOB_ALERT_EMAIL_TEMPLATE,
        },
      }),
    ).resolves.toBe(emailLogBefore + 1);

    const secondWorkerId = `${workerPrefix}-second`;
    const secondWorker = await runWorkerOnce(secondWorkerId);
    expect(secondWorker.output).toContain(`"workerId":"${secondWorkerId}"`);
    const secondWorkerRun = await database.workerRun.findFirstOrThrow({
      where: { workerId: secondWorkerId },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    });
    expect(secondWorkerRun).toMatchObject({
      environment: "local",
      deploymentDigest: candidateDigest,
      runtimeVersion: "v1",
      status: "STOPPED",
      shutdownOutcome: "CLEAN",
      lastErrorDigest: null,
      failedCount: 0,
    });
    expect(secondWorkerRun.succeededCount).toBe(secondWorkerRun.claimedCount);
    assertWorkerRunTimeline(secondWorkerRun);

    await expect(
      database.jobAlertDigest.count({ where: { jobAlertId: alert.id } }),
    ).resolves.toBe(1);
    await expect(
      database.jobAlertEvent.count({
        where: { jobAlertId: alert.id, kind: "DIGEST_MOCK_RECORDED" },
      }),
    ).resolves.toBe(1);
    await expect(
      database.emailLog.count({
        where: {
          recipient: candidate.emailNormalized,
          templateKey: JOB_ALERT_EMAIL_TEMPLATE,
        },
      }),
    ).resolves.toBe(emailLogBefore + 1);
    await expect(
      database.emailLog.findUniqueOrThrow({
        where: { id: emailIdentity.id },
        select: { providerReference: true, updatedAt: true },
      }),
    ).resolves.toEqual({
      providerReference: email.providerReference,
      updatedAt: email.updatedAt,
    });
    await expect(
      database.workerHandlerActivation.findUniqueOrThrow({
        where: { id: handlerActivationId },
        select: {
          id: true,
          generation: true,
          environment: true,
          handlerKey: true,
          handlerVersion: true,
          payloadVersion: true,
          mode: true,
          configurationDigest: true,
          deploymentDigest: true,
          providerUseCase: true,
          killSwitchEngaged: true,
          effectiveAt: true,
          expiresAt: true,
          revokedAt: true,
          updatedAt: true,
        },
      }),
    ).resolves.toEqual(handlerActivationBefore);
    await expect(
      database.providerActivation.findUniqueOrThrow({
        where: { id: providerActivationId },
        select: {
          id: true,
          environment: true,
          useCase: true,
          adapterKey: true,
          adapterVersion: true,
          mode: true,
          configurationDigest: true,
          secretVersionRef: true,
          region: true,
          health: true,
          killSwitchEngaged: true,
          effectiveAt: true,
          expiresAt: true,
          revokedAt: true,
        },
      }),
    ).resolves.toEqual(providerActivationBefore);

    await page.reload();
    const afterWorkerCard = alertCard(page, alertKeyword);
    await expect(
      afterWorkerCard.getByText("Aktiv · Zustellpfad freigegeben", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(alertStat(afterWorkerCard, "Letzter Digest")).not.toHaveText(
      "Noch keiner",
    );
    await expect(alertStat(afterWorkerCard, "Letzte Treffer")).toHaveText(
      String(digest.itemCount),
    );

    previewContext = await browser.newContext({
      baseURL: requiredEnvironment("PHASE34_PREVIEW_BASE_URL"),
      locale: "de-CH",
      timezoneId: "Europe/Zurich",
      serviceWorkers: "block",
      extraHTTPHeaders: { "x-forwarded-for": "198.51.100.79" },
      storageState: await page.context().storageState(),
    });
    const previewPage = await previewContext.newPage();
    const previewObservation = await observePage(previewPage);
    await previewPage.goto("/candidate/alerts");
    await expect(
      previewPage.getByRole("heading", {
        level: 2,
        name: "Zustellung derzeit gesperrt",
      }),
    ).toBeVisible();
    const previewAlertCard = alertCard(previewPage, alertKeyword);
    await expect(
      previewAlertCard.getByText("Aktivierungswunsch · Zustellung gesperrt", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      previewAlertCard.getByText("Aktiv · Zustellpfad freigegeben", {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      previewAlertCard.getByRole("button", {
        name: "Fälligen Mock-Digest ausführen",
      }),
    ).toHaveCount(0);
    await assertNoPreviewJobAlertAuthority(database);
    previewObservation.assertClean();
  } finally {
    await previewContext?.close();
    await database.$disconnect();
  }
});

function newAlertForm(page: Page) {
  return page.locator("form").filter({
    has: page.getByRole("button", { name: "Jobabo erstellen" }),
  });
}

function alertCard(page: Page, keyword: string) {
  return page.locator('[data-slot="card"]').filter({
    has: page.getByRole("heading", { level: 2, name: keyword }),
  });
}

function alertStat(card: Locator, label: string) {
  return card.locator("dl > div").filter({ hasText: label }).locator("dd");
}

async function waitForUnusedDigestScheduleBucket(database: Phase34Database) {
  const deadline = Date.now() + 65_000;
  while (Date.now() < deadline) {
    const bucket = Math.floor(Date.now() / 60_000);
    const dedupeKey = `${JOB_ALERT_HANDLER_KEY}:${JOB_ALERT_HANDLER_VERSION}:${bucket}`;
    if ((await database.workItem.count({ where: { dedupeKey } })) === 0) {
      return bucket;
    }
    const nextBoundary = (bucket + 1) * 60_000;
    await delay(Math.max(50, Math.min(500, nextBoundary - Date.now() + 25)));
  }
  throw new Error("PHASE34_UNUSED_JOB_ALERT_SCHEDULE_BUCKET_TIMEOUT");
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
        APP_URL: requiredEnvironment("PHASE34_LOCAL_BASE_URL"),
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
      `Phase 34 worker failed (code ${String(result.code)}, signal ${String(result.signal)}, timeout ${String(result.timedOut)}):\n${redact(output)}`,
    );
  }
  return Object.freeze({ ...result, output });
}

function assertWorkerRunTimeline(
  run: Readonly<{
    drainingAt: Date | null;
    heartbeatAt: Date;
    startedAt: Date;
    stoppedAt: Date | null;
  }>,
) {
  expect(run.drainingAt).toBeInstanceOf(Date);
  expect(run.stoppedAt).toBeInstanceOf(Date);
  expect(run.heartbeatAt.getTime()).toBeGreaterThanOrEqual(
    run.startedAt.getTime(),
  );
  expect(run.heartbeatAt.getTime()).toBeLessThanOrEqual(
    requireDate(run.stoppedAt).getTime(),
  );
  expect(requireDate(run.drainingAt).getTime()).toBeGreaterThanOrEqual(
    run.startedAt.getTime(),
  );
  expect(requireDate(run.drainingAt).getTime()).toBeLessThanOrEqual(
    requireDate(run.stoppedAt).getTime(),
  );
}

async function assertNoPreviewJobAlertAuthority(database: Phase34Database) {
  const [providers, handlers] = await Promise.all([
    database.providerActivation.count({
      where: {
        environment: "preview",
        useCase: "email.job-alert",
        revokedAt: null,
      },
    }),
    database.workerHandlerActivation.count({
      where: {
        environment: "preview",
        handlerKey: JOB_ALERT_HANDLER_KEY,
        handlerVersion: JOB_ALERT_HANDLER_VERSION,
        revokedAt: null,
      },
    }),
  ]);
  expect({ providers, handlers }).toEqual({ providers: 0, handlers: 0 });
}

function mockEmailOperationIdentity(
  recipient: string,
  templateKey: string,
  idempotencyKey: string,
) {
  const digest = lengthPrefixedDigest("mock-email-operation-v2", [
    recipient,
    templateKey,
    "",
    idempotencyKey,
  ]);
  const uuidHex = `${digest.slice(0, 12)}4${digest.slice(13, 16)}a${digest.slice(17, 32)}`;
  return Object.freeze({
    id: [
      uuidHex.slice(0, 8),
      uuidHex.slice(8, 12),
      uuidHex.slice(12, 16),
      uuidHex.slice(16, 20),
      uuidHex.slice(20, 32),
    ].join("-"),
    digest,
  });
}

function lengthPrefixedDigest(domain: string, values: readonly string[]) {
  const hash = createHash("sha256");
  updateLengthPrefixed(hash, domain);
  for (const value of values) updateLengthPrefixed(hash, value);
  return hash.digest("hex");
}

function updateLengthPrefixed(
  hash: ReturnType<typeof createHash>,
  value: string,
) {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length);
  hash.update(length);
  hash.update(bytes);
}

function digestSummary(value: unknown) {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function canonicalJson(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function requireDate(value: Date | null) {
  if (!(value instanceof Date)) throw new Error("WORKER_RUN_DATE_MISSING");
  return value;
}

function redact(value: string) {
  return value
    .replaceAll(/postgres(?:ql)?:\/\/[^\s"']+/giu, "[REDACTED_DATABASE_URL]")
    .replaceAll(
      /((?:secret|token|password|authorization|cookie)[\w.-]*\s*[:=]\s*)[^\s,;]+/giu,
      "$1[REDACTED]",
    );
}

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required by the Phase 34 browser suite.`);
  }
  return value;
}
