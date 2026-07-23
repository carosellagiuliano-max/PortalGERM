import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  adminErrorResult,
  adminFailure,
  adminNow,
  adminReasonCodeSchema,
  adminSuccess,
  adminUuidSchema,
  boundedPlainText,
  operationKey,
  requireCapability,
  writeAdminAudit,
  type AdminDependencies,
} from "@/lib/admin/common";
import { trimmedString } from "@/lib/validation/common";

export const P1_PRODUCT_TYPES = Object.freeze([
  "ADDITIONAL_JOB",
  "IMPORT_SETUP",
] as const);
export const P2_PRODUCT_TYPES = Object.freeze([
  "FEATURED_JOB",
  "FEATURED_EMPLOYER",
  "NEWSLETTER",
  "SOCIAL_PUSH",
] as const);

export type ReleasableProductType =
  | (typeof P1_PRODUCT_TYPES)[number]
  | (typeof P2_PRODUCT_TYPES)[number];
export type ProductReleaseTier = "P1" | "P2";

const releaseDecisionSchema = z.strictObject({
  productId: adminUuidSchema,
  allowsPublic: z.boolean(),
  allowsSelfService: z.boolean(),
  reasonCode: adminReasonCodeSchema,
  rationale: trimmedString(20, 1_000),
  idempotencyKey: adminUuidSchema,
});

export function productReleaseTier(
  productType: string,
): ProductReleaseTier | null {
  if (P1_PRODUCT_TYPES.some((type) => type === productType)) return "P1";
  if (P2_PRODUCT_TYPES.some((type) => type === productType)) return "P2";
  return null;
}

/**
 * Records immutable, single-use Admin evidence. This command does not schedule
 * or activate a version; the catalog scheduler must consume the matching row.
 */
export async function recordProductReleaseDecision(
  raw: unknown,
  dependencies: AdminDependencies,
) {
  const parsed = releaseDecisionSchema.safeParse(raw);
  if (!parsed.success) return adminFailure("INVALID_INPUT");
  if (!requireCapability(dependencies, "ADMIN_CATALOG_MUTATE")) {
    return adminFailure("FORBIDDEN");
  }
  const rationale = boundedPlainText(parsed.data.rationale, 20, 1_000);
  if (rationale === null) return adminFailure("INVALID_INPUT");
  const now = adminNow(dependencies.now);
  const decisionKey = operationKey(
    "catalog-product-release-decision",
    parsed.data.idempotencyKey,
  );

  try {
    return await dependencies.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "Product"
        WHERE "id" = ${parsed.data.productId}::uuid
        FOR UPDATE
      `;
      const replay = await transaction.productReleaseDecision.findUnique({
        where: { idempotencyKey: decisionKey },
        select: {
          id: true,
          productId: true,
          releaseTier: true,
          allowsPublic: true,
          allowsSelfService: true,
          reasonCode: true,
          rationale: true,
          expiresAt: true,
        },
      });
      if (replay !== null) {
        const matches =
          replay.productId === parsed.data.productId &&
          replay.allowsPublic === parsed.data.allowsPublic &&
          replay.allowsSelfService === parsed.data.allowsSelfService &&
          replay.reasonCode === parsed.data.reasonCode &&
          replay.rationale === rationale;
        return matches
          ? adminSuccess(replay, true)
          : adminFailure("CONFLICT");
      }

      const product = await transaction.product.findUnique({
        where: { id: parsed.data.productId },
        select: { id: true, type: true },
      });
      if (product === null) return adminFailure("NOT_FOUND");
      const releaseTier = productReleaseTier(product.type);
      if (releaseTier !== "P1" || !isP1ProductType(product.type)) {
        return adminFailure("CONFLICT");
      }
      if (!isSupportedReleaseScope(product.type, parsed.data)) {
        return adminFailure("CONFLICT");
      }

      const decision = await transaction.productReleaseDecision.create({
        data: {
          id: randomUUID(),
          productId: product.id,
          releaseTier,
          allowsPublic: parsed.data.allowsPublic,
          allowsSelfService: parsed.data.allowsSelfService,
          reasonCode: parsed.data.reasonCode,
          rationale,
          decidedByUserId: dependencies.actor.userId,
          expiresAt: new Date(now.getTime() + 30 * 86_400_000),
          idempotencyKey: decisionKey,
          createdAt: now,
        },
        select: {
          id: true,
          productId: true,
          releaseTier: true,
          allowsPublic: true,
          allowsSelfService: true,
          reasonCode: true,
          rationale: true,
          expiresAt: true,
        },
      });
      await writeAdminAudit(
        transaction,
        { ...dependencies, correlationId: parsed.data.idempotencyKey },
        now,
        {
          action: "CATALOG_RELEASE_DECIDED",
          capability: "ADMIN_CATALOG_MUTATE",
          targetType: "PRODUCT_RELEASE_DECISION",
          targetId: decision.id,
          reasonCode: parsed.data.reasonCode,
        },
      );
      return adminSuccess(decision);
    });
  } catch (error) {
    return adminErrorResult(error);
  }
}

function isSupportedReleaseScope(
  productType: ReleasableProductType,
  input: Readonly<{ allowsPublic: boolean; allowsSelfService: boolean }>,
) {
  if (productType === "ADDITIONAL_JOB") {
    return input.allowsPublic && input.allowsSelfService;
  }
  if (productType === "IMPORT_SETUP") {
    return !input.allowsPublic && !input.allowsSelfService;
  }
  return !input.allowsSelfService;
}

function isP1ProductType(
  productType: string,
): productType is (typeof P1_PRODUCT_TYPES)[number] {
  return P1_PRODUCT_TYPES.some((type) => type === productType);
}
