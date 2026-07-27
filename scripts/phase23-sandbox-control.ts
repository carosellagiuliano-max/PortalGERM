import { parseEnvironment } from "@/lib/config/env-schema";
import { createDatabaseClient } from "@/lib/db/factory";
import { getWorkerHandlerDefinition } from "@/lib/ops/handler-catalog";
import {
  activateSandboxHandler,
  activateSandboxProvider,
  resolvePersistedHandlerActivation,
} from "@/lib/ops/operations-ledger";
import { enqueueWorkItem } from "@/lib/ops/worker-runtime";
import { replayDeadLetterInSandbox } from "@/lib/ops/work-replay";
import { loadLocalEnvironment } from "@/scripts/load-local-environment";

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      command: "phase23-sandbox-control",
      status: "BLOCKED",
      error: errorCode(error),
    })}\n`,
  );
  process.exitCode = 1;
}

async function main() {
  loadLocalEnvironment();
  const environment = parseEnvironment(process.env);
  const command = parseArguments(process.argv.slice(2));
  const database =
    environment.secrets.database.withValue(createDatabaseClient);
  try {
    if (
      environment.WORKER_RUNTIME !== "sandbox_command" ||
      (environment.APP_ENV !== "local" && environment.APP_ENV !== "ci")
    ) {
      throw new Error("PHASE23_SANDBOX_CONTROL_FORBIDDEN");
    }
    const now = new Date();
    const deploymentDigest =
      environment.APP_BUILD_ID ?? "local-development";
    switch (command.action) {
      case "activate-handler": {
        const activation = await activateSandboxHandler(database, {
          actorReference: required(command, "actor"),
          deploymentDigest,
          environment,
          evidenceDigest: requiredDigest(command, "evidence-digest"),
          handlerKey: required(command, "handler"),
          handlerVersion: command.values.get("handler-version") ?? "v1",
          now,
          reasonCode: required(command, "reason"),
          stepUpEvidenceDigest: requiredDigest(command, "step-up-digest"),
        });
        output({
          action: command.action,
          status: "ACTIVATED",
          activationId: activation.id,
          handlerKey: activation.handlerKey,
          handlerVersion: activation.handlerVersion,
          mode: activation.mode,
        });
        break;
      }
      case "activate-provider": {
        const sustainableCapacity = Number(required(command, "capacity"));
        const unitCostMicros = BigInt(required(command, "unit-cost-micros"));
        const activation = await activateSandboxProvider(database, {
          actorReference: required(command, "actor"),
          adapterKey: required(command, "adapter"),
          adapterVersion: command.values.get("adapter-version") ?? "v1",
          approvalRef: required(command, "approval-ref"),
          contractRef: required(command, "contract-ref"),
          dpaRef: required(command, "dpa-ref"),
          environment,
          evidenceDigest: requiredDigest(command, "evidence-digest"),
          now,
          reasonCode: required(command, "reason"),
          region: required(command, "region"),
          secretVersionRef: required(command, "secret-version-ref"),
          stepUpEvidenceDigest: requiredDigest(command, "step-up-digest"),
          sustainableCapacity,
          unitCostMicros,
          unitCostSource: required(command, "unit-cost-source"),
          useCase: required(command, "use-case"),
        });
        output({
          action: command.action,
          status: "ACTIVATED",
          activationId: activation.id,
          useCase: activation.useCase,
          adapter: `${activation.adapterKey}:${activation.adapterVersion}`,
          mode: activation.mode,
        });
        break;
      }
      case "enqueue-diagnostic": {
        const handler = getWorkerHandlerDefinition(
          "ops.diagnostic-effect",
          "v1",
        );
        if (handler === null) throw new Error("DIAGNOSTIC_HANDLER_MISSING");
        const decision = await resolvePersistedHandlerActivation(database, {
          deploymentDigest,
          environment,
          handler,
          now,
        });
        if (!decision.active) {
          throw new Error(`DIAGNOSTIC_HANDLER_${decision.reason}`);
        }
        const key = required(command, "key");
        if (!/^[a-z0-9][a-z0-9._:-]{2,63}$/u.test(key)) {
          throw new Error("DIAGNOSTIC_KEY_INVALID");
        }
        const queued = await enqueueWorkItem(database, {
          handlerKey: handler.handlerKey,
          handlerVersion: handler.handlerVersion,
          payloadVersion: handler.payloadVersion,
          subjectType: "DIAGNOSTIC",
          subjectId: key,
          dedupeKey: `${handler.handlerKey}:${handler.handlerVersion}:${key}`,
          effectKey: `effect:${handler.handlerKey}:${handler.handlerVersion}:${key}`,
          availableAt: now,
          maxAttempts: decision.policy.maxAttempts,
          payloadReference: {
            effectDigest: requiredDigest(command, "effect-digest"),
          },
        });
        output({
          action: command.action,
          status: queued.created ? "ENQUEUED" : "ALREADY_QUEUED",
          workItemId: queued.id,
        });
        break;
      }
      case "replay": {
        const result = await replayDeadLetterInSandbox(
          {
            workItemId: required(command, "work-item-id"),
            actorReference: required(command, "actor"),
            capability: "OPS_SANDBOX_DLQ_REPLAY",
            stepUpEvidenceDigest: requiredDigest(command, "step-up-digest"),
            reasonCode: required(command, "reason"),
            addedAttemptBudget: Number(
              command.values.get("attempt-budget") ?? "1",
            ),
            now,
          },
          { database, environment },
        );
        if (!result.ok) throw new Error(`SANDBOX_REPLAY_${result.code}`);
        output({
          action: command.action,
          status: "REPLAY_QUEUED",
          nextAttemptNumber: result.nextAttemptNumber,
        });
        break;
      }
    }
  } finally {
    await database.$disconnect();
  }
}

function parseArguments(values: readonly string[]) {
  const map = new Map<string, string>();
  for (const value of values) {
    const match = /^--([a-z-]+)=([A-Za-z0-9][A-Za-z0-9._:@/+ -]{0,254})$/u.exec(
      value,
    );
    if (match === null || map.has(match[1]!)) {
      throw new Error("SANDBOX_CONTROL_ARGUMENT_INVALID");
    }
    map.set(match[1]!, match[2]!);
  }
  const action = map.get("action");
  if (
    action !== "activate-handler" &&
    action !== "activate-provider" &&
    action !== "enqueue-diagnostic" &&
    action !== "replay"
  ) {
    throw new Error("SANDBOX_CONTROL_ACTION_INVALID");
  }
  return Object.freeze({ action, values: map });
}

function required(
  command: Readonly<{ values: ReadonlyMap<string, string> }>,
  key: string,
) {
  const value = command.values.get(key);
  if (value === undefined) throw new Error(`SANDBOX_CONTROL_${key}_REQUIRED`);
  return value;
}

function requiredDigest(
  command: Readonly<{ values: ReadonlyMap<string, string> }>,
  key: string,
) {
  const value = required(command, key);
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`SANDBOX_CONTROL_${key}_INVALID`);
  }
  return value;
}

function output(value: object) {
  process.stdout.write(
    `${JSON.stringify({ command: "phase23-sandbox-control", ...value })}\n`,
  );
}

function errorCode(error: unknown) {
  if (!(error instanceof Error)) return "SANDBOX_CONTROL_FAILED";
  return error.message
    .toUpperCase()
    .replaceAll(/[^A-Z0-9_:-]/gu, "_")
    .slice(0, 64);
}
