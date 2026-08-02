import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  beginStepUpChallenge,
  completeStepUpChallenge,
} from "@/lib/auth/assurance/step-up-service";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import { dispatchNotificationBatch } from "@/lib/notifications/dispatcher";
import { enqueueNotification } from "@/lib/notifications/outbox";
import {
  reconcileNotificationProviderOutcome,
  type NotificationOutcomeReconciliationDependencies,
} from "@/lib/notifications/outcome-reconciliation";
import {
  notificationOutcomeReconciliationStepUpAction,
  type NotificationOutcomeReconciliationResolution,
} from "@/lib/notifications/outcome-reconciliation-policy";
import {
  EmailDeliveryFailure,
  type EmailDeliveryProvider,
  type EmailDeliveryRequest,
} from "@/lib/providers/email/email-delivery-provider";
import { phase20Environment } from "@/tests/fixtures/phase20-identity";
import { activatePhase33SandboxEmailUseCases } from "@/tests/fixtures/phase33-provider-activation";
import {
  createPhase25SecurityFixture,
  PHASE25_NOW,
  type Phase25Actor,
  type Phase25SecurityFixture,
} from "@/tests/fixtures/phase25-security";

const NOW = PHASE25_NOW;
const EVIDENCE_DIGEST = "e".repeat(64);

let fixture: Phase25SecurityFixture | undefined;
let environment: ServerEnvironment | undefined;

beforeAll(async () => {
  fixture = await createPhase25SecurityFixture(
    "phase33_notification_outcome_reconciliation",
  );
  environment = phase20Environment(fixture.migrated.connectionString, {
    DELIVERY_REPLAY: "false",
    EMAIL_PROVIDER_MODE: "local_mock",
    NOTIFICATION_DISPATCH: "command",
    OPTIONAL_EMAIL: "true",
  });
  await fixture.assignRole(fixture.requester, "PLATFORM_OPERATOR");
}, 600_000);

beforeEach(async () => {
  const context = requireContext();
  await activatePhase33SandboxEmailUseCases(
    context.fixture.database,
    context.environment,
    ["email.transactional"],
    NOW,
  );
});

afterAll(async () => {
  await fixture?.dispose();
});

