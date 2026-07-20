import "server-only";

import { createHash } from "node:crypto";

import type { Prisma } from "@/lib/generated/prisma/client";

import type {
  AnalyticsWriteRecord,
  AnalyticsWriter,
} from "@/lib/analytics/track";
import { trackAnalyticsEventV1 } from "@/lib/analytics/track";
import {
  candidateApplicationNoteSchema,
  candidateWithdrawApplicationSchema,
} from "@/lib/applications/contracts";
import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import type { CurrentUser } from "@/lib/auth/current-user";
import type { AuthRequestContext } from "@/lib/auth/request-context";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import {
  writeNotificationExactlyOnce,
  type NotificationWritePort,
} from "@/lib/notifications/writer";
import { decideApplicationTransition } from "@/lib/policies/status/application";
import { stripUnsafeHtml } from "@/lib/security/sanitize";

const AUDIT_RETENTION_MILLISECONDS = 365 * 86_400_000;

export type CandidateApplicationCommandResult =
  | Readonly<{ ok: true; applicationId: string; duplicate: boolean }>
  | Readonly<{
      ok: false;
      code: "UNAUTHORIZED" | "INVALID_INPUT" | "NOT_FOUND" | "CONFLICT" | "WRITE_FAILED";
    }>;

export async function updateCandidateApplicationNote(
  rawInput: unknown,
  dependencies: CommandDependencies,
): Promise<CandidateApplicationCommandResult> {
  if (dependencies.currentUser?.role !== "CANDIDATE") {
    return Object.freeze({ ok: false, code: "UNAUTHORIZED" });
  }
  const parsed = candidateApplicationNoteSchema.safeParse(rawInput);
  if (!parsed.success) return Object.freeze({ ok: false, code: "INVALID_INPUT" });
  const body = stripUnsafeHtml(parsed.data.body);
  if (body.length === 0 || Array.from(body).length > 1_000) {
    return Object.freeze({ ok: false, code: "INVALID_INPUT" });
  }
  const bodyHash = createCandidateNoteBodyHash(body);
  const now = dependencies.now ?? new Date();
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      const application = await transaction.application.findFirst({
        where: {
          id: parsed.data.applicationId,
          candidateProfile: { userId: dependencies.currentUser!.id },
        },
        select: { id: true },
      });
      if (application === null) return Object.freeze({ ok: false, code: "NOT_FOUND" as const });
      const eventKey = operationKey("candidate-note", parsed.data.idempotencyKey);
      const replay = await transaction.applicationEvent.findUnique({
        where: { idempotencyKey: eventKey },
        select: { applicationId: true, kind: true, metadata: true },
      });
      if (replay !== null) {
        return isMatchingCandidateNoteReplay(replay, application.id, bodyHash)
          ? Object.freeze({ ok: true, applicationId: application.id, duplicate: true })
          : Object.freeze({ ok: false, code: "CONFLICT" as const });
      }
      await transaction.applicationCandidateNote.upsert({
        where: { applicationId: application.id },
        update: { body },
        create: { applicationId: application.id, body },
      });
      await transaction.applicationEvent.create({
        data: {
          applicationId: application.id,
          actorUserId: dependencies.currentUser!.id,
          kind: "CANDIDATE_NOTE_UPDATED",
          idempotencyKey: eventKey,
          correlationId: dependencies.request.correlationId,
          metadata: {
            contentStoredInPrivateNote: true,
            bodyHash,
            bodyHashVersion: "sha256-v1",
          },
          createdAt: now,
        },
      });
      return Object.freeze({ ok: true, applicationId: application.id, duplicate: false });
    });
  } catch (error) {
    if (isPrismaUniqueConstraintViolation(error)) {
      const eventKey = operationKey("candidate-note", parsed.data.idempotencyKey);
      const replay = await dependencies.database.applicationEvent.findFirst({
        where: {
          idempotencyKey: eventKey,
          application: {
            id: parsed.data.applicationId,
            candidateProfile: { userId: dependencies.currentUser.id },
          },
        },
        select: { applicationId: true, kind: true, metadata: true },
      });
      if (replay !== null) {
        return isMatchingCandidateNoteReplay(
          replay,
          parsed.data.applicationId,
          bodyHash,
        )
          ? Object.freeze({
              ok: true,
              applicationId: parsed.data.applicationId,
              duplicate: true,
            })
          : Object.freeze({ ok: false, code: "CONFLICT" });
      }
    }
    return Object.freeze({ ok: false, code: "WRITE_FAILED" });
  }
}

