import "server-only";

import { createHash } from "node:crypto";

import type { Prisma } from "@/lib/generated/prisma/client";

import type {
  AnalyticsWriteRecord,
  AnalyticsWriter,
} from "@/lib/analytics/track";
import { candidateAnalyticsSubjectV1 } from "@/lib/analytics/pseudonyms";
import { trackAnalyticsEventV1 } from "@/lib/analytics/track";
import {
  applicationSubmissionPayloadHash,
  loadApplicationConfirmationInTransaction,
  sha256Utf8,
} from "@/lib/applications/confirmation";
import {
  APPLICATION_CONFIRMATION_NOTICE_VERSION_V1,
  applyToJobInputSchema,
  type ApplyToJobInput,
} from "@/lib/applications/contracts";
import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import type { CurrentUser } from "@/lib/auth/current-user";
import { consumeRequestRateLimit } from "@/lib/auth/rate-limit-runtime";
import type { AuthRequestContext } from "@/lib/auth/request-context";
import { verifyJobIntent } from "@/lib/auth/signed-intent";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import {
  writeNotificationExactlyOnce,
  type NotificationWritePort,
} from "@/lib/notifications/writer";
import type { EmailProvider } from "@/lib/providers/email/email-provider";
import { stripUnsafeHtml } from "@/lib/security/sanitize";
import { createLogger } from "@/lib/utils/logger";

const logger = createLogger();
const AUDIT_RETENTION_MILLISECONDS = 365 * 86_400_000;

export type ApplyToJobResult =
  | Readonly<{
      ok: true;
      applicationId: string;
      conversationId: string;
      duplicate: boolean;
      emailRecorded: boolean;
    }>
  | Readonly<{
      ok: false;
      code:
        | "UNAUTHORIZED"
        | "INVALID_INPUT"
        | "INVALID_INTENT"
        | "RATE_LIMITED"
        | "NOT_ELIGIBLE"
        | "PROFILE_IDENTITY_REQUIRED"
        | "CONFIRMATION_CHANGED"
        | "DOCUMENT_REQUIRED"
        | "COVER_LETTER_REQUIRED"
        | "UNSUPPORTED_REQUIREMENTS"
        | "EXTERNAL_APPLICATION"
        | "ALREADY_APPLIED"
        | "IDEMPOTENCY_CONFLICT"
        | "WRITE_FAILED";
      applicationId?: string;
    }>;

type CommittedApplication = Readonly<{
  applicationId: string;
  conversationId: string;
  duplicate: boolean;
  candidateEmail: string;
  jobTitle: string;
  companyName: string;
}>;

