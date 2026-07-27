-- Phase 23: additive, fail-closed worker runtime and operations ledgers.
-- This migration activates no handler or provider. Runtime rows must be
-- explicitly enabled by a later, environment-specific activation record.

CREATE TYPE "WorkItemStatus" AS ENUM (
  'PENDING',
  'RETRY',
  'LEASED',
  'SUCCEEDED',
  'DEAD_LETTER',
  'PAUSED',
  'CANCELLED'
);
CREATE TYPE "WorkFailureClass" AS ENUM (
  'TRANSIENT',
  'RATE_LIMITED',
  'TIMEOUT',
  'PERMANENT_VALIDATION',
  'PERMANENT_CLIENT',
  'CONFIGURATION',
  'UNKNOWN'
);
CREATE TYPE "WorkAttemptOutcome" AS ENUM (
  'SUCCEEDED',
  'EFFECT_ALREADY_APPLIED',
  'RETRY_SCHEDULED',
  'DEAD_LETTERED',
  'LEASE_LOST',
  'PAUSED',
  'CANCELLED'
);
CREATE TYPE "WorkerRunStatus" AS ENUM (
  'STARTING',
  'RUNNING',
  'DRAINING',
  'STOPPED',
  'FAILED'
);
CREATE TYPE "WorkerShutdownOutcome" AS ENUM (
  'CLEAN',
  'DRAINED',
  'LEASE_EXPIRED',
  'CRASHED',
  'FORCED'
);
CREATE TYPE "OperationsActivationMode" AS ENUM (
  'DISABLED',
  'SANDBOX',
  'ALLOWLIST',
  'LIVE'
);
CREATE TYPE "OperationsHealthStatus" AS ENUM (
  'UNKNOWN',
  'HEALTHY',
  'DEGRADED',
  'UNHEALTHY'
);
CREATE TYPE "OperationalCapacityState" AS ENUM (
  'NORMAL',
  'HEADROOM_LOW',
  'THROTTLED',
  'PAUSED',
  'DEGRADED'
);
CREATE TYPE "OperationsActivationSubject" AS ENUM (
  'HANDLER',
  'PROVIDER'
);
CREATE TYPE "OperationsActivationEventKind" AS ENUM (
  'CREATED',
  'KILL_SWITCH_ENGAGED',
  'REVOKED'
);