export async function withdrawCandidateApplication(
  rawInput: unknown,
  dependencies: CommandDependencies,
): Promise<CandidateApplicationCommandResult> {
  if (dependencies.currentUser?.role !== "CANDIDATE") {
    return Object.freeze({ ok: false, code: "UNAUTHORIZED" });
  }
  const parsed = candidateWithdrawApplicationSchema.safeParse(rawInput);
  if (!parsed.success) return Object.freeze({ ok: false, code: "INVALID_INPUT" });
  const now = dependencies.now ?? new Date();
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        const rows = await transaction.$queryRaw<
          readonly Readonly<{
            id: string;
            status: "SUBMITTED" | "IN_REVIEW" | "SHORTLISTED" | "INTERVIEW" | "OFFER" | "HIRED" | "REJECTED" | "WITHDRAWN";
            jobId: string;
            companyId: string;
            jobProvenance: "LIVE" | "DEMO" | "TEST";
            companyProvenance: "LIVE" | "DEMO" | "TEST";
          }>[]
        >`
          SELECT
            application.id,
            application.status,
            application."jobId",
            job."companyId",
            job."dataProvenance" AS "jobProvenance",
            company."dataProvenance" AS "companyProvenance"
          FROM "Application" AS application
          JOIN "CandidateProfile" AS candidate
            ON candidate.id = application."candidateProfileId"
          JOIN "Job" AS job ON job.id = application."jobId"
          JOIN "Company" AS company ON company.id = job."companyId"
          WHERE application.id = ${parsed.data.applicationId}::uuid
            AND candidate."userId" = ${dependencies.currentUser!.id}::uuid
          FOR UPDATE OF application
        `;
        const application = rows[0];
        if (application === undefined) {
          return Object.freeze({ ok: false, code: "NOT_FOUND" as const });
        }
        if (application.status === "WITHDRAWN") {
          return Object.freeze({ ok: true, applicationId: application.id, duplicate: true });
        }
        const decision = decideApplicationTransition({
          action: "WITHDRAW",
          actor: "CANDIDATE_OWNER",
          currentStatus: application.status,
        });
        if (decision.type !== "OK") {
          return Object.freeze({ ok: false, code: "CONFLICT" as const });
        }
        const eventKey = operationKey("withdraw", parsed.data.idempotencyKey);
        const replay = await transaction.applicationEvent.findUnique({
          where: { idempotencyKey: eventKey },
          select: { applicationId: true, toStatus: true },
        });
        if (replay !== null) {
          return replay.applicationId === application.id && replay.toStatus === "WITHDRAWN"
            ? Object.freeze({ ok: true, applicationId: application.id, duplicate: true })
            : Object.freeze({ ok: false, code: "CONFLICT" as const });
        }
        await transaction.application.update({
          where: { id: application.id },
          data: { status: "WITHDRAWN" },
        });
        await transaction.applicationEvent.create({
          data: {
            applicationId: application.id,
            actorUserId: dependencies.currentUser!.id,
            kind: "STATUS_CHANGE",
            fromStatus: application.status,
            toStatus: "WITHDRAWN",
            idempotencyKey: eventKey,
            correlationId: dependencies.request.correlationId,
            metadata: { reasonCode: "CANDIDATE_WITHDRAWN" },
            createdAt: now,
          },
        });
        const recipients = await loadEmployerRecipients(
          transaction,
          application.companyId,
          application.jobId,
          now,
        );
        const notificationPort = transactionNotificationPort(transaction);
        await writeNotificationExactlyOnce(notificationPort, {
          recipientUserId: dependencies.currentUser!.id,
          kind: "APPLICATION_STATUS_CHANGED",
          dedupeKey: `application-withdrawn:${application.id}`,
          payload: {
            applicationId: application.id,
            status: "WITHDRAWN",
            reasonCode: "CANDIDATE_WITHDRAWN",
          },
        });
        for (const recipientUserId of recipients) {
          await writeNotificationExactlyOnce(notificationPort, {
            recipientUserId,
            kind: "APPLICATION_STATUS_CHANGED",
            dedupeKey: `application-withdrawn:${application.id}`,
            payload: {
              applicationId: application.id,
              status: "WITHDRAWN",
              reasonCode: "CANDIDATE_WITHDRAWN",
            },
          });
        }
        await writeRequiredAudit(
          createPrismaTransactionAuditPort(transaction),
          {
            action: "APPLICATION_WITHDRAWN",
            actorKind: "USER",
            actorUserId: dependencies.currentUser!.id,
            capability: "CANDIDATE_APPLICATION_WITHDRAW",
            companyId: application.companyId,
            correlationId: dependencies.request.correlationId,
            reasonCode: "CANDIDATE_WITHDRAWN",
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
            producerEventId: `APPLICATION_WITHDRAWN:${application.id}`,
            occurredAt: now,
            kind: "APPLICATION_STATUS_CHANGED",
            companyId: application.companyId,
            jobId: application.jobId,
            properties: {
              fromStatus: application.status,
              toStatus: "WITHDRAWN",
            },
          },
          {
            producer: "candidate-application",
            productAnalyticsEnabled: false,
            provenance: {
              company: application.companyProvenance,
              job: application.jobProvenance,
            },
          },
          transactionAnalyticsWriter(transaction),
        );
        return Object.freeze({ ok: true, applicationId: application.id, duplicate: false });
      },
      { isolationLevel: "ReadCommitted" },
    );
  } catch {
    return Object.freeze({ ok: false, code: "WRITE_FAILED" });
  }
}