export async function applyToJob(
  rawInput: unknown,
  dependencies: Readonly<{
    database: DatabaseClient;
    environment: ServerEnvironment;
    request: AuthRequestContext;
    currentUser: CurrentUser | null;
    emailProvider: EmailProvider;
    now?: Date;
  }>,
): Promise<ApplyToJobResult> {
  if (dependencies.currentUser?.role !== "CANDIDATE") {
    return Object.freeze({ ok: false, code: "UNAUTHORIZED" });
  }
  const parsed = applyToJobInputSchema.safeParse(rawInput);
  if (!parsed.success) return Object.freeze({ ok: false, code: "INVALID_INPUT" });
  const now = dependencies.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    return Object.freeze({ ok: false, code: "INVALID_INPUT" });
  }
  const coverLetter = sanitizeCoverLetter(parsed.data.coverLetter);
  if (coverLetter === undefined && parsed.data.coverLetter !== undefined) {
    return Object.freeze({ ok: false, code: "INVALID_INPUT" });
  }
  const replayPayloadHash = applicationSubmissionPayloadHash({
    confirmationSnapshotHash: parsed.data.confirmationSnapshotHash,
    coverLetter: coverLetter ?? null,
    selectedDocumentIds: parsed.data.selectedDocumentIds,
  });

  let committed: CommittedApplication;
  try {
    const replay = await loadOwnedApplicationReplay(
      dependencies.database,
      dependencies.currentUser.id,
      parsed.data,
      replayPayloadHash,
    );
    if (replay.kind === "CONFLICT") {
      return Object.freeze({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
    }
    if (replay.kind === "COMMITTED") {
      committed = replay.value;
    } else {
      const intent = verifyJobIntent(
        parsed.data.signedIntent,
        { action: "APPLY", now },
        dependencies.environment.secrets.session,
      );
      if (intent === null) {
        return Object.freeze({ ok: false, code: "INVALID_INTENT" });
      }

      const rate = await consumeRequestRateLimit(
        "APPLICATION_SUBMIT",
        { userId: dependencies.currentUser.id },
        dependencies.request,
        now,
        {
          database: dependencies.database,
          environment: dependencies.environment,
        },
      );
      if (!rate.allowed) {
        return Object.freeze({ ok: false, code: "RATE_LIMITED" });
      }

      const result = await executeWithSerializationRetry(async () =>
        dependencies.database.$transaction(
          async (transaction) => {
          await acquireApplicationLocks(
            transaction,
            dependencies.currentUser!.id,
            intent.jobSlug,
            parsed.data.idempotencyKey,
          );
          const environment =
            dependencies.environment.APP_ENV === "production" ||
            dependencies.environment.APP_ENV === "staging"
              ? "production"
              : "non-production";
          const confirmation = await loadApplicationConfirmationInTransaction(
            {
              candidateUserId: dependencies.currentUser!.id,
              jobSlug: intent.jobSlug,
              now,
              environment,
            },
            transaction,
          );
          if (!confirmation.ok) {
            return Object.freeze({
              kind: "ERROR" as const,
              code: mapConfirmationError(confirmation.code),
            });
          }
          const context = confirmation.value;
          if (context.externalApplyHref !== null) {
            return Object.freeze({
              kind: "ERROR" as const,
              code: "EXTERNAL_APPLICATION" as const,
            });
          }
          if (!context.identityComplete) {
            return Object.freeze({
              kind: "ERROR" as const,
              code: "PROFILE_IDENTITY_REQUIRED" as const,
            });
          }
          if (
            parsed.data.confirmationVersion !==
              APPLICATION_CONFIRMATION_NOTICE_VERSION_V1 ||
            parsed.data.confirmationVersion !==
              context.projection.confirmationVersion ||
            parsed.data.confirmationSnapshotHash !==
              context.projection.confirmationSnapshotHash
          ) {
            return Object.freeze({
              kind: "ERROR" as const,
              code: "CONFIRMATION_CHANGED" as const,
            });
          }

          const documents = validateSelectedDocuments(
            parsed.data,
            context,
            coverLetter,
          );
          if (!documents.ok) {
            return Object.freeze({ kind: "ERROR" as const, code: documents.code });
          }
          const submissionPayloadHash = applicationSubmissionPayloadHash({
            confirmationSnapshotHash: context.projection.confirmationSnapshotHash,
            coverLetter: coverLetter ?? null,
            selectedDocumentIds: documents.selected.map((document) => document.id),
          });

          const byIdempotency = await transaction.application.findUnique({
            where: {
              candidateProfileId_idempotencyKey: {
                candidateProfileId: context.profileId,
                idempotencyKey: parsed.data.idempotencyKey,
              },
            },
            select: existingApplicationSelect,
          });
          if (byIdempotency !== null) {
            if (
              byIdempotency.jobId !== context.jobId ||
              byIdempotency.submissionPayloadHash !== submissionPayloadHash
            ) {
              return Object.freeze({
                kind: "ERROR" as const,
                code: "IDEMPOTENCY_CONFLICT" as const,
              });
            }
            return Object.freeze({
              kind: "COMMITTED" as const,
              value: toCommittedApplication(byIdempotency, true),
            });
          }

          const existingForJob = await transaction.application.findUnique({
            where: {
              jobId_candidateProfileId: {
                jobId: context.jobId,
                candidateProfileId: context.profileId,
              },
            },
            select: existingApplicationSelect,
          });
          if (existingForJob !== null) {
            return Object.freeze({
              kind: "ALREADY_APPLIED" as const,
              applicationId: existingForJob.id,
            });
          }

          const created = await createApplicationTransaction(
            transaction,
            parsed.data,
            context,
            coverLetter ?? null,
            documents.selected,
            submissionPayloadHash,
            intent.analyticsSessionId,
            dependencies,
            now,
          );
          return Object.freeze({ kind: "COMMITTED" as const, value: created });
          },
          { isolationLevel: "Serializable" },
        ),
      );

      if (result.kind === "ERROR") {
        return Object.freeze({ ok: false, code: result.code });
      }
      if (result.kind === "ALREADY_APPLIED") {
        return Object.freeze({
          ok: false,
          code: "ALREADY_APPLIED",
          applicationId: result.applicationId,
        });
      }
      committed = result.value;
    }
  } catch (error) {
    logger.error(
      "candidate_application.write_failed",
      { error, errorCode: databaseErrorCode(error) },
      dependencies.request.correlationId,
    );
    return Object.freeze({ ok: false, code: "WRITE_FAILED" });
  }

  let emailRecorded = false;
  try {
    await dependencies.emailProvider.send({
      to: committed.candidateEmail,
      templateKey: "application_submitted",
      subject: "Deine Bewerbung wurde erfasst",
      data: {
        jobTitle: committed.jobTitle,
        companyName: committed.companyName,
        idempotencyKey: `application-submitted:${committed.applicationId}`,
      },
    });
    emailRecorded = true;
  } catch (error) {
    logger.error(
      "candidate_application.email_retryable",
      { error, applicationId: committed.applicationId },
      dependencies.request.correlationId,
    );
  }

  return Object.freeze({
    ok: true,
    applicationId: committed.applicationId,
    conversationId: committed.conversationId,
    duplicate: committed.duplicate,
    emailRecorded,
  });
}

async function createApplicationTransaction(
  transaction: Prisma.TransactionClient,
  input: ApplyToJobInput,
  context: Extract<
    Awaited<ReturnType<typeof loadApplicationConfirmationInTransaction>>,
    { ok: true }
  >["value"],
  coverLetter: string | null,
  documents: readonly ApplicationDocumentSnapshot[],
  submissionPayloadHash: string,
  analyticsSessionId: string | undefined,
  dependencies: Readonly<{
    environment: ServerEnvironment;
    request: AuthRequestContext;
    currentUser: CurrentUser | null;
  }>,
  now: Date,
): Promise<CommittedApplication> {
  const application = await transaction.application.create({
    data: {
      jobId: context.jobId,
      submittedJobRevisionId: context.projection.job.revisionId,
      candidateProfileId: context.profileId,
      idempotencyKey: input.idempotencyKey,
      submissionPayloadHash,
      status: "SUBMITTED",
      coverLetter,
      submittedAt: now,
    },
    select: { id: true },
  });
  await transaction.applicationSubmissionSnapshot.create({
    data: {
      applicationId: application.id,
      jobRevisionId: context.projection.job.revisionId,
      candidateFirstName: context.projection.candidate.firstName,
      candidateLastName: context.projection.candidate.lastName,
      candidateEmail: context.projection.candidate.email,
      coverLetterSnapshot: coverLetter,
      recipientCompanyName: context.projection.recipient.companyName,
      applicationContactKind: context.projection.recipient.contactKind,
      applicationContactValue: context.projection.recipient.contactValue,
      responseTargetDays: context.projection.job.responseTargetDays,
      applicationEffort: context.projection.job.applicationEffort,
      requiredDocumentKinds: [...context.projection.job.requiredDocumentKinds],
      confirmationNoticeVersion: context.projection.confirmationVersion,
      confirmationNoticeHash: context.projection.confirmationNoticeHash,
      confirmationSnapshotHash: context.projection.confirmationSnapshotHash,
      submittedAt: now,
    },
  });
  if (documents.length > 0) {
    await transaction.applicationSubmissionDocument.createMany({
      data: documents.map((document) => ({
        applicationId: application.id,
        documentMetadataId: document.id,
        safeFilenameSnapshot: document.safeFilename,
        mimeTypeSnapshot: document.mimeType,
        sizeBytesSnapshot: document.sizeBytes,
        storageKeyHash: document.storageKeyHash,
        createdAt: now,
      })),
    });
  }
  await transaction.applicationEvent.create({
    data: {
      applicationId: application.id,
      actorUserId: dependencies.currentUser!.id,
      kind: "STATUS_CHANGE",
      fromStatus: null,
      toStatus: "SUBMITTED",
      idempotencyKey: deterministicOperationKey("submit", input.idempotencyKey),
      correlationId: dependencies.request.correlationId,
      metadata: { source: "candidate-confirmed-application-v1" },
      createdAt: now,
    },
  });
  const conversation = await transaction.conversation.create({
    data: {
      companyId: context.companyId,
      kind: "APPLICATION",
      applicationId: application.id,
      subject: `Bewerbung: ${context.projection.job.title}`.slice(0, 200),
      createdAt: now,
      participants: {
        create: [
          {
            kind: "USER",
            userId: dependencies.currentUser!.id,
            joinedAt: now,
            lastReadAt: now,
          },
          {
            kind: "COMPANY_PRINCIPAL",
            companyId: context.companyId,
            joinedAt: now,
          },
        ],
      },
    },
    select: { id: true },
  });

  const employerRecipients = await loadEmployerNotificationRecipients(
    transaction,
    context.companyId,
    context.jobId,
    now,
  );
  const notificationPort = createTransactionNotificationPort(transaction);
  await writeNotificationExactlyOnce(notificationPort, {
    recipientUserId: dependencies.currentUser!.id,
    kind: "APPLICATION_SUBMITTED",
    dedupeKey: `application-submitted:${application.id}`,
    payload: { applicationId: application.id, status: "SUBMITTED" },
  });
  for (const recipientUserId of employerRecipients) {
    await writeNotificationExactlyOnce(notificationPort, {
      recipientUserId,
      kind: "APPLICATION_SUBMITTED",
      dedupeKey: `application-submitted:${application.id}`,
      payload: { applicationId: application.id, status: "SUBMITTED" },
    });
  }

  await writeRequiredAudit(
    createPrismaTransactionAuditPort(transaction),
    {
      action: "APPLICATION_SUBMITTED",
      actorKind: "USER",
      actorUserId: dependencies.currentUser!.id,
      capability: "CANDIDATE_APPLICATION_SUBMIT",
      companyId: context.companyId,
      correlationId: dependencies.request.correlationId,
      result: "SUCCEEDED",
      retainUntil: new Date(now.getTime() + AUDIT_RETENTION_MILLISECONDS),
      targetId: application.id,
      targetType: "APPLICATION",
    },
    {
      sourceIp: dependencies.request.sourceIp,
      keyring: dependencies.environment.secrets.keyrings.AUDIT_IP_HASH_KEYS,
    },
  );
  await trackAnalyticsEventV1(
    {
      schemaVersion: "1",
      producerEventId: `APPLICATION_SUBMITTED:${application.id}`,
      occurredAt: now,
      kind: "APPLICATION_SUBMITTED",
      pseudonymousActorId: candidateAnalyticsSubjectV1(context.userId),
      pseudonymousSessionId: analyticsSessionId,
      companyId: context.companyId,
      jobId: context.jobId,
      properties: {
        toStatus: "SUBMITTED",
        applicationEffort: context.projection.job.applicationEffort,
      },
    },
    {
      producer: "candidate-application",
      productAnalyticsEnabled: false,
      provenance: {
        actor: context.candidateProvenance,
        company: context.companyProvenance,
        job: context.jobProvenance,
      },
    },
    createTransactionAnalyticsWriter(transaction),
  );

  return Object.freeze({
    applicationId: application.id,
    conversationId: conversation.id,
    duplicate: false,
    candidateEmail: context.projection.candidate.email,
    jobTitle: context.projection.job.title,
    companyName: context.projection.recipient.companyName,
  });
}

type ApplicationDocumentSnapshot = Readonly<{
  id: string;
  safeFilename: string;
  mimeType: string;
  sizeBytes: number;
  storageKeyHash: string;
}>;

function validateSelectedDocuments(
  input: ApplyToJobInput,
  context: Extract<
    Awaited<ReturnType<typeof loadApplicationConfirmationInTransaction>>,
    { ok: true }
  >["value"],
  coverLetter: string | undefined,
):
  | Readonly<{ ok: true; selected: readonly ApplicationDocumentSnapshot[] }>
  | Readonly<{
      ok: false;
      code: "DOCUMENT_REQUIRED" | "COVER_LETTER_REQUIRED" | "UNSUPPORTED_REQUIREMENTS";
    }> {
  const required = context.projection.job.requiredDocumentKinds;
  if (required.includes("COVER_LETTER") && !coverLetter) {
    return Object.freeze({ ok: false, code: "COVER_LETTER_REQUIRED" });
  }
  if (required.includes("CV")) {
    if (input.selectedDocumentIds.length !== 1) {
      return Object.freeze({ ok: false, code: "DOCUMENT_REQUIRED" });
    }
  } else if (input.selectedDocumentIds.length !== 0) {
    return Object.freeze({ ok: false, code: "UNSUPPORTED_REQUIREMENTS" });
  }
  const selected = input.selectedDocumentIds.flatMap((id) => {
    const document = context.documents.find((candidate) => candidate.id === id);
    return document === undefined
      ? []
      : [{ ...document }];
  });
  if (selected.length !== input.selectedDocumentIds.length) {
    return Object.freeze({ ok: false, code: "DOCUMENT_REQUIRED" });
  }
  return Object.freeze({ ok: true, selected: Object.freeze(selected) });
}

const existingApplicationSelect = {
  id: true,
  jobId: true,
  submissionPayloadHash: true,
  conversation: { select: { id: true } },
  submissionSnapshot: {
    select: {
      candidateEmail: true,
      recipientCompanyName: true,
      confirmationNoticeVersion: true,
      confirmationSnapshotHash: true,
      jobRevision: { select: { title: true } },
    },
  },
} as const satisfies Prisma.ApplicationSelect;

async function loadOwnedApplicationReplay(
  database: DatabaseClient,
  candidateUserId: string,
  input: ApplyToJobInput,
  submissionPayloadHash: string,
): Promise<
  | Readonly<{ kind: "MISSING" }>
  | Readonly<{ kind: "CONFLICT" }>
  | Readonly<{ kind: "COMMITTED"; value: CommittedApplication }>
> {
  const application = await database.application.findFirst({
    where: {
      idempotencyKey: input.idempotencyKey,
      candidateProfile: {
        userId: candidateUserId,
        user: { status: "ACTIVE" },
      },
    },
    select: existingApplicationSelect,
  });
  if (application === null) {
    return Object.freeze({ kind: "MISSING" as const });
  }
  const snapshot = application.submissionSnapshot;
  if (
    snapshot === null ||
    application.submissionPayloadHash !== submissionPayloadHash ||
    snapshot.confirmationNoticeVersion !== input.confirmationVersion ||
    snapshot.confirmationSnapshotHash !== input.confirmationSnapshotHash
  ) {
    return Object.freeze({ kind: "CONFLICT" as const });
  }
  return Object.freeze({
    kind: "COMMITTED" as const,
    value: toCommittedApplication(application, true),
  });
}

function toCommittedApplication(
  application: Prisma.ApplicationGetPayload<{
    select: typeof existingApplicationSelect;
  }>,
  duplicate: boolean,
): CommittedApplication {
  if (application.conversation === null || application.submissionSnapshot === null) {
    throw new Error("Application replay found incomplete persisted children.");
  }
  return Object.freeze({
    applicationId: application.id,
    conversationId: application.conversation.id,
    duplicate,
    candidateEmail: application.submissionSnapshot.candidateEmail,
    jobTitle: application.submissionSnapshot.jobRevision.title,
    companyName: application.submissionSnapshot.recipientCompanyName,
  });
}

async function loadEmployerNotificationRecipients(
  transaction: Prisma.TransactionClient,
  companyId: string,
  jobId: string,
  now: Date,
): Promise<readonly string[]> {
  const memberships = await transaction.companyMembership.findMany({
    where: {
      companyId,
      status: "ACTIVE",
      user: { status: "ACTIVE" },
      OR: [
        { role: { in: ["OWNER", "ADMIN"] } },
        {
          jobAssignments: {
            some: {
              jobId,
              role: "PIPELINE",
              status: "ACTIVE",
              validFrom: { lte: now },
              revokedAt: null,
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            },
          },
        },
      ],
    },
    select: { userId: true },
  });
  return Object.freeze([...new Set(memberships.map((membership) => membership.userId))]);
}

function createTransactionNotificationPort(
  transaction: Prisma.TransactionClient,
): NotificationWritePort<unknown> {
  return Object.freeze({
    notification: Object.freeze({
      async upsert(
        input: Parameters<
          NotificationWritePort<unknown>["notification"]["upsert"]
        >[0],
      ) {
        return transaction.notification.upsert({
          where: input.where,
          update: {},
          create: {
            ...input.create,
            payload: input.create.payload as Prisma.InputJsonObject,
          },
        });
      },
    }),
  });
}

function createTransactionAnalyticsWriter(
  transaction: Prisma.TransactionClient,
): AnalyticsWriter {
  return Object.freeze({
    async create(record: AnalyticsWriteRecord) {
      try {
        await transaction.analyticsEvent.create({ data: record });
        return "CREATED";
      } catch (error) {
        if (databaseErrorCode(error) === "P2002") return "DUPLICATE";
        throw error;
      }
    },
    async expire(retainUntilInclusive: Date) {
      const result = await transaction.analyticsEvent.deleteMany({
        where: { retainUntil: { lte: retainUntilInclusive } },
      });
      return result.count;
    },
  });
}

async function acquireApplicationLocks(
  transaction: Prisma.TransactionClient,
  userId: string,
  jobSlug: string,
  idempotencyKey: string,
): Promise<void> {
  const keys = [
    `candidate-application:job:${userId}:${jobSlug}`,
    `candidate-application:key:${userId}:${idempotencyKey}`,
  ]
    .map((value) => createHash("sha256").update(value, "utf8").digest("hex"))
    .sort();
  for (const key of keys) {
    await transaction.$queryRaw<readonly { locked: boolean }[]>`
      SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0)) IS NULL AS "locked"
    `;
  }
}

async function executeWithSerializationRetry<T>(
  operation: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const code = databaseErrorCode(error);
      if ((code !== "P2034" && code !== "P2002") || attempt === 2) throw error;
    }
  }
  throw new Error("Unreachable serialization retry state.");
}

function sanitizeCoverLetter(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const clean = stripUnsafeHtml(value);
  return clean.length > 0 && Array.from(clean).length <= 4_000
    ? clean
    : undefined;
}

function deterministicOperationKey(kind: string, idempotencyKey: string): string {
  return `${kind}:${sha256Utf8(idempotencyKey)}`;
}

function mapConfirmationError(
  code: "NOT_ELIGIBLE" | "PROFILE_MISSING" | "UNSUPPORTED_REQUIREMENTS" | "UNSAFE_CONTACT",
): "NOT_ELIGIBLE" | "UNSUPPORTED_REQUIREMENTS" {
  return code === "UNSUPPORTED_REQUIREMENTS" || code === "UNSAFE_CONTACT"
    ? "UNSUPPORTED_REQUIREMENTS"
    : "NOT_ELIGIBLE";
}

function databaseErrorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code.slice(0, 32)
    : undefined;
}
