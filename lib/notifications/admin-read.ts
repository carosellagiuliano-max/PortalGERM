import "server-only";

import {
  requireCapability,
  type AdminDependencies,
} from "@/lib/admin/common";

const DELIVERY_STATUSES = [
  "PENDING",
  "LEASED",
  "RETRY",
  "DELIVERED",
  "SUPPRESSED",
  "DEAD_LETTER",
  "PAUSED",
] as const;

/**
 * Redacted operational projection. Authorization is evaluated before any
 * outbox/attempt lookup and neither recipients, payloads nor templates leave
 * this boundary.
 */
export async function getNotificationDeliverySummary(
  dependencies: AdminDependencies,
) {
  if (!(await requireCapability(dependencies, "ADMIN_COCKPIT_READ"))) return null;
  const [grouped, bounced, oldestQueued] = await Promise.all([
    dependencies.database.notificationOutbox.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    dependencies.database.notificationDeliveryAttempt.count({
      where: { outcome: "BOUNCED" },
    }),
    dependencies.database.notificationOutbox.findFirst({
      where: { status: { in: ["PENDING", "LEASED", "RETRY"] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { createdAt: true },
    }),
  ]);
  const counts = new Map(
    grouped.map((row) => [row.status, row._count._all] as const),
  );
  return Object.freeze({
    statuses: Object.freeze(
      Object.fromEntries(
        DELIVERY_STATUSES.map((status) => [status, counts.get(status) ?? 0]),
      ) as Record<(typeof DELIVERY_STATUSES)[number], number>,
    ),
    bounced,
    oldestQueuedAt: oldestQueued?.createdAt ?? null,
  });
}
