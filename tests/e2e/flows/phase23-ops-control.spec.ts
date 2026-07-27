import { randomUUID } from "node:crypto";

import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  expect,
  login,
  phase17Database,
  test,
} from "@/tests/e2e/fixtures/phase17-test";

const PAYLOAD_CANARY = "PHASE23_QUEUE_PAYLOAD_MUST_NOT_RENDER";
const SECRET_CANARY = "PHASE23_SECRET_REFERENCE_MUST_NOT_RENDER";

test.describe.configure({ mode: "serial" });

test("[23-AC-10] @journey keeps Ops private, redacted and read-only before Phase 25", async ({
  browser,
  page,
}) => {
  const publicContext = await browser.newContext();
  try {
    const publicPage = await publicContext.newPage();
    await publicPage.goto("/admin/system");
    await expect(publicPage).toHaveURL(/\/login/u);
  } finally {
    await publicContext.close();
  }

  const database = phase17Database();
  try {
    const now = new Date();
    await database.workItem.create({
      data: {
        handlerKey: "ops.diagnostic-effect",
        handlerVersion: "v1",
        subjectType: "DIAGNOSTIC",
        subjectId: randomUUID(),
        dedupeKey: `ops.diagnostic-effect:v1:e2e:${randomUUID()}`,
        effectKey: `effect:ops.diagnostic-effect:v1:e2e:${randomUUID()}`,
        availableAt: now,
        payloadVersion: "v1",
        payloadReference: { unsafeLegacyCanary: PAYLOAD_CANARY },
      },
    });
    await database.providerActivation.create({
      data: {
        environment: "local",
        useCase: `e2e.phase23.${randomUUID()}`,
        adapterKey: "e2e_sandbox",
        adapterVersion: "v1",
        mode: "SANDBOX",
        configurationDigest: "a".repeat(64),
        secretVersionRef: SECRET_CANARY,
        region: "local-test",
        dpaRef: "dpa:e2e",
        contractRef: "contract:e2e",
        approvalRef: "approval:e2e",
        evidenceDigest: "b".repeat(64),
        owner: "E2E Ops",
        runbookRef: "codex-plan/runbooks/provider-activation.md",
        health: "HEALTHY",
        healthCheckedAt: now,
        quotaUnits: 100,
        sustainableCapacity: 100,
        unitCostMicros: 1n,
        unitCostSource: "e2e-fixture",
        killSwitchEngaged: false,
        effectiveAt: now,
      },
    });
    await database.operationalCapacitySample.create({
      data: {
        environment: "local",
        queueKey: "worker",
        handlerKey: "ops.diagnostic-effect",
        handlerVersion: "v1",
        deploymentDigest: "phase23-e2e",
        windowStartedAt: new Date(now.getTime() - 60_000),
        windowEndedAt: now,
        arrivalCount: 10,
        completionCount: 10,
        failureCount: 0,
        retryCount: 0,
        deadLetterCount: 0,
        backlogCount: 1,
        oldestAgeMilliseconds: 1_000,
        sustainablePerMinute: 100,
        arrivalP95PerMinute: 50,
        handlingP50Milliseconds: 10,
        handlingP95Milliseconds: 20,
        utilizationBasisPoints: 5_000,
        workerCount: 1,
        unitCostMicros: 1n,
        unitCostSource: "e2e-fixture",
        state: "NORMAL",
        policyVersion: "phase23-v1",
      },
    });

    await login(page, DEMO_ACCOUNTS.admin, DEMO_PASSWORD);
    await page.goto("/admin/system");
    await expect(
      page.getByRole("heading", { name: "Systemstatus" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Worker Runtime" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Handler-Aktivierungsledger" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Kapazität und Backpressure" }),
    ).toBeVisible();
    await expect(page.getByText("NORMAL", { exact: true })).toBeVisible();
    await expect(page.locator("main")).not.toContainText(PAYLOAD_CANARY);
    await expect(page.locator("main")).not.toContainText(SECRET_CANARY);
    await expect(
      page.getByRole("button", {
        name: /Replay|aktivieren|pausieren|Kill Switch/u,
      }),
    ).toHaveCount(0);
  } finally {
    await database.$disconnect();
  }
});
