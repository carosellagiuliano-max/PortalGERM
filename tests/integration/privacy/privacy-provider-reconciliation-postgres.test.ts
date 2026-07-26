import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runPrivacyExecutionV2 } from "@/lib/privacy/execution-v2";
import {
  createMemoryDocumentStore,
  createPhase22Harness,
  PHASE22_NOW,
  privacyExecutionCommand,
  seedActiveInventory,
  seedPhase22Actors,
  seedPrivacyRequest,
  seedProcessingApproval,
  seedPublishedPrivacyNotice,
  type Phase22Actors,
  type Phase22Harness,
} from "@/tests/fixtures/phase22-privacy";

let harness: Phase22Harness | undefined;
let actors: Phase22Actors | undefined;

beforeAll(async () => {
  harness = await createPhase22Harness("phase22_provider_reconciliation");
  actors = await seedPhase22Actors(harness.client, "reconciliation");
});

afterAll(async () => {
  await harness?.dispose();
});

describe("Phase-22 provider reconciliation", () => {
  it("persists a partial retry without false completion and resumes only open processors", async () => {
    const { client, users } = requireFixture();
    const legal = await seedPublishedPrivacyNotice(
      client,
      users,
      "reconciliation",
    );
    await seedActiveInventory(client, "reconciliation", [
      "notification-outbox",
      "postgres-primary",
    ]);
    for (const processorKey of [
      "notification-outbox",
      "postgres-primary",
    ] as const) {
      await seedProcessingApproval(client, legal.publication.id, {
        suffix: `recon-${processorKey}`,
        scope: "PRIVACY_CORRECTION",
        processorKey,
      });
    }
    const request = await seedPrivacyRequest(client, users, "CORRECT");
    await client.privacyRequestCorrectionField.create({
      data: {
        privacyRequestId: request.id,
        fieldCode: "DISPLAY_NAME",
        correctionText: "Reconciled Phase 22 Name",
      },
    });
    const command = privacyExecutionCommand(request.id, users);
    const baseDependencies = {
      database: client,
      documentStore: createMemoryDocumentStore(),
      correctionEnabled: true,
      erasureEnabled: false,
      cohortAllowed: true,
      processingMode: "sandbox_command" as const,
      now: PHASE22_NOW,
    };

    const first = await runPrivacyExecutionV2(command, {
      ...baseDependencies,
      injectProcessorFailure: (processorKey, attempt) =>
        processorKey === "notification-outbox" && attempt === 1
          ? "RETRYABLE"
          : null,
    });
    expect(first).toMatchObject({
      ok: false,
      code: "RETRY_REQUIRED",
    });
    if (first.ok || first.executionId === undefined) {
      throw new Error("Expected a persisted retry execution.");
    }

    const partial = await client.privacyExecution.findUniqueOrThrow({
      where: { id: first.executionId },
      include: { processorOutcomes: { orderBy: { processorKey: "asc" } } },
    });
    expect(partial.status).toBe("RETRY_REQUIRED");
    expect(partial.completedAt).toBeNull();
    expect(partial.processorOutcomes).toMatchObject([
      {
        processorKey: "notification-outbox",
        status: "RETRY_REQUIRED",
        attemptCount: 1,
      },
      {
        processorKey: "postgres-primary",
        status: "PENDING",
        attemptCount: 0,
      },
    ]);
    await expect(
      client.privacyRequest.findUniqueOrThrow({ where: { id: request.id } }),
    ).resolves.toMatchObject({ status: "IN_PROGRESS", completedAt: null });

    const resumed = await runPrivacyExecutionV2(command, baseDependencies);
    expect(resumed).toMatchObject({
      ok: true,
      replay: true,
      executionId: first.executionId,
      status: "COMPLETED",
    });

    const completed = await client.privacyExecution.findUniqueOrThrow({
      where: { id: first.executionId },
      include: { processorOutcomes: { orderBy: { processorKey: "asc" } } },
    });
    expect(completed).toMatchObject({
      status: "COMPLETED",
      checkpoint: 2,
      processorOutcomes: [
        {
          processorKey: "notification-outbox",
          status: "RETAINED",
          attemptCount: 2,
          retainedBasisRef: "CANONICAL_PROVIDER_REVIEW_REQUIRED",
        },
        {
          processorKey: "postgres-primary",
          status: "SUCCEEDED",
          attemptCount: 1,
        },
      ],
    });
    await expect(
      client.user.findUniqueOrThrow({ where: { id: users.requester.id } }),
    ).resolves.toMatchObject({ name: "Reconciled Phase 22 Name" });
  });
});

function requireFixture() {
  if (harness === undefined || actors === undefined) {
    throw new Error("Phase-22 reconciliation fixture is unavailable.");
  }
  return { client: harness.client, users: actors };
}
