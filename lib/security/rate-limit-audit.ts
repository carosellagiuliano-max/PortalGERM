import "server-only";

import type {
  AuditActorKindV1,
  AuditTargetTypeV1,
} from "@/lib/audit/log";
import { writeBestEffortAudit } from "@/lib/audit/log";
import { createPrismaAuditPort } from "@/lib/audit/prisma-port";
import type {
  RateLimitPresetName,
  RateLimitScope,
} from "@/lib/auth/rate-limit";
import { consumeRequestRateLimit } from "@/lib/auth/rate-limit-runtime";
import type { AuthRequestContext } from "@/lib/auth/request-context";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import { recordAndDecideRiskSignal } from "@/lib/security/risk/risk-service";

const AUDIT_RETENTION_MILLISECONDS = 365 * 86_400_000;

export async function recordRateLimitDenial(
  denial: Readonly<{
    preset: RateLimitPresetName;
    scope: RateLimitScope | "OPEN_TYPE" | "UNKNOWN";
  }>,
  target: Readonly<{
    actorKind: AuditActorKindV1;
    actorUserId?: string;
    capability: string;
    companyId?: string | null;
    riskSubjectUserId?: string;
    targetId: string;
    targetType: AuditTargetTypeV1;
  }>,
  dependencies: Readonly<{
    database: DatabaseClient;
    environment: ServerEnvironment;
    request: Pick<AuthRequestContext, "correlationId" | "sourceIp">;
    now: Date;
  }>,
) {
  try {
    const gate = await consumeRequestRateLimit(
      "SECURITY_DENIAL_AUDIT",
      target.actorUserId === undefined
        ? {}
        : { actorId: target.actorUserId },
      dependencies.request,
      dependencies.now,
      {
        database: dependencies.database,
        environment: dependencies.environment,
      },
    );
    if (!gate.allowed) return Object.freeze({ written: false, gated: true });

    const result = await writeBestEffortAudit(
      createPrismaAuditPort(dependencies.database),
      {
        action: "RATE_LIMITED",
        actorKind: target.actorKind,
        actorUserId: target.actorUserId,
        capability: target.capability,
        companyId: target.companyId,
        correlationId: dependencies.request.correlationId,
        metadata: {
          preset: denial.preset,
          scope: denial.scope,
        },
        reasonCode: "RATE_LIMITED",
        result: "DENIED",
        retainUntil: new Date(
          dependencies.now.getTime() + AUDIT_RETENTION_MILLISECONDS,
        ),
        targetId: target.targetId,
        targetType: target.targetType,
      },
      undefined,
      {
        sourceIp: dependencies.request.sourceIp,
        keyring: dependencies.environment.secrets.keyrings.AUDIT_IP_HASH_KEYS,
      },
    );

    await recordAuthenticationRiskSignal(
      denial,
      target,
      dependencies,
    ).catch(() => undefined);

    return Object.freeze({ written: result.written, gated: false });
  } catch {
    // Denial observability must never turn the primary friendly rate-limit
    // response into an application error when the secondary gate/store fails.
    return Object.freeze({ written: false, gated: false });
  }
}

async function recordAuthenticationRiskSignal(
  denial: Readonly<{
    preset: RateLimitPresetName;
    scope: RateLimitScope | "OPEN_TYPE" | "UNKNOWN";
  }>,
  target: Readonly<{
    actorKind: AuditActorKindV1;
    actorUserId?: string;
    capability: string;
    companyId?: string | null;
    riskSubjectUserId?: string;
    targetId: string;
    targetType: AuditTargetTypeV1;
  }>,
  dependencies: Readonly<{
    database: DatabaseClient;
    environment: ServerEnvironment;
    request: Pick<AuthRequestContext, "correlationId" | "sourceIp">;
    now: Date;
  }>,
): Promise<void> {
  if (
    target.riskSubjectUserId === undefined ||
    (denial.preset !== "LOGIN" &&
      denial.preset !== "FORGOT_PASSWORD")
  ) {
    return;
  }
  const isRecovery = denial.preset === "FORGOT_PASSWORD";
  const correlationKey = dependencies.request.correlationId.replace(
    /[^A-Za-z0-9._:-]/gu,
    "_",
  );
  await recordAndDecideRiskSignal(
    {
      kind: isRecovery ? "RECOVERY_ABUSE" : "CREDENTIAL_STUFFING",
      subjectType: "USER",
      subjectId: target.riskSubjectUserId,
      source: isRecovery ? "RECOVERY_GUARD" : "AUTH_RATE_LIMIT",
      observedCount: isRecovery ? 3 : 5,
      evidenceReference: `rate-limit:${denial.preset}:${correlationKey}`,
      idempotencyKey: `rate-limit:${denial.preset}:${correlationKey}`,
    },
    {
      database: dependencies.database,
      correlationId: dependencies.request.correlationId,
      mode: dependencies.environment.TRUST_RISK_MODE,
      recordedByUserId: null,
      now: dependencies.now,
    },
  );
}
