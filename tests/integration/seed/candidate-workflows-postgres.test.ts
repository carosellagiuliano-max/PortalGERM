import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  firstJobAlertDueAt,
  jobAlertConsentNoticeHash,
  JOB_ALERT_DELIVERY_NOTICE_V1,
  JOB_ALERT_POLICY_V1,
  nextJobAlertDueAt,
  parseStoredJobAlertQuery,
} from "@/lib/candidate/job-alert-policy";
import {
  applicationSubmissionPayloadHash,
  buildApplicationConfirmationProjection,
} from "@/lib/applications/integrity";
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
  buildDemoJobAlertUnsubscribeToken,
  DEMO_ONLY_CANDIDATE_WORKFLOW_CRYPTO,
  seedCandidateWorkflows,
} from "@/prisma/seed/blocks/candidate-workflows";
import { seedDemoAccountsCompaniesAndJobs } from "@/prisma/seed/blocks/companies-jobs";
import { seedReferenceCatalog } from "@/prisma/seed/blocks/reference-catalog";
import {
  APPLICATION_FIXTURES,
  APPLICATION_STATUS_PATHS,
  applicationTransitionFixtures,
  CANDIDATE_FIXTURES,
  JOB_ALERT_FIXTURES,
} from "@/prisma/seed/fixtures/candidate-workflows";
import { stableSeedId } from "@/prisma/seed/ids";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

let isolated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

const ANCHOR_AT = new Date("2026-07-20T00:00:00.000Z");

function client(): DatabaseClient {
  if (database === undefined) {
    throw new Error("Candidate workflow test database is not initialized.");
  }
  return database;
}

function postgres(): MigratedDatabase["pool"] {
  if (isolated === undefined) {
    throw new Error("Candidate workflow PostgreSQL pool is not initialized.");
  }
  return isolated.pool;
}

async function readMigration(migrationName: string): Promise<string> {
  return readFile(
    resolve(
      process.cwd(),
      "prisma",
      "migrations",
      migrationName,
      "migration.sql",
    ),
    "utf8",
  );
}

async function runMigration(migrationName: string): Promise<void> {
  const sql = await readMigration(migrationName);
  await postgres().query(sql);
}

