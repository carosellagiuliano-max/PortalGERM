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
  harness = await createPhase22Harness("phase22_privacy_correction");
  actors = await seedPhase22Actors(harness.client, "correction");
});

afterAll(async () => {
  await harness?.dispose();
});

describe("Phase-22 canonical privacy correction", () => {
  it("applies an approved correction once and persists complete evidence plus notification", async () => {
    const { client, users } = requireFixture();
    const legal = await seedPublishedPrivacyNotice(
      client,
      users,
      "correction",
    );
    await seedActiveInventory(client, "correction", ["postgres-primary"]);
    await seedProcessingApproval(client, legal.publication.id, {
      suffix: "correction",
      scope: "PRIVACY_CORRECTION",
      processorKey: "postgres-primary",
    });
    const request = await seedPrivacyRequest(client, users, "CORRECT");
    await client.privacyRequestCorrectionField.create({
      data: {
        privacyRequestId: request.id,
        fieldCode: "DISPLAY_NAME",
        correctionText: "Korrigierter Anzeigename",
      },
    });
    const command = privacyExecutionCommand(request.id, users);
    const dependencies = {
      database: client,
      documentStore: createMemoryDocumentStore(),
      correctionEnabled: true,
      erasureEnabled: false,
      cohortAllowed: true,
      processingMode: "sandbox_command" as const,
      now: PHASE22_NOW,
    };

    const result = await runPrivacyExecutionV2(command, dependencies);
    expect(result).toMatchObject({
      ok: true,
      replay: false,
      privacyRequestId: request.id,
      status: "COMPLETED",
    });
    if (!result.ok) throw new Error("Correction execution failed.");

    const [updatedUser, updatedRequest, execution, notification] =
      await Promise.all([
        client.user.findUniqueOrThrow({ where: { id: users.requester.id } }),
        client.privacyRequest.findUniqueOrThrow({ where: { id: request.id } }),
        client.privacyExecution.findUniqueOrThrow({
          where: { id: result.executionId },
          include: { processorOutcomes: true },
        }),
        client.notification.findFirst({
          where: {
            recipientUserId: users.requester.id,
            kind: "PRIVACY_REQUEST_CHANGED",
          },
        }),
      ]);

    expect(updatedUser.name).toBe("Korrigierter Anzeigename");
    expect(updatedRequest).toMatchObject({
      status: "COMPLETED",
      correctionOutcome: "CORRECTED_VIA_CANONICAL_COMMAND",
    });
    expect(updatedRequest.domainEventRefs).toHaveLength(1);
    expect(execution).toMatchObject({
      status: "COMPLETED",
      checkpoint: 1,
      approvedByUserId: users.approvalAdmin.id,
      processorOutcomes: [
        {
          processorKey: "postgres-primary",
          status: "SUCCEEDED",
          outcomeCode: "CANONICAL_CORRECTION_APPLIED",
        },
      ],
    });
    expect(notification).not.toBeNull();

    await expect(
      runPrivacyExecutionV2(command, dependencies),
    ).resolves.toMatchObject({
      ok: true,
      replay: true,
      executionId: result.executionId,
    });
    await expect(
      client.privacyExecution.count({
        where: { privacyRequestId: request.id, kind: "CORRECTION" },
      }),
    ).resolves.toBe(1);
  });
});

function requireFixture() {
  if (harness === undefined || actors === undefined) {
    throw new Error("Phase-22 correction fixture is unavailable.");
  }
  return { client: harness.client, users: actors };
}
