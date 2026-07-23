import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { candidateAnalyticsSubjectV1 } from "@/lib/analytics/pseudonyms";
import { getApplicationConfirmationView } from "@/lib/applications/confirmation";
import {
  updateCandidateApplicationNote,
  withdrawCandidateApplication,
} from "@/lib/applications/candidate-commands";
import {
  CANDIDATE_APPLICATION_PAGE_SIZE,
  getCandidateApplicationDetail,
  listCandidateApplications,
} from "@/lib/applications/queries";
import { applyToJob } from "@/lib/applications/service";
import type { CurrentUser } from "@/lib/auth/current-user";
import type { AuthRequestContext } from "@/lib/auth/request-context";
import { signJobIntent } from "@/lib/auth/signed-intent";
import {
  listCandidateSavedJobs,
  MAXIMUM_SAVED_JOBS,
  removeSavedJob,
  saveJobFromSignedIntent,
} from "@/lib/candidate/saved-jobs";
import {
  parseEnvironment,
  type ServerEnvironment,
} from "@/lib/config/env-schema";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { MockEmailProvider } from "@/lib/providers/email/mock-email-provider";
import type { EmailProvider } from "@/lib/providers/email/email-provider";
import { PrismaEmailLogRepository } from "@/lib/providers/email/prisma-email-log-repository";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

const NOW = new Date("2026-07-20T12:00:00.000Z");
const EXPIRES_AT = new Date("2026-08-20T12:00:00.000Z");
const APPLICATION_ANALYTICS_SESSION_ID =
  "12345678-1234-4234-8234-123456789abc";
const IDS = Object.freeze({
  candidateUser: randomUUID(),
  candidateProfile: randomUUID(),
  otherCandidateUser: randomUUID(),
  otherCandidateProfile: randomUUID(),
  employerUser: randomUUID(),
  company: randomUUID(),
  companyLocation: randomUUID(),
  membership: randomUUID(),
  verification: randomUUID(),
  canton: randomUUID(),
  city: randomUUID(),
  category: randomUUID(),
  job: randomUUID(),
  revision: randomUUID(),
  driftRevision: randomUUID(),
  document: randomUUID(),
  externalJob: randomUUID(),
  externalRevision: randomUUID(),
  retryJob: randomUUID(),
  retryRevision: randomUUID(),
});

let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;
let environment: ServerEnvironment | undefined;

function client() {
  if (database === undefined)
    throw new Error("Application test database unavailable.");
  return database;
}

function runtimeEnvironment() {
  if (environment === undefined)
    throw new Error("Application test environment unavailable.");
  return environment;
}

beforeAll(async () => {
  migrated = await createMigratedTestDatabase(
    "phase09_applications_saved_jobs",
  );
  database = createDatabaseClient(migrated.connectionString);
  environment = buildEnvironment(migrated.connectionString);
  await database.$connect();
  await seedContractData(client());
});

afterAll(async () => {
  await database?.$disconnect().catch(() => undefined);
  database = undefined;
  environment = undefined;
  await migrated?.dispose();
  migrated = undefined;
});

