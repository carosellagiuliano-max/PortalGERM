import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  consumePrivacyExportV2,
  createPrivacyExportV2,
} from "@/lib/privacy/export-v2";
import { runPrivacyExecutionV2 } from "@/lib/privacy/execution-v2";
import {
  createMemoryDocumentStore,
  createPhase22Harness,
  phase22ExportKeyring,
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

describe.sequential("Phase 27 identity-wide privacy rights", () => {
  let harness: Phase22Harness;
  let actors: Phase22Actors;
  let assignmentIds: string[];
  let ownMembershipId: string;
  let foreignMembershipId: string;
  let companyId: string;

  beforeAll(async () => {
    harness = await createPhase22Harness("phase27_persona_privacy");
    actors = await seedPhase22Actors(harness.client, "phase27-persona");
    const profile = await harness.client.candidateProfile.create({
      data: {
        userId: actors.requester.id,
        firstName: "PHASE27_OWN_PROFILE_CANARY",
        publicDisplayName: "Phase 27 dual identity",
      },
    });
    expect(profile.userId).toBe(actors.requester.id);
    const assignments = [];
    for (const kind of ["CANDIDATE", "EMPLOYER"] as const) {
      assignments.push(
        await harness.client.personaAssignment.create({
          data: {
            userId: actors.requester.id,
            kind,
            status: "ACTIVE",
            source: "LEGACY_BACKFILL",
            version: 1,
            activatedAt: PHASE22_NOW,
            createdAt: PHASE22_NOW,
            updatedAt: PHASE22_NOW,
            events: {
              create: {
                kind: "MIGRATED",
                toStatus: "ACTIVE",
                source: "LEGACY_BACKFILL",
                reasonCode: "PHASE27_PRIVACY_FIXTURE",
                correlationId: randomUUID(),
                createdAt: PHASE22_NOW,
              },
            },
          },
        }),
      );
    }
    assignmentIds = assignments.map(({ id }) => id);
    const company = await harness.client.company.create({
      data: {
        name: "Phase 27 Privacy Company",
        slug: `phase27-privacy-${randomUUID()}`,
        status: "DRAFT",
        dataProvenance: "TEST",
      },
    });
    companyId = company.id;
    const ownMembership = await harness.client.companyMembership.create({
      data: {
        companyId,
        userId: actors.requester.id,
        role: "ADMIN",
        status: "ACTIVE",
        joinedAt: PHASE22_NOW,
        events: {
          create: {
            kind: "CREATED",
            toRole: "ADMIN",
            actorUserId: actors.assignedAdmin.id,
            reasonCode: "PHASE27_PRIVACY_FIXTURE",
            correlationId: randomUUID(),
            createdAt: PHASE22_NOW,
          },
        },
      },
    });
    const foreignMembership = await harness.client.companyMembership.create({
      data: {
        companyId,
        userId: actors.assignedAdmin.id,
        role: "VIEWER",
        status: "ACTIVE",
        joinedAt: PHASE22_NOW,
        events: {
          create: {
            kind: "CREATED",
            toRole: "VIEWER",
            actorUserId: actors.assignedAdmin.id,
            reasonCode: "PHASE27_FOREIGN_CANARY",
            correlationId: randomUUID(),
            createdAt: PHASE22_NOW,
          },
        },
      },
    });
    ownMembershipId = ownMembership.id;
    foreignMembershipId = foreignMembership.id;

    const legal = await seedPublishedPrivacyNotice(
      harness.client,
      actors,
      "phase27-persona",
    );
    await seedActiveInventory(harness.client, "phase27-persona", [
      "postgres-primary",
    ]);
    await Promise.all([
      seedProcessingApproval(harness.client, legal.publication.id, {
        suffix: "phase27-export",
        scope: "PRIVACY_EXPORT",
        processorKey: "postgres-primary",
      }),
      seedProcessingApproval(harness.client, legal.publication.id, {
        suffix: "phase27-erasure",
        scope: "PRIVACY_ERASURE",
        processorKey: "postgres-primary",
      }),
    ]);
  }, 120_000);

  afterAll(async () => {
    await harness.dispose();
  });

  it("exports both own personas and memberships without foreign company-member data", async () => {
    const request = await seedPrivacyRequest(
      harness.client,
      actors,
      "EXPORT",
    );
    const command = privacyExecutionCommand(request.id, actors);
    const store = createMemoryDocumentStore();
    const dependencies = {
      database: harness.client,
      exportStore: store,
      documentStore: store,
      exportKeyring: phase22ExportKeyring(),
      featureEnabled: true,
      cohortAllowed: true,
      processingMode: "sandbox_command" as const,
      now: PHASE22_NOW,
    };
    const created = await createPrivacyExportV2(command, dependencies);
    expect(created).toMatchObject({ ok: true, replay: false });
    if (!created.ok) throw new Error(created.code);

    const downloaded = await consumePrivacyExportV2(
      {
        artifactId: created.artifactId,
        ownerUserId: actors.requester.id,
        token: created.downloadToken,
        stepUpEvidenceRef: command.stepUpEvidenceRef,
      },
      dependencies,
    );
    expect(downloaded.ok).toBe(true);
    if (!downloaded.ok) throw new Error(downloaded.code);
    const chunks: Uint8Array[] = [];
    for await (const chunk of downloaded.body) chunks.push(chunk);
    const packageText = Buffer.concat(chunks).toString("utf8");
    for (const assignmentId of assignmentIds) {
      expect(packageText).toContain(assignmentId);
    }
    expect(packageText).toContain(ownMembershipId);
    expect(packageText).toContain("PHASE27_OWN_PROFILE_CANARY");
    expect(packageText).not.toContain(foreignMembershipId);
    expect(packageText).not.toContain(actors.assignedAdmin.email);
  });

  it("suspends every persona identity-wide while retaining the company record and membership evidence", async () => {
    const request = await seedPrivacyRequest(
      harness.client,
      actors,
      "DELETE",
    );
    const result = await runPrivacyExecutionV2(
      privacyExecutionCommand(request.id, actors),
      {
        database: harness.client,
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
    if (!result.ok) throw new Error(result.code);

    const [assignments, membership, company, proofs] = await Promise.all([
      harness.client.personaAssignment.findMany({
        where: { userId: actors.requester.id },
        orderBy: { kind: "asc" },
        include: { events: { orderBy: { createdAt: "asc" } } },
      }),
      harness.client.companyMembership.findUniqueOrThrow({
        where: { id: ownMembershipId },
      }),
      harness.client.company.findUniqueOrThrow({ where: { id: companyId } }),
      harness.client.erasureProof.findMany({
        where: { privacyExecutionId: result.executionId },
      }),
    ]);
    expect(assignments).toHaveLength(2);
    expect(
      assignments.map(({ kind, status, version }) => ({
        kind,
        status,
        version,
      })),
    ).toEqual([
      { kind: "CANDIDATE", status: "SUSPENDED", version: 2 },
      { kind: "EMPLOYER", status: "SUSPENDED", version: 2 },
    ]);
    for (const assignment of assignments) {
      expect(assignment.events.at(-1)).toMatchObject({
        kind: "SUSPENDED",
        reasonCode: "IDENTITY_ERASURE",
      });
    }
    expect(membership).toMatchObject({ status: "ACTIVE", companyId });
    expect(company.status).toBe("DRAFT");
    expect(
      proofs.some(
        ({ entityKey, action }) =>
          entityKey === "PERSONA_ASSIGNMENT" && action === "ANONYMIZED",
      ),
    ).toBe(true);
  });
});