describe.sequential("Phase-33 notification outcome reconciliation", () => {
  it("authorizes before outbox access and consumes no grant without the operations capability", async () => {
    const context = requireContext();
    const paused = await createAmbiguousPause(context, "authz");
    const grant = await issueStepUp(
      context.fixture,
      context.fixture.approver,
      paused.outboxId,
      "UNKNOWN",
      NOW,
    );
    const result = await reconcileNotificationProviderOutcome(
      reconciliationInput(paused.outboxId, "UNKNOWN", grant),
      dependencies(context, context.fixture.approver, NOW),
    );
    expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
    await expect(
      context.fixture.database.authAssuranceEvidence.findUniqueOrThrow({
        where: { id: grant.stepUpEvidenceId },
        select: { usedAt: true },
      }),
    ).resolves.toEqual({ usedAt: null });
    await expect(outboxState(context, paused.outboxId)).resolves.toMatchObject({
      attemptCount: 1,
      lastErrorCode: "PROVIDER_OUTCOME_RECONCILIATION_REQUIRED",
      status: "PAUSED",
    });
  });

  it("keeps an unknown outcome paused and writes one strict, replayable evidence audit", async () => {
    const context = requireContext();
    const paused = await createAmbiguousPause(context, "unknown");
    const idempotencyKey = randomUUID();
    const firstGrant = await issueStepUp(
      context.fixture,
      context.fixture.requester,
      paused.outboxId,
      "UNKNOWN",
      NOW,
    );
    const input = reconciliationInput(paused.outboxId, "UNKNOWN", firstGrant, {
      idempotencyKey,
    });
    await expect(
      reconcileNotificationProviderOutcome(
        input,
        dependencies(context, context.fixture.requester, NOW),
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: { resolution: "UNKNOWN", status: "PAUSED" },
    });

    await expect(
      reconcileNotificationProviderOutcome(
        input,
        dependencies(
          context,
          context.fixture.requester,
          new Date(NOW.getTime() + 1_000),
        ),
      ),
    ).resolves.toMatchObject({ ok: true, replay: true });
    await expect(
      reconcileNotificationProviderOutcome(
        { ...input, evidenceReference: "provider-case:TAMPERED" },
        dependencies(
          context,
          context.fixture.requester,
          new Date(NOW.getTime() + 1_000),
        ),
      ),
    ).resolves.toEqual({ ok: false, code: "CONFLICT" });
    expect(paused.provider.requests).toHaveLength(1);
    expect(
      await context.fixture.database.auditLog.count({
        where: {
          action: "SYSTEM_TASK_OUTCOME_RECORDED",
          correlationId: idempotencyKey,
          targetId: paused.outboxId,
        },
      }),
    ).toBe(1);
  });

  it("terminalizes accepted evidence once without a second provider effect, including a concurrent replay", async () => {
    const context = requireContext();
    const paused = await createAmbiguousPause(context, "accepted");
    const idempotencyKey = randomUUID();
    const grant = await issueStepUp(
      context.fixture,
      context.fixture.requester,
      paused.outboxId,
      "ACCEPTED",
      NOW,
    );
    const base = {
      idempotencyKey,
      providerReceipt: `receipt_${randomUUID().replaceAll("-", "")}`,
    } as const;
    const input = reconciliationInput(paused.outboxId, "ACCEPTED", grant, base);
    const results = await Promise.all([
      reconcileNotificationProviderOutcome(
        input,
        dependencies(context, context.fixture.requester, NOW),
      ),
      reconcileNotificationProviderOutcome(
        input,
        dependencies(context, context.fixture.requester, NOW),
      ),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.filter((result) => result.ok && result.replay)).toHaveLength(
      1,
    );
    expect(paused.provider.requests).toHaveLength(1);

    const stored =
      await context.fixture.database.notificationOutbox.findUniqueOrThrow({
        where: { id: paused.outboxId },
        include: { attempts: { orderBy: { attemptNumber: "asc" } } },
      });
    expect(stored).toMatchObject({
      attemptCount: 2,
      deliveredAt: NOW,
      lastErrorCode: null,
      providerRequestCiphertext: null,
      providerRequestDestroyedAt: NOW,
      status: "DELIVERED",
    });
    expect(stored.attempts.map(({ outcome }) => outcome)).toEqual([
      "TIMED_OUT",
      "ACCEPTED",
    ]);
    expect(stored.attempts[1]).toMatchObject({
      providerActivationId: stored.attempts[0]?.providerActivationId,
      providerRequestDigest: stored.attempts[0]?.providerRequestDigest,
      providerReceipt: base.providerReceipt,
      recipientHash: stored.attempts[0]?.recipientHash,
      recipientHashKeyVersion: stored.attempts[0]?.recipientHashKeyVersion,
      recipientEvidenceRetainUntil: new Date(NOW.getTime() + 400 * 86_400_000),
      recipientEvidenceWipedAt: null,
    });
    expect(
      await context.fixture.database.auditLog.count({
        where: {
          action: "SYSTEM_TASK_OUTCOME_RECORDED",
          correlationId: idempotencyKey,
          targetId: paused.outboxId,
        },
      }),
    ).toBe(1);
  });

  it("serializes the same provider receipt across different accepted outboxes", async () => {
    const context = requireContext();
    const firstPaused = await createAmbiguousPause(
      context,
      "receipt-collision-first",
    );
    const secondPaused = await createAmbiguousPause(
      context,
      "receipt-collision-second",
    );
    const firstGrant = await issueStepUp(
      context.fixture,
      context.fixture.requester,
      firstPaused.outboxId,
      "ACCEPTED",
      NOW,
    );
    const secondGrant = await issueStepUp(
      context.fixture,
      context.fixture.requester,
      secondPaused.outboxId,
      "ACCEPTED",
      NOW,
    );
    const sharedReceipt = `receipt_${randomUUID().replaceAll("-", "")}`;
    const results = await Promise.all([
      reconcileNotificationProviderOutcome(
        reconciliationInput(firstPaused.outboxId, "ACCEPTED", firstGrant, {
          providerReceipt: sharedReceipt,
        }),
        dependencies(context, context.fixture.requester, NOW),
      ),
      reconcileNotificationProviderOutcome(
        reconciliationInput(secondPaused.outboxId, "ACCEPTED", secondGrant, {
          providerReceipt: sharedReceipt,
        }),
        dependencies(context, context.fixture.requester, NOW),
      ),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, code: "CONFLICT" },
    ]);
    const states = await context.fixture.database.notificationOutbox.findMany({
      where: { id: { in: [firstPaused.outboxId, secondPaused.outboxId] } },
      select: { status: true },
    });
    expect(states.filter(({ status }) => status === "DELIVERED")).toHaveLength(
      1,
    );
    expect(states.filter(({ status }) => status === "PAUSED")).toHaveLength(1);
  });

  it("releases a definitive rejection only as the same frozen request and effect identity", async () => {
    const context = requireContext();
    const paused = await createAmbiguousPause(context, "not-accepted");
    const before =
      await context.fixture.database.notificationOutbox.findUniqueOrThrow({
        where: { id: paused.outboxId },
        select: {
          providerDedupeKey: true,
          providerRequestActivationId: true,
          providerRequestCiphertext: true,
          providerRequestDigest: true,
        },
      });
    const grant = await issueStepUp(
      context.fixture,
      context.fixture.requester,
      paused.outboxId,
      "DEFINITIVELY_NOT_ACCEPTED",
      NOW,
    );
    const input = reconciliationInput(
      paused.outboxId,
      "DEFINITIVELY_NOT_ACCEPTED",
      grant,
    );
    await expect(
      reconcileNotificationProviderOutcome(
        input,
        dependencies(context, context.fixture.requester, NOW),
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: { resolution: "DEFINITIVELY_NOT_ACCEPTED", status: "RETRY" },
    });
    await expect(
      context.fixture.database.notificationOutbox.findUniqueOrThrow({
        where: { id: paused.outboxId },
        select: {
          providerDedupeKey: true,
          providerRequestActivationId: true,
          providerRequestCiphertext: true,
          providerRequestDigest: true,
          status: true,
        },
      }),
    ).resolves.toEqual({ ...before, status: "RETRY" });

    await expect(
      dispatchNotificationBatch({
        database: context.fixture.database,
        environment: context.environment,
        provider: paused.provider,
        workerId: "phase33-reconciliation-retry",
        clock: () => new Date(NOW.getTime() + 1_000),
      }),
    ).resolves.toMatchObject({ claimed: 1, delivered: 1 });
    expect(paused.provider.requests).toHaveLength(2);
    expect(paused.provider.requests[1]).toEqual(paused.provider.requests[0]);
    expect(paused.provider.acceptedEffects).toEqual([before.providerDedupeKey]);
    await expect(
      reconcileNotificationProviderOutcome(
        input,
        dependencies(
          context,
          context.fixture.requester,
          new Date(NOW.getTime() + 2_000),
        ),
      ),
    ).resolves.toMatchObject({
      ok: true,
      replay: true,
      value: { resolution: "DEFINITIVELY_NOT_ACCEPTED", status: "RETRY" },
    });
    expect(paused.provider.requests).toHaveLength(2);
  });

  it("fails closed when the frozen activation is no longer current", async () => {
    const context = requireContext();
    const paused = await createAmbiguousPause(context, "revoked");
    await context.fixture.database.providerActivation.update({
      where: { id: paused.providerActivationId },
      data: {
        killSwitchEngaged: true,
        revokedAt: new Date(NOW.getTime() + 1_000),
        revokeReasonCode: "INCIDENT_REVOKED",
      },
    });
    const actionAt = new Date(NOW.getTime() + 2_000);
    const grant = await issueStepUp(
      context.fixture,
      context.fixture.requester,
      paused.outboxId,
      "DEFINITIVELY_NOT_ACCEPTED",
      actionAt,
    );
    await expect(
      reconcileNotificationProviderOutcome(
        reconciliationInput(
          paused.outboxId,
          "DEFINITIVELY_NOT_ACCEPTED",
          grant,
        ),
        dependencies(context, context.fixture.requester, actionAt),
      ),
    ).resolves.toEqual({
      ok: false,
      code: "PROVIDER_CONTRACT_UNAVAILABLE",
    });
    await expect(outboxState(context, paused.outboxId)).resolves.toMatchObject({
      status: "PAUSED",
      lastErrorCode: "PROVIDER_OUTCOME_RECONCILIATION_REQUIRED",
    });
  });

  it("fails closed after the 23-hour frozen-material deadline", async () => {
    const context = requireContext();
    const paused = await createAmbiguousPause(context, "expired");
    const actionAt = new Date(NOW.getTime() + 23 * 60 * 60_000);
    await context.fixture.database.sessionAssurance.update({
      where: { sessionId: context.fixture.requester.sessionId },
      data: {
        expiresAt: new Date(actionAt.getTime() + 30 * 60_000),
        verifiedAt: new Date(actionAt.getTime() - 1_000),
      },
    });
    const grant = await issueStepUp(
      context.fixture,
      context.fixture.requester,
      paused.outboxId,
      "ACCEPTED",
      actionAt,
    );
    await expect(
      reconcileNotificationProviderOutcome(
        reconciliationInput(paused.outboxId, "ACCEPTED", grant, {
          providerReceipt: "receipt_after_retention_deadline",
        }),
        dependencies(context, context.fixture.requester, actionAt),
      ),
    ).resolves.toEqual({ ok: false, code: "MATERIAL_EXPIRED" });
    expect(paused.provider.requests).toHaveLength(1);
    await expect(outboxState(context, paused.outboxId)).resolves.toMatchObject({
      attemptCount: 1,
      status: "PAUSED",
    });
  });
});