describe.sequential(
  "PostgreSQL Phase-09 save/apply ownership and concurrency",
  () => {
    it("creates one SavedJob under concurrency and keeps remove candidate-scoped", async () => {
      const intent = signJobIntent(
        { action: "SAVE", jobSlug: "phase09-application-job", now: NOW },
        runtimeEnvironment().secrets.session,
      );
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          saveJobFromSignedIntent(
            { signedIntent: intent, candidateUserId: IDS.candidateUser },
            {
              database: client(),
              environment: runtimeEnvironment(),
              signingKey: runtimeEnvironment().secrets.session,
              now: NOW,
            },
          ),
        ),
      );
      expect(results.every((result) => result.ok)).toBe(true);
      expect(
        results.filter((result) => result.ok && !result.duplicate),
      ).toHaveLength(1);
      const savedRows = await client().savedJob.findMany({
        where: { candidateProfileId: IDS.candidateProfile, jobId: IDS.job },
      });
      expect(savedRows).toHaveLength(1);
      await expect(
        client().analyticsEvent.count({
          where: { kind: "JOB_SAVED", jobId: IDS.job },
        }),
      ).resolves.toBe(0);

      const foreignAttempt = await removeSavedJob(
        {
          savedJobId: savedRows[0]!.id,
          candidateUserId: IDS.otherCandidateUser,
        },
        client(),
      );
      expect(foreignAttempt).toEqual({ ok: true, removed: false });
      await expect(
        client().savedJob.count({ where: { id: savedRows[0]!.id } }),
      ).resolves.toBe(1);
    });

    it("fails confirmation, Save and Apply closed when the current revision pointer drifts", async () => {
      const applyIntent = signJobIntent(
        { action: "APPLY", jobSlug: "phase09-application-job", now: NOW },
        runtimeEnvironment().secrets.session,
      );
      const saveIntent = signJobIntent(
        { action: "SAVE", jobSlug: "phase09-application-job", now: NOW },
        runtimeEnvironment().secrets.session,
      );
      const saveDependencies = {
        database: client(),
        environment: runtimeEnvironment(),
        signingKey: runtimeEnvironment().secrets.session,
        now: NOW,
      } as const;
      const confirmation = await getApplicationConfirmationView(
        {
          candidateUserId: IDS.candidateUser,
          jobSlug: "phase09-application-job",
          now: NOW,
          environment: "non-production",
        },
        client(),
      );
      expect(confirmation.ok).toBe(true);
      if (!confirmation.ok) throw new Error("Expected a current confirmation.");
      await expect(
        saveJobFromSignedIntent(
          { signedIntent: saveIntent, candidateUserId: IDS.candidateUser },
          saveDependencies,
        ),
      ).resolves.toMatchObject({ ok: true });

      await client().jobRevision.create({
        data: {
          id: IDS.driftRevision,
          jobId: IDS.job,
          revisionNumber: 2,
          title: "Unveröffentlichter Entwurf",
          description: "Dieser Entwurf darf keine öffentliche Aktion autorisieren.",
          tasks: ["Entwurfsaufgabe"],
          requirements: ["Entwurfsanforderung"],
          applicationProcessSteps: ["Entwurfsprozess"],
          requiredDocumentKinds: ["CV"],
          jobType: "PERMANENT",
          remoteType: "HYBRID",
          categoryId: IDS.category,
          cantonId: IDS.canton,
          cityId: IDS.city,
          locationLabel: "Zürich",
          workloadMin: 60,
          workloadMax: 100,
          salaryPeriod: "YEARLY",
          salaryMin: 90_000,
          salaryMax: 110_000,
          startByArrangement: true,
          validThrough: EXPIRES_AT,
          responseTargetDays: 7,
          applicationEffort: "SIMPLE",
          applicationContactKind: "EMAIL",
          applicationContactValue: "draft@phase09-contract.example",
          authoredByUserId: IDS.employerUser,
          contentChecksum: createHash("sha256")
            .update("phase09-current-revision-drift")
            .digest("hex"),
        },
      });
      await client().job.update({
        where: { id: IDS.job },
        data: { currentRevisionId: IDS.driftRevision },
      });

      try {
        await expect(
          getApplicationConfirmationView(
            {
              candidateUserId: IDS.candidateUser,
              jobSlug: "phase09-application-job",
              now: NOW,
              environment: "non-production",
            },
            client(),
          ),
        ).resolves.toEqual({ ok: false, code: "NOT_ELIGIBLE" });
        await expect(
          saveJobFromSignedIntent(
            { signedIntent: saveIntent, candidateUserId: IDS.candidateUser },
            saveDependencies,
          ),
        ).resolves.toEqual({ ok: false, code: "NOT_ELIGIBLE" });

        const savedJobs = await listCandidateSavedJobs(
          IDS.candidateUser,
          client(),
          { now: NOW, environment: "non-production" },
        );
        expect(
          savedJobs.find(({ job }) => job.slug === "phase09-application-job"),
        ).toMatchObject({ current: false });
        await expect(
          applyToJob(
            {
              signedIntent: applyIntent,
              coverLetter: "Ich bestätige die zuvor angezeigte Bewerbung.",
              selectedDocumentIds: [IDS.document],
              confirmationVersion:
                confirmation.value.projection.confirmationVersion,
              confirmationSnapshotHash:
                confirmation.value.projection.confirmationSnapshotHash,
              confirmed: true,
              idempotencyKey: "application:current-revision-drift",
            },
            {
              database: client(),
              environment: runtimeEnvironment(),
              request: requestContext(90),
              currentUser: candidateUser(),
              emailProvider: new MockEmailProvider(
                new PrismaEmailLogRepository(client()),
              ),
              now: NOW,
            },
          ),
        ).resolves.toEqual({ ok: false, code: "NOT_ELIGIBLE" });
        await expect(
          client().application.count({
            where: { jobId: IDS.job, candidateProfileId: IDS.candidateProfile },
          }),
        ).resolves.toBe(0);
      } finally {
        await client().job.update({
          where: { id: IDS.job },
          data: { currentRevisionId: IDS.revision },
        });
        await client().jobRevision.delete({
          where: { id: IDS.driftRevision },
        });
      }
    });

    it("fails confirmation and Apply closed when the published category is inactive", async () => {
      const confirmation = await getApplicationConfirmationView(
        {
          candidateUserId: IDS.candidateUser,
          jobSlug: "phase09-application-job",
          now: NOW,
          environment: "non-production",
        },
        client(),
      );
      expect(confirmation.ok).toBe(true);
      if (!confirmation.ok) throw new Error("Expected a current confirmation.");
      const intent = signJobIntent(
        { action: "APPLY", jobSlug: "phase09-application-job", now: NOW },
        runtimeEnvironment().secrets.session,
      );
      await client().category.update({
        where: { id: IDS.category },
        data: { isActive: false },
      });

      try {
        await expect(
          getApplicationConfirmationView(
            {
              candidateUserId: IDS.candidateUser,
              jobSlug: "phase09-application-job",
              now: NOW,
              environment: "non-production",
            },
            client(),
          ),
        ).resolves.toEqual({ ok: false, code: "NOT_ELIGIBLE" });
        await expect(
          applyToJob(
            {
              signedIntent: intent,
              coverLetter: "Ich bestätige die zuvor angezeigte Bewerbung.",
              selectedDocumentIds: [IDS.document],
              confirmationVersion:
                confirmation.value.projection.confirmationVersion,
              confirmationSnapshotHash:
                confirmation.value.projection.confirmationSnapshotHash,
              confirmed: true,
              idempotencyKey: "application:inactive-category",
            },
            {
              database: client(),
              environment: runtimeEnvironment(),
              request: requestContext(91),
              currentUser: candidateUser(),
              emailProvider: new MockEmailProvider(
                new PrismaEmailLogRepository(client()),
              ),
              now: NOW,
            },
          ),
        ).resolves.toEqual({ ok: false, code: "NOT_ELIGIBLE" });
        await expect(
          client().application.count({
            where: { jobId: IDS.job, candidateProfileId: IDS.candidateProfile },
          }),
        ).resolves.toBe(0);
      } finally {
        await client().category.update({
          where: { id: IDS.category },
          data: { isActive: true },
        });
      }
    });

    it("keeps the committed application retryable when the post-commit Mock email fails", async () => {
      const confirmation = await getApplicationConfirmationView(
        {
          candidateUserId: IDS.otherCandidateUser,
          jobSlug: "phase09-email-retry-job",
          now: NOW,
          environment: "non-production",
        },
        client(),
      );
      expect(confirmation.ok).toBe(true);
      if (!confirmation.ok)
        throw new Error("Expected retry confirmation view.");

      const input = {
        signedIntent: signJobIntent(
          { action: "APPLY", jobSlug: "phase09-email-retry-job", now: NOW },
          runtimeEnvironment().secrets.session,
        ),
        coverLetter: "",
        selectedDocumentIds: [],
        confirmationVersion: confirmation.value.projection.confirmationVersion,
        confirmationSnapshotHash:
          confirmation.value.projection.confirmationSnapshotHash,
        confirmed: true as const,
        idempotencyKey: "application:email-retry:one",
      };
      const durableProvider = new MockEmailProvider(
        new PrismaEmailLogRepository(client()),
      );
      let failFirstSend = true;
      const retryingProvider: EmailProvider = {
        async send(email) {
          if (failFirstSend) {
            failFirstSend = false;
            throw new Error("Injected post-commit Mock email failure");
          }
          return durableProvider.send(email);
        },
      };

      const unconfirmed = await applyToJob(
        { ...input, confirmed: false },
        {
          database: client(),
          environment: runtimeEnvironment(),
          request: requestContext(9),
          currentUser: otherCandidateUser(),
          emailProvider: retryingProvider,
          now: NOW,
        },
      );
      expect(unconfirmed).toEqual({ ok: false, code: "INVALID_INPUT" });
      await expect(
        client().application.count({
          where: {
            candidateProfileId: IDS.otherCandidateProfile,
            jobId: IDS.retryJob,
          },
        }),
      ).resolves.toBe(0);

      const first = await applyToJob(input, {
        database: client(),
        environment: runtimeEnvironment(),
        request: requestContext(10),
        currentUser: otherCandidateUser(),
        emailProvider: retryingProvider,
        now: NOW,
      });
      expect(first).toMatchObject({
        ok: true,
        duplicate: false,
        emailRecorded: false,
      });
      if (!first.ok) throw new Error("Expected committed application.");

      const replayAt = new Date(NOW.getTime() + 31 * 60 * 1_000);
      await client().job.update({
        where: { id: IDS.retryJob },
        data: { status: "CLOSED" },
      });

      const foreignReplay = await applyToJob(input, {
        database: client(),
        environment: runtimeEnvironment(),
        request: requestContext(11),
        currentUser: candidateUser(),
        emailProvider: retryingProvider,
        now: replayAt,
      });
      expect(foreignReplay).toEqual({ ok: false, code: "INVALID_INTENT" });

      const conflictingReplay = await applyToJob(
        { ...input, coverLetter: "Abweichender Replay-Inhalt." },
        {
          database: client(),
          environment: runtimeEnvironment(),
          request: requestContext(12),
          currentUser: otherCandidateUser(),
          emailProvider: retryingProvider,
          now: replayAt,
        },
      );
      expect(conflictingReplay).toEqual({
        ok: false,
        code: "IDEMPOTENCY_CONFLICT",
      });
      await expect(
        client().emailLog.count({
          where: {
            templateKey: "application_submitted",
            recipient: "phase09-application-other@example.test",
          },
        }),
      ).resolves.toBe(0);

      let retry: Awaited<ReturnType<typeof applyToJob>>;
      try {
        retry = await applyToJob(input, {
          database: client(),
          environment: runtimeEnvironment(),
          request: requestContext(13),
          currentUser: otherCandidateUser(),
          emailProvider: retryingProvider,
          now: replayAt,
        });
      } finally {
        await client().job.update({
          where: { id: IDS.retryJob },
          data: { status: "PUBLISHED" },
        });
      }
      expect(retry).toMatchObject({
        ok: true,
        applicationId: first.applicationId,
        duplicate: true,
        emailRecorded: true,
      });

      const applicationId = first.applicationId;
      const [
        applications,
        snapshots,
        events,
        conversations,
        participants,
        audits,
        analytics,
        notifications,
        emails,
      ] = await Promise.all([
        client().application.count({ where: { id: applicationId } }),
        client().applicationSubmissionSnapshot.count({
          where: { applicationId },
        }),
        client().applicationEvent.count({ where: { applicationId } }),
        client().conversation.count({ where: { applicationId } }),
        client().conversationParticipant.count({
          where: { conversation: { applicationId } },
        }),
        client().auditLog.count({
          where: { action: "APPLICATION_SUBMITTED", targetId: applicationId },
        }),
        client().analyticsEvent.count({
          where: { kind: "APPLICATION_SUBMITTED", jobId: IDS.retryJob },
        }),
        client().notification.count({
          where: {
            kind: "APPLICATION_SUBMITTED",
            payload: { path: ["applicationId"], equals: applicationId },
          },
        }),
        client().emailLog.count({
          where: {
            templateKey: "application_submitted",
            recipient: "phase09-application-other@example.test",
          },
        }),
      ]);
      expect({
        applications,
        snapshots,
        events,
        conversations,
        participants,
        audits,
        analytics,
        notifications,
        emails,
      }).toEqual({
        applications: 1,
        snapshots: 1,
        events: 1,
        conversations: 1,
        participants: 2,
        audits: 1,
        analytics: 1,
        notifications: 2,
        emails: 1,
      });
    });

    it("creates one immutable application aggregate for concurrent identical submits", async () => {
      const confirmation = await getApplicationConfirmationView(
        {
          candidateUserId: IDS.candidateUser,
          jobSlug: "phase09-application-job",
          now: NOW,
          environment: "non-production",
        },
        client(),
      );
      expect(confirmation.ok).toBe(true);
      if (!confirmation.ok) throw new Error("Expected confirmation view.");
      const intent = signJobIntent(
        {
          action: "APPLY",
          jobSlug: "phase09-application-job",
          analyticsSessionId: APPLICATION_ANALYTICS_SESSION_ID,
          now: NOW,
        },
        runtimeEnvironment().secrets.session,
      );
      const input = {
        signedIntent: intent,
        coverLetter: "Ich bewerbe mich ausdrücklich auf diese Stelle.",
        selectedDocumentIds: [IDS.document],
        confirmationVersion: confirmation.value.projection.confirmationVersion,
        confirmationSnapshotHash:
          confirmation.value.projection.confirmationSnapshotHash,
        confirmed: true as const,
        idempotencyKey: "application:concurrent:one",
      };
      const emailProvider = new MockEmailProvider(
        new PrismaEmailLogRepository(client()),
      );
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          applyToJob(input, {
            database: client(),
            environment: runtimeEnvironment(),
            request: requestContext(index),
            currentUser: candidateUser(),
            emailProvider,
            now: NOW,
          }),
        ),
      );
      expect(results.every((result) => result.ok)).toBe(true);
      expect(
        results.filter((result) => result.ok && !result.duplicate),
      ).toHaveLength(1);
      const applicationId = results.find((result) => result.ok)?.applicationId;
      expect(applicationId).toBeTypeOf("string");
      if (applicationId === undefined)
        throw new Error("Expected the submitted Application id.");

      const [
        applications,
        snapshots,
        documents,
        events,
        conversations,
        participants,
        audits,
        analytics,
        emails,
      ] = await Promise.all([
        client().application.count({
          where: { jobId: IDS.job, candidateProfileId: IDS.candidateProfile },
        }),
        client().applicationSubmissionSnapshot.count({
          where: { applicationId },
        }),
        client().applicationSubmissionDocument.count({
          where: { applicationId },
        }),
        client().applicationEvent.count({ where: { applicationId } }),
        client().conversation.count({ where: { applicationId } }),
        client().conversationParticipant.count({
          where: { conversation: { applicationId } },
        }),
        client().auditLog.count({
          where: { action: "APPLICATION_SUBMITTED", targetId: applicationId },
        }),
        client().analyticsEvent.findMany({
          where: { kind: "APPLICATION_SUBMITTED", jobId: IDS.job },
          select: {
            pseudonymousActorId: true,
            pseudonymousSessionId: true,
            actorProvenanceSnapshot: true,
            companyProvenanceSnapshot: true,
            jobProvenanceSnapshot: true,
          },
        }),
        client().emailLog.count({
          where: {
            templateKey: "application_submitted",
            recipient: "phase09-application-candidate@example.test",
          },
        }),
      ]);
      expect({
        applications,
        snapshots,
        documents,
        events,
        conversations,
        participants,
        audits,
        analytics,
        emails,
      }).toEqual({
        applications: 1,
        snapshots: 1,
        documents: 1,
        events: 1,
        conversations: 1,
        participants: 2,
        audits: 1,
        analytics: [
          {
            pseudonymousActorId: candidateAnalyticsSubjectV1(
              IDS.candidateUser,
            ),
            pseudonymousSessionId: APPLICATION_ANALYTICS_SESSION_ID,
            actorProvenanceSnapshot: "LIVE",
            companyProvenanceSnapshot: "LIVE",
            jobProvenanceSnapshot: "LIVE",
          },
        ],
        emails: 1,
      });
      await expect(
        client().notification.count({
          where: {
            kind: "APPLICATION_SUBMITTED",
            payload: { path: ["applicationId"], equals: applicationId },
          },
        }),
      ).resolves.toBe(2);

      const immutableSnapshotBeforeSourceChanges =
        await client().applicationSubmissionSnapshot.findUniqueOrThrow({
          where: { applicationId },
        });
      const [
        originalCandidateProfile,
        originalCandidateUser,
        originalCompany,
        originalRevision,
        originalJobPointers,
      ] = await Promise.all([
        client().candidateProfile.findUniqueOrThrow({
          where: { id: IDS.candidateProfile },
          select: { firstName: true, lastName: true },
        }),
        client().user.findUniqueOrThrow({
          where: { id: IDS.candidateUser },
          select: {
            email: true,
            emailNormalized: true,
            name: true,
          },
        }),
        client().company.findUniqueOrThrow({
          where: { id: IDS.company },
          select: { name: true },
        }),
        client().jobRevision.findUniqueOrThrow({
          where: { id: IDS.revision },
        }),
        client().job.findUniqueOrThrow({
          where: { id: IDS.job },
          select: {
            currentRevisionId: true,
            publishedRevisionId: true,
          },
        }),
      ]);
      const successorRevisionId = randomUUID();
      try {
        await Promise.all([
          client().candidateProfile.update({
            where: { id: IDS.candidateProfile },
            data: {
              firstName: "Nachträglich",
              lastName: "Geändert",
            },
          }),
          client().user.update({
            where: { id: IDS.candidateUser },
            data: {
              email: "changed-after-submit@example.test",
              emailNormalized: "changed-after-submit@example.test",
              name: "Nachträglich Geändert",
            },
          }),
          client().company.update({
            where: { id: IDS.company },
            data: { name: "Nachträglich umbenannte Firma AG" },
          }),
        ]);
        await client().jobRevision.create({
          data: {
            ...originalRevision,
            id: successorRevisionId,
            revisionNumber: originalRevision.revisionNumber + 1,
            title: "Nachträglich geänderter Stellentitel",
            applicationContactKind: "APPLY_URL",
            applicationContactValue:
              "https://changed-after-submit.example/apply",
            responseTargetDays: 30,
            applicationEffort: "LONG",
            requiredDocumentKinds: ["CV", "COVER_LETTER"],
            contentChecksum: createHash("sha256")
              .update("phase09-successor-after-submit")
              .digest("hex"),
            submittedAt: null,
            approvedAt: null,
            rejectedAt: null,
          },
        });
        await client().job.update({
          where: { id: IDS.job },
          data: {
            currentRevisionId: successorRevisionId,
          },
        });

        await expect(
          client().applicationSubmissionSnapshot.findUniqueOrThrow({
            where: { applicationId },
          }),
        ).resolves.toEqual(immutableSnapshotBeforeSourceChanges);
      } finally {
        await Promise.all([
          client().candidateProfile.update({
            where: { id: IDS.candidateProfile },
            data: originalCandidateProfile,
          }),
          client().user.update({
            where: { id: IDS.candidateUser },
            data: originalCandidateUser,
          }),
          client().company.update({
            where: { id: IDS.company },
            data: originalCompany,
          }),
          client().job.update({
            where: { id: IDS.job },
            data: originalJobPointers,
          }),
        ]);
        await client().jobRevision.deleteMany({
          where: { id: successorRevisionId },
        });
      }

      const submittedDocument =
        await client().applicationSubmissionDocument.findFirstOrThrow({
          where: { applicationId },
          select: { id: true },
        });
      await expect(
        client().applicationSubmissionSnapshot.update({
          where: { applicationId },
          data: { candidateFirstName: "Tampered" },
        }),
      ).rejects.toThrow();
      await expect(
        client().applicationSubmissionSnapshot.delete({
          where: { applicationId },
        }),
      ).rejects.toThrow();
      await expect(
        client().applicationSubmissionDocument.update({
          where: { id: submittedDocument.id },
          data: { safeFilenameSnapshot: "tampered.pdf" },
        }),
      ).rejects.toThrow();
      await expect(
        client().applicationSubmissionDocument.delete({
          where: { id: submittedDocument.id },
        }),
      ).rejects.toThrow();
      await expect(
        Promise.all([
          client().applicationSubmissionSnapshot.count({
            where: { applicationId },
          }),
          client().applicationSubmissionDocument.count({
            where: { applicationId },
          }),
        ]),
      ).resolves.toEqual([1, 1]);

      const differentKey = await applyToJob(
        { ...input, idempotencyKey: "application:different:key" },
        {
          database: client(),
          environment: runtimeEnvironment(),
          request: requestContext(20),
          currentUser: candidateUser(),
          emailProvider,
          now: NOW,
        },
      );
      expect(differentKey).toEqual({
        ok: false,
        code: "ALREADY_APPLIED",
        applicationId,
      });

      const foreignWithdraw = await withdrawCandidateApplication(
        {
          applicationId,
          confirmed: true,
          idempotencyKey: "withdraw:foreign:attempt",
        },
        {
          database: client(),
          environment: runtimeEnvironment(),
          request: requestContext(21),
          currentUser: otherCandidateUser(),
          now: NOW,
        },
      );
      expect(foreignWithdraw).toEqual({ ok: false, code: "NOT_FOUND" });

      const withdrawals = await Promise.all(
        Array.from({ length: 4 }, (_, index) =>
          withdrawCandidateApplication(
            {
              applicationId,
              confirmed: true,
              idempotencyKey: "withdraw:concurrent:one",
            },
            {
              database: client(),
              environment: runtimeEnvironment(),
              request: requestContext(22 + index),
              currentUser: candidateUser(),
              now: NOW,
            },
          ),
        ),
      );
      expect(withdrawals.every((result) => result.ok)).toBe(true);
      expect(
        withdrawals.filter((result) => result.ok && !result.duplicate),
      ).toHaveLength(1);
      await expect(
        client().application.findUniqueOrThrow({
          where: { id: applicationId },
          select: { status: true },
        }),
      ).resolves.toEqual({ status: "WITHDRAWN" });
      await expect(
        client().applicationEvent.count({
          where: { applicationId, toStatus: "WITHDRAWN" },
        }),
      ).resolves.toBe(1);
      await expect(
        client().auditLog.count({
          where: { action: "APPLICATION_WITHDRAWN", targetId: applicationId },
        }),
      ).resolves.toBe(1);
    });

    it("binds candidate-note idempotency to the sanitized body hash", async () => {
      const application = await client().application.findFirstOrThrow({
        where: { candidateProfileId: IDS.candidateProfile, jobId: IDS.job },
        select: { id: true },
      });
      const dependencies = {
        database: client(),
        environment: runtimeEnvironment(),
        request: requestContext(40),
        currentUser: candidateUser(),
        now: NOW,
      };
      const input = {
        applicationId: application.id,
        body: "Nur für mich sichtbar",
        idempotencyKey: "candidate-note:stable-body",
      };

      await expect(
        updateCandidateApplicationNote(input, dependencies),
      ).resolves.toEqual({
        ok: true,
        applicationId: application.id,
        duplicate: false,
      });
      await expect(
        updateCandidateApplicationNote(input, {
          ...dependencies,
          request: requestContext(41),
        }),
      ).resolves.toEqual({
        ok: true,
        applicationId: application.id,
        duplicate: true,
      });
      await expect(
        updateCandidateApplicationNote(
          { ...input, body: "Anderer Inhalt mit demselben Schlüssel" },
          { ...dependencies, request: requestContext(42) },
        ),
      ).resolves.toEqual({ ok: false, code: "CONFLICT" });

      const [note, events] = await Promise.all([
        client().applicationCandidateNote.findUniqueOrThrow({
          where: { applicationId: application.id },
          select: { body: true },
        }),
        client().applicationEvent.findMany({
          where: {
            applicationId: application.id,
            kind: "CANDIDATE_NOTE_UPDATED",
          },
          select: { correlationId: true, metadata: true },
        }),
      ]);
      expect(note.body).toBe("Nur für mich sichtbar");
      expect(events).toHaveLength(1);
      expect(events[0]?.correlationId).toBe(requestContext(40).correlationId);
      expect(events[0]?.metadata).toMatchObject({
        bodyHashVersion: "sha256-v1",
        bodyHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      });
      expect(JSON.stringify(events[0]?.metadata)).not.toContain(note.body);
    });

    it("returns only the newest 200 application events in chronological order", async () => {
      const application = await client().application.findFirstOrThrow({
        where: { candidateProfileId: IDS.candidateProfile, jobId: IDS.job },
        select: { id: true },
      });
      const inserted = Array.from({ length: 205 }, (_, index) => ({
        id: randomUUID(),
        applicationId: application.id,
        actorUserId: null,
        kind: "MESSAGE_SENT" as const,
        idempotencyKey: `timeline-cap:${String(index).padStart(3, "0")}`,
        correlationId: `timeline-cap:${String(index).padStart(3, "0")}`,
        createdAt: new Date(NOW.getTime() + (index + 1) * 1_000),
      }));
      await client().applicationEvent.createMany({ data: inserted });

      const detail = await getCandidateApplicationDetail(
        IDS.candidateUser,
        application.id,
        client(),
        { now: NOW },
      );

      expect(detail).not.toBeNull();
      expect(detail?.timeline).toHaveLength(200);
      expect(detail?.timeline.map((event) => event.id)).toEqual(
        inserted.slice(5).map((event) => event.id),
      );
      expect(detail?.timeline[0]?.createdAt).toEqual(inserted[5]?.createdAt);
      expect(detail?.timeline.at(-1)?.createdAt).toEqual(
        inserted.at(-1)?.createdAt,
      );
    });

    it("returns the same safe not-found for another candidate and creates no external Application", async () => {
      const application = await client().application.findFirstOrThrow({
        where: { candidateProfileId: IDS.candidateProfile },
        select: { id: true },
      });
      await expect(
        getCandidateApplicationDetail(
          IDS.otherCandidateUser,
          application.id,
          client(),
          { now: NOW },
        ),
      ).resolves.toBeNull();
      await expect(
        getCandidateApplicationDetail(
          IDS.otherCandidateUser,
          randomUUID(),
          client(),
          { now: NOW },
        ),
      ).resolves.toBeNull();

      const confirmation = await getApplicationConfirmationView(
        {
          candidateUserId: IDS.otherCandidateUser,
          jobSlug: "phase09-external-application-job",
          now: NOW,
          environment: "non-production",
        },
        client(),
      );
      expect(confirmation.ok).toBe(true);
      if (!confirmation.ok)
        throw new Error("Expected external confirmation view.");
      const external = await applyToJob(
        {
          signedIntent: signJobIntent(
            {
              action: "APPLY",
              jobSlug: "phase09-external-application-job",
              now: NOW,
            },
            runtimeEnvironment().secrets.session,
          ),
          coverLetter: "",
          selectedDocumentIds: [],
          confirmationVersion:
            confirmation.value.projection.confirmationVersion,
          confirmationSnapshotHash:
            confirmation.value.projection.confirmationSnapshotHash,
          confirmed: true,
          idempotencyKey: "external:must:not:create",
        },
        {
          database: client(),
          environment: runtimeEnvironment(),
          request: requestContext(30),
          currentUser: otherCandidateUser(),
          emailProvider: new MockEmailProvider(
            new PrismaEmailLogRepository(client()),
          ),
          now: NOW,
        },
      );
      expect(external).toEqual({ ok: false, code: "EXTERNAL_APPLICATION" });
      await expect(
        client().application.count({ where: { jobId: IDS.externalJob } }),
      ).resolves.toBe(0);
    });

    it("paginates more than 100 candidate-scoped applications without losing filters", async () => {
      const fixtures = Array.from({ length: 106 }, (_, index) => {
        const suffix = String(index).padStart(3, "0");
        return {
          index,
          jobId: randomUUID(),
          revisionId: randomUUID(),
          applicationId: randomUUID(),
          slug: `phase09-pagination-role-${suffix}`,
          title: `Pagination Role ${suffix}`,
        };
      });
      await client().job.createMany({
        data: fixtures.map((fixture) => ({
          id: fixture.jobId,
          companyId: IDS.company,
          slug: fixture.slug,
          status: "DRAFT" as const,
          sourceReference: `integration:${fixture.slug}`,
          dataProvenance: "TEST" as const,
          createdByUserId: IDS.employerUser,
        })),
      });
      await client().jobRevision.createMany({
        data: fixtures.map((fixture) => ({
          id: fixture.revisionId,
          jobId: fixture.jobId,
          revisionNumber: 1,
          title: fixture.title,
          description: "Fiktive Stellenbeschreibung für den Paginationstest.",
          tasks: ["Pagination prüfen"],
          requirements: ["Testprofil"],
          applicationProcessSteps: ["Bewerbung"],
          requiredDocumentKinds: ["NONE" as const],
          jobType: "PERMANENT" as const,
          remoteType: "HYBRID" as const,
          categoryId: IDS.category,
          cantonId: IDS.canton,
          cityId: IDS.city,
          locationLabel: "Zürich",
          workloadMin: 80,
          workloadMax: 100,
          startByArrangement: true,
          responseTargetDays: 7,
          applicationEffort: "SIMPLE" as const,
          applicationContactKind: "EMAIL" as const,
          applicationContactValue: "jobs@phase09-contract.example",
          authoredByUserId: IDS.employerUser,
          contentChecksum: createHash("sha256")
            .update(`pagination:${fixture.slug}`)
            .digest("hex"),
        })),
      });
      await client().application.createMany({
        data: fixtures.map((fixture) => ({
          id: fixture.applicationId,
          jobId: fixture.jobId,
          submittedJobRevisionId: fixture.revisionId,
          candidateProfileId: IDS.candidateProfile,
          idempotencyKey: `pagination-application-${fixture.index}`,
          submissionPayloadHash: createHash("sha256")
            .update(`pagination-application:${fixture.applicationId}`)
            .digest("hex"),
          status:
            fixture.index === 105
              ? ("SUBMITTED" as const)
              : ("IN_REVIEW" as const),
          submittedAt: new Date(NOW.getTime() - (fixture.index + 1) * 60_000),
          updatedAt: new Date(NOW.getTime() - fixture.index * 60_000),
        })),
      });
      await client().application.create({
        data: {
          jobId: fixtures[0]!.jobId,
          submittedJobRevisionId: fixtures[0]!.revisionId,
          candidateProfileId: IDS.otherCandidateProfile,
          idempotencyKey: "pagination-other-candidate",
          submissionPayloadHash: createHash("sha256")
            .update("pagination-other-candidate")
            .digest("hex"),
          status: "IN_REVIEW",
          submittedAt: NOW,
          updatedAt: NOW,
        },
      });

      const filter = { query: "Pagination Role", status: "IN_REVIEW" } as const;
      const firstPage = await listCandidateApplications(
        IDS.candidateUser,
        filter,
        client(),
        { now: NOW, page: 1 },
      );
      expect(firstPage).toMatchObject({
        total: 105,
        page: 1,
        pageSize: CANDIDATE_APPLICATION_PAGE_SIZE,
        totalPages: 5,
        from: 1,
        to: 25,
      });
      expect(firstPage.items.map((item) => item.id)).toEqual(
        fixtures.slice(0, 25).map((fixture) => fixture.applicationId),
      );

      const applicationIds: string[] = [];
      for (let page = 1; page <= firstPage.totalPages; page += 1) {
        const result = await listCandidateApplications(
          IDS.candidateUser,
          filter,
          client(),
          { now: NOW, page },
        );
        applicationIds.push(...result.items.map((item) => item.id));
      }
      expect(applicationIds).toHaveLength(105);
      expect(new Set(applicationIds)).toHaveLength(105);
      expect(applicationIds).toEqual(
        fixtures.slice(0, 105).map((fixture) => fixture.applicationId),
      );

      const clampedLastPage = await listCandidateApplications(
        IDS.candidateUser,
        filter,
        client(),
        { now: NOW, page: 999 },
      );
      expect(clampedLastPage).toMatchObject({
        total: 105,
        page: 5,
        totalPages: 5,
        from: 101,
        to: 105,
      });
      expect(clampedLastPage.items).toHaveLength(5);

      const unfilteredStatus = await listCandidateApplications(
        IDS.candidateUser,
        { query: "Pagination Role" },
        client(),
        { now: NOW, page: 1 },
      );
      expect(unfilteredStatus.total).toBe(106);
      const otherCandidate = await listCandidateApplications(
        IDS.otherCandidateUser,
        filter,
        client(),
        { now: NOW, page: 1 },
      );
      expect(otherCandidate.total).toBe(1);
      expect(otherCandidate.items.map((item) => item.id)).not.toContain(
        fixtures[0]!.applicationId,
      );
    });

    it("keeps saved jobs bounded while allowing duplicate replay at the cap", async () => {
      const existingCount = await client().savedJob.count({
        where: { candidateProfileId: IDS.candidateProfile },
      });
      const fillerJobs = Array.from(
        { length: MAXIMUM_SAVED_JOBS - existingCount },
        (_, index) => ({
          id: randomUUID(),
          companyId: IDS.company,
          slug: `phase09-saved-cap-${String(index).padStart(3, "0")}`,
          status: "DRAFT" as const,
          sourceReference: `integration:saved-cap:${index}`,
          dataProvenance: "LIVE" as const,
          createdByUserId: IDS.employerUser,
          publishedCategoryId: index === 0 ? IDS.category : null,
        }),
      );
      await client().job.createMany({ data: fillerJobs });
      await client().savedJob.createMany({
        data: fillerJobs.map((job, index) => ({
          candidateProfileId: IDS.candidateProfile,
          jobId: job.id,
          createdAt: new Date(NOW.getTime() + (index + 1) * 1_000),
        })),
      });
      const atCap = await client().savedJob.findFirstOrThrow({
        where: { candidateProfileId: IDS.candidateProfile, jobId: IDS.job },
      });

      const newIntent = signJobIntent(
        { action: "SAVE", jobSlug: "phase09-email-retry-job", now: NOW },
        runtimeEnvironment().secrets.session,
      );
      await expect(
        saveJobFromSignedIntent(
          { signedIntent: newIntent, candidateUserId: IDS.candidateUser },
          {
            database: client(),
            environment: runtimeEnvironment(),
            signingKey: runtimeEnvironment().secrets.session,
            now: NOW,
          },
        ),
      ).resolves.toEqual({ ok: false, code: "LIMIT_REACHED" });

      const duplicateIntent = signJobIntent(
        { action: "SAVE", jobSlug: "phase09-application-job", now: NOW },
        runtimeEnvironment().secrets.session,
      );
      await expect(
        saveJobFromSignedIntent(
          { signedIntent: duplicateIntent, candidateUserId: IDS.candidateUser },
          {
            database: client(),
            environment: runtimeEnvironment(),
            signingKey: runtimeEnvironment().secrets.session,
            now: NOW,
          },
        ),
      ).resolves.toEqual({
        ok: true,
        savedJobId: atCap.id,
        duplicate: true,
        jobSlug: "phase09-application-job",
      });
      await expect(
        client().savedJob.count({
          where: { candidateProfileId: IDS.candidateProfile },
        }),
      ).resolves.toBe(MAXIMUM_SAVED_JOBS);

      const savedJobs = await listCandidateSavedJobs(
        IDS.candidateUser,
        client(),
        { now: NOW, environment: "non-production" },
      );
      expect(savedJobs).toHaveLength(MAXIMUM_SAVED_JOBS);
      expect(savedJobs.filter((savedJob) => savedJob.current)).toHaveLength(1);
      expect(savedJobs.find((savedJob) => savedJob.current)?.job.slug).toBe(
        "phase09-application-job",
      );
      const categorizedStale = savedJobs.find(
        (savedJob) => savedJob.job.slug === "phase09-saved-cap-000",
      );
      expect(categorizedStale).toMatchObject({
        current: false,
        job: { contextLabel: "Nicht mehr öffentlich" },
      });
      expect(
        new Set(
          categorizedStale?.alternatives.map((alternative) => alternative.slug),
        ),
      ).toEqual(
        new Set([
          "phase09-email-retry-job",
          "phase09-external-application-job",
        ]),
      );
    });

    it("preserves raw confirmation values exactly in the immutable application snapshot", async () => {
      const raw = Object.freeze({
        firstName: " \t<b>Ada &amp;</b>  ",
        lastName: "  Lovelace&nbsp;<i>Raw</i>\n",
        companyName: " \t<strong>Raw &amp; Company</strong>  ",
        jobTitle: "\tLead <em>R&amp;D</em> Engineer  \n",
        contactValue: "  raw&amp;apply@example.test \t",
      });
      const jobId = randomUUID();
      const revisionId = randomUUID();
      const slug = "phase09-raw-snapshot-values";
      const [originalProfile, originalCompany] = await Promise.all([
        client().candidateProfile.findUniqueOrThrow({
          where: { id: IDS.otherCandidateProfile },
          select: { firstName: true, lastName: true },
        }),
        client().company.findUniqueOrThrow({
          where: { id: IDS.company },
          select: { name: true },
        }),
      ]);

      try {
        await Promise.all([
          client().candidateProfile.update({
            where: { id: IDS.otherCandidateProfile },
            data: { firstName: raw.firstName, lastName: raw.lastName },
          }),
          client().company.update({
            where: { id: IDS.company },
            data: { name: raw.companyName },
          }),
        ]);
        await createPublishedJob(client(), {
          id: jobId,
          revisionId,
          slug,
          title: raw.jobTitle,
          contactKind: "EMAIL",
          contactValue: raw.contactValue,
          requiredDocumentKinds: ["NONE"],
        });

        const confirmation = await getApplicationConfirmationView(
          {
            candidateUserId: IDS.otherCandidateUser,
            jobSlug: slug,
            now: NOW,
            environment: "non-production",
          },
          client(),
        );
        expect(confirmation.ok).toBe(true);
        if (!confirmation.ok)
          throw new Error("Expected raw-value confirmation view.");
        expect(confirmation.value.projection).toMatchObject({
          candidate: {
            firstName: raw.firstName,
            lastName: raw.lastName,
            email: "phase09-application-other@example.test",
          },
          recipient: {
            companyName: raw.companyName,
            contactKind: "EMAIL",
            contactValue: raw.contactValue,
          },
          job: {
            revisionId,
            slug,
            title: raw.jobTitle,
          },
        });

        const result = await applyToJob(
          {
            signedIntent: signJobIntent(
              { action: "APPLY", jobSlug: slug, now: NOW },
              runtimeEnvironment().secrets.session,
            ),
            coverLetter: "",
            selectedDocumentIds: [],
            confirmationVersion:
              confirmation.value.projection.confirmationVersion,
            confirmationSnapshotHash:
              confirmation.value.projection.confirmationSnapshotHash,
            confirmed: true,
            idempotencyKey: "application:raw-snapshot:one",
          },
          {
            database: client(),
            environment: runtimeEnvironment(),
            request: requestContext(50),
            currentUser: otherCandidateUser(),
            emailProvider: new MockEmailProvider(
              new PrismaEmailLogRepository(client()),
            ),
            now: NOW,
          },
        );
        expect(result.ok).toBe(true);
        if (!result.ok)
          throw new Error(`Raw snapshot apply failed: ${result.code}`);

        const snapshot =
          await client().applicationSubmissionSnapshot.findUniqueOrThrow({
            where: { applicationId: result.applicationId },
            select: {
              candidateFirstName: true,
              candidateLastName: true,
              candidateEmail: true,
              recipientCompanyName: true,
              applicationContactKind: true,
              applicationContactValue: true,
              confirmationSnapshotHash: true,
              confirmationSnapshotHashVersion: true,
              jobRevision: { select: { title: true } },
            },
          });
        expect(snapshot).toEqual({
          candidateFirstName: raw.firstName,
          candidateLastName: raw.lastName,
          candidateEmail: "phase09-application-other@example.test",
          recipientCompanyName: raw.companyName,
          applicationContactKind: "EMAIL",
          applicationContactValue: raw.contactValue,
          confirmationSnapshotHash:
            confirmation.value.projection.confirmationSnapshotHash,
          confirmationSnapshotHashVersion:
            "application-confirmation-snapshot-v1",
          jobRevision: { title: raw.jobTitle },
        });
      } finally {
        await Promise.all([
          client().candidateProfile.update({
            where: { id: IDS.otherCandidateProfile },
            data: originalProfile,
          }),
          client().company.update({
            where: { id: IDS.company },
            data: originalCompany,
          }),
        ]);
      }
    });
  },
);

