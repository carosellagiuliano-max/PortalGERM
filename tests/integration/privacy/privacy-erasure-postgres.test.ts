import { createHash } from "node:crypto";

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
  harness = await createPhase22Harness("phase22_privacy_erasure");
  actors = await seedPhase22Actors(harness.client, "erasure");
});

afterAll(async () => {
  await harness?.dispose();
});

describe("Phase-22 privacy erasure execution", () => {
  it("anonymizes canonical account/profile rows and writes immutable narrow proofs", async () => {
    const { client, users } = requireFixture();
    const profile = await client.candidateProfile.create({
      data: {
        userId: users.requester.id,
        firstName: "ERASURE_FIRST_NAME_CANARY",
        lastName: "ERASURE_LAST_NAME_CANARY",
        publicDisplayName: "ERASURE_DISPLAY_CANARY",
        phone: "+41 79 000 00 00",
        cityLabel: "ERASURE_CITY_CANARY",
        summary: "ERASURE_SUMMARY_CANARY",
      },
    });
    const legal = await seedPublishedPrivacyNotice(client, users, "erasure");
    await seedActiveInventory(client, "erasure", ["postgres-primary"]);
    await seedProcessingApproval(client, legal.publication.id, {
      suffix: "erasure",
      scope: "PRIVACY_ERASURE",
      processorKey: "postgres-primary",
    });
    const request = await seedPrivacyRequest(client, users, "DELETE");

    const result = await runPrivacyExecutionV2(
      privacyExecutionCommand(request.id, users),
      {
        database: client,
        documentStore: createMemoryDocumentStore(),
        correctionEnabled: false,
        erasureEnabled: true,
        cohortAllowed: true,
        processingMode: "sandbox_command",
        now: PHASE22_NOW,
      },
    );
    expect(result).toMatchObject({
      ok: true,
      replay: false,
      status: "COMPLETED",
    });
    if (!result.ok) throw new Error("Erasure execution failed.");

    const [account, updatedProfile, updatedRequest, execution, proofs] =
      await Promise.all([
        client.user.findUniqueOrThrow({ where: { id: users.requester.id } }),
        client.candidateProfile.findUniqueOrThrow({
          where: { id: profile.id },
        }),
        client.privacyRequest.findUniqueOrThrow({ where: { id: request.id } }),
        client.privacyExecution.findUniqueOrThrow({
          where: { id: result.executionId },
          include: { processorOutcomes: true },
        }),
        client.erasureProof.findMany({
          where: { privacyExecutionId: result.executionId },
          orderBy: { entityKey: "asc" },
        }),
      ]);

    expect(account.status).toBe("SUSPENDED");
    expect(account.name).toBeNull();
    expect(account.email).toMatch(/^erased-[a-f0-9]{24}@invalid\.local$/u);
    expect(updatedProfile).toMatchObject({
      firstName: null,
      lastName: null,
      publicDisplayName: null,
      phone: null,
      cityLabel: null,
      summary: null,
    });
    expect(JSON.stringify([account, updatedProfile])).not.toContain(
      "ERASURE_",
    );
    expect(updatedRequest).toMatchObject({
      status: "COMPLETED",
      deletionOutcome: "ERASURE_OR_ANONYMIZATION_COMPLETED",
      deletionDependencies: ["NONE"],
    });
    expect(execution).toMatchObject({
      status: "COMPLETED",
      checkpoint: 1,
      processorOutcomes: [
        {
          processorKey: "postgres-primary",
          status: "SUCCEEDED",
          outcomeCode: "POSTGRES_ANONYMIZED",
        },
      ],
    });
    expect(proofs.map(({ entityKey, action }) => ({ entityKey, action }))).toEqual([
      { entityKey: "CANDIDATE_PROFILE", action: "ANONYMIZED" },
      { entityKey: "USER_ACCOUNT", action: "ANONYMIZED" },
    ]);

    const executionRow = await client.privacyExecution.findUniqueOrThrow({
      where: { id: result.executionId },
      select: { subjectReferenceHash: true },
    });
    expect(
      await client.privacyTombstone.count({
        where: { subjectReferenceHash: executionRow.subjectReferenceHash },
      }),
    ).toBe(2);

    await expect(
      client.erasureProof.update({
        where: { id: proofs[0]!.id },
        data: { proofDigest: "b".repeat(64) },
      }),
    ).rejects.toThrow(/append-only/iu);

    const heldActors = await seedPhase22Actors(client, "erasure-held");
    const heldProfile = await client.candidateProfile.create({
      data: {
        userId: heldActors.requester.id,
        firstName: "HELD_PROFILE_CANARY",
        publicDisplayName: "Held profile",
      },
    });
    const heldSubjectHash = createHash("sha256")
      .update(heldActors.requester.id, "utf8")
      .digest("hex");
    const hold = await client.legalHold.create({
      data: {
        subjectUserId: heldActors.requester.id,
        subjectReferenceHash: heldSubjectHash,
        entityType: "USER_ACCOUNT",
        entityReferenceHash: heldSubjectHash,
        scope: "USER_ACCOUNT",
        basisRef: "external-review:phase22-litigation-hold",
        safeReasonCode: "ACTIVE_LEGAL_HOLD",
        createdByUserId: heldActors.assignedAdmin.id,
        reviewedByUserId: heldActors.approvalAdmin.id,
        startsAt: new Date(PHASE22_NOW.getTime() - 60_000),
        reviewAt: new Date(PHASE22_NOW.getTime() + 86_400_000),
      },
    });
    const heldRequest = await seedPrivacyRequest(client, heldActors, "DELETE");
    const heldResult = await runPrivacyExecutionV2(
      privacyExecutionCommand(heldRequest.id, heldActors),
      {
        database: client,
        documentStore: createMemoryDocumentStore(),
        correctionEnabled: false,
        erasureEnabled: true,
        cohortAllowed: true,
        processingMode: "sandbox_command",
        now: PHASE22_NOW,
      },
    );
    expect(heldResult).toMatchObject({ ok: true, status: "COMPLETED" });
    if (!heldResult.ok) throw new Error("Held erasure execution failed.");
    await expect(
      client.user.findUniqueOrThrow({ where: { id: heldActors.requester.id } }),
    ).resolves.toMatchObject({
      status: "ACTIVE",
      email: heldActors.requester.email,
    });
    await expect(
      client.candidateProfile.findUniqueOrThrow({
        where: { id: heldProfile.id },
      }),
    ).resolves.toMatchObject({
      firstName: null,
      publicDisplayName: null,
    });
    await expect(
      client.privacyRequest.findUniqueOrThrow({
        where: { id: heldRequest.id },
      }),
    ).resolves.toMatchObject({
      status: "COMPLETED",
      deletionOutcome: "PARTIALLY_RETAINED_WITH_BASIS",
      deletionDependencies: ["LEGAL_HOLD"],
    });
    await expect(
      client.legalHold.findUniqueOrThrow({ where: { id: hold.id } }),
    ).resolves.toMatchObject({
      status: "ACTIVE",
      basisRef: "external-review:phase22-litigation-hold",
      releasedAt: null,
    });
    expect(
      await client.erasureProof.findFirst({
        where: {
          privacyExecutionId: heldResult.executionId,
          entityKey: "USER_ACCOUNT",
          action: "RETAINED",
          retainedBasisRef: "external-review:phase22-litigation-hold",
        },
      }),
    ).not.toBeNull();
  });
});

function requireFixture() {
  if (harness === undefined || actors === undefined) {
    throw new Error("Phase-22 erasure fixture is unavailable.");
  }
  return { client: harness.client, users: actors };
}
