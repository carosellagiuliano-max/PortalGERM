import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { syncBoostStatusProjection } from "@/lib/billing/boosts";
import { projectCreditExpiries } from "@/lib/billing/credits";
import { projectSubscriptionBoundaries } from "@/lib/billing/subscriptions";
import { projectPaymentInboxEvent } from "@/lib/billing/payment-inbox";
import {
  reconcilePersistedPayments,
  reconcilePersistedSubscriptionProviderInvoices,
} from "@/lib/billing/finance-reconciliation";
import { projectDueDunningCases } from "@/lib/billing/dunning";
import { projectApprovedServiceRecoveries } from "@/lib/billing/service-delivery-policy";
import {
  runJobAlertDigestDelivery,
  runJobAlertDigestMock,
} from "@/lib/candidate/job-alerts";
import { projectCompanyTrustLifecycle } from "@/lib/companies/verification/lifecycle";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import {
  documentObjectStoreActivationBinding,
  documentScannerActivationBinding,
} from "@/lib/documents/provider-activation-binding";
import { reconcileDocumentObjects } from "@/lib/documents/reconciliation";
import { scanDocumentVersion } from "@/lib/documents/vault-service";
import { expireDueCompanyInvitations } from "@/lib/employer/team";
import { syncJobStatusProjection } from "@/lib/jobs/effective-status";
import { projectJobFreshness } from "@/lib/jobs/freshness";
import { dispatchNotificationBatch } from "@/lib/notifications/dispatcher";
import { maintainNotificationPrivacyRetention } from "@/lib/notifications/retention";
import { resolvePersistedProviderActivation } from "@/lib/ops/operations-ledger";
import {
  startHeartbeatLoop,
  type HeartbeatLoop,
} from "@/lib/ops/heartbeat-loop";
import { projectExpiredSecurityState } from "@/lib/security/security-expiry";
import { executeApprovedPrivacyWorkItem } from "@/lib/privacy/execution-approval";
import { measureAndPersistSitemapCapacity } from "@/lib/seo/sitemap-capacity-monitor";
import {
  completeWorkItem,
  failWorkItem,
  heartbeatWorkLease,
  recordFencedEffectReceipt,
  type ClaimedWorkItem,
  type WorkLeaseIdentity,
} from "@/lib/ops/worker-runtime";
import { createEmailDeliveryProvider } from "@/lib/providers/email/delivery-composition";
import { emailProvider } from "@/lib/providers/email";
import { emailProviderActivationBinding } from "@/lib/providers/email/provider-activation-binding";
import { projectResendEventInbox } from "@/lib/providers/email/resend-event-inbox";
import { paymentProviderActivationBinding } from "@/lib/providers/payments/provider-activation-binding";
import { createHostedPaymentProvider } from "@/lib/providers/payments/payment-composition";
import {
  createDocumentMalwareScanner,
  createDocumentObjectStore,
} from "@/lib/providers/storage/document-storage-composition";
import { expireDueContactRequests } from "@/lib/talentradar/contact-requests";
import { projectExpiredTrustCases } from "@/lib/trust-safety/case-service";
import { processRecruitingReminderExpiry } from "@/lib/recruiting/reminder-worker";
import { expireSearchLearningWorkingState } from "@/lib/search/learning";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const uuidSchema = z.uuid();

export type RegisteredHandlerExecutionResult = Readonly<{
  completion: "COMPLETED" | "LEASE_LOST" | "RETRY" | "DEAD_LETTER" | "PAUSED";
  handlerKey: string;
  workItemId: string;
}>;