CREATE TABLE "WorkItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "handlerKey" VARCHAR(96) NOT NULL,
  "handlerVersion" VARCHAR(32) NOT NULL,
  "subjectType" VARCHAR(64) NOT NULL,
  "subjectId" VARCHAR(128) NOT NULL,
  "dedupeKey" VARCHAR(160) NOT NULL,
  "effectKey" VARCHAR(160) NOT NULL,
  "priority" SMALLINT NOT NULL DEFAULT 50,
  "availableAt" TIMESTAMPTZ(3) NOT NULL,
  "status" "WorkItemStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 8,
  "replayCount" INTEGER NOT NULL DEFAULT 0,
  "payloadVersion" VARCHAR(32) NOT NULL,
  "payloadReference" JSONB NOT NULL,
  "leaseOwner" VARCHAR(96),
  "leaseWorkerRunId" UUID,
  "leaseDeploymentDigest" VARCHAR(128),
  "leaseClaimedAt" TIMESTAMPTZ(3),
  "leaseExpiresAt" TIMESTAMPTZ(3),
  "heartbeatAt" TIMESTAMPTZ(3),
  "fencingToken" INTEGER NOT NULL DEFAULT 0,
  "lastFailureClass" "WorkFailureClass",
  "lastErrorCode" VARCHAR(64),
  "lastErrorDigest" CHAR(64),
  "completedAt" TIMESTAMPTZ(3),
  "deadLetteredAt" TIMESTAMPTZ(3),
  "cancelledAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "WorkItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "work_item_priority_check" CHECK ("priority" BETWEEN 0 AND 100),
  CONSTRAINT "work_item_attempt_budget_check" CHECK (
    "attemptCount" >= 0
    AND "maxAttempts" BETWEEN 1 AND 64
    AND "attemptCount" <= "maxAttempts"
    AND "replayCount" BETWEEN 0 AND 32
    AND "fencingToken" >= 0
  ),
  CONSTRAINT "work_item_payload_reference_check" CHECK (
    jsonb_typeof("payloadReference") = 'object'
    AND octet_length("payloadReference"::text) <= 8192
  ),
  CONSTRAINT "work_item_lease_state_check" CHECK (
    (
      "status" = 'LEASED'
      AND "leaseOwner" IS NOT NULL
      AND "leaseWorkerRunId" IS NOT NULL
      AND "leaseDeploymentDigest" IS NOT NULL
      AND "leaseClaimedAt" IS NOT NULL
      AND "leaseExpiresAt" IS NOT NULL
      AND "heartbeatAt" IS NOT NULL
      AND "leaseClaimedAt" <= "heartbeatAt"
      AND "heartbeatAt" < "leaseExpiresAt"
    )
    OR (
      "status" <> 'LEASED'
      AND "leaseOwner" IS NULL
      AND "leaseWorkerRunId" IS NULL
      AND "leaseDeploymentDigest" IS NULL
      AND "leaseClaimedAt" IS NULL
      AND "leaseExpiresAt" IS NULL
      AND "heartbeatAt" IS NULL
    )
  ),
  CONSTRAINT "work_item_terminal_state_check" CHECK (
    (
      "status" = 'SUCCEEDED'
      AND "completedAt" IS NOT NULL
      AND "deadLetteredAt" IS NULL
      AND "cancelledAt" IS NULL
    )
    OR (
      "status" = 'DEAD_LETTER'
      AND "completedAt" IS NULL
      AND "deadLetteredAt" IS NOT NULL
      AND "cancelledAt" IS NULL
    )
    OR (
      "status" = 'CANCELLED'
      AND "completedAt" IS NULL
      AND "deadLetteredAt" IS NULL
      AND "cancelledAt" IS NOT NULL
    )
    OR (
      "status" IN ('PENDING', 'RETRY', 'LEASED', 'PAUSED')
      AND "completedAt" IS NULL
      AND "deadLetteredAt" IS NULL
      AND "cancelledAt" IS NULL
    )
  )
);

CREATE TABLE "WorkerRun" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workerId" VARCHAR(96) NOT NULL,
  "environment" VARCHAR(32) NOT NULL,
  "deploymentDigest" VARCHAR(128) NOT NULL,
  "runtimeVersion" VARCHAR(32) NOT NULL,
  "status" "WorkerRunStatus" NOT NULL DEFAULT 'STARTING',
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "heartbeatAt" TIMESTAMPTZ(3) NOT NULL,
  "drainingAt" TIMESTAMPTZ(3),
  "stoppedAt" TIMESTAMPTZ(3),
  "shutdownOutcome" "WorkerShutdownOutcome",
  "lastErrorDigest" CHAR(64),
  "claimedCount" INTEGER NOT NULL DEFAULT 0,
  "succeededCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "WorkerRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "worker_run_environment_check" CHECK (
    "environment" IN ('local', 'ci', 'preview', 'staging', 'production')
  ),
  CONSTRAINT "worker_run_counters_check" CHECK (
    "claimedCount" >= 0
    AND "succeededCount" >= 0
    AND "failedCount" >= 0
    AND "succeededCount" + "failedCount" <= "claimedCount"
  ),
  CONSTRAINT "worker_run_state_check" CHECK (
    (
      "status" IN ('STARTING', 'RUNNING')
      AND "drainingAt" IS NULL
      AND "stoppedAt" IS NULL
      AND "shutdownOutcome" IS NULL
    )
    OR (
      "status" = 'DRAINING'
      AND "drainingAt" IS NOT NULL
      AND "stoppedAt" IS NULL
      AND "shutdownOutcome" IS NULL
    )
    OR (
      "status" IN ('STOPPED', 'FAILED')
      AND "stoppedAt" IS NOT NULL
      AND "shutdownOutcome" IS NOT NULL
    )
  )
);