async function setJobProvenanceForCanary(
  jobId: string,
  dataProvenance: "DEMO" | "LIVE",
): Promise<void> {
  const connection = await postgres().connect();
  try {
    await connection.query("BEGIN");
    await connection.query(
      'ALTER TABLE "Job" DISABLE TRIGGER job_identity_provenance_immutable_trigger',
    );
    await connection.query(
      'UPDATE "Job" SET "dataProvenance" = $2::"DataProvenance" WHERE "id" = $1::uuid',
      [jobId, dataProvenance],
    );
    await connection.query(
      'ALTER TABLE "Job" ENABLE TRIGGER job_identity_provenance_immutable_trigger',
    );
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

async function removeApplicationEventsForCanary(
  eventIds: readonly string[],
): Promise<void> {
  const connection = await postgres().connect();
  try {
    await connection.query("BEGIN");
    await connection.query(
      'ALTER TABLE "ApplicationEvent" DISABLE TRIGGER USER',
    );
    await connection.query(
      'DELETE FROM "ApplicationEvent" WHERE "id" = ANY($1::uuid[])',
      [eventIds],
    );
    await connection.query(
      'ALTER TABLE "ApplicationEvent" ENABLE TRIGGER USER',
    );
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

async function removeJobAlertCommitArtifactsForCanary(
  alertIds: readonly string[],
): Promise<void> {
  const connection = await postgres().connect();
  try {
    await connection.query("BEGIN");
    await connection.query('ALTER TABLE "JobAlertEvent" DISABLE TRIGGER USER');
    await connection.query(
      'ALTER TABLE "JobAlertDigestItem" DISABLE TRIGGER USER',
    );
    await connection.query(
      'DELETE FROM "JobAlertDigestItem" WHERE "jobAlertId" = ANY($1::uuid[])',
      [alertIds],
    );
    await connection.query(
      'DELETE FROM "JobAlertUnsubscribeToken" WHERE "jobAlertId" = ANY($1::uuid[])',
      [alertIds],
    );
    await connection.query(
      'DELETE FROM "JobAlertEvent" WHERE "jobAlertId" = ANY($1::uuid[])',
      [alertIds],
    );
    await connection.query(
      'DELETE FROM "JobAlertDigest" WHERE "jobAlertId" = ANY($1::uuid[])',
      [alertIds],
    );
    await connection.query(
      'ALTER TABLE "JobAlertDigestItem" ENABLE TRIGGER USER',
    );
    await connection.query('ALTER TABLE "JobAlertEvent" ENABLE TRIGGER USER');
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
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

describe.sequential(
  "Phase-05 candidate workflow seed",
  () => {
    it("persists the exact trigger-valid graph and makes its second run read-only", async () => {
      const anchorAt = ANCHOR_AT;
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
      const firstPrivacyVersions = await client().$queryRaw<
        Array<{ id: string; version: string }>
      >`SELECT "id"::text AS id, xmin::text AS version FROM "PrivacyRequest" ORDER BY "id"`;
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
      const secondPrivacyVersions = await client().$queryRaw<
        Array<{ id: string; version: string }>
      >`SELECT "id"::text AS id, xmin::text AS version FROM "PrivacyRequest" ORDER BY "id"`;
      const secondRadarMappingVersions = await client().$queryRaw<
        Array<{ id: string; version: string }>
      >`SELECT "id"::text AS id, xmin::text AS version FROM "RadarOpaqueMapping" ORDER BY "id"`;
      const secondRevealFieldVersions = await client().$queryRaw<
        Array<{ id: string; version: string }>
      >`SELECT "id"::text AS id, xmin::text AS version FROM "IdentityRevealGrantField" ORDER BY "id"`;

      expect(second).toEqual(first);
      expect(secondCandidateVersions).toEqual(firstCandidateVersions);
      expect(secondApplicationVersions).toEqual(firstApplicationVersions);
      expect(secondPrivacyVersions).toEqual(firstPrivacyVersions);
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
        expiredSavedJobs,
        jobAlerts,
        conversations,
        applicationConversations,
        radarConversations,
        requests,
        reveals,
        revealFields,
        confirmations,
        contactConsumes,
        suspendedCandidates,
        privacyRequests,
        privacyCorrectionFields,
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
        client().savedJob.count({ where: { job: { status: "EXPIRED" } } }),
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
        client().candidateProfile.count({
          where: { user: { status: "SUSPENDED" } },
        }),
        client().privacyRequest.count(),
        client().privacyRequestCorrectionField.count(),
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
        expiredSavedJobs,
        jobAlerts,
        conversations,
        applicationConversations,
        radarConversations,
        revealFields,
        confirmations,
        contactConsumes,
        suspendedCandidates,
        privacyRequests,
        privacyCorrectionFields,
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
        savedJobs: 41,
        expiredSavedJobs: 1,
        jobAlerts: 15,
        conversations: 82,
        applicationConversations: 80,
        radarConversations: 2,
        revealFields: 5,
        confirmations: 3,
        contactConsumes: 6,
        suspendedCandidates: 1,
        privacyRequests: 3,
        privacyCorrectionFields: 2,
      });
      expect(
        Object.fromEntries(
          requests.map((row) => [row.status, row._count._all]),
        ),
      ).toEqual({ ACCEPTED: 2, DECLINED: 2, PENDING: 2 });
      expect(reveals).toHaveLength(2);
      expect(reveals.filter((grant) => grant.revokedAt !== null)).toHaveLength(
        1,
      );

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
                .filter(
                  (part): part is string =>
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
        const recheckAt = new Date(
          activeConfirmation.createdAt.getTime() + 60_000,
        );
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
          candidateProfile: { include: { user: true } },
          events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
          submissionDocuments: { include: { documentMetadata: true } },
          submissionSnapshot: true,
          job: {
            include: {
              company: {
                include: {
                  memberships: {
                    where: { role: "OWNER", status: "ACTIVE" },
                  },
                },
              },
            },
          },
          submittedJobRevision: true,
        },
      });
      expect(
        submittedApplications.reduce(
          (total, application) =>
            total + application.submissionDocuments.length,
          0,
        ),
      ).toBe(3);
      expect(
        submittedApplications.reduce(
          (total, application) => total + application.events.length,
          0,
        ),
      ).toBe(
        APPLICATION_FIXTURES.reduce(
          (total, fixture) =>
            total + APPLICATION_STATUS_PATHS[fixture.status].length,
          0,
        ),
      );
      for (const application of submittedApplications) {
        const fixture = APPLICATION_FIXTURES.find(
          (candidate) =>
            stableSeedId("application", candidate.key) === application.id,
        );
        expect(fixture).toBeDefined();
        if (fixture === undefined) continue;
        expect(application.status).toBe(fixture.status);
        expect(application.events).toHaveLength(
          APPLICATION_STATUS_PATHS[fixture.status].length,
        );
        expect(application.events[0]).toMatchObject({
          id: stableSeedId("application-event", `${fixture.key}:submitted`),
          actorUserId: application.candidateProfile.userId,
          kind: "STATUS_CHANGE",
          fromStatus: null,
          toStatus: "SUBMITTED",
        });
        const transitions = applicationTransitionFixtures(fixture);
        for (const [index, transition] of transitions.entries()) {
          const event = application.events[index + 1];
          expect(event).toMatchObject({
            id: stableSeedId("application-event", transition.naturalKey),
            actorUserId:
              transition.toStatus === "WITHDRAWN"
                ? application.candidateProfile.userId
                : application.job.company.memberships[0]?.userId,
            kind: "STATUS_CHANGE",
            fromStatus: transition.fromStatus,
            toStatus: transition.toStatus,
          });
          expect(event?.createdAt.getTime()).toBeGreaterThan(
            application.events[index]!.createdAt.getTime(),
          );
        }
        expect(application.events.at(-1)?.toStatus).toBe(application.status);
        const snapshot = application.submissionSnapshot;
        expect(snapshot).not.toBeNull();
        if (snapshot === null) continue;
        const confirmation = buildApplicationConfirmationProjection({
          candidate: {
            firstName: snapshot.candidateFirstName,
            lastName: snapshot.candidateLastName,
            email: snapshot.candidateEmail,
          },
          recipient: {
            companyName: snapshot.recipientCompanyName,
            contactKind: snapshot.applicationContactKind,
            contactValue: snapshot.applicationContactValue,
          },
          job: {
            revisionId: snapshot.jobRevisionId,
            slug: application.job.slug,
            title: application.submittedJobRevision.title,
            responseTargetDays: snapshot.responseTargetDays,
            applicationEffort: snapshot.applicationEffort,
            requiredDocumentKinds: snapshot.requiredDocumentKinds,
          },
        });
        expect(snapshot.confirmationNoticeHash).toBe(
          confirmation.confirmationNoticeHash,
        );
        expect(snapshot.confirmationSnapshotHash).toBe(
          confirmation.confirmationSnapshotHash,
        );
        expect(snapshot.confirmationSnapshotHashVersion).toBe(
          "application-confirmation-snapshot-v1",
        );
        expect(application.submissionPayloadHash).toBe(
          applicationSubmissionPayloadHash({
            confirmationSnapshotHash: confirmation.confirmationSnapshotHash,
            coverLetter: application.coverLetter,
            selectedDocumentIds: application.submissionDocuments.map(
              ({ documentMetadataId }) => documentMetadataId,
            ),
          }),
        );
        expect(application.submissionPayloadHashVersion).toBe(
          "application-submission-payload-v1",
        );
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
      expect(cv.storageKey).toMatch(
        /^mock-storage\/[a-f0-9-]+\/lebenslauf\.pdf$/,
      );

      const [alerts, deliveryConsents, alertEmails] = await Promise.all([
        client().jobAlert.findMany({
          include: {
            candidateProfile: { include: { user: true } },
            digests: {
              include: {
                items: {
                  include: { job: true },
                  orderBy: { sortOrder: "asc" },
                },
                unsubscribeTokens: true,
              },
            },
            events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
          },
        }),
        client().userConsentEvent.findMany({
          where: { kind: "JOB_ALERT_DELIVERY" },
        }),
        client().emailLog.findMany({
          where: { purpose: "job_alert_digest_mock" },
        }),
      ]);
      expect(alerts).toHaveLength(15);
      expect(deliveryConsents).toHaveLength(15);
      expect(alertEmails).toHaveLength(15);
      for (const fixture of JOB_ALERT_FIXTURES) {
        const alert = alerts.find(
          ({ id }) => id === stableSeedId("job-alert", fixture.key),
        );
        const consent = deliveryConsents.find(
          ({ id }) =>
            id ===
            stableSeedId(
              "user-consent-event",
              `${fixture.key}:delivery-granted`,
            ),
        );
        const email = alertEmails.find(
          ({ id }) =>
            id === stableSeedId("email-log", `${fixture.key}:digest-recorded`),
        );
        expect(alert).toBeDefined();
        expect(consent).toBeDefined();
        expect(email).toBeDefined();
        if (
          alert === undefined ||
          consent === undefined ||
          email === undefined
        ) {
          continue;
        }
        expect(alert.status).toBe(fixture.status);
        const storedQuery = parseStoredJobAlertQuery(alert.query);
        expect(storedQuery.kind).toBe("v1");
        if (storedQuery.kind !== "v1") continue;
        expect(consent).toMatchObject({
          userId: alert.candidateProfile.userId,
          actorUserId: alert.candidateProfile.userId,
          granted: true,
          kind: "JOB_ALERT_DELIVERY",
          purpose: JOB_ALERT_DELIVERY_NOTICE_V1.purpose,
          noticeVersion: JOB_ALERT_DELIVERY_NOTICE_V1.version,
          noticeHash: jobAlertConsentNoticeHash(),
        });
        const digest = alert.digests[0];
        expect(alert.digests).toHaveLength(1);
        expect(digest).toBeDefined();
        if (digest === undefined) continue;
        expect(digest).toMatchObject({
          alertNameSnapshot: "Dein Jobabo",
          policyVersion: JOB_ALERT_POLICY_V1.version,
          recipientEmailSnapshot: alert.candidateProfile.user.emailNormalized,
          itemCount: 2,
        });
        expect(digest.windowStart).toEqual(alert.createdAt);
        expect(digest.windowEnd).toEqual(alert.lastSuccessfulCutoffAt);
        expect(digest.scheduledFor).toEqual(
          firstJobAlertDueAt(alert.createdAt, alert.frequency),
        );
        expect(digest.runAt).toEqual(
          new Date(anchorAt.getTime() - 2 * 60 * 60 * 1_000),
        );
        expect(digest.runAt).not.toBeNull();
        expect(alert.nextDueAt).toEqual(
          nextJobAlertDueAt(digest.runAt!, alert.frequency),
        );
        expect(digest.items.map(({ sortOrder }) => sortOrder)).toEqual([0, 1]);
        for (const item of digest.items) {
          expect(item.jobAlertId).toBe(alert.id);
          expect(item.digestId).toBe(digest.id);
          expect(item.job.publishedAt?.getTime()).toBeGreaterThan(
            digest.windowStart.getTime(),
          );
          expect(item.job.publishedAt?.getTime()).toBeLessThanOrEqual(
            digest.windowEnd.getTime(),
          );
          expect(item.job.publishedCategoryId).toBe(
            storedQuery.query.categoryId,
          );
          expect(item.job.publishedCantonId).toBe(storedQuery.query.cantonId);
        }
        const token = digest.unsubscribeTokens[0];
        expect(digest.unsubscribeTokens).toHaveLength(1);
        expect(token).toBeDefined();
        if (token === undefined) continue;
        expect(token.tokenHash).toBe(
          buildDemoJobAlertUnsubscribeToken(fixture.key, digest.runAt!)
            .tokenHash,
        );
        expect(token.issuedAt).toEqual(digest.runAt);
        expect(token.expiresAt.getTime() - token.issuedAt.getTime()).toBe(
          JOB_ALERT_POLICY_V1.unsubscribeLifetimeDays * 86_400_000,
        );
        expect(alert.events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: "CREATED",
              actorUserId: alert.candidateProfile.userId,
              reasonCode: "EXPLICIT_ACTIVATION",
            }),
            expect.objectContaining({
              kind: "DIGEST_MOCK_RECORDED",
              actorUserId: null,
              reasonCode: JOB_ALERT_POLICY_V1.version,
            }),
          ]),
        );
        const terminal = alert.events.find((event) =>
          ["PAUSED", "UNSUBSCRIBED", "DELETED"].includes(event.kind),
        );
        if (fixture.status === "ACTIVE") {
          expect(terminal).toBeUndefined();
        } else {
          expect(terminal?.id).toBe(
            stableSeedId(
              "job-alert-event",
              `${fixture.key}:${fixture.status.toLowerCase()}`,
            ),
          );
          expect(terminal?.kind).toBe(fixture.status);
          expect(terminal?.actorUserId).toBe(
            fixture.status === "UNSUBSCRIBED"
              ? null
              : alert.candidateProfile.userId,
          );
          expect(terminal?.reasonCode).toBe(
            fixture.status === "PAUSED"
              ? "EXPLICIT_ALERT_ACTION"
              : fixture.status === "UNSUBSCRIBED"
                ? "ONE_CLICK_TOKEN"
                : "EXPLICIT_DELETE",
          );
        }
        const tokenUseExpected =
          fixture.status === "UNSUBSCRIBED" || fixture.status === "DELETED";
        expect(token.usedAt?.getTime() ?? null).toBe(
          tokenUseExpected ? terminal?.createdAt.getTime() : null,
        );
        expect(alert.events).toHaveLength(fixture.status === "ACTIVE" ? 2 : 3);

        expect(email).toMatchObject({
          recipient: alert.candidateProfile.user.emailNormalized,
          purpose: "job_alert_digest_mock",
          templateKey: "job_alert_digest_mock",
          status: "MOCK_RECORDED",
          errorCode: null,
        });
        const payload = email.payload;
        expect(
          payload !== null &&
            !Array.isArray(payload) &&
            typeof payload === "object" &&
            payload.deliveryStatus === "mock_recorded" &&
            payload.externalDeliveryClaimed === false &&
            typeof payload.body === "string" &&
            payload.body.includes("Geschützter Abmeldelink nicht verfügbar") &&
            !/(?:https?:\/\/|[?&]token=|[A-Za-z0-9_-]{43})/u.test(payload.body),
        ).toBe(true);
      }
    });

    it("reconciles only legacy DEMO artifacts and preserves LIVE canaries", async () => {
      const uuidPattern =
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gu;
      const [applicationMigrationSql, alertMigrationSql] = await Promise.all([
        readMigration(
          "20260720231000_phase_09_demo_application_event_reconciliation",
        ),
        readMigration("20260720231100_phase_09_demo_job_alert_reconciliation"),
      ]);
      expect(
        [...new Set(applicationMigrationSql.match(uuidPattern) ?? [])].sort(),
      ).toEqual(
        APPLICATION_FIXTURES.slice(0, 20)
          .map((fixture) =>
            stableSeedId("application-event", `${fixture.key}:current-status`),
          )
          .sort(),
      );
      expect(
        [...new Set(alertMigrationSql.match(uuidPattern) ?? [])].sort(),
      ).toEqual(
        JOB_ALERT_FIXTURES.map((fixture) =>
          stableSeedId("job-alert", fixture.key),
        ).sort(),
      );

      const demoApplicationFixture = APPLICATION_FIXTURES[0];
      const liveApplicationFixture = APPLICATION_FIXTURES[1];
      if (
        demoApplicationFixture === undefined ||
        liveApplicationFixture === undefined
      ) {
        throw new Error("Application reconciliation fixtures are incomplete.");
      }

      const [demoApplication, liveApplication] = await Promise.all([
        client().application.findUniqueOrThrow({
          where: {
            id: stableSeedId("application", demoApplicationFixture.key),
          },
          include: {
            candidateProfile: { select: { userId: true } },
          },
        }),
        client().application.findUniqueOrThrow({
          where: {
            id: stableSeedId("application", liveApplicationFixture.key),
          },
          include: {
            candidateProfile: { select: { userId: true } },
          },
        }),
      ]);

      await client().$transaction([
        client().user.update({
          where: { id: demoApplication.candidateProfile.userId },
          data: { dataProvenance: "DEMO" },
        }),
        client().user.update({
          where: { id: liveApplication.candidateProfile.userId },
          data: { dataProvenance: "LIVE" },
        }),
      ]);
      await setJobProvenanceForCanary(demoApplication.jobId, "DEMO");
      await setJobProvenanceForCanary(liveApplication.jobId, "LIVE");

      const demoApplicationEventId = stableSeedId(
        "application-event",
        `${demoApplicationFixture.key}:current-status`,
      );
      const liveApplicationEventId = stableSeedId(
        "application-event",
        `${liveApplicationFixture.key}:current-status`,
      );
      const nonSeedDemoApplicationEventId = stableSeedId(
        "application-event-reconciliation-canary",
        "non-seed-demo",
      );
      await client().applicationEvent.createMany({
        data: [
          {
            id: demoApplicationEventId,
            applicationId: demoApplication.id,
            kind: "STATUS_CHANGE",
            fromStatus: demoApplication.status,
            toStatus: demoApplication.status,
            idempotencyKey: "phase09-reconciliation-application-demo",
            correlationId: "phase09-reconciliation-application-demo",
            metadata: { source: "demo-pipeline-history" },
            createdAt: new Date("2026-07-20T01:00:00.000Z"),
          },
          {
            id: liveApplicationEventId,
            applicationId: liveApplication.id,
            kind: "STATUS_CHANGE",
            fromStatus: liveApplication.status,
            toStatus: liveApplication.status,
            idempotencyKey: "phase09-reconciliation-application-live",
            correlationId: "phase09-reconciliation-application-live",
            metadata: { source: "demo-pipeline-history" },
            createdAt: new Date("2026-07-20T01:01:00.000Z"),
          },
          {
            id: nonSeedDemoApplicationEventId,
            applicationId: demoApplication.id,
            kind: "STATUS_CHANGE",
            fromStatus: demoApplication.status,
            toStatus: demoApplication.status,
            idempotencyKey: "phase09-reconciliation-application-non-seed-demo",
            correlationId: "phase09-reconciliation-application-non-seed-demo",
            metadata: { source: "demo-pipeline-history" },
            createdAt: new Date("2026-07-20T01:02:00.000Z"),
          },
        ],
      });

      await runMigration(
        "20260720231000_phase_09_demo_application_event_reconciliation",
      );

      await expect(
        client().applicationEvent.findUnique({
          where: { id: demoApplicationEventId },
        }),
      ).resolves.toBeNull();
      await expect(
        client().applicationEvent.findUnique({
          where: { id: liveApplicationEventId },
        }),
      ).resolves.toMatchObject({
        id: liveApplicationEventId,
        applicationId: liveApplication.id,
      });
      await expect(
        client().applicationEvent.findUnique({
          where: { id: nonSeedDemoApplicationEventId },
        }),
      ).resolves.toMatchObject({
        id: nonSeedDemoApplicationEventId,
        applicationId: demoApplication.id,
      });
      await expect(
        client().applicationEvent.delete({
          where: { id: liveApplicationEventId },
        }),
      ).rejects.toThrow(/append-only/u);

      await setJobProvenanceForCanary(liveApplication.jobId, "DEMO");
      const demoAlertFixtureIndex = 6;
      const demoAlertFixture = JOB_ALERT_FIXTURES[demoAlertFixtureIndex];
      const liveAlertFixture = JOB_ALERT_FIXTURES[1];
      const mixedAlertFixture = JOB_ALERT_FIXTURES[2];
      if (
        demoAlertFixture === undefined ||
        liveAlertFixture === undefined ||
        mixedAlertFixture === undefined
      ) {
        throw new Error("Job-alert reconciliation fixtures are incomplete.");
      }
      const [demoSeedAlert, liveSeedAlert, mixedSeedAlert] = await Promise.all([
        client().jobAlert.findUniqueOrThrow({
          where: { id: stableSeedId("job-alert", demoAlertFixture.key) },
          include: {
            candidateProfile: { select: { userId: true } },
            digests: {
              include: { items: { orderBy: { sortOrder: "asc" } } },
            },
          },
        }),
        client().jobAlert.findUniqueOrThrow({
          where: { id: stableSeedId("job-alert", liveAlertFixture.key) },
          include: {
            candidateProfile: { select: { userId: true } },
            digests: {
              include: { items: { orderBy: { sortOrder: "asc" } } },
            },
          },
        }),
        client().jobAlert.findUniqueOrThrow({
          where: { id: stableSeedId("job-alert", mixedAlertFixture.key) },
          include: {
            candidateProfile: { select: { userId: true } },
            digests: {
              include: { items: { orderBy: { sortOrder: "asc" } } },
            },
          },
        }),
      ]);
      const demoSourceDigest = demoSeedAlert.digests[0];
      const liveSourceDigest = liveSeedAlert.digests[0];
      const mixedSourceDigest = mixedSeedAlert.digests[0];
      if (
        demoSourceDigest === undefined ||
        liveSourceDigest === undefined ||
        mixedSourceDigest === undefined ||
        demoSourceDigest.items.length !== 2 ||
        liveSourceDigest.items.length !== 2 ||
        mixedSourceDigest.items.length !== 2
      ) {
        throw new Error(
          "Job-alert reconciliation source digests are incomplete.",
        );
      }

      const projectionCanaries = [
        {
          fixture: demoAlertFixture,
          alert: demoSeedAlert,
          fixtureIndex: demoAlertFixtureIndex,
        },
        { fixture: liveAlertFixture, alert: liveSeedAlert, fixtureIndex: 1 },
        { fixture: mixedAlertFixture, alert: mixedSeedAlert, fixtureIndex: 2 },
      ] as const;
      for (const canary of projectionCanaries) {
        const candidateFixture =
          CANDIDATE_FIXTURES[canary.fixture.candidateIndex];
        if (candidateFixture === undefined) {
          throw new Error("Legacy JobAlert query fixture is incomplete.");
        }
        await client().jobAlert.update({
          where: { id: canary.alert.id },
          data: {
            query: {
              category: candidateFixture.categorySlug,
              canton: candidateFixture.cantonCode,
              page: 1,
            },
            nextDueAt: new Date(
              ANCHOR_AT.getTime() +
                (1 + (canary.fixtureIndex % 7)) * 86_400_000,
            ),
            lastSuccessfulCutoffAt: new Date(
              ANCHOR_AT.getTime() - 2 * 86_400_000,
            ),
          },
        });
      }

      await removeJobAlertCommitArtifactsForCanary([
        demoSeedAlert.id,
        liveSeedAlert.id,
        mixedSeedAlert.id,
      ]);
      await client().$transaction([
        client().user.update({
          where: { id: demoSeedAlert.candidateProfile.userId },
          data: { dataProvenance: "DEMO" },
        }),
        client().user.update({
          where: { id: liveSeedAlert.candidateProfile.userId },
          data: { dataProvenance: "LIVE" },
        }),
        client().user.update({
          where: { id: mixedSeedAlert.candidateProfile.userId },
          data: { dataProvenance: "DEMO" },
        }),
      ]);
      await setJobProvenanceForCanary(
        mixedSourceDigest.items[0]!.jobId,
        "LIVE",
      );

      const exactAlertCanaries = [
        {
          fixture: demoAlertFixture,
          alert: demoSeedAlert,
          sourceDigest: demoSourceDigest,
          tokenHash: "1".repeat(64),
          scheduledFor: new Date("2026-07-17T08:00:00.000Z"),
        },
        {
          fixture: liveAlertFixture,
          alert: liveSeedAlert,
          sourceDigest: liveSourceDigest,
          tokenHash: "2".repeat(64),
          scheduledFor: new Date("2026-07-17T09:00:00.000Z"),
        },
        {
          fixture: mixedAlertFixture,
          alert: mixedSeedAlert,
          sourceDigest: mixedSourceDigest,
          tokenHash: "4".repeat(64),
          scheduledFor: new Date("2026-07-17T10:00:00.000Z"),
        },
      ] as const;

      for (const canary of exactAlertCanaries) {
        const digestId = stableSeedId("job-alert-digest", canary.fixture.key);
        await client().jobAlertDigest.create({
          data: {
            id: digestId,
            jobAlertId: canary.alert.id,
            policyVersion: "job-alert-digest-v1",
            alertNameSnapshot: `Canary ${canary.fixture.key}`,
            recipientEmailSnapshot: `${canary.fixture.key}@example.test`,
            windowStart: canary.alert.createdAt,
            windowEnd: canary.scheduledFor,
            scheduledFor: canary.scheduledFor,
            runAt: new Date(canary.scheduledFor.getTime() + 5 * 60 * 1_000),
            itemCount: canary.sourceDigest.items.length,
            createdAt: canary.scheduledFor,
          },
        });
        for (const sourceItem of canary.sourceDigest.items) {
          await client().jobAlertDigestItem.create({
            data: {
              id: sourceItem.id,
              digestId,
              jobAlertId: canary.alert.id,
              jobId: sourceItem.jobId,
              sortOrder: sourceItem.sortOrder,
              createdAt: canary.scheduledFor,
            },
          });
        }
        await client().jobAlertUnsubscribeToken.create({
          data: {
            id: stableSeedId("job-alert-unsubscribe-token", canary.fixture.key),
            jobAlertId: canary.alert.id,
            digestId,
            tokenHash: canary.tokenHash,
            issuedAt: canary.scheduledFor,
            expiresAt: new Date(
              canary.scheduledFor.getTime() + 180 * 86_400_000,
            ),
          },
        });
        await client().jobAlertEvent.create({
          data: {
            id: stableSeedId(
              "job-alert-event",
              `${canary.fixture.key}:created`,
            ),
            jobAlertId: canary.alert.id,
            kind: "CREATED",
            actorUserId: canary.alert.candidateProfile.userId,
            reasonCode: null,
            createdAt: canary.alert.createdAt,
          },
        });
        if (canary.fixture.status !== "ACTIVE") {
          await client().jobAlertEvent.create({
            data: {
              id: stableSeedId(
                "job-alert-event",
                `${canary.fixture.key}:${canary.fixture.status.toLowerCase()}`,
              ),
              jobAlertId: canary.alert.id,
              kind: canary.fixture.status as
                "PAUSED" | "UNSUBSCRIBED" | "DELETED",
              actorUserId: canary.alert.candidateProfile.userId,
              reasonCode: "demo-lifecycle",
              createdAt: new Date(
                canary.alert.createdAt.getTime() + 86_400_000,
              ),
            },
          });
        }
      }

      const mixedExtraDigestId = stableSeedId(
        "job-alert-digest-reconciliation-canary",
        "mixed-extra-demo-digest",
      );
      const mixedExtraItemId = stableSeedId(
        "job-alert-digest-item-reconciliation-canary",
        "mixed-extra-demo-digest",
      );
      const mixedExtraTokenId = stableSeedId(
        "job-alert-token-reconciliation-canary",
        "mixed-extra-demo-digest",
      );
      await client().jobAlertDigest.create({
        data: {
          id: mixedExtraDigestId,
          jobAlertId: mixedSeedAlert.id,
          policyVersion: "job-alert-digest-v1",
          alertNameSnapshot: "Mixed extra canary",
          recipientEmailSnapshot: "mixed-extra-canary@example.test",
          windowStart: mixedSeedAlert.createdAt,
          windowEnd: new Date("2026-07-18T11:00:00.000Z"),
          scheduledFor: new Date("2026-07-18T11:00:00.000Z"),
          runAt: new Date("2026-07-18T11:05:00.000Z"),
          itemCount: 1,
          createdAt: new Date("2026-07-18T11:00:00.000Z"),
        },
      });
      await client().jobAlertDigestItem.create({
        data: {
          id: mixedExtraItemId,
          digestId: mixedExtraDigestId,
          jobAlertId: mixedSeedAlert.id,
          jobId: demoSourceDigest.items[0]!.jobId,
          sortOrder: 0,
          createdAt: new Date("2026-07-18T11:05:00.000Z"),
        },
      });
      await client().jobAlertUnsubscribeToken.create({
        data: {
          id: mixedExtraTokenId,
          jobAlertId: mixedSeedAlert.id,
          digestId: mixedExtraDigestId,
          tokenHash: "5".repeat(64),
          issuedAt: new Date("2026-07-18T11:05:00.000Z"),
          expiresAt: new Date("2027-01-14T11:05:00.000Z"),
        },
      });

      const nonSeedAlertId = stableSeedId(
        "job-alert-reconciliation-canary",
        "non-seed-demo",
      );
      const nonSeedDigestId = stableSeedId(
        "job-alert-digest-reconciliation-canary",
        "non-seed-demo",
      );
      const nonSeedItemId = stableSeedId(
        "job-alert-digest-item-reconciliation-canary",
        "non-seed-demo",
      );
      const nonSeedTokenId = stableSeedId(
        "job-alert-token-reconciliation-canary",
        "non-seed-demo",
      );
      const nonSeedEventId = stableSeedId(
        "job-alert-event-reconciliation-canary",
        "non-seed-demo",
      );
      await client().jobAlert.create({
        data: {
          id: nonSeedAlertId,
          candidateProfileId: demoSeedAlert.candidateProfileId,
          query: { keyword: "legacy-non-seed-demo-canary" },
          frequency: "DAILY",
          status: "PAUSED",
          nextDueAt: new Date("2026-07-21T10:00:00.000Z"),
          lastSuccessfulCutoffAt: new Date("2026-07-19T00:00:00.000Z"),
          createdAt: new Date("2026-07-18T00:00:00.000Z"),
          updatedAt: new Date("2026-07-18T00:00:00.000Z"),
        },
      });
      await client().jobAlertDigest.create({
        data: {
          id: nonSeedDigestId,
          jobAlertId: nonSeedAlertId,
          policyVersion: "job-alert-digest-v1",
          alertNameSnapshot: "Legacy non-seed canary",
          recipientEmailSnapshot: "non-seed-canary@example.test",
          windowStart: new Date("2026-07-18T00:00:00.000Z"),
          windowEnd: new Date("2026-07-19T00:00:00.000Z"),
          scheduledFor: new Date("2026-07-21T10:00:00.000Z"),
          runAt: new Date("2026-07-20T00:00:00.000Z"),
          itemCount: 1,
          createdAt: new Date("2026-07-20T00:00:00.000Z"),
        },
      });
      await client().jobAlertDigestItem.create({
        data: {
          id: nonSeedItemId,
          digestId: nonSeedDigestId,
          jobAlertId: nonSeedAlertId,
          jobId: demoSourceDigest.items[0]!.jobId,
          sortOrder: 0,
          createdAt: new Date("2026-07-20T00:00:00.000Z"),
        },
      });
      await client().jobAlertUnsubscribeToken.create({
        data: {
          id: nonSeedTokenId,
          jobAlertId: nonSeedAlertId,
          digestId: nonSeedDigestId,
          tokenHash: "3".repeat(64),
          issuedAt: new Date("2026-07-20T00:00:00.000Z"),
          expiresAt: new Date("2027-01-16T00:00:00.000Z"),
        },
      });
      await client().jobAlertEvent.create({
        data: {
          id: nonSeedEventId,
          jobAlertId: nonSeedAlertId,
          kind: "PAUSED",
          actorUserId: demoSeedAlert.candidateProfile.userId,
          reasonCode: "demo-lifecycle",
          createdAt: new Date("2026-07-20T00:00:00.000Z"),
        },
      });

      await runMigration(
        "20260720231100_phase_09_demo_job_alert_reconciliation",
      );

      const exactCanaryRows = async (
        fixture: (typeof JOB_ALERT_FIXTURES)[number],
      ) => {
        const alertId = stableSeedId("job-alert", fixture.key);
        return Promise.all([
          client().jobAlert.findUnique({ where: { id: alertId } }),
          client().jobAlertEvent.findUnique({
            where: {
              id: stableSeedId("job-alert-event", `${fixture.key}:created`),
            },
          }),
          ...(fixture.status === "ACTIVE"
            ? []
            : [
                client().jobAlertEvent.findUnique({
                  where: {
                    id: stableSeedId(
                      "job-alert-event",
                      `${fixture.key}:${fixture.status.toLowerCase()}`,
                    ),
                  },
                }),
              ]),
          ...fixture.jobIndices.map((_, itemIndex) =>
            client().jobAlertDigestItem.findUnique({
              where: {
                id: stableSeedId(
                  "job-alert-digest-item",
                  `${fixture.key}:${itemIndex}`,
                ),
              },
            }),
          ),
          client().jobAlertUnsubscribeToken.findUnique({
            where: {
              id: stableSeedId("job-alert-unsubscribe-token", fixture.key),
            },
          }),
          client().jobAlertDigest.findUnique({
            where: {
              id: stableSeedId("job-alert-digest", fixture.key),
            },
          }),
        ]);
      };

      const [demoRows, liveRows, mixedRows, mixedExtraRows, nonSeedRows] =
        await Promise.all([
          exactCanaryRows(demoAlertFixture),
          exactCanaryRows(liveAlertFixture),
          exactCanaryRows(mixedAlertFixture),
          Promise.all([
            client().jobAlertDigest.findUnique({
              where: { id: mixedExtraDigestId },
            }),
            client().jobAlertDigestItem.findUnique({
              where: { id: mixedExtraItemId },
            }),
            client().jobAlertUnsubscribeToken.findUnique({
              where: { id: mixedExtraTokenId },
            }),
          ]),
          Promise.all([
            client().jobAlert.findUnique({ where: { id: nonSeedAlertId } }),
            client().jobAlertEvent.findUnique({
              where: { id: nonSeedEventId },
            }),
            client().jobAlertDigestItem.findUnique({
              where: { id: nonSeedItemId },
            }),
            client().jobAlertUnsubscribeToken.findUnique({
              where: { id: nonSeedTokenId },
            }),
            client().jobAlertDigest.findUnique({
              where: { id: nonSeedDigestId },
            }),
          ]),
        ]);
      expect(demoRows[0]).toMatchObject({
        id: stableSeedId("job-alert", demoAlertFixture.key),
      });
      expect(demoRows.slice(1)).toEqual([null, null, null, null, null, null]);
      expect(liveRows.every((row) => row !== null)).toBe(true);
      expect(mixedRows.every((row) => row !== null)).toBe(true);
      expect(mixedExtraRows.every((row) => row !== null)).toBe(true);
      expect(nonSeedRows.every((row) => row !== null)).toBe(true);
      await expect(
        client().jobAlertDigestItem.delete({
          where: {
            id: stableSeedId(
              "job-alert-digest-item",
              `${liveAlertFixture.key}:0`,
            ),
          },
        }),
      ).rejects.toThrow(/append-only/u);

      await removeApplicationEventsForCanary([
        liveApplicationEventId,
        nonSeedDemoApplicationEventId,
      ]);
      await removeJobAlertCommitArtifactsForCanary([
        liveSeedAlert.id,
        mixedSeedAlert.id,
        nonSeedAlertId,
      ]);
      await client().jobAlert.delete({ where: { id: nonSeedAlertId } });
      const usersToRestore = [
        ...new Set([
          liveApplication.candidateProfile.userId,
          demoSeedAlert.candidateProfile.userId,
          liveSeedAlert.candidateProfile.userId,
          mixedSeedAlert.candidateProfile.userId,
        ]),
      ];
      await client().$transaction(
        usersToRestore.map((userId) =>
          client().user.update({
            where: { id: userId },
            data: { dataProvenance: "DEMO" },
          }),
        ),
      );
      await setJobProvenanceForCanary(liveApplication.jobId, "DEMO");
      await setJobProvenanceForCanary(
        mixedSourceDigest.items[0]!.jobId,
        "DEMO",
      );

      const dependencies = await seedDemoAccountsCompaniesAndJobs(
        client(),
        ANCHOR_AT,
      );
      const upgraded = await seedCandidateWorkflows(
        client(),
        ANCHOR_AT,
        dependencies,
        DEMO_ONLY_CANDIDATE_WORKFLOW_CRYPTO,
      );
      const upgradedAlerts = await client().jobAlert.findMany({
        where: {
          id: {
            in: [demoSeedAlert.id, liveSeedAlert.id, mixedSeedAlert.id],
          },
        },
        include: {
          digests: true,
          events: true,
        },
        orderBy: { id: "asc" },
      });
      expect(upgradedAlerts).toHaveLength(3);
      for (const alert of upgradedAlerts) {
        expect(parseStoredJobAlertQuery(alert.query).kind).toBe("v1");
        expect(alert.digests).toHaveLength(1);
        expect(alert.digests[0]?.policyVersion).toBe(
          JOB_ALERT_POLICY_V1.version,
        );
        expect(alert.events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: "CREATED",
              reasonCode: "EXPLICIT_ACTIVATION",
            }),
            expect.objectContaining({
              kind: "DIGEST_MOCK_RECORDED",
              reasonCode: JOB_ALERT_POLICY_V1.version,
            }),
          ]),
        );
      }
      await expect(
        client().applicationEvent.count({
          where: {
            id: { in: [demoApplicationEventId, liveApplicationEventId] },
          },
        }),
      ).resolves.toBe(0);

      const firstReplayVersions = await client().$queryRaw<
        Array<{ id: string; version: string }>
      >`SELECT "id"::text AS id, xmin::text AS version FROM "JobAlert" ORDER BY "id"`;
      const replayed = await seedCandidateWorkflows(
        client(),
        ANCHOR_AT,
        dependencies,
        DEMO_ONLY_CANDIDATE_WORKFLOW_CRYPTO,
      );
      const secondReplayVersions = await client().$queryRaw<
        Array<{ id: string; version: string }>
      >`SELECT "id"::text AS id, xmin::text AS version FROM "JobAlert" ORDER BY "id"`;
      expect(replayed).toEqual(upgraded);
      expect(secondReplayVersions).toEqual(firstReplayVersions);
    });
  },
  600_000,
);
