import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import type { AuthRequestContext } from "@/lib/auth/request-context";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import {
  Prisma,
  type ExternalApplicationStatus,
} from "@/lib/generated/prisma/client";
import {
  isRecruitingFeatureAvailableV1,
  RECRUITING_FEATURE_UNAVAILABLE,
} from "@/lib/recruiting/feature-gates";

const DAY = 86_400_000;
const AUDIT_RETENTION = 400 * DAY;

export const EXTERNAL_APPLICATION_STATUS_LABELS_V1 = Object.freeze({
  BEGUN: "Begonnen",
  SUBMITTED: "Von dir als eingereicht bestätigt",
  INTERVIEW: "Interview",
  OFFER: "Angebot",
  REJECTED: "Absage",
  HIRED: "Eingestellt",
  WITHDRAWN: "Zurückgezogen",
  ARCHIVED: "Archiviert",
} satisfies Record<ExternalApplicationStatus, string>);

export const EXTERNAL_APPLICATION_TRANSITIONS_V1 = Object.freeze({
  BEGUN: Object.freeze(["SUBMITTED", "WITHDRAWN", "ARCHIVED"]),
  SUBMITTED: Object.freeze([
    "INTERVIEW",
    "OFFER",
    "REJECTED",
    "WITHDRAWN",
    "ARCHIVED",
  ]),
  INTERVIEW: Object.freeze([
    "OFFER",
    "REJECTED",
    "WITHDRAWN",
    "ARCHIVED",
  ]),
  OFFER: Object.freeze(["HIRED", "REJECTED", "WITHDRAWN", "ARCHIVED"]),
  REJECTED: Object.freeze(["ARCHIVED"]),
  HIRED: Object.freeze(["ARCHIVED"]),
  WITHDRAWN: Object.freeze(["ARCHIVED"]),
  ARCHIVED: Object.freeze([]),
} satisfies Record<ExternalApplicationStatus, readonly ExternalApplicationStatus[]>);

const createSchema = z.strictObject({
  candidateUserId: z.uuid(),
  jobId: z.uuid(),
  jobRevisionId: z.uuid(),
  idempotencyKey: z.string().trim().min(8).max(128),
});
const transitionSchema = z.strictObject({
  candidateUserId: z.uuid(),
  trackerId: z.uuid(),
  nextStatus: z.enum([
    "SUBMITTED",
    "INTERVIEW",
    "OFFER",
    "REJECTED",
    "HIRED",
    "WITHDRAWN",
    "ARCHIVED",
  ]),
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(128),
});
const reminderSchema = z.strictObject({
  candidateUserId: z.uuid(),
  trackerId: z.uuid(),
  reminderAt: z.date().nullable(),
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(128),
});

type Dependencies = Readonly<{
  database: DatabaseClient;
  environment: ServerEnvironment;
  request: AuthRequestContext;
  now?: Date;
}>;

type ExternalTrackerFailureCode =
  | typeof RECRUITING_FEATURE_UNAVAILABLE
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_TRANSITION"
  | "IDEMPOTENCY_CONFLICT"
  | "WRITE_FAILED";

export async function previewExternalApplicationResume(
  input: Readonly<{ jobId: string; jobRevisionId: string }>,
  dependencies: Pick<Dependencies, "database" | "environment">,
) {
  if (
    !isRecruitingFeatureAvailableV1(
      dependencies.environment,
      "external_application_tracker",
    ) ||
    !z.uuid().safeParse(input.jobId).success ||
    !z.uuid().safeParse(input.jobRevisionId).success
  ) {
    return null;
  }
  const row = await loadSnapshotSource(
    dependencies.database,
    input.jobId,
    input.jobRevisionId,
  );
  return row === null ? null : publicSnapshot(row);
}