CREATE TABLE "WorkAttempt" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workItemId" UUID NOT NULL,
  "workerRunId" UUID,
  "attemptNumber" INTEGER NOT NULL,
  "fencingToken" INTEGER NOT NULL,
  "workerId" VARCHAR(96) NOT NULL,
  "deploymentDigest" VARCHAR(128) NOT NULL,
  "outcome" "WorkAttemptOutcome" NOT NULL,
  "failureClass" "WorkFailureClass",
  "errorCode" VARCHAR(64),
  "errorDigest" CHAR(64),
  "leaseClaimedAt" TIMESTAMPTZ(3) NOT NULL,
  "leaseExpiresAt" TIMESTAMPTZ(3) NOT NULL,
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "completedAt" TIMESTAMPTZ(3) NOT NULL,
  "nextAvailableAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "work_attempt_sequence_check" CHECK (
    "attemptNumber" > 0
    AND "fencingToken" > 0
    AND "leaseClaimedAt" <= "startedAt"
    AND "startedAt" <= "completedAt"
    AND "leaseClaimedAt" < "leaseExpiresAt"
  ),
  CONSTRAINT "work_attempt_outcome_check" CHECK (
    (
      "outcome" IN ('SUCCEEDED', 'EFFECT_ALREADY_APPLIED', 'LEASE_LOST', 'CANCELLED')
      AND "nextAvailableAt" IS NULL
    )
    OR (
      "outcome" = 'RETRY_SCHEDULED'
      AND "failureClass" IS NOT NULL
      AND "errorCode" IS NOT NULL
      AND "nextAvailableAt" IS NOT NULL
    )
    OR (
      "outcome" IN ('DEAD_LETTERED', 'PAUSED')
      AND "failureClass" IS NOT NULL
      AND "errorCode" IS NOT NULL
      AND "nextAvailableAt" IS NULL
    )
  )
);

CREATE TABLE "WorkDeadLetter" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workItemId" UUID NOT NULL,
  "terminalAttempt" INTEGER NOT NULL,
  "failureClass" "WorkFailureClass" NOT NULL,
  "reasonCode" VARCHAR(64) NOT NULL,
  "errorDigest" CHAR(64),
  "deploymentDigest" VARCHAR(128) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkDeadLetter_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "work_dead_letter_attempt_check" CHECK ("terminalAttempt" > 0)
);

CREATE TABLE "WorkEffectReceipt" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workItemId" UUID NOT NULL,
  "effectKey" VARCHAR(160) NOT NULL,
  "handlerKey" VARCHAR(96) NOT NULL,
  "handlerVersion" VARCHAR(32) NOT NULL,
  "effectDigest" CHAR(64) NOT NULL,
  "providerReceiptDigest" CHAR(64),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkEffectReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkReplayAudit" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workItemId" UUID NOT NULL,
  "deadLetterId" UUID NOT NULL,
  "actorReference" VARCHAR(128) NOT NULL,
  "capability" VARCHAR(96) NOT NULL,
  "stepUpEvidenceDigest" CHAR(64) NOT NULL,
  "reasonCode" VARCHAR(64) NOT NULL,
  "effectKey" VARCHAR(160) NOT NULL,
  "priorAttemptCount" INTEGER NOT NULL,
  "addedAttemptBudget" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkReplayAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "work_replay_budget_check" CHECK (
    "priorAttemptCount" > 0 AND "addedAttemptBudget" BETWEEN 1 AND 8
  )
);