class AmbiguousThenAcceptedProvider implements EmailDeliveryProvider {
  readonly providerClass = "local-mock-v1";
  readonly requests: EmailDeliveryRequest[] = [];
  readonly acceptedEffects: string[] = [];

  async deliver(input: EmailDeliveryRequest) {
    this.requests.push(structuredClone(input));
    if (this.requests.length === 1) {
      throw new EmailDeliveryFailure("TIMEOUT", "PROVIDER_OUTCOME_UNKNOWN");
    }
    this.acceptedEffects.push(input.idempotencyKey);
    return Object.freeze({
      accepted: true as const,
      providerClass: this.providerClass,
      providerReceipt: `receipt:${input.idempotencyKey}`,
    });
  }
}

async function createAmbiguousPause(
  context: ReturnType<typeof requireContext>,
  suffix: string,
) {
  const outbox = await context.fixture.database.$transaction((transaction) =>
    enqueueNotification(transaction, {
      availableAt: NOW,
      dedupeKey: `phase33-reconciliation:${suffix}:${randomUUID()}`,
      maxAttempts: 1,
      payload: { emailChangeId: randomUUID() },
      payloadSchemaVersion: "identity-v1",
      recipient: { userId: context.fixture.candidate.userId },
      templateKey: "login_email_changed_notice",
    }),
  );
  const provider = new AmbiguousThenAcceptedProvider();
  await expect(
    dispatchNotificationBatch({
      batchSize: 1,
      clock: () => NOW,
      database: context.fixture.database,
      environment: context.environment,
      provider,
      workerId: `phase33-reconciliation-${suffix}`,
    }),
  ).resolves.toMatchObject({ claimed: 1, paused: 1 });
  const stored =
    await context.fixture.database.notificationOutbox.findUniqueOrThrow({
      where: { id: outbox.id },
      select: {
        providerRequestActivationId: true,
        status: true,
        lastErrorCode: true,
      },
    });
  expect(stored).toMatchObject({
    lastErrorCode: "PROVIDER_OUTCOME_RECONCILIATION_REQUIRED",
    status: "PAUSED",
  });
  if (stored.providerRequestActivationId === null) {
    throw new Error("Expected frozen provider activation evidence.");
  }
  return Object.freeze({
    outboxId: outbox.id,
    provider,
    providerActivationId: stored.providerRequestActivationId,
  });
}