async function seedContractData(target: DatabaseClient) {
  await target.user.createMany({
    data: [
      {
        id: IDS.candidateUser,
        email: "phase09-application-candidate@example.test",
        emailNormalized: "phase09-application-candidate@example.test",
        name: "Mara Muster",
        role: "CANDIDATE",
        status: "ACTIVE",
        dataProvenance: "LIVE",
      },
      {
        id: IDS.otherCandidateUser,
        email: "phase09-application-other@example.test",
        emailNormalized: "phase09-application-other@example.test",
        name: "Noah Neben",
        role: "CANDIDATE",
        status: "ACTIVE",
        dataProvenance: "LIVE",
      },
      {
        id: IDS.employerUser,
        email: "phase09-application-employer@example.test",
        emailNormalized: "phase09-application-employer@example.test",
        name: "Erika Employer",
        role: "EMPLOYER",
        status: "ACTIVE",
        dataProvenance: "LIVE",
      },
    ],
  });
  await target.canton.create({
    data: {
      id: IDS.canton,
      code: "ZH",
      name: "Zürich",
      slug: "phase09-app-zuerich",
      language: "DE",
    },
  });
  await target.city.create({
    data: {
      id: IDS.city,
      cantonId: IDS.canton,
      name: "Zürich",
      slug: "phase09-app-zuerich",
    },
  });
  await target.category.create({
    data: {
      id: IDS.category,
      name: "Phase 09 Applications",
      slug: "phase09-applications",
    },
  });
  await target.candidateProfile.createMany({
    data: [
      {
        id: IDS.candidateProfile,
        userId: IDS.candidateUser,
        cantonId: IDS.canton,
        firstName: "Mara",
        lastName: "Muster",
      },
      {
        id: IDS.otherCandidateProfile,
        userId: IDS.otherCandidateUser,
        cantonId: IDS.canton,
        firstName: "Noah",
        lastName: "Neben",
      },
    ],
  });
  await target.candidateDocumentMetadata.create({
    data: {
      id: IDS.document,
      candidateProfileId: IDS.candidateProfile,
      storageKey: "phase09/applications/mara-cv.pdf",
      safeFilename: "mara-muster-cv.pdf",
      mimeType: "application/pdf",
      sizeBytes: 123_456,
      purpose: "CV",
      status: "ACTIVE",
    },
  });
  await target.company.create({
    data: {
      id: IDS.company,
      name: "Phase 09 Contract AG",
      slug: "phase09-contract-ag",
      industry: "Gesundheit",
      size: "51-200",
      website: "https://phase09-contract.example",
      about: "Fiktives Unternehmen für den Phase-09-Integrationsvertrag.",
      values: ["Fairness"],
      benefits: ["Flexibilität"],
      status: "DRAFT",
      dataProvenance: "LIVE",
    },
  });
  await target.companyLocation.create({
    data: {
      id: IDS.companyLocation,
      companyId: IDS.company,
      cantonId: IDS.canton,
      cityId: IDS.city,
      address: "Teststrasse 9",
      postalCode: "8000",
      isPrimary: true,
    },
  });
  await target.companyMembership.create({
    data: {
      id: IDS.membership,
      companyId: IDS.company,
      userId: IDS.employerUser,
      role: "OWNER",
      status: "ACTIVE",
    },
  });
  await target.companyVerificationRequest.create({
    data: {
      id: IDS.verification,
      companyId: IDS.company,
      requestedByUserId: IDS.employerUser,
      status: "VERIFIED",
      evidenceMetadata: { fixture: true },
    },
  });
  await target.company.update({
    where: { id: IDS.company },
    data: { status: "ACTIVE" },
  });
  await createPublishedJob(target, {
    id: IDS.job,
    revisionId: IDS.revision,
    slug: "phase09-application-job",
    title: "Pflegefachperson Phase 09",
    contactKind: "EMAIL",
    contactValue: "jobs@phase09-contract.example",
    requiredDocumentKinds: ["CV"],
  });
  await createPublishedJob(target, {
    id: IDS.externalJob,
    revisionId: IDS.externalRevision,
    slug: "phase09-external-application-job",
    title: "Externe Bewerbung Phase 09",
    contactKind: "APPLY_URL",
    contactValue: "https://careers.phase09-contract.example/apply",
    requiredDocumentKinds: ["NONE"],
  });
  await createPublishedJob(target, {
    id: IDS.retryJob,
    revisionId: IDS.retryRevision,
    slug: "phase09-email-retry-job",
    title: "Bewerbung mit Mail-Retry Phase 09",
    contactKind: "EMAIL",
    contactValue: "jobs@phase09-contract.example",
    requiredDocumentKinds: ["NONE"],
  });
}