CREATE TABLE "WorkerHandlerActivation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "environment" VARCHAR(32) NOT NULL,
  "handlerKey" VARCHAR(96) NOT NULL,
  "handlerVersion" VARCHAR(32) NOT NULL,
  "payloadVersion" VARCHAR(32) NOT NULL,
  "mode" "OperationsActivationMode" NOT NULL DEFAULT 'DISABLED',
  "configurationDigest" CHAR(64) NOT NULL,
  "deploymentDigest" VARCHAR(128) NOT NULL,
  "owner" VARCHAR(160) NOT NULL,
  "runbookRef" VARCHAR(255) NOT NULL,
  "sloRef" VARCHAR(255) NOT NULL,
  "evidenceDigest" CHAR(64) NOT NULL,
  "providerUseCase" VARCHAR(96),
  "leaseMilliseconds" INTEGER NOT NULL DEFAULT 60000,
  "heartbeatMilliseconds" INTEGER NOT NULL DEFAULT 20000,
  "batchSize" INTEGER NOT NULL DEFAULT 25,
  "maxAttempts" INTEGER NOT NULL DEFAULT 8,
  "maxConcurrency" INTEGER NOT NULL DEFAULT 1,
  "killSwitchEngaged" BOOLEAN NOT NULL DEFAULT true,
  "effectiveAt" TIMESTAMPTZ(3),
  "expiresAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "revokeReasonCode" VARCHAR(64),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "WorkerHandlerActivation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "worker_handler_environment_check" CHECK (
    "environment" IN ('local', 'ci', 'preview', 'staging', 'production')
  ),
  CONSTRAINT "worker_handler_runtime_bounds_check" CHECK (
    "leaseMilliseconds" BETWEEN 5000 AND 900000
    AND "heartbeatMilliseconds" BETWEEN 1000 AND 300000
    AND "heartbeatMilliseconds" * 3 <= "leaseMilliseconds"
    AND "batchSize" BETWEEN 1 AND 100
    AND "maxAttempts" BETWEEN 1 AND 64
    AND "maxConcurrency" BETWEEN 1 AND 64
  ),
  CONSTRAINT "worker_handler_activation_time_check" CHECK (
    ("mode" = 'DISABLED' AND "effectiveAt" IS NULL)
    OR (
      "mode" <> 'DISABLED'
      AND "effectiveAt" IS NOT NULL
      AND ("expiresAt" IS NULL OR "expiresAt" > "effectiveAt")
      AND (
        ("revokedAt" IS NULL AND "revokeReasonCode" IS NULL)
        OR ("revokedAt" IS NOT NULL AND "revokeReasonCode" IS NOT NULL)
      )
    )
  )
);

CREATE TABLE "ProviderActivation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "environment" VARCHAR(32) NOT NULL,
  "useCase" VARCHAR(96) NOT NULL,
  "adapterKey" VARCHAR(96) NOT NULL,
  "adapterVersion" VARCHAR(32) NOT NULL,
  "mode" "OperationsActivationMode" NOT NULL DEFAULT 'DISABLED',
  "configurationDigest" CHAR(64) NOT NULL,
  "secretVersionRef" VARCHAR(128),
  "region" VARCHAR(64),
  "dpaRef" VARCHAR(255),
  "contractRef" VARCHAR(255),
  "approvalRef" VARCHAR(255),
  "evidenceDigest" CHAR(64) NOT NULL,
  "owner" VARCHAR(160) NOT NULL,
  "runbookRef" VARCHAR(255) NOT NULL,
  "health" "OperationsHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
  "healthCheckedAt" TIMESTAMPTZ(3),
  "quotaUnits" INTEGER,
  "sustainableCapacity" INTEGER,
  "unitCostMicros" BIGINT,
  "unitCostSource" VARCHAR(255),
  "killSwitchEngaged" BOOLEAN NOT NULL DEFAULT true,
  "effectiveAt" TIMESTAMPTZ(3),
  "expiresAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "revokeReasonCode" VARCHAR(64),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ProviderActivation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_activation_environment_check" CHECK (
    "environment" IN ('local', 'ci', 'preview', 'staging', 'production')
  ),
  CONSTRAINT "provider_activation_capacity_check" CHECK (
    ("quotaUnits" IS NULL OR "quotaUnits" > 0)
    AND ("sustainableCapacity" IS NULL OR "sustainableCapacity" > 0)
    AND ("unitCostMicros" IS NULL OR "unitCostMicros" >= 0)
  ),
  CONSTRAINT "provider_activation_time_check" CHECK (
    ("mode" = 'DISABLED' AND "effectiveAt" IS NULL)
    OR (
      "mode" <> 'DISABLED'
      AND "effectiveAt" IS NOT NULL
      AND ("expiresAt" IS NULL OR "expiresAt" > "effectiveAt")
      AND (
        ("revokedAt" IS NULL AND "revokeReasonCode" IS NULL)
        OR ("revokedAt" IS NOT NULL AND "revokeReasonCode" IS NOT NULL)
      )
    )
  )
);

