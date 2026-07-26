import { createHash } from "node:crypto";

import { runPrivacyExecutionV2 } from "@/lib/privacy/execution-v2";
import {
  createMemoryDocumentStore,
  createPhase22Harness,
  PHASE22_NOW,
  privacyExecutionCommand,
  seedActiveInventory,
  seedPhase22Actors,
  seedPrivacyRequest,
  seedProcessingApproval,
  seedPublishedPrivacyNotice,
} from "@/tests/fixtures/phase22-privacy";

const PROCESSORS = Object.freeze([
  "email-provider",
  "document-object-store",
  "analytics-store",
  "notification-outbox",
  "payment-ledger",
  "postgres-primary",
  "backup-restore",
] as const);

const argumentsMap = parseArguments(process.argv.slice(2));
if (
  argumentsMap.case !== undefined &&
  argumentsMap.case !== "erasure"
) {
  throw new Error("Phase-22 failure drill currently permits only --case=erasure.");
}
const requestedIndex =
  argumentsMap["fail-after"] === undefined
    ? 1
    : Number(argumentsMap["fail-after"]);
if (
  !Number.isSafeInteger(requestedIndex) ||
  requestedIndex < 1 ||
  requestedIndex > PROCESSORS.length
) {
  throw new Error(`--fail-after must be within 1..${PROCESSORS.length}.`);
}
const targets =
  argumentsMap.matrix === "all-processors"
    ? PROCESSORS
    : [PROCESSORS[requestedIndex - 1]!];
const resume = argumentsMap.resume === "true" || argumentsMap.matrix === "all-processors";
const harness = await createPhase22Harness("phase22_failure_drill");
const results: Array<Record<string, unknown>> = [];

try {
  const legalActors = await seedPhase22Actors(harness.client, "failure-legal");
  const legal = await seedPublishedPrivacyNotice(
    harness.client,
    legalActors,
    "failure-drill",
  );
  await seedActiveInventory(harness.client, "failure-drill", PROCESSORS);
  for (const processorKey of PROCESSORS) {
    await seedProcessingApproval(harness.client, legal.publication.id, {
      suffix: `failure-${processorKey}`,
      scope: "PRIVACY_ERASURE",
      processorKey,
    });
  }

  for (const [index, target] of targets.entries()) {
    const actors = await seedPhase22Actors(
      harness.client,
      `failure-${index}-${target}`,
    );
    await harness.client.candidateProfile.create({
      data: {
        userId: actors.requester.id,
        firstName: `FAILURE_CANARY_${index}`,
        publicDisplayName: `Failure Canary ${index}`,
      },
    });
    const request = await seedPrivacyRequest(
      harness.client,
      actors,
      "DELETE",
    );
    const command = privacyExecutionCommand(request.id, actors);
    const dependencies = {
      database: harness.client,
      documentStore: createMemoryDocumentStore(),
      correctionEnabled: false,
      erasureEnabled: true,
      cohortAllowed: true,
      processingMode: "sandbox_command" as const,
      now: new Date(PHASE22_NOW.getTime() + index * 1_000),
    };
    const failed = await runPrivacyExecutionV2(command, {
      ...dependencies,
      injectProcessorFailure: (processorKey, attempt) =>
        processorKey === target && attempt === 1 ? "RETRYABLE" : null,
    });
    assert(
      !failed.ok &&
        failed.code === "RETRY_REQUIRED" &&
        failed.executionId !== undefined,
      `${target}: injected retry was not persisted`,
    );
    const partial = await harness.client.privacyExecution.findUniqueOrThrow({
      where: { id: failed.executionId! },
      include: { processorOutcomes: true },
    });
    assert(
      partial.status === "RETRY_REQUIRED" && partial.completedAt === null,
      `${target}: failure falsely completed the execution`,
    );
    assert(
      partial.processorOutcomes.filter(
        ({ processorKey }) => processorKey === target,
      ).length === 1,
      `${target}: failure created duplicate processor outcomes`,
    );

    let finalStatus: string = partial.status;
    if (resume) {
      const resumed = await runPrivacyExecutionV2(command, dependencies);
      assert(
        resumed.ok && resumed.status === "COMPLETED",
        `${target}: retry did not resume to a terminal execution`,
      );
      const completed =
        await harness.client.privacyExecution.findUniqueOrThrow({
          where: { id: failed.executionId! },
          include: { processorOutcomes: true },
        });
      assert(
        completed.processorOutcomes.length === PROCESSORS.length &&
          completed.processorOutcomes.every(({ status }) =>
            ["SUCCEEDED", "RETAINED"].includes(status),
          ),
        `${target}: resume left non-terminal or duplicate outcomes`,
      );
      finalStatus = completed.status;
    }
    results.push({
      processorKey: target,
      injectedStatus: partial.status,
      finalStatus,
      outcomeCount: partial.processorOutcomes.length,
      executionDigest: createHash("sha256")
        .update(failed.executionId!, "utf8")
        .digest("hex"),
      falseComplete: false,
    });
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        contract: "phase22-privacy-failure-drill-v1",
        matrix: argumentsMap.matrix ?? "single",
        resume,
        processorCount: targets.length,
        results,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await harness.dispose();
}

function parseArguments(values: readonly string[]) {
  const parsed: Record<string, string> = {};
  for (const value of values) {
    if (value === "--resume") {
      parsed.resume = "true";
      continue;
    }
    const match = /^--([a-z-]+)=(.+)$/u.exec(value);
    if (match === null) throw new Error(`Unsupported argument: ${value}`);
    parsed[match[1]!] = match[2]!;
  }
  return parsed;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