type CommandDependencies = Readonly<{
  database: DatabaseClient;
  environment: ServerEnvironment;
  request: AuthRequestContext;
  currentUser: CurrentUser | null;
  now?: Date;
}>;

async function loadEmployerRecipients(
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
  return Object.freeze([...new Set(memberships.map((row) => row.userId))]);
}

function transactionNotificationPort(
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

function transactionAnalyticsWriter(
  transaction: Prisma.TransactionClient,
): AnalyticsWriter {
  return Object.freeze({
    async create(record: AnalyticsWriteRecord) {
      try {
        await transaction.analyticsEvent.create({ data: record });
        return "CREATED";
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2002"
        ) return "DUPLICATE";
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

function operationKey(kind: string, idempotencyKey: string): string {
  return `${kind}:${createDigest(idempotencyKey)}`;
}

function createCandidateNoteBodyHash(body: string): string {
  return createHash("sha256")
    .update("candidate-note-body:v1\0", "utf8")
    .update(body, "utf8")
    .digest("hex");
}

function isMatchingCandidateNoteReplay(
  replay: Readonly<{
    applicationId: string;
    kind: string;
    metadata: unknown;
  }>,
  applicationId: string,
  bodyHash: string,
): boolean {
  if (
    replay.applicationId !== applicationId ||
    replay.kind !== "CANDIDATE_NOTE_UPDATED" ||
    typeof replay.metadata !== "object" ||
    replay.metadata === null ||
    Array.isArray(replay.metadata)
  ) return false;
  const metadata = replay.metadata as Readonly<Record<string, unknown>>;
  return (
    metadata.bodyHashVersion === "sha256-v1" &&
    metadata.bodyHash === bodyHash
  );
}

function isPrismaUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function createDigest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