CREATE TABLE "OperationsActivationEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "subject" "OperationsActivationSubject" NOT NULL,
  "activationId" UUID NOT NULL,
  "environment" VARCHAR(32) NOT NULL,
  "useCase" VARCHAR(96) NOT NULL,
  "mode" "OperationsActivationMode" NOT NULL,
  "kind" "OperationsActivationEventKind" NOT NULL,
  "actorReference" VARCHAR(128) NOT NULL,
  "capability" VARCHAR(96) NOT NULL,
  "stepUpEvidenceDigest" CHAR(64),
  "reasonCode" VARCHAR(64) NOT NULL,
  "evidenceDigest" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperationsActivationEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "operations_activation_event_environment_check" CHECK (
    "environment" IN ('local', 'ci', 'preview', 'staging', 'production')
  )
);

CREATE TABLE "OperationalCapacitySample" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "environment" VARCHAR(32) NOT NULL,
  "queueKey" VARCHAR(96) NOT NULL,
  "handlerKey" VARCHAR(96) NOT NULL,
  "handlerVersion" VARCHAR(32) NOT NULL,
  "deploymentDigest" VARCHAR(128) NOT NULL,
  "windowStartedAt" TIMESTAMPTZ(3) NOT NULL,
  "windowEndedAt" TIMESTAMPTZ(3) NOT NULL,
  "arrivalCount" INTEGER NOT NULL,
  "completionCount" INTEGER NOT NULL,
  "failureCount" INTEGER NOT NULL,
  "retryCount" INTEGER NOT NULL,
  "deadLetterCount" INTEGER NOT NULL,
  "backlogCount" INTEGER NOT NULL,
  "oldestAgeMilliseconds" INTEGER NOT NULL,
  "sustainablePerMinute" DOUBLE PRECISION NOT NULL,
  "arrivalP95PerMinute" DOUBLE PRECISION NOT NULL,
  "handlingP50Milliseconds" INTEGER NOT NULL,
  "handlingP95Milliseconds" INTEGER NOT NULL,
  "utilizationBasisPoints" INTEGER NOT NULL,
  "providerQuotaBasisPoints" INTEGER,
  "databasePoolBasisPoints" INTEGER,
  "workerCount" INTEGER NOT NULL,
  "unitCostMicros" BIGINT,
  "unitCostSource" VARCHAR(255),
  "manualHandlingMinutes" INTEGER NOT NULL DEFAULT 0,
  "state" "OperationalCapacityState" NOT NULL,
  "policyVersion" VARCHAR(32) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperationalCapacitySample_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "capacity_sample_environment_check" CHECK (
    "environment" IN ('local', 'ci', 'preview', 'staging', 'production')
  ),
  CONSTRAINT "capacity_sample_window_check" CHECK (
    "windowStartedAt" < "windowEndedAt"
  ),
  CONSTRAINT "capacity_sample_counts_check" CHECK (
    "arrivalCount" >= 0
    AND "completionCount" >= 0
    AND "failureCount" >= 0
    AND "retryCount" >= 0
    AND "deadLetterCount" >= 0
    AND "backlogCount" >= 0
    AND "oldestAgeMilliseconds" >= 0
    AND "sustainablePerMinute" >= 0
    AND "arrivalP95PerMinute" >= 0
    AND "handlingP50Milliseconds" >= 0
    AND "handlingP95Milliseconds" >= "handlingP50Milliseconds"
    AND "utilizationBasisPoints" BETWEEN 0 AND 10000
    AND (
      "providerQuotaBasisPoints" IS NULL
      OR "providerQuotaBasisPoints" BETWEEN 0 AND 10000
    )
    AND (
      "databasePoolBasisPoints" IS NULL
      OR "databasePoolBasisPoints" BETWEEN 0 AND 10000
    )
    AND "workerCount" >= 0
    AND ("unitCostMicros" IS NULL OR "unitCostMicros" >= 0)
    AND "manualHandlingMinutes" >= 0
  )
);

CREATE UNIQUE INDEX "WorkItem_dedupeKey_key" ON "WorkItem"("dedupeKey");
CREATE INDEX "work_item_claim_due_idx"
  ON "WorkItem"("handlerKey", "handlerVersion", "priority" DESC, "availableAt", "id")
  WHERE "status" IN ('PENDING', 'RETRY');
