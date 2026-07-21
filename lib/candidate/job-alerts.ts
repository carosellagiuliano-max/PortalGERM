import "server-only";

import { randomUUID, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import { trackAnalyticsEventV1 } from "@/lib/analytics/track";
import {
  JOB_ALERT_DELIVERY_NOTICE_V1,
  JOB_ALERT_POLICY_V1,
  JobAlertPolicyError,
  type JobAlertCommand,
  type JobAlertQuery,
  createJobAlertUnsubscribeToken,
  defaultJobAlertQuery,
  distanceInKilometres,
  firstJobAlertDueAt,
  hashJobAlertUnsubscribeToken,
  jobAlertCommandSchema,
  jobAlertConsentNoticeHash,
  jobAlertEligibilityEnvironment,
  jobAlertIdSchema,
  jobAlertWindow,
  nextJobAlertDueAt,
  parseStoredJobAlertQuery,
  unsubscribeRawTokenSchema,
} from "@/lib/candidate/job-alert-policy";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";
import type {
  AlertFrequency,
  DataProvenance,
  JobAlertStatus,
  RemoteType,
} from "@/lib/generated/prisma/enums";
import {
  filterPubliclyEligibleJobsInTransaction,
  type PublicEligibilityEnvironment,
} from "@/lib/jobs/public-eligibility";
import { scanJobAlertDigestMatches } from "@/lib/candidate/job-alert-digest-scan";
import {
  captureLocalMockEmail,
  validateLocalMockEmail,
} from "@/lib/providers/email/local-mock-mailbox";
import type { LocalMockMailboxCaptureInput } from "@/lib/providers/email/local-mock-mailbox-core";
import {
  EmailLogIdempotencyConflictError,
  MockEmailProvider,
  type EmailLogRepository,
  type LocalMockMailboxCapturePort,
} from "@/lib/providers/email/mock-email-provider";
import { renderEmailTemplate } from "@/lib/providers/email/templates";
import { USER_CONSENT_NOTICES_V1 } from "@/lib/privacy/user-consent";
import { CANDIDATE_ONBOARDING_RULE_V1 } from "@/lib/candidate/profile";

const candidateActorSchema = z.string().uuid();
const MAX_DUE_ALERTS_PER_MANUAL_RUN = 100;
const MATCH_SCAN_PAGE_SIZE = 100;
const DAY_MILLISECONDS = 86_400_000;
const JOB_ALERT_CONSENT_AUDIT_RETENTION_DAYS = 400;
const JOB_ALERT_ANALYTICS_PRODUCER = "candidate-job-alert";
export const MAX_CANDIDATE_JOB_ALERTS = 50;

export type JobAlertActionCode =
  | "CONSENT_REQUIRED"
  | "INVALID_INPUT"
  | "LIMIT_REACHED"
  | "NOT_FOUND"
  | "REFERENCE_INVALID";

export class JobAlertActionError extends Error {
  constructor(readonly code: JobAlertActionCode) {
    super(`Job alert action rejected: ${code}`);
    this.name = "JobAlertActionError";
  }
}

export type CandidateJobAlertListItem = Readonly<{
  id: string;
  query: JobAlertQuery;
  legacyLabel: string | null;
  filterRequiresRepair: boolean;
  frequency: AlertFrequency;
  status: JobAlertStatus;
  nextDueAt: Date;
  lastSuccessfulCutoffAt: Date | null;
  lastDigestAt: Date | null;
  lastDigestCount: number | null;
  createdAt: Date;
}>;

export type CandidateJobAlertPageData = Readonly<{
  alerts: readonly CandidateJobAlertListItem[];
  deliveryConsentGranted: boolean;
  references: Readonly<{
    cantons: readonly Readonly<{ id: string; code: string; name: string }>[];
    categories: readonly Readonly<{ id: string; name: string }>[];
    cities: readonly Readonly<{
      id: string;
      cantonId: string;
      cantonCode: string;
      name: string;
    }>[];
  }>;
}>;

type MutationOptions = Readonly<{
  actorUserId: string;
  correlationId?: string;
  now?: Date;
  database?: DatabaseClient;
}>;

export async function getCandidateJobAlertPageData(
  actorUserIdInput: string,
  database: DatabaseClient = getDatabase(),
  now: Date = new Date(),
): Promise<CandidateJobAlertPageData> {
  const actorUserId = parseActor(actorUserIdInput);
  assertDate(now);
  const profile = await database.candidateProfile.findUnique({
    where: { userId: actorUserId },
    select: {
      jobAlerts: {
        where: { status: { not: "DELETED" } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: MAX_CANDIDATE_JOB_ALERTS,
        select: {
          id: true,
          query: true,
          frequency: true,
          status: true,
          nextDueAt: true,
          lastSuccessfulCutoffAt: true,
          createdAt: true,
          digests: {
            where: { runAt: { not: null } },
            orderBy: [{ runAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { runAt: true, itemCount: true },
          },
        },
      },
    },
  });
  if (profile === null) throw new JobAlertActionError("NOT_FOUND");

  const [consent, cantons, categories, cities] = await Promise.all([
    latestDeliveryConsent(database, actorUserId, now),
    database.canton.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, code: true, name: true },
    }),
    database.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, slug: true },
    }),
    database.city.findMany({
      where: { isActive: true, canton: { isActive: true } },
      orderBy: [{ canton: { code: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        cantonId: true,
        name: true,
        canton: { select: { code: true } },
      },
    }),
  ]);

  const categoryIdBySlug = new Map(
    categories.map((category) => [category.slug, category.id] as const),
  );
  const cantonIdByCode = new Map(
    cantons.map((canton) => [canton.code, canton.id] as const),
  );
  const alerts = profile.jobAlerts.map((alert): CandidateJobAlertListItem => {
    const stored = parseStoredJobAlertQuery(alert.query);
    const resolvedLegacyCategoryId =
      stored.kind === "legacy" && stored.query.categorySlug !== null
        ? (categoryIdBySlug.get(stored.query.categorySlug) ?? null)
        : null;
    const resolvedLegacyCantonId =
      stored.kind === "legacy" && stored.query.cantonCode !== null
        ? (cantonIdByCode.get(stored.query.cantonCode) ?? null)
        : null;
    const legacyReferencesResolved =
      stored.kind === "legacy" &&
      (stored.query.categorySlug === null ||
        resolvedLegacyCategoryId !== null) &&
      (stored.query.cantonCode === null || resolvedLegacyCantonId !== null);
    const query =
      stored.kind === "v1"
        ? stored.query
        : stored.kind === "legacy" && legacyReferencesResolved
          ? Object.freeze({
              ...defaultJobAlertQuery(),
              categoryId: resolvedLegacyCategoryId,
              cantonId: resolvedLegacyCantonId,
            })
          : defaultJobAlertQuery();
    const legacyLabel =
      stored.kind === "legacy"
        ? [stored.query.categorySlug, stored.query.cantonCode]
            .filter(Boolean)
            .join(" · ")
        : stored.kind === "invalid"
          ? "Historischer Filter"
          : null;
    const digest = alert.digests[0];
    return Object.freeze({
      id: alert.id,
      query,
      legacyLabel: legacyLabel || null,
      filterRequiresRepair:
        stored.kind === "invalid" ||
        (stored.kind === "legacy" && !legacyReferencesResolved),
      frequency: alert.frequency,
      status: alert.status,
      nextDueAt: alert.nextDueAt,
      lastSuccessfulCutoffAt: alert.lastSuccessfulCutoffAt,
      lastDigestAt: digest?.runAt ?? null,
      lastDigestCount: digest?.itemCount ?? null,
      createdAt: alert.createdAt,
    });
  });

  return Object.freeze({
    alerts: Object.freeze(alerts),
    deliveryConsentGranted: isCurrentDeliveryConsent(consent),
    references: Object.freeze({
      cantons: Object.freeze(cantons.map((row) => Object.freeze(row))),
      categories: Object.freeze(categories.map((row) => Object.freeze(row))),
      cities: Object.freeze(
        cities.map((city) =>
          Object.freeze({
            id: city.id,
            cantonId: city.cantonId,
            cantonCode: city.canton.code,
            name: city.name,
          }),
        ),
      ),
    }),
  });
}

