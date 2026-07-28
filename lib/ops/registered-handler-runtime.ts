import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { syncBoostStatusProjection } from "@/lib/billing/boosts";
import { projectCreditExpiries } from "@/lib/billing/credits";
import { projectSubscriptionBoundaries } from "@/lib/billing/subscriptions";
import { projectPaymentInboxEvent } from "@/lib/billing/payment-inbox";
import { reconcilePersistedPayments } from "@/lib/billing/finance-reconciliation";
import { projectDueDunningCases } from "@/lib/billing/dunning";
import { projectApprovedServiceRecoveries } from "@/lib/billing/service-delivery-policy";
import { runJobAlertDigestMock } from "@/lib/candidate/job-alerts";
import { projectCompanyTrustLifecycle } from "@/lib/companies/verification/lifecycle";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import { reconcileDocumentObjects } from "@/lib/documents/reconciliation";
import { scanDocumentVersion } from "@/lib/documents/vault-service";
import { expireDueCompanyInvitations } from "@/lib/employer/team";
import { syncJobStatusProjection } from "@/lib/jobs/effective-status";
import { dispatchNotificationBatch } from "@/lib/notifications/dispatcher";
import { resolvePersistedProviderActivation } from "@/lib/ops/operations-ledger";
import { projectExpiredSecurityState } from "@/lib/security/security-expiry";
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
import {
  createDocumentMalwareScanner,
  createDocumentObjectStore,
} from "@/lib/providers/storage/document-storage-composition";
import { expireDueContactRequests } from "@/lib/talentradar/contact-requests";
import { projectExpiredTrustCases } from "@/lib/trust-safety/case-service";

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
    leaseMilliseconds: number;
    now: () => Date;
  }>,
): Promise<RegisteredHandlerExecutionResult> {
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

    const existingReceipt =
      await dependencies.database.workEffectReceipt.findUnique({
        where: { effectKey: claimed.effectKey },
        select: { effectDigest: true },
      });
    if (existingReceipt !== null) {
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
    const failure = handlerFailureDescriptor(error);
    const failed = await failWorkItem(
      dependencies.database,
      dependencies.identity,
      { failure, now: dependencies.now() },
    );
    return result(claimed, failed.status);
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
      await requireProvider(dependencies, {
        adapterKey: dependencies.environment.EMAIL_PROVIDER_MODE,
        useCase: "email.transactional",
        now,
      });
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
    case "candidate.job-alert-digest": {
      await requireProvider(dependencies, {
        adapterKey: dependencies.environment.EMAIL_PROVIDER_MODE,
        useCase: "email.job-alert",
        now,
      });
      if (
        dependencies.environment.APP_ENV !== "local" &&
        dependencies.environment.APP_ENV !== "ci"
      ) {
        throw new HandlerFailure(
          "CONFIGURATION",
          "JOB_ALERT_PROVIDER_ADAPTER_NOT_READY",
        );
      }
      return digestSummary(
        await runJobAlertDigestMock({
          database: dependencies.database,
          now,
        }),
      );
    }
    case "jobs.expiry-projection":
      return digestSummary(
        await syncJobStatusProjection({
          database: dependencies.database,
          correlationId,
          now,
        }),
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
      await requireProvider(dependencies, {
        adapterKey: dependencies.environment.PAYMENT_PROVIDER_MODE,
        useCase: "payments.hosted-checkout",
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
          },
        ),
      );
    }
    case "payments.reconcile": {
      await requireProvider(dependencies, {
        adapterKey: dependencies.environment.PAYMENT_PROVIDER_MODE,
        useCase: "payments.hosted-checkout",
        now,
      });
      if (!dependencies.environment.REAL_PAYMENT_INGESTION) {
        throw new HandlerFailure(
          "CONFIGURATION",
          "REAL_PAYMENT_INGESTION_DISABLED",
        );
      }
      return digestSummary(
        await reconcilePersistedPayments(
          {
            batchSize: 100,
            correlationId,
            environment: dependencies.environment.APP_ENV as
              "local" | "ci" | "staging",
            now,
          },
          dependencies.database,
        ),
      );
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
    case "radar.contact-expiry":
      return digestSummary(
        await expireDueContactRequests({
          database: dependencies.database,
          correlationId,
          now,
        }),
      );
    case "documents.scan": {
      await requireProvider(dependencies, {
        adapterKey: dependencies.environment.DOCUMENT_STORAGE_MODE,
        useCase: "documents.object-store",
        now,
      });
      await requireProvider(dependencies, {
        adapterKey: "deterministic_sandbox",
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
      await requireProvider(dependencies, {
        adapterKey: dependencies.environment.DOCUMENT_STORAGE_MODE,
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