CREATE INDEX "work_item_stale_lease_idx"
  ON "WorkItem"("handlerKey", "handlerVersion", "leaseExpiresAt", "id")
  WHERE "status" = 'LEASED';
CREATE INDEX "WorkItem_status_availableAt_priority_idx"
  ON "WorkItem"("status", "availableAt", "priority");
CREATE INDEX "WorkItem_subjectType_subjectId_idx"
  ON "WorkItem"("subjectType", "subjectId");
CREATE INDEX "WorkItem_effectKey_idx" ON "WorkItem"("effectKey");

CREATE UNIQUE INDEX "WorkerRun_environment_workerId_startedAt_key"
  ON "WorkerRun"("environment", "workerId", "startedAt");
CREATE INDEX "WorkerRun_environment_status_heartbeatAt_idx"
  ON "WorkerRun"("environment", "status", "heartbeatAt");
CREATE INDEX "WorkerRun_deploymentDigest_startedAt_idx"
  ON "WorkerRun"("deploymentDigest", "startedAt");

CREATE UNIQUE INDEX "WorkAttempt_workItemId_attemptNumber_key"
  ON "WorkAttempt"("workItemId", "attemptNumber");
CREATE INDEX "WorkAttempt_workItemId_completedAt_idx"
  ON "WorkAttempt"("workItemId", "completedAt");
CREATE INDEX "WorkAttempt_workerRunId_completedAt_idx"
  ON "WorkAttempt"("workerRunId", "completedAt");
CREATE INDEX "WorkAttempt_outcome_completedAt_idx"
  ON "WorkAttempt"("outcome", "completedAt");

CREATE UNIQUE INDEX "WorkDeadLetter_workItemId_key"
  ON "WorkDeadLetter"("workItemId");
CREATE INDEX "WorkDeadLetter_failureClass_createdAt_idx"
  ON "WorkDeadLetter"("failureClass", "createdAt");
CREATE UNIQUE INDEX "WorkEffectReceipt_effectKey_key"
  ON "WorkEffectReceipt"("effectKey");
CREATE INDEX "WorkEffectReceipt_workItemId_createdAt_idx"
  ON "WorkEffectReceipt"("workItemId", "createdAt");
CREATE INDEX "WorkReplayAudit_workItemId_createdAt_idx"
  ON "WorkReplayAudit"("workItemId", "createdAt");
CREATE INDEX "WorkReplayAudit_actorReference_createdAt_idx"
  ON "WorkReplayAudit"("actorReference", "createdAt");

CREATE INDEX "WorkerHandlerActivation_environment_handlerKey_handlerVersion_createdAt_idx"
  ON "WorkerHandlerActivation"("environment", "handlerKey", "handlerVersion", "createdAt");
CREATE INDEX "WorkerHandlerActivation_environment_mode_effectiveAt_expiresAt_idx"
  ON "WorkerHandlerActivation"("environment", "mode", "effectiveAt", "expiresAt");
CREATE UNIQUE INDEX "worker_handler_one_current_activation"
  ON "WorkerHandlerActivation"("environment", "handlerKey", "handlerVersion")
  WHERE "mode" <> 'DISABLED' AND "revokedAt" IS NULL;

CREATE INDEX "ProviderActivation_environment_useCase_createdAt_idx"
  ON "ProviderActivation"("environment", "useCase", "createdAt");
CREATE INDEX "ProviderActivation_environment_mode_health_effectiveAt_expiresAt_idx"
  ON "ProviderActivation"("environment", "mode", "health", "effectiveAt", "expiresAt");
CREATE UNIQUE INDEX "provider_one_current_activation"
  ON "ProviderActivation"("environment", "useCase")
  WHERE "mode" <> 'DISABLED' AND "revokedAt" IS NULL;

CREATE UNIQUE INDEX "capacity_sample_window_key"
  ON "OperationalCapacitySample"(
    "environment",
    "queueKey",
    "handlerKey",
    "handlerVersion",
    "windowStartedAt",
    "windowEndedAt"
  );
CREATE INDEX "OperationalCapacitySample_environment_handlerKey_windowEndedAt_idx"
  ON "OperationalCapacitySample"("environment", "handlerKey", "windowEndedAt");