export async function executeRegisteredHandler(
  claimed: ClaimedWorkItem,
  dependencies: Readonly<{
    database: DatabaseClient;
    environment: ServerEnvironment;
    identity: WorkLeaseIdentity;
    heartbeatMilliseconds?: number;
    leaseMilliseconds: number;
    now: () => Date;
  }>,
): Promise<RegisteredHandlerExecutionResult> {
  let heartbeatLoop: HeartbeatLoop | null = null;
  try {
    const heartbeat = await heartbeatWorkLease(
      dependencies.database,
      dependencies.identity,
      {
        leaseMilliseconds: dependencies.leaseMilliseconds,
        now: dependencies.now(),
      },
    );
    if (!heartbeat.extended) {
      return result(claimed, "LEASE_LOST");
    }
    heartbeatLoop = startHeartbeatLoop({
      heartbeat: async () =>
        (
          await heartbeatWorkLease(
            dependencies.database,
            dependencies.identity,
            {
              leaseMilliseconds: dependencies.leaseMilliseconds,
              now: dependencies.now(),
            },
          )
        ).extended,
      intervalMilliseconds:
        dependencies.heartbeatMilliseconds ??
        Math.min(20_000, Math.floor(dependencies.leaseMilliseconds / 3)),
    });

    const existingReceipt =
      await dependencies.database.workEffectReceipt.findUnique({
        where: { effectKey: claimed.effectKey },
        select: { effectDigest: true },
      });
    if (existingReceipt !== null) {
      await heartbeatLoop.stop();
      heartbeatLoop = null;
      const completion = await completeWorkItem(
        dependencies.database,
        dependencies.identity,
        {
          now: dependencies.now(),
          outcome: "EFFECT_ALREADY_APPLIED",
        },
      );
      return result(claimed, completion.status);
    }

    const effectDigest = await invokeHandler(claimed, dependencies);
    await heartbeatLoop.stop();
    heartbeatLoop = null;
    // A failed heartbeat can mean that the activation was revoked while the
    // handler was in flight. The external/database effect has already
    // returned at this point, so skipping its append-only receipt would make a
    // later takeover repeat an effect whose outcome is actually known. The
    // receipt writer preserves the original activation generation and accepts
    // only the still-owned fencing token; completion separately records
    // whether that generation remained current.
    const receipt = await recordFencedEffectReceipt(
      dependencies.database,
      dependencies.identity,
      {
        effectDigest,
        handlerKey: claimed.handlerKey,
        handlerVersion: claimed.handlerVersion,
        now: dependencies.now(),
      },
    );
    if (receipt.status === "LEASE_LOST") {
      return result(claimed, "LEASE_LOST");
    }
    const completion = await completeWorkItem(
      dependencies.database,
      dependencies.identity,
      {
        now: dependencies.now(),
        outcome:
          receipt.status === "ALREADY_APPLIED"
            ? "EFFECT_ALREADY_APPLIED"
            : "SUCCEEDED",
      },
    );
    return result(claimed, completion.status);
  } catch (error) {
    const heartbeatState = await heartbeatLoop?.stop();
    heartbeatLoop = null;
    if (heartbeatState !== undefined && !heartbeatState.healthy) {
      const drained = await failWorkItem(
        dependencies.database,
        dependencies.identity,
        {
          failure: {
            errorCode: "WORKER_LEASE_HEARTBEAT_LOST",
            explicitClass: "CONFIGURATION",
          },
          now: dependencies.now(),
        },
      );
      return result(claimed, drained.status);
    }
    const failure = handlerFailureDescriptor(error);
    const failed = await failWorkItem(
      dependencies.database,
      dependencies.identity,
      { failure, now: dependencies.now() },
    );
    return result(claimed, failed.status);
  } finally {
    await heartbeatLoop?.stop();
  }
}