async function createPublishedJob(
  target: DatabaseClient,
  input: Readonly<{
    id: string;
    revisionId: string;
    slug: string;
    title: string;
    contactKind: "EMAIL" | "APPLY_URL";
    contactValue: string;
    requiredDocumentKinds: readonly ("NONE" | "CV")[];
  }>,
) {
  await target.job.create({
    data: {
      id: input.id,
      companyId: IDS.company,
      slug: input.slug,
      status: "DRAFT",
      sourceReference: `integration:${input.slug}`,
      dataProvenance: "LIVE",
      createdByUserId: IDS.employerUser,
    },
  });
  await target.jobRevision.create({
    data: {
      id: input.revisionId,
      jobId: input.id,
      revisionNumber: 1,
      title: input.title,
      description:
        "Eine vollständige fiktive Stellenbeschreibung für den Bewerbungsvertrag.",
      tasks: ["Verantwortung übernehmen"],
      requirements: ["Passende Qualifikation"],
      applicationProcessSteps: ["Bewerbung", "Gespräch"],
      requiredDocumentKinds: [...input.requiredDocumentKinds],
      jobType: "PERMANENT",
      remoteType: "HYBRID",
      categoryId: IDS.category,
      cantonId: IDS.canton,
      cityId: IDS.city,
      locationLabel: "Zürich",
      workloadMin: 60,
      workloadMax: 100,
      salaryPeriod: "YEARLY",
      salaryMin: 90_000,
      salaryMax: 110_000,
      startByArrangement: true,
      validThrough: EXPIRES_AT,
      responseTargetDays: 7,
      applicationEffort: "SIMPLE",
      applicationContactKind: input.contactKind,
      applicationContactValue: input.contactValue,
      authoredByUserId: IDS.employerUser,
      contentChecksum: createHash("sha256").update(input.slug).digest("hex"),
      submittedAt: new Date(NOW.getTime() - 3_600_000),
      approvedAt: NOW,
    },
  });
  await target.job.update({
    where: { id: input.id },
    data: {
      status: "PUBLISHED",
      currentRevisionId: input.revisionId,
      publishedRevisionId: input.revisionId,
      publishedAt: NOW,
      expiresAt: EXPIRES_AT,
      publishedCategoryId: IDS.category,
      publishedCantonId: IDS.canton,
      publishedCityId: IDS.city,
      publishedSalaryPeriod: "YEARLY",
      publishedSalaryMin: 90_000,
      publishedSalaryMax: 110_000,
    },
  });
}

