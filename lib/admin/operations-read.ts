import "server-only";

import { requireCapability, type AdminDependencies } from "@/lib/admin/common";
import { WORKER_HANDLER_CATALOG } from "@/lib/ops/handler-catalog";

const OPEN_WORK_STATUSES = ["PENDING", "RETRY", "LEASED", "PAUSED"] as const;

export async function getRedactedOperationsOverview(
  dependencies: AdminDependencies,
) {
  if (!await requireCapability(dependencies, "ADMIN_OPS_READ")) return null;
  const environment = process.env.APP_ENV ?? "local";
  const [
    queueGroups,
    oldestOpen,
    deadLetters,
    handlerActivations,
    providerActivations,
    workerRuns,
    capacitySamples,
  ] = await Promise.all([
    dependencies.database.workItem.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    dependencies.database.workItem.aggregate({
      where: { status: { in: [...OPEN_WORK_STATUSES] } },
      _min: { availableAt: true },
    }),
    dependencies.database.workDeadLetter.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 25,
      select: {
        id: true,
        terminalAttempt: true,
        failureClass: true,
        reasonCode: true,
        createdAt: true,
        workItem: {
          select: {
            handlerKey: true,
            handlerVersion: true,
            status: true,
          },
        },
      },
    }),
    dependencies.database.workerHandlerActivation.findMany({
      where: { environment, revokedAt: null },
      orderBy: [
        { handlerKey: "asc" },
        { handlerVersion: "asc" },
        { createdAt: "desc" },
      ],
      distinct: ["handlerKey", "handlerVersion"],
      select: {
        id: true,
        handlerKey: true,
        handlerVersion: true,
        mode: true,
        owner: true,
        runbookRef: true,
        killSwitchEngaged: true,
        effectiveAt: true,
        expiresAt: true,
        batchSize: true,
        maxConcurrency: true,
      },
    }),
    dependencies.database.providerActivation.findMany({
      where: { environment, revokedAt: null },
      orderBy: [{ useCase: "asc" }, { createdAt: "desc" }],
      distinct: ["useCase"],
      select: {
        id: true,
        useCase: true,
        adapterKey: true,
        adapterVersion: true,
        mode: true,
        health: true,
        owner: true,
        runbookRef: true,
        killSwitchEngaged: true,
        effectiveAt: true,
        expiresAt: true,
        sustainableCapacity: true,
        unitCostMicros: true,
        unitCostSource: true,
      },
    }),
    dependencies.database.workerRun.findMany({
      where: { environment },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: 10,
      select: {
        id: true,
        workerId: true,
        deploymentDigest: true,
        status: true,
        startedAt: true,
        heartbeatAt: true,
        stoppedAt: true,
        shutdownOutcome: true,
        claimedCount: true,
        succeededCount: true,
        failedCount: true,
      },
    }),
    dependencies.database.operationalCapacitySample.findMany({
      where: { environment },
      orderBy: [
        { handlerKey: "asc" },
        { handlerVersion: "asc" },
        { windowEndedAt: "desc" },
      ],
      distinct: ["handlerKey", "handlerVersion"],
      select: {
        handlerKey: true,
        handlerVersion: true,
        windowEndedAt: true,
        state: true,
        backlogCount: true,
        oldestAgeMilliseconds: true,
        arrivalP95PerMinute: true,
        sustainablePerMinute: true,
        utilizationBasisPoints: true,
        unitCostMicros: true,
        unitCostSource: true,
      },
    }),
  ]);
  const statusCounts = Object.fromEntries(
    queueGroups.map((group) => [group.status, group._count._all]),
  );
  const activationByHandler = new Set(
    handlerActivations.map(
      (activation) =>
        `${activation.handlerKey}\0${activation.handlerVersion}`,
    ),
  );
  const absentHandlers = WORKER_HANDLER_CATALOG.filter(
    (handler) =>
      !activationByHandler.has(
        `${handler.handlerKey}\0${handler.handlerVersion}`,
      ),
  ).map((handler) =>
    Object.freeze({
      handlerKey: handler.handlerKey,
      handlerVersion: handler.handlerVersion,
      execution: handler.execution,
      owner: handler.owner,
    }),
  );

  return Object.freeze({
    environment,
    queue: Object.freeze({
      statuses: Object.freeze(statusCounts),
      oldestOpenAt: oldestOpen._min.availableAt,
    }),
    deadLetters: Object.freeze(deadLetters),
    handlerActivations: Object.freeze(handlerActivations),
    absentHandlers: Object.freeze(absentHandlers),
    providerActivations: Object.freeze(providerActivations),
    workerRuns: Object.freeze(workerRuns),
    capacitySamples: Object.freeze(capacitySamples),
  });
}