export async function createJobAlert(input: unknown, options: MutationOptions) {
  const command = parseCommand(input);
  const actorUserId = parseActor(options.actorUserId);
  const now = options.now ?? new Date();
  const database = options.database ?? getDatabase();
  assertDate(now);

  return database.$transaction(async (transaction) => {
    const profile = await lockCandidateProfile(transaction, actorUserId);
    const existingAlertCount = await transaction.jobAlert.count({
      where: {
        candidateProfileId: profile.id,
        status: { not: "DELETED" },
      },
    });
    if (existingAlertCount >= MAX_CANDIDATE_JOB_ALERTS) {
      throw new JobAlertActionError("LIMIT_REACHED");
    }
    await assertQueryReferences(transaction, command.query);
    const consent = await latestDeliveryConsent(transaction, actorUserId, now);
    if (command.active && !isCurrentDeliveryConsent(consent)) {
      if (!command.deliveryConsentAccepted) {
        throw new JobAlertActionError("CONSENT_REQUIRED");
      }
      await appendDeliveryConsent(
        transaction,
        actorUserId,
        true,
        now,
        options.correlationId,
      );
    }

    const alert = await transaction.jobAlert.create({
      data: {
        candidateProfileId: profile.id,
        query: toJsonObject(command.query),
        frequency: command.frequency,
        status: command.active ? "ACTIVE" : "PAUSED",
        nextDueAt: firstJobAlertDueAt(now, command.frequency),
        createdAt: now,
        updatedAt: now,
        events: {
          create: {
            kind: "CREATED",
            actorUserId,
            reasonCode: command.active
              ? "EXPLICIT_ACTIVATION"
              : "CREATED_PAUSED",
            createdAt: now,
          },
        },
      },
      select: { id: true, status: true },
    });
    if (command.active) {
      await recordJobAlertActivatedOnce(transaction, {
        actorProvenance: profile.actorProvenance,
        alertFrequency: command.frequency,
        jobAlertId: alert.id,
        occurredAt: now,
      });
    }
    return Object.freeze(alert);
  }, transactionOptions());
}

export async function updateJobAlert(
  jobAlertIdInput: string,
  input: unknown,
  options: MutationOptions,
) {
  const jobAlertId = parseAlertId(jobAlertIdInput);
  const command = parseCommand(input);
  const actorUserId = parseActor(options.actorUserId);
  const now = options.now ?? new Date();
  const database = options.database ?? getDatabase();
  assertDate(now);

  return database.$transaction(async (transaction) => {
    const alert = await lockOwnedAlert(transaction, jobAlertId, actorUserId);
    await assertQueryReferences(transaction, command.query);
    if (alert.status === "DELETED") throw new JobAlertActionError("NOT_FOUND");

    let nextStatus = alert.status;
    let lifecycleEvent: "PAUSED" | "RESUMED" | null = null;
    if (!command.active && alert.status === "ACTIVE") {
      nextStatus = "PAUSED";
      lifecycleEvent = "PAUSED";
    } else if (
      command.active &&
      (alert.status === "PAUSED" || alert.status === "UNSUBSCRIBED")
    ) {
      const consent = await latestDeliveryConsent(
        transaction,
        actorUserId,
        now,
      );
      if (!isCurrentDeliveryConsent(consent)) {
        throw new JobAlertActionError("CONSENT_REQUIRED");
      }
      nextStatus = "ACTIVE";
      lifecycleEvent = "RESUMED";
    }

    const frequencyChanged = alert.frequency !== command.frequency;
    const shouldRebaseSchedule =
      lifecycleEvent === "RESUMED" ||
      (frequencyChanged && nextStatus === "ACTIVE");
    const hasPendingDigest =
      shouldRebaseSchedule &&
      (await hasDigestAtScheduledTime(transaction, alert.id, alert.nextDueAt));
    await transaction.jobAlert.update({
      where: { id: alert.id },
      data: {
        query: toJsonObject(command.query),
        frequency: command.frequency,
        status: nextStatus,
        ...(shouldRebaseSchedule && !hasPendingDigest
          ? { nextDueAt: firstJobAlertDueAt(now, command.frequency) }
          : {}),
        updatedAt: now,
      },
    });
    await transaction.jobAlertEvent.create({
      data: {
        jobAlertId: alert.id,
        kind: "UPDATED",
        actorUserId,
        reasonCode: "FILTERS_UPDATED",
        createdAt: now,
      },
    });
    if (lifecycleEvent !== null) {
      await transaction.jobAlertEvent.create({
        data: {
          jobAlertId: alert.id,
          kind: lifecycleEvent,
          actorUserId,
          reasonCode: "EXPLICIT_ALERT_ACTION",
          createdAt: now,
        },
      });
    }
    if (lifecycleEvent === "RESUMED") {
      await recordJobAlertActivatedOnce(transaction, {
        actorProvenance: alert.actorProvenance,
        alertFrequency: command.frequency,
        jobAlertId: alert.id,
        occurredAt: now,
      });
    }
    return Object.freeze({ id: alert.id, status: nextStatus });
  }, transactionOptions());
}

