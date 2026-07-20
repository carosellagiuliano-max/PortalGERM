import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import {
  buildRadarOpaqueLookup,
  decryptRadarOpaqueToken,
} from "@/lib/privacy/radar-opaque";
import {
  authorizeAndRecheckRevealConfirmation,
  buildRevealPreview,
  decryptRevealValue,
  REVEAL_SNAPSHOT_POLICY_V1,
  type RevealValue,
} from "@/lib/privacy/reveal-dto";
import {
  DEMO_ONLY_CANDIDATE_WORKFLOW_CRYPTO,
  seedCandidateWorkflows,
} from "@/prisma/seed/blocks/candidate-workflows";
import { seedDemoAccountsCompaniesAndJobs } from "@/prisma/seed/blocks/companies-jobs";
import { seedReferenceCatalog } from "@/prisma/seed/blocks/reference-catalog";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

let isolated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

function client(): DatabaseClient {
  if (database === undefined) {
    throw new Error("Candidate workflow test database is not initialized.");
  }
  return database;
}

beforeAll(async () => {
  isolated = await createMigratedTestDatabase("phase_05_candidate_workflows");
  database = createDatabaseClient(isolated.connectionString);
});

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  await isolated?.dispose();
  isolated = undefined;
});

describe.sequential("Phase-05 candidate workflow seed", () => {
  it("persists the exact trigger-valid graph and makes its second run read-only", async () => {
    const anchorAt = new Date("2026-07-20T00:00:00.000Z");
    await seedReferenceCatalog(client());
    const dependencies = await seedDemoAccountsCompaniesAndJobs(
      client(),
      anchorAt,
    );
    const crypto = DEMO_ONLY_CANDIDATE_WORKFLOW_CRYPTO;
    const first = await seedCandidateWorkflows(
      client(),
      anchorAt,
      dependencies,
      crypto,
    );

    const firstCandidateVersions = await client().$queryRaw<
      Array<{ id: string; version: string }>
    >`SELECT "id"::text AS id, xmin::text AS version FROM "CandidateProfile" ORDER BY "id"`;
    const firstApplicationVersions = await client().$queryRaw<
      Array<{ id: string; version: string }>
    >`SELECT "id"::text AS id, xmin::text AS version FROM "Application" ORDER BY "id"`;
    const firstRadarMappingVersions = await client().$queryRaw<
      Array<{ id: string; version: string }>
    >`SELECT "id"::text AS id, xmin::text AS version FROM "RadarOpaqueMapping" ORDER BY "id"`;
    const firstRevealFieldVersions = await client().$queryRaw<
      Array<{ id: string; version: string }>
    >`SELECT "id"::text AS id, xmin::text AS version FROM "IdentityRevealGrantField" ORDER BY "id"`;

    const second = await seedCandidateWorkflows(
      client(),
      anchorAt,
      dependencies,
      crypto,
    );
    const secondCandidateVersions = await client().$queryRaw<
      Array<{ id: string; version: string }>
    >`SELECT "id"::text AS id, xmin::text AS version FROM "CandidateProfile" ORDER BY "id"`;
    const secondApplicationVersions = await client().$queryRaw<
      Array<{ id: string; version: string }>
    >`SELECT "id"::text AS id, xmin::text AS version FROM "Application" ORDER BY "id"`;
    const secondRadarMappingVersions = await client().$queryRaw<
      Array<{ id: string; version: string }>
    >`SELECT "id"::text AS id, xmin::text AS version FROM "RadarOpaqueMapping" ORDER BY "id"`;
    const secondRevealFieldVersions = await client().$queryRaw<
      Array<{ id: string; version: string }>
    >`SELECT "id"::text AS id, xmin::text AS version FROM "IdentityRevealGrantField" ORDER BY "id"`;

    expect(second).toEqual(first);
    expect(secondCandidateVersions).toEqual(firstCandidateVersions);
    expect(secondApplicationVersions).toEqual(firstApplicationVersions);
    expect(secondRadarMappingVersions).toEqual(firstRadarMappingVersions);
    expect(secondRevealFieldVersions).toEqual(firstRevealFieldVersions);

    const [
      candidates,
      skills,
      languages,
      grantedConsents,
      radarProfiles,
      mappings,
      budgets,
      sessions,
      applications,
      snapshots,
      savedJobs,
      jobAlerts,
      conversations,
      applicationConversations,
      radarConversations,
      requests,
      reveals,
      revealFields,
      confirmations,
      contactConsumes,
    ] = await Promise.all([
      client().candidateProfile.count(),
      client().candidateSkill.count(),
      client().candidateLanguage.count(),
      client().candidateConsent.count({ where: { granted: true } }),
      client().radarProfile.count({
        where: { publishedAt: { not: null }, withdrawnAt: null },
      }),
      client().radarOpaqueMapping.count(),
      client().radarSearchBudget.count(),
      client().radarSearchSession.count(),
      client().application.count(),
      client().applicationSubmissionSnapshot.count(),
      client().savedJob.count(),
      client().jobAlert.count(),
      client().conversation.count(),
      client().conversation.count({ where: { kind: "APPLICATION" } }),
      client().conversation.count({ where: { kind: "TALENT_RADAR" } }),
      client().employerContactRequest.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      client().identityRevealGrant.findMany({
        include: {
          candidateProfile: { include: { documents: true, user: true } },
          confirmations: { orderBy: { createdAt: "asc" } },
          contactRequest: true,
          fields: { orderBy: { field: "asc" } },
        },
        orderBy: { id: "asc" },
      }),
      client().identityRevealGrantField.count(),
      client().identityRevealConfirmation.count(),
      client().creditLedgerEntry.count({
        where: {
          kind: "CONSUME",
          reasonCode: "TALENT_RADAR_CONTACT",
          amount: -1,
        },
      }),
    ]);

    expect({
      candidates,
      skills,
      languages,
      grantedConsents,
      radarProfiles,
      mappings,
      budgets,
      sessions,
      applications,
      snapshots,
      savedJobs,
      jobAlerts,
      conversations,
      applicationConversations,
      radarConversations,
      revealFields,
      confirmations,
      contactConsumes,
    }).toEqual({
      candidates: 30,
      skills: 165,
      languages: 75,
      grantedConsents: 11,
      radarProfiles: 10,
      mappings: 40,
      budgets: 4,
      sessions: 4,
      applications: 80,
      snapshots: 80,
      savedJobs: 40,
      jobAlerts: 15,
      conversations: 82,
      applicationConversations: 80,
      radarConversations: 2,
      revealFields: 5,
      confirmations: 3,
      contactConsumes: 6,
    });
    expect(
      Object.fromEntries(
        requests.map((row) => [row.status, row._count._all]),
      ),
    ).toEqual({ ACCEPTED: 2, DECLINED: 2, PENDING: 2 });
    expect(reveals).toHaveLength(2);
    expect(reveals.filter((grant) => grant.revokedAt !== null)).toHaveLength(1);

    const radarMappings = await client().radarOpaqueMapping.findMany({
      orderBy: { id: "asc" },
    });
    const opaqueTokens = radarMappings.map((mapping) => {
      const binding = {
        mappingId: mapping.id,
        candidateProfileId: mapping.candidateProfileId,
        companyId: mapping.companyId,
        epoch: mapping.epoch,
      };
      const token = decryptRadarOpaqueToken(
        {
          lookupHmac: mapping.lookupHmac,
          encryptedToken: mapping.encryptedToken,
          nonce: mapping.nonce,
          authTag: mapping.authTag,
          lookupKeyVersion: mapping.lookupKeyVersion,
          encryptionKeyVersion: mapping.encryptionKeyVersion,
        },
        crypto.radarLookupKeys,
        crypto.radarEncryptionKeys,
        binding,
      );
      const lookupKey = crypto.radarLookupKeys.find(
        ({ version }) => version === mapping.lookupKeyVersion,
      );
      expect(lookupKey).toBeDefined();
      expect(buildRadarOpaqueLookup(token, [lookupKey!], binding)).toEqual({
        lookupHmac: mapping.lookupHmac,
        lookupKeyVersion: mapping.lookupKeyVersion,
      });
      expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(Buffer.from(token, "base64url")).toHaveLength(16);
      expect(mapping.encryptedToken).toHaveLength(22);
      expect(mapping.nonce).toHaveLength(12);
      expect(mapping.authTag).toHaveLength(16);
      return token;
    });
    expect(new Set(opaqueTokens).size).toBe(40);

    const valueFor = (
      grant: (typeof reveals)[number],
      field: RevealValue["field"],
    ): RevealValue => {
      switch (field) {
        case "DISPLAY_NAME":
          return {
            field,
            value: [
              grant.candidateProfile.firstName,
              grant.candidateProfile.lastName,
            ]
              .filter((part): part is string =>
                part !== null && part.trim().length > 0,
              )
              .join(" "),
          };
        case "EMAIL":
          return {
            field,
            value: grant.candidateProfile.user.emailNormalized,
          };
        case "PHONE":
          return {
            field,
            value: grant.candidateProfile.phone?.replace(/[^+\d]/g, "") ?? "",
          };
        case "CV_METADATA": {
          const document = grant.candidateProfile.documents.find(
            (candidate) =>
              candidate.purpose === "CV" && candidate.status === "ACTIVE",
          );
          if (document === undefined) {
            throw new Error("Reveal CV metadata fixture is unavailable.");
          }
          return {
            field,
            value: {
              fileName: document.safeFilename,
              mimeType: document.mimeType as "application/pdf",
              sizeBytes: document.sizeBytes,
            },
          };
        }
      }
    };

    for (const grant of reveals) {
      const binding = {
        grantId: grant.id,
        candidateProfileId: grant.candidateProfileId,
        companyId: grant.companyId,
        contactRequestId: grant.contactRequestId,
      };
      for (const field of grant.fields) {
        expect(field.schemaVersion).toBe(
          REVEAL_SNAPSHOT_POLICY_V1.schemaVersion,
        );
        expect(field.integrityHmac).toMatch(/^[a-f0-9]{64}$/);
        const decrypted = decryptRevealValue(
          {
            field: field.field,
            ciphertext: field.ciphertext,
            nonce: field.nonce,
            authTag: field.authTag,
            encryptionKeyVersion: field.encryptionKeyVersion,
            schemaVersion: field.schemaVersion as "v1",
            integrityHmac: field.integrityHmac,
          },
          crypto.piiRevealKeys,
          binding,
        );
        expect(decrypted).toEqual(valueFor(grant, field.field));
        expect(Buffer.from(field.ciphertext).toString("utf8")).not.toBe(
          String(decrypted.value),
        );
      }

      for (const confirmation of grant.confirmations) {
        const values = confirmation.completeFieldSet.map((field) =>
          valueFor(grant, field),
        );
        const preview = buildRevealPreview(
          values,
          {
            contactRequestId: grant.contactRequestId,
            conversationId: grant.conversationId,
            candidateProfileId: grant.candidateProfileId,
            companyId: grant.companyId,
          },
          crypto.revealConfirmationKeys,
          confirmation.createdAt,
        );
        expect(confirmation.noticeVersion).toBe(
          REVEAL_SNAPSHOT_POLICY_V1.noticeVersion,
        );
        expect(confirmation.previewHmac).toBe(preview.evidence.previewHmac);
      }
    }

    const activeReveal = reveals.find((grant) => grant.revokedAt === null);
    const activeConfirmation = activeReveal?.confirmations[0];
    expect(activeReveal).toBeDefined();
    expect(activeConfirmation).toBeDefined();
    if (activeReveal !== undefined && activeConfirmation !== undefined) {
      const currentValues = activeConfirmation.completeFieldSet.map((field) =>
        valueFor(activeReveal, field),
      );
      const preview = buildRevealPreview(
        currentValues,
        {
          contactRequestId: activeReveal.contactRequestId,
          conversationId: activeReveal.conversationId,
          candidateProfileId: activeReveal.candidateProfileId,
          companyId: activeReveal.companyId,
        },
        crypto.revealConfirmationKeys,
        activeConfirmation.createdAt,
      );
      const input = {
        contactRequestId: activeReveal.contactRequestId,
        conversationId: activeReveal.conversationId,
        fields: activeConfirmation.completeFieldSet,
        noticeVersion: activeConfirmation.noticeVersion,
        previewHmac: activeConfirmation.previewHmac,
        idempotencyKey: activeConfirmation.idempotencyKey,
      };
      const authorization = {
        actorUserId: activeConfirmation.actorUserId,
        candidateOwnerUserId: activeReveal.candidateProfile.userId,
        candidateUserStatus: activeReveal.candidateProfile.user.status,
        candidateProfileId: activeReveal.candidateProfileId,
        companyId: activeReveal.companyId,
        companyStatus: "ACTIVE",
        companyVerified: true,
        requestId: activeReveal.contactRequest.id,
        requestStatus: activeReveal.contactRequest.status,
        requestCandidateProfileId:
          activeReveal.contactRequest.candidateProfileId,
        requestCompanyId: activeReveal.contactRequest.companyId,
        requestConversationId: activeReveal.conversationId,
        existingGrant: {
          contactRequestId: activeReveal.contactRequestId,
          candidateProfileId: activeReveal.candidateProfileId,
          companyId: activeReveal.companyId,
          conversationId: activeReveal.conversationId,
          revokedAt: activeReveal.revokedAt,
        },
      } as const;
      const recheckAt = new Date(activeConfirmation.createdAt.getTime() + 60_000);
      expect(
        authorizeAndRecheckRevealConfirmation(
          input,
          currentValues,
          preview.evidence,
          crypto.revealConfirmationKeys,
          authorization,
          recheckAt,
        ),
      ).toMatchObject({ ok: true });
      const changedValues = currentValues.map((value) =>
        value.field === "EMAIL"
          ? ({ field: "EMAIL", value: "changed@demo.invalid" } as const)
          : value,
      );
      expect(
        authorizeAndRecheckRevealConfirmation(
          input,
          changedValues,
          preview.evidence,
          crypto.revealConfirmationKeys,
          authorization,
          recheckAt,
        ),
      ).toEqual({ ok: false, code: "STALE_REVEAL_PREVIEW" });
    }

    const submittedApplications = await client().application.findMany({
      include: {
        submissionDocuments: { include: { documentMetadata: true } },
        submittedJobRevision: true,
      },
    });
    expect(
      submittedApplications.reduce(
        (total, application) => total + application.submissionDocuments.length,
        0,
      ),
    ).toBe(3);
    for (const application of submittedApplications) {
      const required = application.submittedJobRevision.requiredDocumentKinds
        .filter((kind) => kind !== "NONE")
        .sort();
      const linked = application.submissionDocuments
        .map(({ documentMetadata }) => documentMetadata.purpose)
        .sort();
      expect(linked).toEqual(required);
      expect(
        application.submissionDocuments.every(
          ({ documentMetadata }) =>
            documentMetadata.candidateProfileId ===
              application.candidateProfileId &&
            documentMetadata.status === "ACTIVE" &&
            documentMetadata.removedAt === null,
        ),
      ).toBe(true);
    }

    const cv = await client().candidateDocumentMetadata.findFirstOrThrow({
      where: { status: "ACTIVE", purpose: "CV" },
    });
    expect(cv).toMatchObject({
      safeFilename: "lebenslauf.pdf",
      mimeType: "application/pdf",
      sizeBytes: 123_456,
    });
    expect(cv.storageKey).toMatch(/^mock-storage\/[a-f0-9-]+\/lebenslauf\.pdf$/);

    const tokens = await client().jobAlertUnsubscribeToken.findMany();
    expect(tokens).toHaveLength(15);
    expect(tokens.every((token) => /^[a-f0-9]{64}$/.test(token.tokenHash))).toBe(
      true,
    );
    expect(
      tokens.some(
        (token) => token.expiresAt.getTime() - token.issuedAt.getTime() === 180 * 86_400_000,
      ),
    ).toBe(true);
  });
}, 600_000);