async function invokeHandler(
  claimed: ClaimedWorkItem,
  dependencies: Readonly<{
    database: DatabaseClient;
    environment: ServerEnvironment;
    identity: WorkLeaseIdentity;
    now: () => Date;
  }>,
): Promise<string> {
  const now = dependencies.now();
  const correlationId = randomUUID();
  switch (claimed.handlerKey) {
    case "ops.diagnostic-effect": {
      const payload = z
        .strictObject({ effectDigest: sha256Schema })
        .parse(claimed.payloadReference);
      return payload.effectDigest;
    }
    case "notifications.dispatch": {
      const provider = createEmailDeliveryProvider(dependencies.environment);
      const summary = await dispatchNotificationBatch({
        database: dependencies.database,
        environment: dependencies.environment,
        provider,
        workerId: dependencies.identity.workerId,
        batchSize: 100,
        clock: dependencies.now,
      });
      if (summary.status !== "COMPLETED") {
        throw new HandlerFailure(
          "CONFIGURATION",
          "NOTIFICATION_DISPATCH_PAUSED",
        );
      }
      return digestSummary(summary);
    }
    case "notifications.provider-event-project": {
      const payload = z
        .strictObject({ emailProviderEventInboxId: uuidSchema })
        .parse(claimed.payloadReference);
      const inbox =
        await dependencies.database.emailProviderEventInbox.findUnique({
          where: { id: payload.emailProviderEventInboxId },
          select: {
            adapterKey: true,
            adapterVersion: true,
            environment: true,
            status: true,
          },
        });
      if (inbox === null) {
        throw new HandlerFailure(
          "PERMANENT_VALIDATION",
          "EMAIL_PROVIDER_EVENT_NOT_FOUND",
        );
      }
      const providerBinding = emailProviderActivationBinding(
        dependencies.environment,
        "email.delivery-events",
      );
      if (
        providerBinding === null ||
        providerBinding.adapterKey === "local_mock"
      ) {
        throw new HandlerFailure("CONFIGURATION", "PROVIDER_DISABLED");
      }
      if (
        inbox.environment !== dependencies.environment.APP_ENV ||
        inbox.adapterKey !== providerBinding.adapterKey ||
        inbox.adapterVersion !== providerBinding.adapterVersion
      ) {
        throw new HandlerFailure(
          "PERMANENT_VALIDATION",
          "EMAIL_PROVIDER_EVENT_BINDING_MISMATCH",
        );
      }
      if (inbox.status !== "RECEIVED") {
        return digestSummary({
          inboxId: payload.emailProviderEventInboxId,
          projectedSuppressions: 0,
          status: inbox.status,
        });
      }
      const providerActivationId = await requireProvider(dependencies, {
        ...providerBinding,
        now,
      });
      const projection = await projectResendEventInbox(
        {
          expectedAdapterKey: providerBinding.adapterKey,
          expectedEnvironment: dependencies.environment.APP_ENV,
          expectedProviderActivationId: providerActivationId,
          inboxId: payload.emailProviderEventInboxId,
          now,
        },
        dependencies.database,
      );
      if (projection.status === "RECEIVED") {
        throw new HandlerFailure("TRANSIENT", "EMAIL_PROVIDER_ATTEMPT_PENDING");
      }
      if (projection.status === "NOT_FOUND") {
        throw new HandlerFailure(
          "PERMANENT_VALIDATION",
          "EMAIL_PROVIDER_EVENT_NOT_FOUND",
        );
      }
      if (projection.status === "BINDING_MISMATCH") {
        throw new HandlerFailure(
          "CONFIGURATION",
          "EMAIL_PROVIDER_ACTIVATION_MISMATCH",
        );
      }
      return digestSummary({
        inboxId: payload.emailProviderEventInboxId,
        ...projection,
      });
    }
    case "notifications.retention":
      return digestSummary(
        await maintainNotificationPrivacyRetention(dependencies.database, now),
      );
    case "candidate.job-alert-digest": {
      const providerBinding = emailProviderActivationBinding(
        dependencies.environment,
        "email.job-alert",
      );
      if (providerBinding === null) {
        throw new HandlerFailure("CONFIGURATION", "PROVIDER_DISABLED");
      }
      await requireProvider(dependencies, {
        ...providerBinding,
        now,
      });
      if (dependencies.environment.EMAIL_PROVIDER_MODE === "local_mock") {
        if (
          dependencies.environment.APP_ENV !== "local" &&
          dependencies.environment.APP_ENV !== "ci"
        ) {
          throw new HandlerFailure(
            "CONFIGURATION",
            "JOB_ALERT_LOCAL_MOCK_ENVIRONMENT_FORBIDDEN",
          );
        }
        return digestSummary(
          await runJobAlertDigestMock({
            database: dependencies.database,
            now,
          }),
        );
      }
      return digestSummary(
        await runJobAlertDigestDelivery({
          database: dependencies.database,
          environment: dependencies.environment,
          now,
        }),
      );
    }
    case "privacy.export":
    case "privacy.correction":
    case "privacy.erasure": {
      const payload = z
        .strictObject({ approvalId: z.uuid() })
        .parse(claimed.payloadReference);
      const outcome = await executeApprovedPrivacyWorkItem(payload, {
        database: dependencies.database,
        environment: dependencies.environment,
        handlerKey: claimed.handlerKey,
        now,
      });
      if (!outcome.ok) {
        throw new HandlerFailure(outcome.failureClass, outcome.code);
      }
      return outcome.effectDigest;
    }
    case "jobs.expiry-projection":
      return digestSummary(
        await syncJobStatusProjection({
          database: dependencies.database,
          correlationId,
          now,
        }),
      );
    case "jobs.freshness":
      return digestSummary(
        await projectJobFreshness({
          database: dependencies.database,
          correlationId,
          now,
        }),
      );
    case "seo.sitemap-capacity":
      return digestSummary(
        await measureAndPersistSitemapCapacity({
          database: dependencies.database,
          origin: dependencies.environment.APP_URL,
          now,
        }),
      );
    case "search.learning-expiry":
      return digestSummary(
        await expireSearchLearningWorkingState(dependencies.database, now),
      );
    case "employer.invitation-expiry":
      return digestSummary(
        await expireDueCompanyInvitations({
          database: dependencies.database,
          correlationId,
          now,
        }),
      );
    case "billing.boost-projection":
      return digestSummary(
        await syncBoostStatusProjection({
          database: dependencies.database,
          correlationId,
          now,
        }),
      );
    case "billing.credit-expiry":
      return digestSummary(
        await projectCreditExpiries({
          database: dependencies.database,
          correlationId,
          now,
        }),
      );
    case "billing.subscription-boundary":
      return digestSummary(
        await projectSubscriptionBoundaries({
          database: dependencies.database,
          correlationId,
          now,
        }),
      );
    case "payments.inbox-project": {
      const providerBinding = paymentProviderActivationBinding(
        dependencies.environment,
      );
      if (providerBinding === null) {
        throw new HandlerFailure("CONFIGURATION", "PROVIDER_DISABLED");
      }
      await requireProvider(dependencies, {
        ...providerBinding,
        now,
      });
      if (!dependencies.environment.REAL_PAYMENT_PROJECTION) {
        throw new HandlerFailure(
          "CONFIGURATION",
          "REAL_PAYMENT_PROJECTION_DISABLED",
        );
      }
      const payload = z
        .strictObject({ providerEventInboxId: uuidSchema })
        .parse(claimed.payloadReference);
      return digestSummary(
        await projectPaymentInboxEvent(
          {
            correlationId,
            inboxId: payload.providerEventInboxId,
            now,
          },
          {
            database: dependencies.database,
            emailProvider,
            paymentProvider: createHostedPaymentProvider(
              dependencies.environment,
            ),
          },
        ),
      );
    }
    case "payments.reconcile": {
      const providerBinding = paymentProviderActivationBinding(
        dependencies.environment,
      );
      if (providerBinding === null) {
        throw new HandlerFailure("CONFIGURATION", "PROVIDER_DISABLED");
      }
      await requireProvider(dependencies, {
        ...providerBinding,
        now,
      });
      if (!dependencies.environment.REAL_PAYMENT_INGESTION) {
        throw new HandlerFailure(
          "CONFIGURATION",
          "REAL_PAYMENT_INGESTION_DISABLED",
        );
      }
      let cursor: string | null = null;
      let matched = 0;
      let mismatched = 0;
      let processed = 0;
      let pages = 0;
      do {
        const page = await reconcilePersistedPayments(
          {
            batchSize: 100,
            correlationId,
            cursor,
            environment: dependencies.environment.APP_ENV,
            now,
          },
          dependencies.database,
        );
        matched += page.matched;
        mismatched += page.mismatched;
        processed += page.processed;
        pages += 1;
        if (
          pages > 1_000 ||
          (page.nextCursor !== null && page.nextCursor === cursor)
        ) {
          throw new HandlerFailure(
            "PERMANENT_VALIDATION",
            "PAYMENT_RECONCILIATION_CURSOR_STALLED",
          );
        }
        cursor = page.nextCursor;
      } while (cursor !== null);
      cursor = null;
      do {
        const page = await reconcilePersistedSubscriptionProviderInvoices(
          {
            batchSize: 100,
            correlationId,
            cursor,
            environment: dependencies.environment.APP_ENV,
            now,
          },
          dependencies.database,
        );
        matched += page.matched;
        mismatched += page.mismatched;
        processed += page.processed;
        pages += 1;
        if (
          pages > 1_000 ||
          (page.nextCursor !== null && page.nextCursor === cursor)
        ) {
          throw new HandlerFailure(
            "PERMANENT_VALIDATION",
            "PAYMENT_RECONCILIATION_CURSOR_STALLED",
          );
        }
        cursor = page.nextCursor;
      } while (cursor !== null);
      return digestSummary({ matched, mismatched, pages, processed });
    }
    case "payments.dunning": {
      return digestSummary(
        await projectDueDunningCases({
          correlationId,
          database: dependencies.database,
          enabled: dependencies.environment.REAL_PAYMENT_PROJECTION,
          now,
        }),
      );
    }
    case "payments.service-recovery": {
      return digestSummary(
        await projectApprovedServiceRecoveries({
          correlationId,
          database: dependencies.database,
          enabled: dependencies.environment.PAID_SERVICE_RECOVERY,
          now,
        }),
      );
    }
    case "security.expiry-projection":
      return digestSummary(
        await projectExpiredSecurityState(dependencies.database, {
          correlationId,
          now,
        }),
      );
    case "trust.case-expiry":
      return digestSummary(
        await projectExpiredTrustCases(dependencies.database, now),
      );
    case "company-trust.expiry-review":
      return digestSummary(
        await projectCompanyTrustLifecycle({
          database: dependencies.database,
          correlationId,
          now,
        }),
      );
    case "recruiting.reminder-expiry":
      return digestSummary(
        await processRecruitingReminderExpiry({
          database: dependencies.database,
          environment: dependencies.environment,
          now,
        }),
      );
    case "radar.contact-expiry":
      return digestSummary(
        await expireDueContactRequests({
          database: dependencies.database,
          correlationId,
          now,
        }),
      );
    case "documents.scan": {
      const objectStoreBinding = documentObjectStoreActivationBinding(
        dependencies.environment,
      );
      if (objectStoreBinding === null) {
        throw new HandlerFailure("CONFIGURATION", "PROVIDER_DISABLED");
      }
      await requireProvider(dependencies, {
        adapterKey: objectStoreBinding.adapterKey,
        expectedConfigurationDigest:
          objectStoreBinding.expectedConfigurationDigest,
        expectedMode: objectStoreBinding.expectedMode,
        ...(objectStoreBinding.expectedSecretVersionRef === undefined
          ? {}
          : {
              expectedSecretVersionRef:
                objectStoreBinding.expectedSecretVersionRef,
            }),
        useCase: "documents.object-store",
        now,
      });
      const scannerBinding = documentScannerActivationBinding(
        dependencies.environment,
      );
      if (scannerBinding === null) {
        throw new HandlerFailure("CONFIGURATION", "PROVIDER_DISABLED");
      }
      await requireProvider(dependencies, {
        adapterKey: scannerBinding.adapterKey,
        expectedConfigurationDigest: scannerBinding.expectedConfigurationDigest,
        expectedMode: scannerBinding.expectedMode,
        ...(scannerBinding.expectedSecretVersionRef === undefined
          ? {}
          : {
              expectedSecretVersionRef: scannerBinding.expectedSecretVersionRef,
            }),
        useCase: "documents.malware-scan",
        now,
      });
      const payload = z
        .strictObject({ documentVersionId: uuidSchema })
        .parse(claimed.payloadReference);
      const version = await dependencies.database.documentVersion.findUnique({
        where: { id: payload.documentVersionId },
        select: {
          candidateProfile: { select: { userId: true } },
          company: {
            select: {
              memberships: {
                where: {
                  status: "ACTIVE",
                  removedAt: null,
                  role: { in: ["OWNER", "ADMIN"] },
                  user: { status: "ACTIVE" },
                },
                orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
                take: 1,
                select: { userId: true },
              },
            },
          },
        },
      });
      if (version === null) {
        throw new HandlerFailure(
          "PERMANENT_VALIDATION",
          "DOCUMENT_VERSION_NOT_FOUND",
        );
      }
      const scanActorUserId =
        version.candidateProfile?.userId ??
        version.company?.memberships[0]?.userId;
      if (scanActorUserId === undefined) {
        throw new HandlerFailure(
          "PERMANENT_VALIDATION",
          "DOCUMENT_SUBJECT_OWNER_NOT_FOUND",
        );
      }
      const summary = await scanDocumentVersion(
        {
          actorUserId: scanActorUserId,
          documentVersionId: payload.documentVersionId,
          correlationId,
        },
        {
          database: dependencies.database,
          environment: dependencies.environment,
          objectStore: createDocumentObjectStore(dependencies.environment),
          scanner: createDocumentMalwareScanner(dependencies.environment),
        },
      );
      if (!summary.ok) {
        throw new HandlerFailure(
          summary.code === "PROVIDER_DEGRADED"
            ? "TRANSIENT"
            : summary.code === "DOCUMENT_VAULT_UNAVAILABLE"
              ? "CONFIGURATION"
              : "PERMANENT_VALIDATION",
          summary.code,
        );
      }
      if (summary.status === "SCAN_FAILED") {
        throw new HandlerFailure("TRANSIENT", "DOCUMENT_SCAN_FAILED");
      }
      return digestSummary(summary);
    }
    case "documents.reconcile": {
      const objectStoreBinding = documentObjectStoreActivationBinding(
        dependencies.environment,
      );
      if (objectStoreBinding === null) {
        throw new HandlerFailure("CONFIGURATION", "PROVIDER_DISABLED");
      }
      await requireProvider(dependencies, {
        adapterKey: objectStoreBinding.adapterKey,
        expectedConfigurationDigest:
          objectStoreBinding.expectedConfigurationDigest,
        expectedMode: objectStoreBinding.expectedMode,
        ...(objectStoreBinding.expectedSecretVersionRef === undefined
          ? {}
          : {
              expectedSecretVersionRef:
                objectStoreBinding.expectedSecretVersionRef,
            }),
        useCase: "documents.object-store",
        now,
      });
      const summary = await reconcileDocumentObjects(
        { mode: "command", correlationId, now },
        {
          database: dependencies.database,
          environment: dependencies.environment,
          objectStore: createDocumentObjectStore(dependencies.environment),
        },
      );
      if (!summary.ok) {
        throw new HandlerFailure(
          summary.code === "PROVIDER_DEGRADED" ? "TRANSIENT" : "CONFIGURATION",
          summary.code,
        );
      }
      return digestSummary(summary);
    }
    default:
      throw new HandlerFailure(
        "PERMANENT_VALIDATION",
        "HANDLER_NOT_REGISTERED",
      );
  }
}