export async function createExternalApplicationTracker(
  rawInput: unknown,
  dependencies: Dependencies,
) {
  const input = createSchema.safeParse(rawInput);
  const now = dependencies.now ?? new Date();
  if (!input.success || !validDate(now)) return failure("INVALID_INPUT");
  if (
    !isRecruitingFeatureAvailableV1(
      dependencies.environment,
      "external_application_tracker",
    )
  ) {
    return failure(RECRUITING_FEATURE_UNAVAILABLE);
  }
  try {
    return await runSerializable(dependencies.database, async (transaction) => {
      const [profile, source] = await Promise.all([
        transaction.candidateProfile.findFirst({
          where: {
            userId: input.data.candidateUserId,
            user: { status: "ACTIVE" },
          },
          select: { id: true },
        }),
        loadSnapshotSource(
          transaction,
          input.data.jobId,
          input.data.jobRevisionId,
        ),
      ]);
      if (profile === null || source === null) return failure("NOT_FOUND");
      const snapshot = snapshotRecord(source, now);
      const existing = await transaction.externalApplicationTracker.findUnique({
        where: {
          candidateProfileId_snapshotFingerprint: {
            candidateProfileId: profile.id,
            snapshotFingerprint: snapshot.payloadHash,
          },
        },
        select: { id: true, candidateProfileId: true, status: true, version: true },
      });
      if (existing !== null) {
        return Object.freeze({
          ok: true as const,
          replay: true,
          trackerId: existing.id,
          status: existing.status,
          version: existing.version,
        });
      }
      const eventIdempotencyKey = eventKey("external:create", input.data.idempotencyKey);
      const replay = await transaction.externalApplicationEvent.findUnique({
        where: { idempotencyKey: eventIdempotencyKey },
        select: {
          tracker: { select: { id: true, candidateProfileId: true, status: true, version: true } },
        },
      });
      if (replay !== null) {
        return replay.tracker.candidateProfileId === profile.id
          ? Object.freeze({
              ok: true as const,
              replay: true,
              trackerId: replay.tracker.id,
              status: replay.tracker.status,
              version: replay.tracker.version,
            })
          : failure("IDEMPOTENCY_CONFLICT");
      }
      const tracker = await transaction.externalApplicationTracker.create({
        data: {
          candidateProfileId: profile.id,
          source: "CANDIDATE_CONFIRMED",
          status: "BEGUN",
          snapshotFingerprint: snapshot.payloadHash,
          version: 1,
          createdAt: now,
          updatedAt: now,
          snapshot: { create: snapshot },
          events: {
            create: {
              kind: "CREATED",
              toStatus: "BEGUN",
              source: "CANDIDATE_CONFIRMED",
              actorUserId: input.data.candidateUserId,
              idempotencyKey: eventIdempotencyKey,
              correlationId: dependencies.request.correlationId,
              createdAt: now,
            },
          },
        },
        select: { id: true, status: true, version: true },
      });
      await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
        action: "EXTERNAL_APPLICATION_CREATED",
        actorKind: "USER",
        actorUserId: input.data.candidateUserId,
        capability: "CANDIDATE_EXTERNAL_APPLICATION_CREATE",
        correlationId: dependencies.request.correlationId,
        result: "SUCCEEDED",
        retainUntil: new Date(now.getTime() + AUDIT_RETENTION),
        targetId: tracker.id,
        targetType: "EXTERNAL_APPLICATION_TRACKER",
      });
      return Object.freeze({
        ok: true as const,
        replay: false,
        trackerId: tracker.id,
        status: tracker.status,
        version: tracker.version,
      });
    });
  } catch {
    return failure("WRITE_FAILED");
  }
}

export async function transitionExternalApplicationTracker(
  rawInput: unknown,
  dependencies: Dependencies,
) {
  const input = transitionSchema.safeParse(rawInput);
  const now = dependencies.now ?? new Date();
  if (!input.success || !validDate(now)) return failure("INVALID_INPUT");
  if (
    !isRecruitingFeatureAvailableV1(
      dependencies.environment,
      "external_application_tracker",
    )
  ) {
    return failure(RECRUITING_FEATURE_UNAVAILABLE);
  }
  try {
    return await runSerializable(dependencies.database, async (transaction) => {
      const tracker = await transaction.externalApplicationTracker.findFirst({
        where: {
          id: input.data.trackerId,
          candidateProfile: {
            userId: input.data.candidateUserId,
            user: { status: "ACTIVE" },
          },
        },
        select: { id: true, status: true, version: true },
      });
      if (tracker === null) return failure("NOT_FOUND");
      await transaction.$queryRaw`
        SELECT "id" FROM "ExternalApplicationTracker"
        WHERE "id" = ${tracker.id}::uuid FOR UPDATE
      `;
      const current =
        await transaction.externalApplicationTracker.findUniqueOrThrow({
          where: { id: tracker.id },
          select: { status: true, version: true },
        });
      const key = eventKey("external:status", input.data.idempotencyKey);
      const replay = await transaction.externalApplicationEvent.findUnique({
        where: { idempotencyKey: key },
        select: { trackerId: true, toStatus: true },
      });
      if (replay !== null) {
        return replay.trackerId === tracker.id &&
          replay.toStatus === input.data.nextStatus
          ? Object.freeze({
              ok: true as const,
              replay: true,
              trackerId: tracker.id,
              status: input.data.nextStatus,
              version: current.version,
            })
          : failure("IDEMPOTENCY_CONFLICT");
      }
      if (current.version !== input.data.expectedVersion) return failure("CONFLICT");
      if (
        !(EXTERNAL_APPLICATION_TRANSITIONS_V1[current.status] as readonly ExternalApplicationStatus[]).includes(
          input.data.nextStatus,
        )
      ) {
        return failure("INVALID_TRANSITION");
      }
      const updated = await transaction.externalApplicationTracker.update({
        where: { id: tracker.id },
        data: {
          status: input.data.nextStatus,
          version: { increment: 1 },
          updatedAt: now,
          ...(["ARCHIVED", "HIRED", "REJECTED", "WITHDRAWN"].includes(
            input.data.nextStatus,
          )
            ? {
                reminderAt: null,
                ...(input.data.nextStatus === "ARCHIVED"
                  ? { archivedAt: now }
                  : {}),
              }
            : {}),
        },
        select: { version: true },
      });
      await transaction.externalApplicationEvent.create({
        data: {
          trackerId: tracker.id,
          kind:
            input.data.nextStatus === "ARCHIVED" ? "ARCHIVED" : "STATUS_CHANGED",
          fromStatus: current.status,
          toStatus: input.data.nextStatus,
          source: "CANDIDATE_CONFIRMED",
          actorUserId: input.data.candidateUserId,
          idempotencyKey: key,
          correlationId: dependencies.request.correlationId,
          createdAt: now,
        },
      });
      await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
        action: "EXTERNAL_APPLICATION_STATUS_CHANGED",
        actorKind: "USER",
        actorUserId: input.data.candidateUserId,
        capability: "CANDIDATE_EXTERNAL_APPLICATION_MUTATE",
        correlationId: dependencies.request.correlationId,
        result: "SUCCEEDED",
        retainUntil: new Date(now.getTime() + AUDIT_RETENTION),
        targetId: tracker.id,
        targetType: "EXTERNAL_APPLICATION_TRACKER",
      });
      return Object.freeze({
        ok: true as const,
        replay: false,
        trackerId: tracker.id,
        status: input.data.nextStatus,
        version: updated.version,
      });
    });
  } catch {
    return failure("WRITE_FAILED");
  }
}

