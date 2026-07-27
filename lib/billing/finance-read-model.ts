import "server-only";

import { z } from "zod";

import {
  hasAdminCapability,
  type AdminCapabilityActor,
} from "@/lib/admin/capabilities";
import type { DatabaseClient } from "@/lib/db/factory";

const cursorSchema = z.uuid();

export async function getFinanceReconciliationPage(
  database: DatabaseClient,
  actor: AdminCapabilityActor,
  cursor: string | null,
) {
  if (!hasAdminCapability(actor, "ADMIN_BILLING_READ")) return null;
  const safeCursor =
    cursor !== null && cursorSchema.safeParse(cursor).success ? cursor : null;
  const [runs, openItems, inboxCounts, attemptCounts] = await Promise.all([
    database.reconciliationRun.findMany({
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: 26,
      ...(safeCursor === null ? {} : { cursor: { id: safeCursor }, skip: 1 }),
      include: {
        _count: { select: { items: true } },
      },
    }),
    database.reconciliationItem.findMany({
      where: { status: { in: ["OPEN", "ESCALATED"] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 25,
      select: {
        id: true,
        companyId: true,
        providerReference: true,
        status: true,
        mismatchKind: true,
        expectedAmountRappen: true,
        observedAmountRappen: true,
        expectedCurrency: true,
        observedCurrency: true,
        reasonCode: true,
        createdAt: true,
      },
    }),
    database.providerEventInbox.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    database.paymentAttempt.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
  ]);
  return Object.freeze({
    runs: Object.freeze(runs.slice(0, 25)),
    nextCursor: runs.length > 25 ? runs[24]!.id : null,
    openItems: Object.freeze(openItems),
    inboxCounts: Object.freeze(
      Object.fromEntries(
        inboxCounts.map((row) => [row.status, row._count._all]),
      ),
    ),
    attemptCounts: Object.freeze(
      Object.fromEntries(
        attemptCounts.map((row) => [row.status, row._count._all]),
      ),
    ),
  });
}

export async function getFinanceServiceRecoveryPage(
  database: DatabaseClient,
  actor: AdminCapabilityActor,
  cursor: string | null,
) {
  if (!hasAdminCapability(actor, "ADMIN_BILLING_READ")) return null;
  const safeCursor =
    cursor !== null && cursorSchema.safeParse(cursor).success ? cursor : null;
  const [assessments, statusCounts, dunningCounts, refundCounts] =
    await Promise.all([
      database.serviceDeliveryAssessment.findMany({
        orderBy: [{ assessedAt: "desc" }, { id: "desc" }],
        take: 26,
        ...(safeCursor === null ? {} : { cursor: { id: safeCursor }, skip: 1 }),
        select: {
          id: true,
          companyId: true,
          serviceKind: true,
          classification: true,
          status: true,
          remedyKind: true,
          reasonCode: true,
          assessedAt: true,
          appliedAt: true,
        },
      }),
      database.serviceDeliveryAssessment.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      database.dunningCase.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      database.refund.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
    ]);
  return Object.freeze({
    assessments: Object.freeze(assessments.slice(0, 25)),
    nextCursor: assessments.length > 25 ? assessments[24]!.id : null,
    statusCounts: Object.freeze(
      Object.fromEntries(
        statusCounts.map((row) => [row.status, row._count._all]),
      ),
    ),
    dunningCounts: Object.freeze(
      Object.fromEntries(
        dunningCounts.map((row) => [row.status, row._count._all]),
      ),
    ),
    refundCounts: Object.freeze(
      Object.fromEntries(
        refundCounts.map((row) => [row.status, row._count._all]),
      ),
    ),
  });
}
