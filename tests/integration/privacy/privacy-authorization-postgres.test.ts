import { randomUUID } from "node:crypto";

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
  type Phase22Actors,
  type Phase22Harness,
} from "@/tests/fixtures/phase22-privacy";

let harness: Phase22Harness | undefined;
let actors: Phase22Actors | undefined;

beforeAll(async () => {
  harness = await createPhase22Harness("phase22_privacy_authorization");
  actors = await seedPhase22Actors(harness.client, "authorization");
  await seedActiveInventory(harness.client, "authorization", [
    "postgres-primary",
  ]);
});

afterAll(async () => {
  await harness?.dispose();
});

describe("Phase-22 privacy execution authorization", () => {
  it("fails closed for disabled, unverified, unassigned and non-separated commands", async () => {
    const { client, users } = requireFixture();
    const request = await seedPrivacyRequest(client, users, "CORRECT");
    await client.privacyRequestCorrectionField.create({
      data: {
        privacyRequestId: request.id,
        fieldCode: "DISPLAY_NAME",
        correctionText: "Denied command must not write",
      },
    });
    const base = privacyExecutionCommand(request.id, users);
    const enabled = {
      database: client,
      documentStore: createMemoryDocumentStore(),
      correctionEnabled: true,
      erasureEnabled: true,
      cohortAllowed: true,
      processingMode: "sandbox_command" as const,
      now: PHASE22_NOW,
    };

    await expect(
      runPrivacyExecutionV2(base, { ...enabled, processingMode: "disabled" }),
    ).resolves.toEqual({ ok: false, code: "FEATURE_DISABLED" });
    await expect(
      runPrivacyExecutionV2(
        {
          ...base,
          actorUserId: users.legalAuthor.id,
          idempotencyKey: randomUUID(),
        },
        enabled,
      ),
    ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    await expect(
      runPrivacyExecutionV2(
        {
          ...base,
          approvalActorUserId: users.assignedAdmin.id,
          idempotencyKey: randomUUID(),
        },
        enabled,
      ),
    ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    await expect(
      runPrivacyExecutionV2(
        {
          ...base,
          approvalActorUserId: users.requester.id,
          idempotencyKey: randomUUID(),
        },
        enabled,
      ),
    ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });

    await client.privacyRequest.update({
      where: { id: request.id },
      data: { verifiedAt: null },
    });
    await expect(runPrivacyExecutionV2(base, enabled)).resolves.toEqual({
      ok: false,
      code: "WRONG_STATE",
    });
    await client.privacyRequest.update({
      where: { id: request.id },
      data: { verifiedAt: PHASE22_NOW },
    });
    await expect(runPrivacyExecutionV2(base, enabled)).resolves.toEqual({
      ok: false,
      code: "LEGAL_GATE_BLOCKED",
    });

    await expect(
      client.privacyExecution.count({ where: { privacyRequestId: request.id } }),
    ).resolves.toBe(0);
  });
});

function requireFixture() {
  if (harness === undefined || actors === undefined) {
    throw new Error("Phase-22 authorization fixture is unavailable.");
  }
  return { client: harness.client, users: actors };
}