async function requireProvider(
  dependencies: Readonly<{
    database: DatabaseClient;
    environment: ServerEnvironment;
  }>,
  input: Readonly<{
    adapterKey: string;
    expectedConfigurationDigest?: string;
    expectedMode?: "SANDBOX" | "ALLOWLIST" | "LIVE";
    expectedSecretVersionRef?: string;
    now: Date;
    useCase: string;
  }>,
) {
  if (input.adapterKey === "disabled") {
    throw new HandlerFailure("CONFIGURATION", "PROVIDER_DISABLED");
  }
  const decision = await resolvePersistedProviderActivation(
    dependencies.database,
    {
      adapterKey: input.adapterKey,
      adapterVersion: "v1",
      environment: dependencies.environment.APP_ENV,
      ...(input.expectedConfigurationDigest === undefined
        ? {}
        : {
            expectedConfigurationDigest: input.expectedConfigurationDigest,
          }),
      ...(input.expectedMode === undefined
        ? {}
        : { expectedMode: input.expectedMode }),
      ...(input.expectedSecretVersionRef === undefined
        ? {}
        : { expectedSecretVersionRef: input.expectedSecretVersionRef }),
      now: input.now,
      useCase: input.useCase,
    },
  );
  if (!decision.active) {
    throw new HandlerFailure(
      decision.reason === "UNHEALTHY" || decision.reason === "STALE_HEALTH"
        ? "TRANSIENT"
        : "CONFIGURATION",
      `PROVIDER_${decision.reason}`,
    );
  }
  return decision.activationId;
}