function candidateUser(): CurrentUser {
  return Object.freeze({
    id: IDS.candidateUser,
    email: "phase09-application-candidate@example.test",
    role: "CANDIDATE",
    name: "Mara Muster",
    status: "ACTIVE",
    emailVerifiedAt: null,
  });
}

function otherCandidateUser(): CurrentUser {
  return Object.freeze({
    id: IDS.otherCandidateUser,
    email: "phase09-application-other@example.test",
    role: "CANDIDATE",
    name: "Noah Neben",
    status: "ACTIVE",
    emailVerifiedAt: null,
  });
}

function requestContext(index: number): AuthRequestContext {
  return Object.freeze({
    correlationId: `09000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    expectedOrigin: "http://localhost:3000",
    origin: "http://localhost:3000",
    production: false,
    sourceIp: "203.0.113.90",
    userAgent: "Phase-09 application integration test",
  });
}

function buildEnvironment(connectionString: string): ServerEnvironment {
  return parseEnvironment({
    APP_ENV: "local",
    NODE_ENV: "test",
    DATABASE_URL: connectionString,
    APP_URL: "http://localhost:3000",
    NEXT_PUBLIC_APP_NAME: "SwissTalentHub Integration",
    SESSION_SECRET: secret(31),
    AUDIT_IP_HASH_KEYS: `v1:${secret(32)}`,
    RADAR_OPAQUE_LOOKUP_KEYS: `v1:${secret(33)}`,
    RADAR_OPAQUE_ENCRYPTION_KEYS: `v1:${secret(34)}`,
    REVEAL_CONFIRMATION_KEYS: `v1:${secret(35)}`,
    PII_REVEAL_KEYS: `v1:${secret(36)}`,
    RATE_LIMIT_BACKEND: "postgres",
    TRUSTED_PROXY_HOPS: "0",
    ENABLE_LOCAL_MOCK_MAILBOX: "false",
    LOG_LEVEL: "error",
  });
}

function secret(byte: number): string {
  return Buffer.alloc(32, byte).toString("base64");
}