export async function setExternalApplicationReminder(
  rawInput: unknown,
  dependencies: Dependencies,
) {
  const input = reminderSchema.safeParse(rawInput);
  const now = dependencies.now ?? new Date();
  if (!input.success || !validDate(now)) return failure("INVALID_INPUT");
  if (
    !isRecruitingFeatureAvailableV1(
      dependencies.environment,
      "external_application_tracker",
    )
  ) {
    return failure(RECRUITING_FEATURE_UNAVAILABLE);
  }
  if (
    input.data.reminderAt !== null &&
    (input.data.reminderAt <= now ||
      input.data.reminderAt.getTime() > now.getTime() + 365 * DAY)
  ) {
    return failure("INVALID_INPUT");
  }
  try {
    return await dependencies.database.$transaction(async (transaction) => {
      const tracker = await transaction.externalApplicationTracker.findFirst({
        where: {
          id: input.data.trackerId,
          candidateProfile: {
            userId: input.data.candidateUserId,
            user: { status: "ACTIVE" },
          },
          status: { notIn: ["ARCHIVED", "HIRED", "REJECTED", "WITHDRAWN"] },
        },
        select: { id: true, version: true },
      });
      if (tracker === null) return failure("NOT_FOUND");
      const key = eventKey("external:reminder", input.data.idempotencyKey);
      const replay = await transaction.externalApplicationEvent.findUnique({
        where: { idempotencyKey: key },
        select: { trackerId: true },
      });
      if (replay !== null) {
        return replay.trackerId === tracker.id
          ? Object.freeze({
              ok: true as const,
              replay: true,
              trackerId: tracker.id,
              version: tracker.version,
            })
          : failure("IDEMPOTENCY_CONFLICT");
      }
      const updated = await transaction.externalApplicationTracker.updateMany({
        where: { id: tracker.id, version: input.data.expectedVersion },
        data: {
          reminderAt: input.data.reminderAt,
          version: { increment: 1 },
          updatedAt: now,
        },
      });
      if (updated.count !== 1) return failure("CONFLICT");
      const current =
        await transaction.externalApplicationTracker.findUniqueOrThrow({
          where: { id: tracker.id },
          select: { version: true },
        });
      await transaction.externalApplicationEvent.create({
        data: {
          trackerId: tracker.id,
          kind: "REMINDER_CHANGED",
          source: "CANDIDATE_CONFIRMED",
          actorUserId: input.data.candidateUserId,
          reasonCode:
            input.data.reminderAt === null ? "REMINDER_REMOVED" : "REMINDER_SET",
          idempotencyKey: key,
          correlationId: dependencies.request.correlationId,
          createdAt: now,
        },
      });
      await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
        action: "EXTERNAL_APPLICATION_REMINDER_CHANGED",
        actorKind: "USER",
        actorUserId: input.data.candidateUserId,
        capability: "CANDIDATE_EXTERNAL_APPLICATION_MUTATE",
        correlationId: dependencies.request.correlationId,
        result: "SUCCEEDED",
        retainUntil: new Date(now.getTime() + AUDIT_RETENTION),
        targetId: tracker.id,
        targetType: "EXTERNAL_APPLICATION_TRACKER",
      });
      return Object.freeze({
        ok: true as const,
        replay: false,
        trackerId: tracker.id,
        version: current.version,
      });
    });
  } catch {
    return failure("WRITE_FAILED");
  }
}