class HandlerFailure extends Error {
  readonly failureClass:
    | "TRANSIENT"
    | "RATE_LIMITED"
    | "TIMEOUT"
    | "PERMANENT_VALIDATION"
    | "PERMANENT_CLIENT"
    | "CONFIGURATION"
    | "UNKNOWN";
  readonly code: string;

  constructor(failureClass: HandlerFailure["failureClass"], code: string) {
    super(code);
    this.name = "HandlerFailure";
    this.failureClass = failureClass;
    this.code = normalizeErrorCode(code);
  }
}

function handlerFailureDescriptor(error: unknown) {
  if (error instanceof HandlerFailure) {
    return Object.freeze({
      errorCode: error.code,
      explicitClass: error.failureClass,
    });
  }
  if (error instanceof z.ZodError) {
    return Object.freeze({
      errorCode: "PAYLOAD_VALIDATION_FAILED",
      explicitClass: "PERMANENT_VALIDATION" as const,
    });
  }
  return Object.freeze({
    errorCode: "HANDLER_UNKNOWN_FAILURE",
    explicitClass: "UNKNOWN" as const,
  });
}

function normalizeErrorCode(value: string) {
  const normalized = value
    .toUpperCase()
    .replaceAll(/[^A-Z0-9_:-]/gu, "_")
    .slice(0, 64);
  return /^[A-Z0-9][A-Z0-9_:-]{1,63}$/u.test(normalized)
    ? normalized
    : "HANDLER_FAILURE";
}

function digestSummary(value: unknown) {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function canonicalJson(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function result(
  claimed: ClaimedWorkItem,
  completion: RegisteredHandlerExecutionResult["completion"],
): RegisteredHandlerExecutionResult {
  return Object.freeze({
    completion,
    handlerKey: claimed.handlerKey,
    workItemId: claimed.id,
  });
}