async function issueStepUp(
  context: Phase25SecurityFixture,
  actor: Phase25Actor,
  outboxId: string,
  resolution: NotificationOutcomeReconciliationResolution,
  now: Date,
) {
  const stepUpDependencies = context.stepUpDependencies(actor, now);
  const begun = await beginStepUpChallenge(
    {
      action: notificationOutcomeReconciliationStepUpAction(resolution),
      purpose: "NOTIFICATION_RECONCILIATION",
      resourceId: outboxId,
    },
    stepUpDependencies,
  );
  if (!begun.ok) throw new Error(`Step-up challenge failed: ${begun.code}`);
  const completed = await completeStepUpChallenge(
    {
      challengeId: begun.value.challengeId,
      challengeToken: begun.value.challengeToken,
    },
    stepUpDependencies,
  );
  if (!completed.ok) {
    throw new Error(`Step-up completion failed: ${completed.code}`);
  }
  return Object.freeze({
    stepUpEvidenceId: completed.value.evidenceId,
    stepUpGrantToken: completed.value.grantToken,
  });
}

function reconciliationInput(
  outboxId: string,
  resolution: NotificationOutcomeReconciliationResolution,
  grant: Readonly<{
    stepUpEvidenceId: string;
    stepUpGrantToken: string;
  }>,
  overrides: Readonly<{
    idempotencyKey?: string;
    providerReceipt?: string;
  }> = {},
) {
  return Object.freeze({
    evidenceDigest: EVIDENCE_DIGEST,
    evidenceReference: "provider-case:PHASE33-RECONCILIATION",
    idempotencyKey: overrides.idempotencyKey ?? randomUUID(),
    outboxId,
    ...(resolution === "ACCEPTED"
      ? { providerReceipt: overrides.providerReceipt ?? "receipt_phase33" }
      : {}),
    reasonCode:
      resolution === "ACCEPTED"
        ? "PROVIDER_ACCEPTANCE_VERIFIED"
        : resolution === "DEFINITIVELY_NOT_ACCEPTED"
          ? "PROVIDER_REJECTION_VERIFIED"
          : "PROVIDER_OUTCOME_STILL_UNKNOWN",
    resolution,
    ...grant,
  });
}

function dependencies(
  context: ReturnType<typeof requireContext>,
  actor: Phase25Actor,
  now: Date,
): NotificationOutcomeReconciliationDependencies {
  return Object.freeze({
    actor: {
      email: actor.email,
      role: actor.role,
      sessionId: actor.sessionId,
      status: "ACTIVE",
      userId: actor.userId,
    },
    correlationId: randomUUID(),
    database: context.fixture.database,
    environment: context.environment,
    now,
  });
}

function outboxState(
  context: ReturnType<typeof requireContext>,
  outboxId: string,
) {
  return context.fixture.database.notificationOutbox.findUniqueOrThrow({
    where: { id: outboxId },
    select: { attemptCount: true, lastErrorCode: true, status: true },
  });
}

function requireContext() {
  if (fixture === undefined || environment === undefined) {
    throw new Error(
      "Phase-33 notification reconciliation fixture unavailable.",
    );
  }
  return Object.freeze({ fixture, environment });
}