export async function pauseJobAlert(
  jobAlertIdInput: string,
  options: MutationOptions,
) {
  return transitionOwnedAlert(jobAlertIdInput, "pause", options);
}

export async function resumeJobAlert(
  jobAlertIdInput: string,
  options: MutationOptions,
) {
  return transitionOwnedAlert(jobAlertIdInput, "resume", options);
}

export async function deleteJobAlert(
  jobAlertIdInput: string,
  options: MutationOptions,
) {
  const jobAlertId = parseAlertId(jobAlertIdInput);
  const actorUserId = parseActor(options.actorUserId);
  const now = options.now ?? new Date();
  const database = options.database ?? getDatabase();
  assertDate(now);
  return database.$transaction(async (transaction) => {
    const alert = await lockOwnedAlert(transaction, jobAlertId, actorUserId);
    if (alert.status === "DELETED")
      return Object.freeze({ id: alert.id, changed: false });
    await transaction.jobAlert.update({
      where: { id: alert.id },
      data: { status: "DELETED", updatedAt: now },
    });
    await transaction.jobAlertUnsubscribeToken.updateMany({
      where: { jobAlertId: alert.id, usedAt: null },
      data: { usedAt: now },
    });
    await transaction.jobAlertEvent.create({
      data: {
        jobAlertId: alert.id,
        kind: "DELETED",
        actorUserId,
        reasonCode: "EXPLICIT_DELETE",
        createdAt: now,
      },
    });
    return Object.freeze({ id: alert.id, changed: true });
  }, transactionOptions());
}

export async function grantJobAlertDeliveryConsent(options: MutationOptions) {
  return appendGlobalDeliveryConsent(true, options);
}

export async function revokeJobAlertDeliveryConsentGlobally(
  options: MutationOptions,
) {
  return appendGlobalDeliveryConsent(false, options);
}

