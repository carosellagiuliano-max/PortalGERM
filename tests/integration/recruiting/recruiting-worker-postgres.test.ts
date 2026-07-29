import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ServerEnvironment } from "@/lib/config/env-schema";
import { getWorkerHandlerDefinition } from "@/lib/ops/handler-catalog";
import { executeRegisteredHandler } from "@/lib/ops/registered-handler-runtime";
import {
  claimWorkBatch,
  createWorkerRun,
  enqueueWorkItem,
  type ClaimedWorkItem,
  type WorkLeaseIdentity,
} from "@/lib/ops/worker-runtime";
import { processRecruitingReminderExpiry } from "@/lib/recruiting/reminder-worker";
import {
  createExternalApplicationTracker,
  setExternalApplicationReminder,
} from "@/lib/recruiting/external-tracker";
import {
  proposeInterview,
  respondToInterview,
} from "@/lib/recruiting/interviews";
import {
  createPhase28RecruitingFixture,
  type Phase28RecruitingFixture,
} from "@/tests/fixtures/phase28-recruiting";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const DEPLOYMENT = "phase28-worker-build";

describe.sequential("Phase 28 recruiting reminder/expiry worker", () => {
  let fixture: Phase28RecruitingFixture;
  let trackerId = "";
  let interviewId = "";

  beforeAll(async () => {
    fixture = await createPhase28RecruitingFixture("worker");
  }, 120_000);

  afterAll(async () => {
    await fixture?.dispose();
  });

  it("registers the handler and keeps all effects off behind both kill switches", async () => {
    expect(
      getWorkerHandlerDefinition("recruiting.reminder-expiry", "v1"),
    ).toMatchObject({
      execution: "IMPLEMENTED",
      schedule: "minute-boundary",
      owner: "Recruiting / Privacy / Platform",
    });
    expect(
      await processRecruitingReminderExpiry({
        database: fixture.database,
        environment: {
          ...fixture.environment,
          EXTERNAL_APPLICATION_TRACKER: "disabled",
          INTERVIEW_SCHEDULER: "disabled",
        },
        now: fixture.now,
      }),
    ).toEqual({
      externalReminders: 0,
      interviewReminders: 0,
      expiredProposals: 0,
    });
  });

  it("queues due reminders exactly once and expires only open current proposals", async () => {
    const tracker = await createExternalApplicationTracker(
      {
        candidateUserId: fixture.candidateUserId,
        jobId: fixture.jobId,
        jobRevisionId: fixture.revisionId,
        idempotencyKey: randomUUID(),
      },
      fixture.dependencies(),
    );
    if (!tracker.ok) throw new Error(tracker.code);
    trackerId = tracker.trackerId;
    const reminderAt = new Date(fixture.now.getTime() + HOUR);
    const reminder = await setExternalApplicationReminder(
      {
        candidateUserId: fixture.candidateUserId,
        trackerId,
        reminderAt,
        expectedVersion: tracker.version,
        idempotencyKey: randomUUID(),
      },
      fixture.dependencies(),
    );
    if (!reminder.ok) throw new Error(reminder.code);

    const proposed = await proposeInterview(
      fixture.access,
      {
        applicationId: fixture.applicationId,
        timeZone: "Europe/Zurich",
        subject: "Worker reminder interview",
        slots: [
          {
            startsAt: new Date(fixture.now.getTime() + 3 * DAY),
            endsAt: new Date(fixture.now.getTime() + 3 * DAY + HOUR),
          },
        ],
        idempotencyKey: randomUUID(),
      },
      fixture.dependencies(),
    );
    if (!proposed.ok) throw new Error(proposed.code);
    interviewId = proposed.interviewId;
    const proposal =
      await fixture.database.interviewProposal.findFirstOrThrow({
        where: { interviewId, status: "OPEN" },
      });
    const accepted = await respondToInterview(
      {
        actorUserId: fixture.candidateUserId,
        interviewId,
        kind: "ACCEPT",
        proposalId: proposal.id,
        expectedVersion: proposed.version,
        idempotencyKey: randomUUID(),
      },
      fixture.dependencies(),
    );
    if (!accepted.ok) throw new Error(accepted.code);

    const foreignApplication = await fixture.database.application.create({
      data: {
        jobId: fixture.jobId,
        submittedJobRevisionId: fixture.revisionId,
        candidateProfileId: fixture.foreignCandidateProfileId,
        idempotencyKey: `phase28-worker-foreign-${randomUUID()}`,
        submissionPayloadHash: "e".repeat(64),
        status: "SUBMITTED",
        submittedAt: fixture.now,
        updatedAt: fixture.now,
      },
    });
    const expiring = await proposeInterview(
      fixture.access,
      {
        applicationId: foreignApplication.id,
        timeZone: "Europe/Zurich",
        subject: "Expiring proposal",
        slots: [
          {
            startsAt: new Date(fixture.now.getTime() + 2 * DAY),
            endsAt: new Date(fixture.now.getTime() + 2 * DAY + HOUR),
          },
        ],
        idempotencyKey: randomUUID(),
      },
      fixture.dependencies(),
    );
    if (!expiring.ok) throw new Error(expiring.code);

    const runAt = new Date(fixture.now.getTime() + 2 * DAY);
    const first = await processRecruitingReminderExpiry({
      database: fixture.database,
      environment: fixture.environment,
      now: runAt,
    });
    expect(first).toEqual({
      externalReminders: 1,
      interviewReminders: 2,
      expiredProposals: 1,
    });
    expect(
      await processRecruitingReminderExpiry({
        database: fixture.database,
        environment: fixture.environment,
        now: runAt,
      }),
    ).toEqual({
      externalReminders: 0,
      interviewReminders: 0,
      expiredProposals: 0,
    });
    await expect(
      fixture.database.externalApplicationTracker.findUniqueOrThrow({
        where: { id: trackerId },
      }),
    ).resolves.toMatchObject({ reminderAt: null });
    expect(
      await fixture.database.notification.count({
        where: {
          recipientUserId: fixture.candidateUserId,
          kind: { in: ["EXTERNAL_APPLICATION_CHANGED", "INTERVIEW_REMINDER"] },
        },
      }),
    ).toBe(2);
    await expect(
      fixture.database.interview.findUniqueOrThrow({
        where: { id: expiring.interviewId },
      }),
    ).resolves.toMatchObject({ status: "DECLINED" });
  });

  it("runs through the fenced Phase-23 queue with one effect receipt", async () => {
    const item = await enqueueWorkItem(fixture.database, {
      handlerKey: "recruiting.reminder-expiry",
      handlerVersion: "v1",
      payloadVersion: "v1",
      subjectType: "RECRUITING_SCHEDULE",
      subjectId: `phase28-${randomUUID()}`,
      dedupeKey: `recruiting.reminder-expiry:v1:${randomUUID()}`,
      effectKey: `effect:recruiting.reminder-expiry:v1:${randomUUID()}`,
      availableAt: new Date(fixture.now.getTime() + 2 * DAY + MINUTE),
      payloadReference: { scope: "phase28" },
    });
    const at = new Date(fixture.now.getTime() + 2 * DAY + MINUTE);
    const { claimed, identity } = await claim(item.id, "phase28-worker-ok", at);
    const result = await executeRegisteredHandler(claimed, {
      database: fixture.database,
      environment: fixture.environment,
      identity,
      leaseMilliseconds: 6_000,
      now: () => new Date(at.getTime() + 100),
    });
    expect(result).toMatchObject({
      completion: "COMPLETED",
      handlerKey: "recruiting.reminder-expiry",
    });
    expect(
      await fixture.database.workEffectReceipt.count({
        where: { workItemId: item.id },
      }),
    ).toBe(1);
    expect(
      await fixture.database.workItem.findUniqueOrThrow({
        where: { id: item.id },
        select: { status: true },
      }),
    ).toEqual({ status: "SUCCEEDED" });
  });

  it("retries a poisoned handler and moves it once to the DLQ at its budget", async () => {
    const item = await enqueueWorkItem(fixture.database, {
      handlerKey: "recruiting.reminder-expiry",
      handlerVersion: "v1",
      payloadVersion: "v1",
      subjectType: "RECRUITING_SCHEDULE",
      subjectId: `phase28-poison-${randomUUID()}`,
      dedupeKey: `recruiting.reminder-expiry:poison:${randomUUID()}`,
      effectKey: `effect:recruiting.reminder-expiry:poison:${randomUUID()}`,
      availableAt: fixture.now,
      maxAttempts: 2,
      payloadReference: { scope: "phase28-poison" },
    });
    const poisonEnvironment = new Proxy(fixture.environment, {
      get(target, property, receiver) {
        if (property === "EXTERNAL_APPLICATION_TRACKER") {
          throw new Error("phase28 poison environment");
        }
        return Reflect.get(target, property, receiver);
      },
    }) as ServerEnvironment;
    const firstClaim = await claim(item.id, "phase28-worker-poison-a", fixture.now);
    const first = await executeRegisteredHandler(firstClaim.claimed, {
      database: fixture.database,
      environment: poisonEnvironment,
      identity: firstClaim.identity,
      leaseMilliseconds: 6_000,
      now: () => new Date(fixture.now.getTime() + 100),
    });
    expect(first.completion).toBe("RETRY");
    const retryAt = await fixture.database.workItem
      .findUniqueOrThrow({
        where: { id: item.id },
        select: { availableAt: true },
      })
      .then(({ availableAt }) => new Date(availableAt.getTime() + 1));
    const secondClaim = await claim(
      item.id,
      "phase28-worker-poison-b",
      retryAt,
    );
    const second = await executeRegisteredHandler(secondClaim.claimed, {
      database: fixture.database,
      environment: poisonEnvironment,
      identity: secondClaim.identity,
      leaseMilliseconds: 6_000,
      now: () => new Date(retryAt.getTime() + 100),
    });
    expect(second.completion).toBe("DEAD_LETTER");
    expect(
      await fixture.database.workDeadLetter.count({
        where: { workItemId: item.id },
      }),
    ).toBe(1);
    expect(
      await fixture.database.workEffectReceipt.count({
        where: { workItemId: item.id },
      }),
    ).toBe(0);
  });

  async function claim(
    expectedId: string,
    workerId: string,
    now: Date,
  ): Promise<Readonly<{ claimed: ClaimedWorkItem; identity: WorkLeaseIdentity }>> {
    const run = await createWorkerRun(fixture.database, {
      workerId,
      environment: "ci",
      deploymentDigest: DEPLOYMENT,
      runtimeVersion: "v1",
      now,
    });
    const items = await claimWorkBatch(fixture.database, {
      deploymentDigest: DEPLOYMENT,
      handlerKey: "recruiting.reminder-expiry",
      handlerVersion: "v1",
      payloadVersion: "v1",
      workerId,
      workerRunId: run.id,
      now,
      policy: {
        batchSize: 1,
        leaseMilliseconds: 6_000,
        heartbeatMilliseconds: 2_000,
      },
    });
    expect(items[0]?.id).toBe(expectedId);
    const claimed = items[0]!;
    return Object.freeze({
      claimed,
      identity: Object.freeze({
        workItemId: claimed.id,
        workerRunId: run.id,
        workerId,
        deploymentDigest: DEPLOYMENT,
        fencingToken: claimed.fencingToken,
      }),
    });
  }
});
