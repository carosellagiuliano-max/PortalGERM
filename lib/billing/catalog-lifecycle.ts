import "server-only";

import { z } from "zod";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import {
  adminErrorResult,
  adminFailure,
  adminNow,
  adminSuccess,
  requireCapability,
  type AdminDependencies,
} from "@/lib/admin/common";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";

const CATALOG_AUDIT_RETENTION_MILLISECONDS = 3 * 365 * 86_400_000;

const catalogLifecycleInputSchema = z.strictObject({
  correlationId: z.uuid(),
  now: z.date(),
});
const projectDueCatalogVersionsSchema = z.strictObject({});

export type CatalogLifecycleProjectionDependencies = Readonly<{
  correlationId: string;
  database: DatabaseClient;
  now: Date;
}>;

export type CatalogLifecycleProjectionResult = Readonly<{
  planActivatedCount: number;
  planDeactivatedCount: number;
  productActivatedCount: number;
  productDeactivatedCount: number;
}>;

/** Admin command boundary: accepts no client-controlled clock or catalog id. */
export async function projectDueCatalogVersions(
  raw: unknown,
  dependencies: AdminDependencies,
) {
  if (!projectDueCatalogVersionsSchema.safeParse(raw).success) {
    return adminFailure("INVALID_INPUT");
  }
  if (!requireCapability(dependencies, "ADMIN_CATALOG_MUTATE")) {
    return adminFailure("FORBIDDEN");
  }
  try {
    const value = await projectCatalogLifecycle({
      correlationId: dependencies.correlationId,
      database: dependencies.database,
      now: adminNow(dependencies.now),
    });
    return adminSuccess(value);
  } catch (error) {
    return adminErrorResult(error);
  }
}

type CatalogProjectionCounts = Readonly<{
  activatedCount: number;
  deactivatedCount: number;
}>;

/**
 * Projects released catalog versions at an explicit clock instant.
 *
 * Scheduling and projection serialize on the same Plan/Product parent row. A
 * retry observes the terminal status and therefore appends neither another
 * transition nor another audit record.
 */
export async function projectCatalogLifecycle(
  dependencies: CatalogLifecycleProjectionDependencies,
): Promise<CatalogLifecycleProjectionResult> {
  const parsed = catalogLifecycleInputSchema.safeParse({
    correlationId: dependencies.correlationId,
    now: dependencies.now,
  });
  if (!parsed.success || !Number.isFinite(parsed.data.now.getTime())) {
    throw new TypeError(
      "Catalog lifecycle projection requires a UUID correlation and valid injected clock.",
    );
  }
  const now = new Date(parsed.data.now.getTime());

  const [plans, products] = await Promise.all([
    dependencies.database.plan.findMany({
      where: {
        versions: {
          some: {
            OR: [
              { status: "ACTIVE", validTo: { lte: now } },
              { status: "SCHEDULED", validFrom: { lte: now } },
            ],
          },
        },
      },
      orderBy: { id: "asc" },
      select: { id: true },
    }),
    dependencies.database.product.findMany({
      where: {
        versions: {
          some: {
            OR: [
              { status: "ACTIVE", validTo: { lte: now } },
              { status: "SCHEDULED", validFrom: { lte: now } },
            ],
          },
        },
      },
      orderBy: { id: "asc" },
      select: { id: true },
    }),
  ]);

  let planActivatedCount = 0;
  let planDeactivatedCount = 0;
  for (const plan of plans) {
    const counts = await projectPlanVersions(
      dependencies,
      plan.id,
      now,
    );
    planActivatedCount += counts.activatedCount;
    planDeactivatedCount += counts.deactivatedCount;
  }

  let productActivatedCount = 0;
  let productDeactivatedCount = 0;
  for (const product of products) {
    const counts = await projectProductVersions(
      dependencies,
      product.id,
      now,
    );
    productActivatedCount += counts.activatedCount;
    productDeactivatedCount += counts.deactivatedCount;
  }

  return Object.freeze({
    planActivatedCount,
    planDeactivatedCount,
    productActivatedCount,
    productDeactivatedCount,
  });
}