async function appendGlobalDeliveryConsent(
  granted: boolean,
  options: MutationOptions,
) {
  const actorUserId = parseActor(options.actorUserId);
  const now = options.now ?? new Date();
  const database = options.database ?? getDatabase();
  assertDate(now);
  return database.$transaction(async (transaction) => {
    await lockCandidateProfile(transaction, actorUserId);
    await appendDeliveryConsent(
      transaction,
      actorUserId,
      granted,
      now,
      options.correlationId,
    );
    if (granted) {
      return Object.freeze({ granted: true, pausedAlertCount: 0 });
    }
    const activeAlerts = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT alert."id"
        FROM "JobAlert" AS alert
        INNER JOIN "CandidateProfile" AS profile
          ON profile."id" = alert."candidateProfileId"
        WHERE profile."userId" = ${actorUserId}::uuid
          AND alert."status" = 'ACTIVE'
        ORDER BY alert."id"
        FOR UPDATE OF alert
      `;
    const ids = activeAlerts.map(({ id }) => id);
    if (ids.length > 0) {
      await transaction.jobAlert.updateMany({
        where: { id: { in: ids }, status: "ACTIVE" },
        data: { status: "PAUSED", updatedAt: now },
      });
      await transaction.jobAlertEvent.createMany({
        data: ids.map((jobAlertId) => ({
          jobAlertId,
          kind: "PAUSED" as const,
          actorUserId,
          reasonCode: "GLOBAL_DELIVERY_CONSENT_REVOKED",
          createdAt: now,
        })),
      });
    }
    return Object.freeze({ granted: false, pausedAlertCount: ids.length });
  }, transactionOptions());
}

type DigestRunOptions = Readonly<{
  now: Date;
  alertId?: string;
  candidateUserId?: string;
  database?: DatabaseClient;
  appUrl?: string;
  environment?: PublicEligibilityEnvironment;
  randomBytes?: (size: number) => Buffer;
  mailbox?: Readonly<{
    validate(input: LocalMockMailboxCaptureInput): void | Promise<void>;
    capture(input: LocalMockMailboxCaptureInput): void | Promise<void>;
  }>;
  createEmailProvider?: (
    repository: EmailLogRepository,
    mailbox: LocalMockMailboxCapturePort,
  ) => Pick<MockEmailProvider, "send">;
}>;

export async function runJobAlertDigestMock(options: DigestRunOptions) {
  assertDate(options.now);
  const database = options.database ?? getDatabase();
  const alertId =
    options.alertId === undefined ? undefined : parseAlertId(options.alertId);
  const candidateUserId =
    options.candidateUserId === undefined
      ? undefined
      : parseActor(options.candidateUserId);
  const serverEnvironment =
    options.appUrl === undefined || options.environment === undefined
      ? getServerEnvironment()
      : null;
  const appUrl = normalizeAppUrl(
    options.appUrl ?? serverEnvironment?.APP_URL ?? "",
  );
  const eligibilityEnvironment =
    options.environment ??
    jobAlertEligibilityEnvironment(serverEnvironment?.APP_ENV ?? "local");
  const mailbox =
    options.mailbox ??
    Object.freeze({
      validate: (input: LocalMockMailboxCaptureInput) => {
        validateLocalMockEmail(input);
      },
      capture: (input: LocalMockMailboxCaptureInput) => {
        captureLocalMockEmail(input);
      },
    });

  const candidates = await database.jobAlert.findMany({
    where: {
      ...(alertId === undefined ? {} : { id: alertId }),
      status: "ACTIVE",
      nextDueAt: { lte: options.now },
      ...(candidateUserId === undefined
        ? { candidateProfile: { user: { status: "ACTIVE" } } }
        : {
            candidateProfile: {
              userId: candidateUserId,
              user: { status: "ACTIVE" },
            },
          }),
    },
    orderBy: [{ nextDueAt: "asc" }, { id: "asc" }],
    take: MAX_DUE_ALERTS_PER_MANUAL_RUN,
    select: { id: true },
  });

  const completed: Array<
    Readonly<{ alertId: string; digestId: string; itemCount: number }>
  > = [];
  let skipped = 0;
  for (const candidate of candidates) {
    const result = await processDueAlert(database, candidate.id, {
      ...options,
      appUrl,
      candidateUserId,
      eligibilityEnvironment,
      mailbox,
    });
    if (result === null) {
      skipped += 1;
      continue;
    }
    try {
      await mailbox.capture(result.capture);
    } catch (captureError) {
      try {
        await compensateFailedDigestCapture(database, result);
      } catch (compensationError) {
        throw new AggregateError(
          [captureError, compensationError],
          `Job-alert mailbox capture and compensation both failed: ${errorMessage(compensationError)}`,
        );
      }
      throw captureError;
    }
    completed.push(
      Object.freeze({
        alertId: result.alertId,
        digestId: result.digestId,
        itemCount: result.itemCount,
      }),
    );
  }
  return Object.freeze({ completed: Object.freeze(completed), skipped });
}

type ProcessDueOptions = DigestRunOptions &
  Readonly<{
    appUrl: string;
    candidateUserId: string | undefined;
    eligibilityEnvironment: PublicEligibilityEnvironment;
    mailbox: NonNullable<DigestRunOptions["mailbox"]>;
  }>;

async function processDueAlert(
  database: DatabaseClient,
  alertId: string,
  options: ProcessDueOptions,
) {
  return database.$transaction(async (transaction) => {
    const locked = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "JobAlert"
        WHERE "id" = ${alertId}::uuid
          AND "status" = 'ACTIVE'
          AND "nextDueAt" <= ${options.now}
        FOR UPDATE SKIP LOCKED
      `;
    if (locked.length !== 1) return null;
    const alert = await transaction.jobAlert.findUnique({
      where: { id: alertId },
      select: {
        id: true,
        query: true,
        frequency: true,
        status: true,
        nextDueAt: true,
        lastSuccessfulCutoffAt: true,
        createdAt: true,
        updatedAt: true,
        candidateProfile: {
          select: {
            userId: true,
            user: { select: { emailNormalized: true, status: true } },
          },
        },
      },
    });
    if (
      alert === null ||
      alert.status !== "ACTIVE" ||
      alert.candidateProfile.user.status !== "ACTIVE" ||
      (options.candidateUserId !== undefined &&
        alert.candidateProfile.userId !== options.candidateUserId)
    ) {
      return null;
    }
    const consent = await latestDeliveryConsent(
      transaction,
      alert.candidateProfile.userId,
      options.now,
    );
    if (!isCurrentDeliveryConsent(consent)) return null;

    const window = jobAlertWindow(
      alert.createdAt,
      alert.lastSuccessfulCutoffAt,
      options.now,
    );
    const pendingDigests = await transaction.jobAlertDigest.findMany({
      where: {
        jobAlertId: alert.id,
        windowStart: window.start,
        windowEnd: { gt: window.start },
        runAt: { not: null },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 2,
      select: {
        id: true,
        alertNameSnapshot: true,
        itemCount: true,
        policyVersion: true,
        recipientEmailSnapshot: true,
        windowEnd: true,
        windowStart: true,
      },
    });
    if (pendingDigests.length > 1) {
      throw new Error("Multiple pending job-alert digests require repair.");
    }
    const existingDigest = pendingDigests[0] ?? null;
    const retryingExistingDigest = existingDigest !== null;
    let digest = existingDigest;
    let jobs: Awaited<ReturnType<typeof findDigestJobs>> = [];
    if (digest === null) {
      const query = await resolveStoredQuery(transaction, alert.query);
      if (query === null) {
        await transaction.jobAlert.update({
          where: { id: alert.id },
          data: { status: "PAUSED", updatedAt: options.now },
        });
        await transaction.jobAlertEvent.create({
          data: {
            jobAlertId: alert.id,
            kind: "PAUSED",
            reasonCode: "INVALID_STORED_QUERY_REQUIRES_REPAIR",
            createdAt: options.now,
          },
        });
        return null;
      }
      jobs = await findDigestJobs(
        transaction,
        alert.id,
        query,
        window,
        options.now,
        options.eligibilityEnvironment,
      );
      digest = await transaction.jobAlertDigest.create({
        data: {
          jobAlertId: alert.id,
          policyVersion: JOB_ALERT_POLICY_V1.version,
          alertNameSnapshot: jobAlertDisplayName(query),
          recipientEmailSnapshot: alert.candidateProfile.user.emailNormalized,
          windowStart: window.start,
          windowEnd: window.end,
          scheduledFor: alert.nextDueAt,
          runAt: options.now,
          itemCount: jobs.length,
          createdAt: options.now,
        },
        select: {
          id: true,
          alertNameSnapshot: true,
          itemCount: true,
          policyVersion: true,
          recipientEmailSnapshot: true,
          windowEnd: true,
          windowStart: true,
        },
      });
    }
    if (
      retryingExistingDigest &&
      (existingDigest.policyVersion !== JOB_ALERT_POLICY_V1.version ||
        existingDigest.windowStart.getTime() !== window.start.getTime())
    ) {
      throw new Error("Existing job-alert digest does not match retry state.");
    }
    if (!retryingExistingDigest && jobs.length > 0) {
      await transaction.jobAlertDigestItem.createMany({
        data: jobs.map((job, index) => ({
          digestId: digest.id,
          jobAlertId: alert.id,
          jobId: job.id,
          sortOrder: index,
          createdAt: options.now,
        })),
      });
    }

    if (retryingExistingDigest) {
      await transaction.jobAlertUnsubscribeToken.deleteMany({
        where: { jobAlertId: alert.id, digestId: digest.id, usedAt: null },
      });
    }

    const token = createJobAlertUnsubscribeToken(
      options.now,
      options.randomBytes,
    );
    const unsubscribeToken = await transaction.jobAlertUnsubscribeToken.create({
      data: {
        jobAlertId: alert.id,
        digestId: digest.id,
        tokenHash: token.tokenHash,
        issuedAt: token.issuedAt,
        expiresAt: token.expiresAt,
      },
      select: { id: true },
    });
    const unsubscribeUrl = `${options.appUrl}/alerts/unsubscribe/${token.rawToken}`;
    const templateData = Object.freeze({
      alertName: digest.alertNameSnapshot,
      jobCount: digest.itemCount,
      idempotencyKey: `job-alert-digest:${digest.id}`,
      unsubscribeUrl,
    });
    const rendered = renderEmailTemplate("job_alert_digest_mock", templateData);
    const repository = createTransactionEmailLogRepository(transaction);
    const validationOnlyMailbox: LocalMockMailboxCapturePort = Object.freeze({
      validate: (input: LocalMockMailboxCaptureInput) =>
        options.mailbox.validate(input),
      capture: () => undefined,
    });
    const provider =
      options.createEmailProvider?.(repository, validationOnlyMailbox) ??
      new MockEmailProvider(repository, { mailbox: validationOnlyMailbox });
    await provider.send({
      to: digest.recipientEmailSnapshot,
      templateKey: "job_alert_digest_mock",
      data: templateData,
      subject: rendered.subject,
    });
    if (!retryingExistingDigest) {
      await transaction.jobAlertEvent.create({
        data: {
          jobAlertId: alert.id,
          kind: "DIGEST_MOCK_RECORDED",
          actorUserId: null,
          reasonCode: JOB_ALERT_POLICY_V1.version,
          createdAt: options.now,
        },
      });
    }
    const nextDueAt = nextJobAlertDueAt(options.now, alert.frequency);
    await transaction.jobAlert.update({
      where: { id: alert.id },
      data: {
        lastSuccessfulCutoffAt: digest.windowEnd,
        nextDueAt,
        updatedAt: options.now,
      },
    });

    return Object.freeze({
      alertId: alert.id,
      digestId: digest.id,
      itemCount: digest.itemCount,
      capture: Object.freeze({
        to: digest.recipientEmailSnapshot,
        templateKey: "job_alert_digest_mock" as const,
        subject: rendered.subject,
        body: rendered.body,
        actionUrl: unsubscribeUrl,
      }),
      compensation: Object.freeze({
        alertId: alert.id,
        digestId: digest.id,
        nextDueAt,
        previousCutoffAt: alert.lastSuccessfulCutoffAt,
        previousNextDueAt: alert.nextDueAt,
        previousUpdatedAt: alert.updatedAt,
        processedUpdatedAt: options.now,
        unsubscribeTokenId: unsubscribeToken.id,
        windowEnd: digest.windowEnd,
      }),
    });
  }, transactionOptions());
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "unknown compensation error";
}

async function compensateFailedDigestCapture(
  database: DatabaseClient,
  result: Readonly<{
    compensation: Readonly<{
      alertId: string;
      digestId: string;
      nextDueAt: Date;
      previousCutoffAt: Date | null;
      previousNextDueAt: Date;
      previousUpdatedAt: Date;
      processedUpdatedAt: Date;
      unsubscribeTokenId: string;
      windowEnd: Date;
    }>;
  }>,
) {
  const state = result.compensation;
  await database.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id"
      FROM "JobAlert"
      WHERE "id" = ${state.alertId}::uuid
      FOR UPDATE
    `;
    const alert = await transaction.jobAlert.findUnique({
      where: { id: state.alertId },
      select: {
        lastSuccessfulCutoffAt: true,
        nextDueAt: true,
        updatedAt: true,
      },
    });
    if (
      alert === null ||
      alert.lastSuccessfulCutoffAt?.getTime() !== state.windowEnd.getTime()
    ) {
      throw new Error(
        "Job-alert capture compensation encountered changed state.",
      );
    }
    const scheduleIsUnchanged =
      alert.nextDueAt.getTime() === state.nextDueAt.getTime() &&
      alert.updatedAt.getTime() === state.processedUpdatedAt.getTime();
    await transaction.jobAlertUnsubscribeToken.deleteMany({
      where: {
        id: state.unsubscribeTokenId,
        digestId: state.digestId,
        usedAt: null,
      },
    });
    await transaction.jobAlertEvent.create({
      data: {
        jobAlertId: state.alertId,
        kind: "UPDATED",
        actorUserId: null,
        reasonCode: "DIGEST_CAPTURE_COMPENSATED",
        createdAt: state.processedUpdatedAt,
      },
    });
    await transaction.jobAlert.update({
      where: { id: state.alertId },
      data: {
        lastSuccessfulCutoffAt: state.previousCutoffAt,
        updatedAt: scheduleIsUnchanged
          ? state.previousUpdatedAt
          : alert.updatedAt,
        ...(scheduleIsUnchanged
          ? {
              nextDueAt: state.previousNextDueAt,
            }
          : {}),
      },
    });
  }, transactionOptions());
}

export async function unsubscribeJobAlertWithToken(
  rawTokenInput: string,
  options: Readonly<{ now?: Date; database?: DatabaseClient }> = {},
) {
  const now = options.now ?? new Date();
  const database = options.database ?? getDatabase();
  assertDate(now);
  const parsed = unsubscribeRawTokenSchema.safeParse(rawTokenInput);
  if (!parsed.success) return genericUnsubscribeResult();
  let tokenHash: string;
  try {
    tokenHash = hashJobAlertUnsubscribeToken(parsed.data);
  } catch {
    return genericUnsubscribeResult();
  }

  await database.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<
      Array<{
        id: string;
        jobAlertId: string;
        expiresAt: Date;
        usedAt: Date | null;
        alertStatus: JobAlertStatus;
      }>
    >`
        SELECT
          token."id",
          token."jobAlertId",
          token."expiresAt",
          token."usedAt",
          alert."status" AS "alertStatus"
        FROM "JobAlertUnsubscribeToken" AS token
        INNER JOIN "JobAlert" AS alert ON alert."id" = token."jobAlertId"
        WHERE token."tokenHash" = ${tokenHash}
        FOR UPDATE OF token, alert
      `;
    const token = rows[0];
    if (
      token === undefined ||
      token.usedAt !== null ||
      token.expiresAt.getTime() <= now.getTime() ||
      token.alertStatus === "DELETED"
    ) {
      return;
    }
    await transaction.jobAlertUnsubscribeToken.updateMany({
      where: { jobAlertId: token.jobAlertId, usedAt: null },
      data: { usedAt: now },
    });
    if (token.alertStatus !== "UNSUBSCRIBED") {
      await transaction.jobAlert.update({
        where: { id: token.jobAlertId },
        data: { status: "UNSUBSCRIBED", updatedAt: now },
      });
      await transaction.jobAlertEvent.create({
        data: {
          jobAlertId: token.jobAlertId,
          kind: "UNSUBSCRIBED",
          actorUserId: null,
          reasonCode: "ONE_CLICK_TOKEN",
          createdAt: now,
        },
      });
    }
  }, transactionOptions());
  return genericUnsubscribeResult();
}

function genericUnsubscribeResult() {
  return Object.freeze({
    ok: true as const,
    message:
      "Falls der Abmeldelink gültig war, wurde dieses Jobabo pausiert. Es wurden keine Kontodaten offengelegt.",
  });
}

async function transitionOwnedAlert(
  jobAlertIdInput: string,
  command: "pause" | "resume",
  options: MutationOptions,
) {
  const jobAlertId = parseAlertId(jobAlertIdInput);
  const actorUserId = parseActor(options.actorUserId);
  const now = options.now ?? new Date();
  const database = options.database ?? getDatabase();
  assertDate(now);
  return database.$transaction(async (transaction) => {
    const alert = await lockOwnedAlert(transaction, jobAlertId, actorUserId);
    if (alert.status === "DELETED") throw new JobAlertActionError("NOT_FOUND");
    if (command === "pause") {
      if (alert.status !== "ACTIVE") {
        return Object.freeze({
          id: alert.id,
          status: alert.status,
          changed: false,
        });
      }
      await transaction.jobAlert.update({
        where: { id: alert.id },
        data: { status: "PAUSED", updatedAt: now },
      });
      await transaction.jobAlertEvent.create({
        data: {
          jobAlertId: alert.id,
          kind: "PAUSED",
          actorUserId,
          reasonCode: "EXPLICIT_ALERT_ACTION",
          createdAt: now,
        },
      });
      return Object.freeze({
        id: alert.id,
        status: "PAUSED" as const,
        changed: true,
      });
    }
    if (alert.status === "ACTIVE") {
      return Object.freeze({
        id: alert.id,
        status: alert.status,
        changed: false,
      });
    }
    const consent = await latestDeliveryConsent(transaction, actorUserId, now);
    if (!isCurrentDeliveryConsent(consent)) {
      throw new JobAlertActionError("CONSENT_REQUIRED");
    }
    const hasPendingDigest = await hasDigestAtScheduledTime(
      transaction,
      alert.id,
      alert.nextDueAt,
    );
    await transaction.jobAlert.update({
      where: { id: alert.id },
      data: {
        status: "ACTIVE",
        nextDueAt: hasPendingDigest
          ? alert.nextDueAt
          : firstJobAlertDueAt(now, alert.frequency),
        updatedAt: now,
      },
    });
    await transaction.jobAlertEvent.create({
      data: {
        jobAlertId: alert.id,
        kind: "RESUMED",
        actorUserId,
        reasonCode: "EXPLICIT_ALERT_ACTION",
        createdAt: now,
      },
    });
    await recordJobAlertActivatedOnce(transaction, {
      actorProvenance: alert.actorProvenance,
      alertFrequency: alert.frequency,
      jobAlertId: alert.id,
      occurredAt: now,
    });
    return Object.freeze({
      id: alert.id,
      status: "ACTIVE" as const,
      changed: true,
    });
  }, transactionOptions());
}

async function lockCandidateProfile(
  transaction: Prisma.TransactionClient,
  actorUserId: string,
) {
  const rows = await transaction.$queryRaw<
    Array<{ id: string; actorProvenance: DataProvenance }>
  >`
    SELECT profile."id", actor."dataProvenance" AS "actorProvenance"
    FROM "CandidateProfile" AS profile
    INNER JOIN "User" AS actor
      ON actor."id" = profile."userId"
    WHERE profile."userId" = ${actorUserId}::uuid
    FOR UPDATE OF profile
  `;
  const row = rows[0];
  if (row === undefined) throw new JobAlertActionError("NOT_FOUND");
  return row;
}

async function lockOwnedAlert(
  transaction: Prisma.TransactionClient,
  jobAlertId: string,
  actorUserId: string,
) {
  const rows = await transaction.$queryRaw<
    Array<{
      id: string;
      status: JobAlertStatus;
      frequency: AlertFrequency;
      nextDueAt: Date;
      actorProvenance: DataProvenance;
    }>
  >`
    SELECT
      alert."id",
      alert."status",
      alert."frequency",
      alert."nextDueAt",
      actor."dataProvenance" AS "actorProvenance"
    FROM "JobAlert" AS alert
    INNER JOIN "CandidateProfile" AS profile
      ON profile."id" = alert."candidateProfileId"
    INNER JOIN "User" AS actor
      ON actor."id" = profile."userId"
    WHERE alert."id" = ${jobAlertId}::uuid
      AND profile."userId" = ${actorUserId}::uuid
    FOR UPDATE OF alert
  `;
  const row = rows[0];
  if (row === undefined) throw new JobAlertActionError("NOT_FOUND");
  return row;
}

async function hasDigestAtScheduledTime(
  transaction: Prisma.TransactionClient,
  jobAlertId: string,
  scheduledFor: Date,
) {
  const digest = await transaction.jobAlertDigest.findUnique({
    where: {
      jobAlertId_scheduledFor: { jobAlertId, scheduledFor },
    },
    select: { id: true },
  });
  return digest !== null;
}

async function recordJobAlertActivatedOnce(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    actorProvenance: DataProvenance;
    alertFrequency: AlertFrequency;
    jobAlertId: string;
    occurredAt: Date;
  }>,
): Promise<void> {
  await trackAnalyticsEventV1(
    {
      kind: "JOB_ALERT_ACTIVATED",
      schemaVersion: "1",
      producerEventId: `JOB_ALERT_ACTIVATED:${input.jobAlertId}`,
      occurredAt: input.occurredAt,
      properties: {
        onboardingRuleVersion: CANDIDATE_ONBOARDING_RULE_V1.version,
        alertFrequency: input.alertFrequency,
      },
    },
    {
      producer: JOB_ALERT_ANALYTICS_PRODUCER,
      productAnalyticsEnabled: false,
      provenance: { actor: input.actorProvenance },
    },
    {
      async create(record) {
        const result = await transaction.analyticsEvent.createMany({
          data: [record],
          skipDuplicates: true,
        });
        return result.count === 0 ? "DUPLICATE" : "CREATED";
      },
      async expire(retainUntilInclusive) {
        const result = await transaction.analyticsEvent.deleteMany({
          where: { retainUntil: { lte: retainUntilInclusive } },
        });
        return result.count;
      },
    },
  );
}

async function assertQueryReferences(
  transaction: Prisma.TransactionClient,
  query: JobAlertQuery,
) {
  const [canton, category, city] = await Promise.all([
    query.cantonId === null
      ? null
      : transaction.canton.findFirst({
          where: { id: query.cantonId, isActive: true },
          select: { id: true },
        }),
    query.categoryId === null
      ? null
      : transaction.category.findFirst({
          where: { id: query.categoryId, isActive: true },
          select: { id: true },
        }),
    query.cityId === null
      ? null
      : transaction.city.findFirst({
          where: { id: query.cityId, cantonId: query.cantonId ?? undefined, isActive: true, canton: { isActive: true } },
          select: { id: true },
        }),
  ]);
  if (
    (query.cantonId !== null && canton === null) ||
    (query.categoryId !== null && category === null) ||
    (query.cityId !== null && city === null)
  ) {
    throw new JobAlertActionError("REFERENCE_INVALID");
  }
}

type ConsentDatabase = Pick<Prisma.TransactionClient, "userConsentEvent">;

async function latestDeliveryConsent(
  database: ConsentDatabase,
  userId: string,
  at: Date,
) {
  return database.userConsentEvent.findFirst({
    where: {
      userId,
      kind: "JOB_ALERT_DELIVERY",
      effectiveAt: { lte: at },
    },
    orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
    select: { granted: true, noticeVersion: true, noticeHash: true },
  });
}

function isCurrentDeliveryConsent(
  consent: Readonly<{
    granted: boolean;
    noticeVersion: string;
    noticeHash: string;
  }> | null,
) {
  const expected = USER_CONSENT_NOTICES_V1.JOB_ALERT_DELIVERY.noticeVersion;
  const expectedHash = jobAlertConsentNoticeHash();
  return (
    consent?.granted === true &&
    consent.noticeVersion === expected &&
    timingSafeEqual(
      Buffer.from(consent.noticeVersion),
      Buffer.from(expected),
    ) &&
    consent.noticeHash.length === expectedHash.length &&
    timingSafeEqual(Buffer.from(consent.noticeHash), Buffer.from(expectedHash))
  );
}

async function appendDeliveryConsent(
  transaction: Prisma.TransactionClient,
  userId: string,
  granted: boolean,
  now: Date,
  correlationId: string = randomUUID(),
) {
  const notice = USER_CONSENT_NOTICES_V1.JOB_ALERT_DELIVERY;
  if (
    notice.noticeVersion !== JOB_ALERT_DELIVERY_NOTICE_V1.version ||
    notice.purpose !== JOB_ALERT_DELIVERY_NOTICE_V1.purpose
  ) {
    throw new JobAlertPolicyError("consent_notice_drift");
  }
  const latestRecordedConsent = await transaction.userConsentEvent.findFirst({
    where: { userId, kind: "JOB_ALERT_DELIVERY" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const createdAt = nextConsentCreatedAt(
    latestRecordedConsent?.createdAt ?? null,
    now,
  );
  await transaction.userConsentEvent.create({
    data: {
      userId,
      kind: "JOB_ALERT_DELIVERY",
      granted,
      purpose: notice.purpose,
      noticeVersion: notice.noticeVersion,
      noticeHash: jobAlertConsentNoticeHash(),
      actorUserId: userId,
      effectiveAt: now,
      createdAt,
    },
  });
  await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
    action: "USER_CONSENT_CHANGED",
    actorKind: "USER",
    actorUserId: userId,
    capability: "JOB_ALERT_DELIVERY_CONSENT",
    correlationId,
    reasonCode: granted
      ? "JOB_ALERT_DELIVERY_GRANTED"
      : "JOB_ALERT_DELIVERY_REVOKED",
    result: "SUCCEEDED",
    retainUntil: new Date(
      now.getTime() + JOB_ALERT_CONSENT_AUDIT_RETENTION_DAYS * DAY_MILLISECONDS,
    ),
    targetId: userId,
    targetType: "USER",
  });
}

async function resolveStoredQuery(
  transaction: Prisma.TransactionClient,
  storedValue: unknown,
): Promise<JobAlertQuery | null> {
  const parsed = parseStoredJobAlertQuery(storedValue);
  if (parsed.kind === "v1") return parsed.query;
  if (parsed.kind === "invalid") return null;
  const [category, canton] = await Promise.all([
    parsed.query.categorySlug === null
      ? null
      : transaction.category.findFirst({
          where: { slug: parsed.query.categorySlug, isActive: true },
          select: { id: true },
        }),
    parsed.query.cantonCode === null
      ? null
      : transaction.canton.findFirst({
          where: { code: parsed.query.cantonCode, isActive: true },
          select: { id: true },
        }),
  ]);
  if (
    (parsed.query.categorySlug !== null && category === null) ||
    (parsed.query.cantonCode !== null && canton === null)
  ) {
    return null;
  }
  return Object.freeze({
    ...defaultJobAlertQuery(),
    categoryId: category?.id ?? null,
    cantonId: canton?.id ?? null,
  });
}

async function findDigestJobs(
  transaction: Prisma.TransactionClient,
  alertId: string,
  query: JobAlertQuery,
  window: Readonly<{ start: Date; end: Date }>,
  now: Date,
  environment: PublicEligibilityEnvironment,
) {
  const location = await loadQueryLocation(transaction, query);
  return scanJobAlertDigestMatches({
    pageSize: MATCH_SCAN_PAGE_SIZE,
    maximumMatches: JOB_ALERT_POLICY_V1.maximumDigestJobs,
    loadPage: (cursor, take) =>
      transaction.job.findMany({
        where: buildDigestCandidateWhere(
          alertId,
          query,
          window,
          location !== null,
        ),
        orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
        take,
        ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
        select: {
          id: true,
          publishedAt: true,
          publishedCity: {
            select: { latitude: true, longitude: true },
          },
        },
      }),
    cursorOf: (candidate) => candidate.id,
    evaluatePage: async (candidates) => {
      const radiusMatches = candidates.filter((candidate) =>
        matchesLocationRadius(
          candidate.publishedCity,
          location,
          query.radiusKm,
        ),
      );
      const eligibleJobs = await filterPubliclyEligibleJobsInTransaction(
        radiusMatches.map((candidate) => candidate.id),
        now,
        environment,
        transaction,
      );
      return Object.freeze(
        eligibleJobs.map((job) =>
          Object.freeze({ id: job.id, publishedAt: job.publishedAt }),
        ),
      );
    },
  });
}

function buildDigestCandidateWhere(
  alertId: string,
  query: JobAlertQuery,
  window: Readonly<{ start: Date; end: Date }>,
  hasRadiusLocation: boolean,
): Prisma.JobWhereInput {
  const revisionFilters: Prisma.JobRevisionWhereInput = {
    workloadMax: { gte: query.workloadMin },
    workloadMin: { lte: query.workloadMax },
    ...(query.remotePreference === "ANY"
      ? {}
      : { remoteType: query.remotePreference as RemoteType }),
    ...(query.keyword === ""
      ? {}
      : {
          OR: [
            { title: { contains: query.keyword, mode: "insensitive" } },
            { description: { contains: query.keyword, mode: "insensitive" } },
          ],
        }),
  };
  return {
    publishedAt: { gt: window.start, lte: window.end },
    alertDigestItems: { none: { jobAlertId: alertId } },
    ...(query.categoryId === null
      ? {}
      : { publishedCategoryId: query.categoryId }),
    ...(query.cityId !== null && (query.radiusKm === 0 || !hasRadiusLocation)
      ? { publishedCityId: query.cityId }
      : query.cantonId !== null && !hasRadiusLocation
        ? { publishedCantonId: query.cantonId }
        : {}),
    ...(query.salaryTransparentOnly
      ? {
          publishedSalaryMin: { not: null },
          publishedSalaryMax: { not: null },
          publishedSalaryPeriod: { not: null },
        }
      : {}),
    publishedRevision: { is: revisionFilters },
  };
}

async function loadQueryLocation(
  transaction: Prisma.TransactionClient,
  query: JobAlertQuery,
) {
  if (query.cityId === null || query.radiusKm <= 0) return null;
  const city = await transaction.city.findFirst({
    where: { id: query.cityId, isActive: true, canton: { isActive: true } },
    select: { latitude: true, longitude: true },
  });
  if (city?.latitude === null || city?.longitude === null || city === null)
    return null;
  return Object.freeze({
    latitude: Number(city.latitude),
    longitude: Number(city.longitude),
  });
}

function matchesLocationRadius(
  city: Readonly<{
    latitude: { toString(): string } | null;
    longitude: { toString(): string } | null;
  }> | null,
  origin: Readonly<{ latitude: number; longitude: number }> | null,
  radiusKm: number,
) {
  if (origin === null || radiusKm <= 0) return true;
  if (city?.latitude === null || city?.longitude === null || city === null)
    return false;
  return (
    distanceInKilometres(origin, {
      latitude: Number(city.latitude),
      longitude: Number(city.longitude),
    }) <= radiusKm
  );
}

function createTransactionEmailLogRepository(
  transaction: Prisma.TransactionClient,
): EmailLogRepository {
  return Object.freeze({
    record: async (input: Parameters<EmailLogRepository["record"]>[0]) => {
      const data = {
        ...(input.id === undefined ? {} : { id: input.id }),
        recipient: input.recipient,
        purpose: input.purpose,
        templateKey: input.templateKey,
        payload: input.payload as Prisma.InputJsonObject,
        status: input.status,
        providerReference: input.providerReference,
      };
      if (input.id === undefined) {
        const row = await transaction.emailLog.create({
          data,
          select: { id: true },
        });
        return Object.freeze({ id: row.id, created: true });
      }
      const row = await transaction.emailLog.upsert({
        where: { id: input.id },
        create: data,
        update: {},
        select: {
          id: true,
          recipient: true,
          templateKey: true,
          providerReference: true,
        },
      });
      if (
        row.recipient !== input.recipient ||
        row.templateKey !== input.templateKey ||
        row.providerReference !== input.providerReference
      ) {
        throw new EmailLogIdempotencyConflictError();
      }
      return Object.freeze({ id: row.id, created: false });
    },
  });
}

function jobAlertDisplayName(query: JobAlertQuery) {
  return query.keyword || "Dein Jobabo";
}

function parseActor(value: string) {
  const parsed = candidateActorSchema.safeParse(value);
  if (!parsed.success) throw new JobAlertActionError("INVALID_INPUT");
  return parsed.data;
}

function parseAlertId(value: string) {
  const parsed = jobAlertIdSchema.safeParse(value);
  if (!parsed.success) throw new JobAlertActionError("NOT_FOUND");
  return parsed.data;
}

function parseCommand(value: unknown): JobAlertCommand {
  const parsed = jobAlertCommandSchema.safeParse(value);
  if (!parsed.success) throw new JobAlertActionError("INVALID_INPUT");
  return parsed.data;
}

function toJsonObject(query: JobAlertQuery) {
  return JSON.parse(JSON.stringify(query)) as Prisma.InputJsonObject;
}

function normalizeAppUrl(value: string) {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new JobAlertPolicyError("app_url_invalid");
  }
  return url.origin;
}

function transactionOptions() {
  return Object.freeze({
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5_000,
    timeout: 20_000,
  });
}

function assertDate(value: Date) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new JobAlertActionError("INVALID_INPUT");
  }
}

function nextConsentCreatedAt(previous: Date | null, requested: Date): Date {
  return new Date(
    Math.max(requested.getTime(), (previous?.getTime() ?? -1) + 1),
  );
}
