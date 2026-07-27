import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseEnvironment } from "@/lib/config/env-schema";
import { executeRegisteredHandler } from "@/lib/ops/registered-handler-runtime";
import {
  claimWorkBatch,
  createWorkerRun,
  enqueueWorkItem,
} from "@/lib/ops/worker-runtime";
import { recordAndDecideRiskSignal } from "@/lib/security/risk/risk-service";
import { projectExpiredTrustCases } from "@/lib/trust-safety/case-service";
import { createValidEnvironment } from "@/tests/fixtures/environment";
import {
  createPhase25SecurityFixture,
  type Phase25SecurityFixture,
} from "@/tests/fixtures/phase25-security";
import { createPhase25TrustCompany } from "@/tests/fixtures/phase25-trust";

describe("Phase 25 Trust worker failure and idempotency", () => {
  let fixture: Phase25SecurityFixture;

  beforeAll(async () => {
    fixture = await createPhase25SecurityFixture(
      "phase25_trust_worker_failure",
    );
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  it("stays fail closed during queue delay and recovers effect-before-ack exactly once", async () => {
    const scenario = await createPhase25TrustCompany(fixture);
    const signalAt = new Date(fixture.now.getTime() - 25 * 60 * 60_000);
    const signal = await recordAndDecideRiskSignal(
      {
        kind: "JOB_SCAM",
        subjectType: "JOB",
        subjectId: scenario.job.id,
        companyId: scenario.company.id,
        source: "ABUSE_REPORT",
        observedCount: 2,
        evidenceReference: `worker-abuse:${crypto.randomUUID()}`,
        idempotencyKey: `worker-abuse:${crypto.randomUUID()}`,
      },
      {
        database: fixture.database,
        correlationId: crypto.randomUUID(),
        mode: "hold",
        now: signalAt,
      },
    );
    expect(signal.ok).toBe(true);
    if (!signal.ok || signal.value.caseId === null) return;
    expect(
      (
        await fixture.database.job.findUniqueOrThrow({
          where: { id: scenario.job.id },
        })
      ).status,
    ).toBe("PAUSED");

    const firstProjection = await projectExpiredTrustCases(
      fixture.database,
      fixture.now,
    );
    expect(firstProjection).toEqual({ expired: 1, alerts: 1 });

    const item = await enqueueWorkItem(fixture.database, {
      handlerKey: "trust.case-expiry",
      handlerVersion: "v1",
      payloadVersion: "v1",
      subjectType: "SCHEDULE_TICK",
      subjectId: "phase25-expiry",
      dedupeKey: `trust.case-expiry:v1:${crypto.randomUUID()}`,
      effectKey: `effect:trust.case-expiry:v1:${crypto.randomUUID()}`,
      availableAt: fixture.now,
      payloadReference: { scheduleBucket: 1 },
    });
    const run = await createWorkerRun(fixture.database, {
      workerId: "phase25-trust-worker",
      environment: "ci",
      deploymentDigest: "phase25-test-build",
      runtimeVersion: "v1",
      now: fixture.now,
    });
    const [claimed] = await claimWorkBatch(fixture.database, {
      deploymentDigest: "phase25-test-build",
      handlerKey: "trust.case-expiry",
      handlerVersion: "v1",
      payloadVersion: "v1",
      workerId: "phase25-trust-worker",
      workerRunId: run.id,
      now: fixture.now,
      policy: {
        batchSize: 1,
        leaseMilliseconds: 15_000,
        heartbeatMilliseconds: 5_000,
      },
    });
    expect(claimed?.id).toBe(item.id);
    const execution = await executeRegisteredHandler(claimed!, {
      database: fixture.database,
      environment: parseEnvironment(
        createValidEnvironment({ WORKER_RUNTIME: "sandbox_command" }),
      ),
      identity: {
        workItemId: item.id,
        workerRunId: run.id,
        workerId: "phase25-trust-worker",
        deploymentDigest: "phase25-test-build",
        fencingToken: claimed!.fencingToken,
      },
      leaseMilliseconds: 15_000,
      now: () => new Date(fixture.now.getTime() + 100),
    });
    expect(execution.completion).toBe("COMPLETED");
    expect(
      await fixture.database.trustSafetyCaseEvent.count({
        where: {
          trustSafetyCaseId: signal.value.caseId,
          kind: "EXPIRED",
        },
      }),
    ).toBe(1);
    expect(
      await fixture.database.systemTask.count({
        where: { idempotencyKey: `trust-expired:${signal.value.caseId}` },
      }),
    ).toBe(1);
    expect(
      await fixture.database.workEffectReceipt.count({
        where: { workItemId: item.id },
      }),
    ).toBe(1);
  });
});
