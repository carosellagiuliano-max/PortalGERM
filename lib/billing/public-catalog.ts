import "server-only";

import { getDatabase } from "@/lib/db/client";
import { getPublicDataContext } from "@/lib/public/environment";
import {
  buildPublicPricingCatalogV1,
  PUBLIC_PRODUCT_CODES_V1,
  type PublicPricingCatalogResult,
} from "@/lib/billing/public-catalog-core";

const effectiveAt = (at: Date) => ({
  validFrom: { lte: at },
  AND: [{ OR: [{ validTo: null }, { validTo: { gt: at } }] }],
});

export async function getPublicPricingCatalog(
  at = new Date(),
): Promise<PublicPricingCatalogResult> {
  if (!Number.isFinite(at.getTime())) {
    return buildPublicPricingCatalogV1({
      at,
      productionLike: getPublicDataContext().liveOnly,
      planVersions: [],
      productVersions: [],
      successFeeVersions: [],
      taxRates: [],
    });
  }

  const database = getDatabase();
  let snapshots: Awaited<ReturnType<typeof loadCatalogSnapshots>>;
  try {
    snapshots = await loadCatalogSnapshots(database, at);
  } catch {
    return buildPublicPricingCatalogV1({
      at,
      productionLike: getPublicDataContext().liveOnly,
      planVersions: [],
      productVersions: [],
      successFeeVersions: [],
      taxRates: [],
    });
  }

  return buildPublicPricingCatalogV1({
    at,
    productionLike: getPublicDataContext().liveOnly,
    ...snapshots,
  });
}

async function loadCatalogSnapshots(
  database: ReturnType<typeof getDatabase>,
  at: Date,
) {
  return database.$transaction(async (transaction) => {
    const [planVersions, productVersions, successFeeVersions, taxRates] =
      await Promise.all([
        transaction.planVersion.findMany({
          where: {
            status: "ACTIVE",
            ...effectiveAt(at),
            OR: [
              { isPublic: true },
              { plan: { code: "ENTERPRISE_CONTRACT" } },
            ],
          },
          select: {
            id: true,
            version: true,
            status: true,
            priceMode: true,
            billingInterval: true,
            termMonths: true,
            netPriceRappen: true,
            monthlyEquivalentRappen: true,
            currency: true,
            isPublic: true,
            isSelfService: true,
            validFrom: true,
            validTo: true,
            plan: { select: { code: true, name: true, isDefaultFree: true } },
            entitlements: {
              select: {
                key: true,
                valueType: true,
                booleanValue: true,
                integerValue: true,
                analyticsLevelValue: true,
              },
            },
          },
        }),
        transaction.productVersion.findMany({
          where: {
            status: "ACTIVE",
            isPublic: true,
            product: { code: { in: [...PUBLIC_PRODUCT_CODES_V1] } },
            ...effectiveAt(at),
          },
          select: productVersionSelect,
        }),
        transaction.productVersion.findMany({
          where: {
            status: "INACTIVE",
            requiresLegalReview: true,
            product: { code: "success-fee" },
            ...effectiveAt(at),
          },
          select: productVersionSelect,
        }),
        transaction.taxRateVersion.findMany({
          where: {
            jurisdiction: "CH",
            reviewStatus: "APPROVED",
            ...effectiveAt(at),
          },
          select: {
            jurisdiction: true,
            taxType: true,
            rateBasisPoints: true,
            validFrom: true,
            validTo: true,
            source: true,
            reviewStatus: true,
          },
        }),
      ]);
    return { planVersions, productVersions, successFeeVersions, taxRates };
  }, { isolationLevel: "RepeatableRead" });

}

const productVersionSelect = {
  id: true,
  version: true,
  status: true,
  netPriceRappen: true,
  currency: true,
  durationDays: true,
  creditType: true,
  creditAmount: true,
  isPublic: true,
  isSelfService: true,
  priority: true,
  requiresLegalReview: true,
  validFrom: true,
  validTo: true,
  product: { select: { code: true, name: true, type: true } },
} as const;
