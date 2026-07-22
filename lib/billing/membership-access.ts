import "server-only";

import {
  selectDefaultRetainedSeatsV1,
  type RetainedSeatMembershipV1,
  type RetainedSeatSelectionV1,
} from "@/lib/billing/billing-policy-v1";
import type { DatabaseClient } from "@/lib/db/factory";
import type { Prisma } from "@/lib/generated/prisma/client";

type BillingReadClient = DatabaseClient | Prisma.TransactionClient;

/**
 * Resolves a projector-independent seat restriction at one injected instant.
 *
 * `null` means that no ended paid period or due change exists, so normal ACTIVE
 * Membership rules apply. An array (including an empty fail-closed array) is
 * the complete set of Membership ids that may still enter the Company scope.
 */
export async function listBoundaryAccessibleMembershipIds(
  database: BillingReadClient,
  companyId: string,
  at: Date,
): Promise<readonly string[] | null> {
  if (
    companyId.trim().length === 0 ||
    !(at instanceof Date) ||
    !Number.isFinite(at.getTime())
  ) {
    return Object.freeze([]);
  }

  const dueSchedules = await database.subscriptionChangeSchedule.findMany({
    where: {
      companyId,
      status: "PENDING",
      effectiveAt: { lte: at },
    },
    orderBy: [{ effectiveAt: "asc" }, { id: "asc" }],
    select: {
      kind: true,
      effectiveAt: true,
      retainedMembershipIds: true,
      retainedDefaultOwnerId: true,
      successorSubscription: {
        select: {
          planVersion: {
            select: {
              entitlements: {
                where: { key: "SEAT_LIMIT", valueType: "INTEGER" },
                select: { integerValue: true },
              },
            },
          },
        },
      },
    },
    take: 2,
  });

  if (dueSchedules.length > 1) return Object.freeze([]);
  const dueSchedule = dueSchedules[0];
  if (dueSchedule !== undefined) {
    const seatLimit = dueSchedule.kind === "DOWNGRADE"
      ? decodeSingleSeatLimit(
          dueSchedule.successorSubscription?.planVersion.entitlements ?? [],
        )
      : await loadDefaultFreeSeatLimit(database, dueSchedule.effectiveAt);
    if (seatLimit === null) return Object.freeze([]);
    return resolveRetainedSeatSelection(
      await loadActiveMemberships(database, companyId),
      seatLimit,
      dueSchedule.retainedMembershipIds,
      dueSchedule.retainedDefaultOwnerId,
    )?.retainedMembershipIds ?? Object.freeze([]);
  }

  const subscriptions = await database.employerSubscription.findMany({
    where: { companyId },
    orderBy: [{ currentPeriodEnd: "desc" }, { id: "asc" }],
    select: {
      status: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
    },
    take: 100,
  });
  if (subscriptions.length === 0) return null;

  const hasEffectivePaidPeriod = subscriptions.some(
    (subscription) =>
      (subscription.status === "ACTIVE" ||
        subscription.status === "CANCELLING") &&
      subscription.currentPeriodStart.getTime() <= at.getTime() &&
      at.getTime() < subscription.currentPeriodEnd.getTime(),
  );
  if (hasEffectivePaidPeriod) return null;

  const latestEndedPeriod = subscriptions
    .filter((subscription) => subscription.currentPeriodEnd.getTime() <= at.getTime())
    .sort(
      (left, right) =>
        right.currentPeriodEnd.getTime() - left.currentPeriodEnd.getTime(),
    )[0];
  if (latestEndedPeriod === undefined) return null;
  const seatLimit = await loadDefaultFreeSeatLimit(
    database,
    latestEndedPeriod.currentPeriodEnd,
  );
  if (seatLimit === null) return Object.freeze([]);
  return resolveRetainedSeatSelection(
    await loadActiveMemberships(database, companyId),
    seatLimit,
  )?.retainedMembershipIds ?? Object.freeze([]);
}

/**
 * Revalidates the immutable retained-seat snapshot against current Membership
 * state. A stale snapshot falls back to ADR-028's deterministic, Owner-first
 * selection so a changed row can neither retain access nor starve projection.
 */
export function resolveRetainedSeatSelection(
  memberships: readonly RetainedSeatMembershipV1[],
  seatLimit: number,
  preferredMembershipIds?: readonly string[],
  preferredOwnerUserId?: string,
): RetainedSeatSelectionV1 | null {
  const fallback = selectDefaultRetainedSeatsV1({ memberships, seatLimit });
  if (!fallback.ok) return null;
  if (
    preferredMembershipIds === undefined ||
    preferredOwnerUserId === undefined
  ) {
    return fallback.value;
  }

  const preferredIds = new Set(preferredMembershipIds);
  const byId = new Map(memberships.map((membership) => [membership.id, membership]));
  const retained = preferredMembershipIds.map((id) => byId.get(id));
  const retainedOwner = retained.find(
    (membership) =>
      membership?.status === "ACTIVE" &&
      membership.role === "OWNER" &&
      membership.userId === preferredOwnerUserId,
  );
  if (
    preferredMembershipIds.length < 1 ||
    preferredMembershipIds.length > seatLimit ||
    preferredIds.size !== preferredMembershipIds.length ||
    retained.some((membership) => membership?.status !== "ACTIVE") ||
    retainedOwner === undefined
  ) {
    return fallback.value;
  }

  return Object.freeze({
    defaultOwnerMembershipId: retainedOwner.id,
    defaultOwnerUserId: retainedOwner.userId,
    retainedMembershipIds: Object.freeze([...preferredMembershipIds]),
    nonRetainedActiveMembershipIds: Object.freeze(
      memberships
        .filter(
          (membership) =>
            membership.status === "ACTIVE" && !preferredIds.has(membership.id),
        )
        .map((membership) => membership.id),
    ),
  });
}

async function loadActiveMemberships(
  database: BillingReadClient,
  companyId: string,
): Promise<readonly RetainedSeatMembershipV1[]> {
  const rows = await database.companyMembership.findMany({
    where: { companyId, status: "ACTIVE", removedAt: null },
    select: {
      id: true,
      userId: true,
      role: true,
      status: true,
      joinedAt: true,
    },
    orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    role: row.role,
    status: row.status,
    joinedAt: row.joinedAt,
  }));
}

async function loadDefaultFreeSeatLimit(
  database: BillingReadClient,
  at: Date,
): Promise<number | null> {
  const versions = await database.planVersion.findMany({
    where: {
      plan: { isDefaultFree: true },
      status: "ACTIVE",
      validFrom: { lte: at },
      OR: [{ validTo: null }, { validTo: { gt: at } }],
    },
    select: {
      entitlements: {
        where: { key: "SEAT_LIMIT", valueType: "INTEGER" },
        select: { integerValue: true },
      },
    },
    take: 2,
  });
  if (versions.length !== 1) return null;
  return decodeSingleSeatLimit(versions[0]?.entitlements ?? []);
}

function decodeSingleSeatLimit(
  rows: readonly Readonly<{ integerValue: number | null }>[],
): number | null {
  const value = rows.length === 1 ? rows[0]?.integerValue : null;
  return Number.isSafeInteger(value) && (value ?? 0) >= 1
    ? (value as number)
    : null;
}