CREATE INDEX "OperationalCapacitySample_environment_state_windowEndedAt_idx"
  ON "OperationalCapacitySample"("environment", "state", "windowEndedAt");
CREATE INDEX "OperationsActivationEvent_subject_activationId_createdAt_idx"
  ON "OperationsActivationEvent"("subject", "activationId", "createdAt");
CREATE INDEX "OperationsActivationEvent_environment_useCase_createdAt_idx"
  ON "OperationsActivationEvent"("environment", "useCase", "createdAt");
CREATE INDEX "OperationsActivationEvent_actorReference_createdAt_idx"
  ON "OperationsActivationEvent"("actorReference", "createdAt");

ALTER TABLE "WorkAttempt"
  ADD CONSTRAINT "WorkAttempt_workItemId_fkey"
  FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkAttempt"
  ADD CONSTRAINT "WorkAttempt_workerRunId_fkey"
  FOREIGN KEY ("workerRunId") REFERENCES "WorkerRun"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkItem"
  ADD CONSTRAINT "WorkItem_leaseWorkerRunId_fkey"
  FOREIGN KEY ("leaseWorkerRunId") REFERENCES "WorkerRun"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkDeadLetter"
  ADD CONSTRAINT "WorkDeadLetter_workItemId_fkey"
  FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkEffectReceipt"
  ADD CONSTRAINT "WorkEffectReceipt_workItemId_fkey"
  FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkReplayAudit"
  ADD CONSTRAINT "WorkReplayAudit_workItemId_fkey"
  FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkReplayAudit"
  ADD CONSTRAINT "WorkReplayAudit_deadLetterId_fkey"
  FOREIGN KEY ("deadLetterId") REFERENCES "WorkDeadLetter"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION phase23_reject_append_only_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER phase23_work_attempt_append_only
BEFORE UPDATE OR DELETE ON "WorkAttempt"
FOR EACH ROW EXECUTE FUNCTION phase23_reject_append_only_mutation();
CREATE TRIGGER phase23_dead_letter_append_only
BEFORE UPDATE OR DELETE ON "WorkDeadLetter"
FOR EACH ROW EXECUTE FUNCTION phase23_reject_append_only_mutation();
CREATE TRIGGER phase23_effect_receipt_append_only
BEFORE UPDATE OR DELETE ON "WorkEffectReceipt"
FOR EACH ROW EXECUTE FUNCTION phase23_reject_append_only_mutation();
CREATE TRIGGER phase23_replay_audit_append_only
BEFORE UPDATE OR DELETE ON "WorkReplayAudit"
FOR EACH ROW EXECUTE FUNCTION phase23_reject_append_only_mutation();
CREATE TRIGGER phase23_capacity_sample_append_only
BEFORE UPDATE OR DELETE ON "OperationalCapacitySample"
FOR EACH ROW EXECUTE FUNCTION phase23_reject_append_only_mutation();
CREATE TRIGGER phase23_activation_event_append_only
BEFORE UPDATE OR DELETE ON "OperationsActivationEvent"
FOR EACH ROW EXECUTE FUNCTION phase23_reject_append_only_mutation();

CREATE OR REPLACE FUNCTION phase23_guard_work_item_identity()
RETURNS trigger AS $$
BEGIN
  IF NEW."handlerKey" IS DISTINCT FROM OLD."handlerKey"
     OR NEW."handlerVersion" IS DISTINCT FROM OLD."handlerVersion"
     OR NEW."subjectType" IS DISTINCT FROM OLD."subjectType"
     OR NEW."subjectId" IS DISTINCT FROM OLD."subjectId"
     OR NEW."dedupeKey" IS DISTINCT FROM OLD."dedupeKey"
     OR NEW."effectKey" IS DISTINCT FROM OLD."effectKey"
     OR NEW."payloadVersion" IS DISTINCT FROM OLD."payloadVersion"
     OR NEW."payloadReference" IS DISTINCT FROM OLD."payloadReference"
     OR NEW."maxAttempts" < OLD."maxAttempts"
  THEN
    RAISE EXCEPTION 'work item identity and attempt budget are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER phase23_work_item_identity_guard
BEFORE UPDATE ON "WorkItem"
FOR EACH ROW EXECUTE FUNCTION phase23_guard_work_item_identity();