export async function listExternalApplicationTrackers(
  candidateUserId: string,
  dependencies: Pick<Dependencies, "database" | "environment">,
) {
  if (!z.uuid().safeParse(candidateUserId).success) {
    return Object.freeze([]);
  }
  return Object.freeze(
    await dependencies.database.externalApplicationTracker.findMany({
      where: { candidateProfile: { userId: candidateUserId } },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: 200,
      select: {
        id: true,
        status: true,
        source: true,
        version: true,
        reminderAt: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
        snapshot: {
          select: {
            jobSlug: true,
            jobTitle: true,
            companyName: true,
            applicationUrl: true,
            capturedAt: true,
          },
        },
      },
    }),
  );
}

export async function getExternalApplicationTracker(
  candidateUserId: string,
  trackerId: string,
  dependencies: Pick<Dependencies, "database" | "environment">,
) {
  if (
    !z.uuid().safeParse(candidateUserId).success ||
    !z.uuid().safeParse(trackerId).success
  ) {
    return null;
  }
  return dependencies.database.externalApplicationTracker.findFirst({
    where: { id: trackerId, candidateProfile: { userId: candidateUserId } },
    select: {
      id: true,
      status: true,
      source: true,
      version: true,
      reminderAt: true,
      archivedAt: true,
      createdAt: true,
      updatedAt: true,
      snapshot: true,
      events: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
        select: {
          id: true,
          kind: true,
          fromStatus: true,
          toStatus: true,
          source: true,
          reasonCode: true,
          createdAt: true,
        },
      },
    },
  });
}

async function loadSnapshotSource(
  database: DatabaseClient | Prisma.TransactionClient,
  jobId: string,
  jobRevisionId: string,
) {
  return database.job.findFirst({
    where: { id: jobId, revisions: { some: { id: jobRevisionId } } },
    select: {
      id: true,
      slug: true,
      company: { select: { id: true, name: true, slug: true } },
      revisions: {
        where: { id: jobRevisionId },
        take: 1,
        select: {
          id: true,
          title: true,
          applicationContactKind: true,
          applicationContactValue: true,
        },
      },
    },
  }).then((row) => {
    const revision = row?.revisions[0];
    if (
      row === null ||
      row === undefined ||
      revision === undefined ||
      revision.applicationContactKind !== "APPLY_URL" ||
      safeHttpUrl(revision.applicationContactValue) === null
    ) {
      return null;
    }
    return Object.freeze({ ...row, revision });
  });
}

function snapshotRecord(
  source: NonNullable<Awaited<ReturnType<typeof loadSnapshotSource>>>,
  now: Date,
) {
  const applicationUrl = safeHttpUrl(source.revision.applicationContactValue)!;
  const canonical = Object.freeze({
    sourceJobId: source.id,
    sourceJobRevisionId: source.revision.id,
    jobSlug: source.slug,
    jobTitle: source.revision.title.trim(),
    companyId: source.company.id,
    companyName: source.company.name.trim(),
    companySlug: source.company.slug,
    applicationUrl,
    source: "CANDIDATE_CONFIRMED" as const,
  });
  return Object.freeze({
    ...canonical,
    applicationUrlHash: sha256(applicationUrl),
    payloadHash: sha256(JSON.stringify(canonical)),
    capturedAt: now,
  });
}

function publicSnapshot(
  source: NonNullable<Awaited<ReturnType<typeof loadSnapshotSource>>>,
) {
  return Object.freeze({
    jobId: source.id,
    jobRevisionId: source.revision.id,
    jobSlug: source.slug,
    jobTitle: source.revision.title,
    companyId: source.company.id,
    companyName: source.company.name,
    companySlug: source.company.slug,
    applicationUrl: safeHttpUrl(source.revision.applicationContactValue)!,
  });
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) &&
        url.username === "" &&
        url.password === ""
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function eventKey(scope: string, key: string): string {
  return `${scope}:${sha256(key)}`.slice(0, 160);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function failure(code: ExternalTrackerFailureCode) {
  return Object.freeze({ ok: false as const, code });
}

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

async function runSerializable<T>(
  database: DatabaseClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await database.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        attempt < 2 &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("unreachable");
}