async function projectPlanVersions(
  dependencies: CatalogLifecycleProjectionDependencies,
  planId: string,
  now: Date,
): Promise<CatalogProjectionCounts> {
  return dependencies.database.$transaction(
    async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT "id"
          FROM "Plan"
          WHERE "id" = ${planId}::uuid
          FOR UPDATE
        `,
      );
      if (locked.length !== 1) return emptyCounts();

      const versions = await transaction.planVersion.findMany({
        where: { planId, status: { in: ["SCHEDULED", "ACTIVE"] } },
        orderBy: [{ validFrom: "asc" }, { id: "asc" }],
        select: {
          id: true,
          status: true,
          validFrom: true,
          validTo: true,
        },
      });

      let activatedCount = 0;
      let deactivatedCount = 0;
      for (const version of versions) {
        if (isExpired(version.validTo, now)) {
          await transaction.planVersion.update({
            where: { id: version.id },
            data: { status: "INACTIVE" },
          });
          await writeCatalogLifecycleAudit(transaction, dependencies, now, {
            reasonCode: "CATALOG_VERSION_EXPIRED",
            targetId: version.id,
            targetType: "PLAN_VERSION",
            transition: "DEACTIVATED",
          });
          deactivatedCount += 1;
          continue;
        }
        if (
          version.status === "SCHEDULED" &&
          version.validFrom.getTime() <= now.getTime()
        ) {
          await transaction.planVersion.update({
            where: { id: version.id },
            data: { status: "ACTIVE" },
          });
          await writeCatalogLifecycleAudit(transaction, dependencies, now, {
            reasonCode: "CATALOG_VERSION_ACTIVATED",
            targetId: version.id,
            targetType: "PLAN_VERSION",
            transition: "ACTIVATED",
          });
          activatedCount += 1;
        }
      }

      if (activatedCount > 0) {
        const effective = await transaction.planVersion.count({
          where: {
            planId,
            status: "ACTIVE",
            validFrom: { lte: now },
            OR: [{ validTo: null }, { validTo: { gt: now } }],
          },
        });
        if (effective !== 1) {
          throw new CatalogLifecycleInvariantError("PLAN", planId, effective);
        }
      }

      return Object.freeze({ activatedCount, deactivatedCount });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}

async function projectProductVersions(
  dependencies: CatalogLifecycleProjectionDependencies,
  productId: string,
  now: Date,
): Promise<CatalogProjectionCounts> {
  return dependencies.database.$transaction(
    async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT "id"
          FROM "Product"
          WHERE "id" = ${productId}::uuid
          FOR UPDATE
        `,
      );
      if (locked.length !== 1) return emptyCounts();

      const versions = await transaction.productVersion.findMany({
        where: { productId, status: { in: ["SCHEDULED", "ACTIVE"] } },
        orderBy: [{ validFrom: "asc" }, { id: "asc" }],
        select: {
          id: true,
          status: true,
          validFrom: true,
          validTo: true,
        },
      });

      let activatedCount = 0;
      let deactivatedCount = 0;
      for (const version of versions) {
        if (isExpired(version.validTo, now)) {
          await transaction.productVersion.update({
            where: { id: version.id },
            data: { status: "INACTIVE" },
          });
          await writeCatalogLifecycleAudit(transaction, dependencies, now, {
            reasonCode: "CATALOG_VERSION_EXPIRED",
            targetId: version.id,
            targetType: "PRODUCT_VERSION",
            transition: "DEACTIVATED",
          });
          deactivatedCount += 1;
          continue;
        }
        if (
          version.status === "SCHEDULED" &&
          version.validFrom.getTime() <= now.getTime()
        ) {
          await transaction.productVersion.update({
            where: { id: version.id },
            data: { status: "ACTIVE" },
          });
          await writeCatalogLifecycleAudit(transaction, dependencies, now, {
            reasonCode: "CATALOG_VERSION_ACTIVATED",
            targetId: version.id,
            targetType: "PRODUCT_VERSION",
            transition: "ACTIVATED",
          });
          activatedCount += 1;
        }
      }

      if (activatedCount > 0) {
        const effective = await transaction.productVersion.count({
          where: {
            productId,
            status: "ACTIVE",
            validFrom: { lte: now },
            OR: [{ validTo: null }, { validTo: { gt: now } }],
          },
        });
        if (effective !== 1) {
          throw new CatalogLifecycleInvariantError(
            "PRODUCT",
            productId,
            effective,
          );
        }
      }

      return Object.freeze({ activatedCount, deactivatedCount });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}

async function writeCatalogLifecycleAudit(
  transaction: Prisma.TransactionClient,
  dependencies: CatalogLifecycleProjectionDependencies,
  now: Date,
  input: Readonly<{
    reasonCode: "CATALOG_VERSION_ACTIVATED" | "CATALOG_VERSION_EXPIRED";
    targetId: string;
    targetType: "PLAN_VERSION" | "PRODUCT_VERSION";
    transition: "ACTIVATED" | "DEACTIVATED";
  }>,
) {
  await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
    action:
      input.transition === "ACTIVATED"
        ? "MAINTENANCE_PROJECTION_SYNCED"
        : "CATALOG_VERSION_DEACTIVATED",
    actorKind: "SYSTEM",
    capability: "BILLING_CATALOG_LIFECYCLE_PROJECT",
    correlationId: dependencies.correlationId,
    reasonCode: input.reasonCode,
    result: "SUCCEEDED",
    retainUntil: new Date(now.getTime() + CATALOG_AUDIT_RETENTION_MILLISECONDS),
    targetId: input.targetId,
    targetType: input.targetType,
  });
}

function isExpired(validTo: Date | null, now: Date) {
  return validTo !== null && validTo.getTime() <= now.getTime();
}

function emptyCounts(): CatalogProjectionCounts {
  return Object.freeze({ activatedCount: 0, deactivatedCount: 0 });
}

export class CatalogLifecycleInvariantError extends Error {
  constructor(kind: "PLAN" | "PRODUCT", id: string, effectiveCount: number) {
    super(
      `Catalog lifecycle ${kind.toLowerCase()} ${id} resolved ${effectiveCount} effective ACTIVE versions.`,
    );
    this.name = "CatalogLifecycleInvariantError";
  }
}
