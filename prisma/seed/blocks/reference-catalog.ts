import type { PrismaClient } from "@/lib/generated/prisma/client";
import type { CanonicalJsonValue } from "@/prisma/seed/canonical-json";
import {
  createOrVerifySeedRecord,
  SeedDataDriftError,
} from "@/prisma/seed/create-or-verify";
import {
  CANTON_FIXTURES,
  CATEGORY_FIXTURES,
  CITY_FIXTURES,
  OCCUPATION_CODES_2026_FIXTURE,
  PLAN_ENTITLEMENT_FIXTURES,
  PLAN_FIXTURES,
  PLAN_VERSION_FIXTURES,
  PRODUCT_FIXTURES,
  PRODUCT_VERSION_FIXTURES,
  SALARY_BAND_FIXTURES,
  SALARY_DATASET_FIXTURE,
  SKILL_FIXTURES,
} from "@/prisma/seed/fixtures";
import {
  createSeedIdentity,
  stableSeedId,
} from "@/prisma/seed/ids";

export type ReferenceCatalogSeedResult = Readonly<{
  cantonIdsByCode: Readonly<Record<string, string>>;
  categoryIdsBySlug: Readonly<Record<string, string>>;
  cityIdsByNaturalKey: Readonly<Record<string, string>>;
  occupationCodeIdsByCode: Readonly<Record<string, string>>;
  occupationCodeVersionId: string;
  planIdsByCode: Readonly<Record<string, string>>;
  planVersionIdsByNaturalKey: Readonly<Record<string, string>>;
  productIdsByCode: Readonly<Record<string, string>>;
  productVersionIdsByNaturalKey: Readonly<Record<string, string>>;
  salaryDatasetVersionId: string;
  skillIdsBySlug: Readonly<Record<string, string>>;
}>;

const OCCUPATION_VERSION_NATURAL_KEY = [
  OCCUPATION_CODES_2026_FIXTURE.datasetKey,
  OCCUPATION_CODES_2026_FIXTURE.datasetVersion,
].join(":");

export const REFERENCE_CATALOG_SEED_IDENTITIES = Object.freeze([
  ...CANTON_FIXTURES.map((fixture) =>
    createSeedIdentity("canton", fixture.code),
  ),
  ...CITY_FIXTURES.map((fixture) =>
    createSeedIdentity(
      "city",
      cityNaturalKey(fixture.cantonCode, fixture.slug),
    ),
  ),
  ...CATEGORY_FIXTURES.map((fixture) =>
    createSeedIdentity("category", fixture.slug),
  ),
  ...SKILL_FIXTURES.map((fixture) =>
    createSeedIdentity("skill", fixture.slug),
  ),
  createSeedIdentity(
    "occupation-code-version",
    OCCUPATION_VERSION_NATURAL_KEY,
  ),
  ...OCCUPATION_CODES_2026_FIXTURE.occupationCodes.map((fixture) =>
    createSeedIdentity(
      "occupation-code",
      `${OCCUPATION_VERSION_NATURAL_KEY}:${fixture.code}`,
    ),
  ),
  createSeedIdentity(
    "salary-dataset-version",
    SALARY_DATASET_FIXTURE.naturalKey,
  ),
  ...SALARY_BAND_FIXTURES.map((fixture) =>
    createSeedIdentity("salary-band", fixture.naturalKey),
  ),
  ...PLAN_FIXTURES.map((fixture) =>
    createSeedIdentity("plan", fixture.code),
  ),
  ...PLAN_VERSION_FIXTURES.map((fixture) =>
    createSeedIdentity("plan-version", fixture.naturalKey),
  ),
  ...PLAN_ENTITLEMENT_FIXTURES.map((fixture) =>
    createSeedIdentity("plan-entitlement", fixture.naturalKey),
  ),
  ...PRODUCT_FIXTURES.map((fixture) =>
    createSeedIdentity("product", fixture.code),
  ),
  ...PRODUCT_VERSION_FIXTURES.map((fixture) =>
    createSeedIdentity("product-version", fixture.naturalKey),
  ),
]);

/**
 * Persists the closed Swiss reference and commercial catalog contract.
 * Released catalog rows are never upsert-updated: a rerun verifies their
 * immutable projection, while an interrupted first run may only finish a
 * still-DRAFT lifecycle.
 */
export async function seedReferenceCatalog(
  db: PrismaClient,
): Promise<ReferenceCatalogSeedResult> {
  const cantonIdsByCode: Record<string, string> = {};
  const cityIdsByNaturalKey: Record<string, string> = {};
  const categoryIdsBySlug: Record<string, string> = {};
  const skillIdsBySlug: Record<string, string> = {};
  const occupationCodeIdsByCode: Record<string, string> = {};
  const planIdsByCode: Record<string, string> = {};
  const planVersionIdsByNaturalKey: Record<string, string> = {};
  const productIdsByCode: Record<string, string> = {};
  const productVersionIdsByNaturalKey: Record<string, string> = {};

  for (const fixture of CANTON_FIXTURES) {
    const id = stableSeedId("canton", fixture.code);
    const expected = {
      id,
      code: fixture.code,
      name: fixture.name,
      slug: fixture.slug,
      language: fixture.language,
    } as const;
    await createOrVerifySeedRecord({
      entity: "Canton",
      naturalKey: fixture.code,
      findExisting: () => db.canton.findUnique({ where: { code: fixture.code } }),
      create: () => db.canton.create({ data: expected }),
      project: projectCanton,
      expected,
    });
    cantonIdsByCode[fixture.code] = id;
  }

  for (const fixture of CITY_FIXTURES) {
    const naturalKey = cityNaturalKey(fixture.cantonCode, fixture.slug);
    const id = stableSeedId("city", naturalKey);
    const cantonId = requireLookup(
      cantonIdsByCode,
      fixture.cantonCode,
      "Canton",
    );
    const expected = {
      id,
      cantonId,
      name: fixture.name,
      slug: fixture.slug,
      latitude: fixture.latitude,
      longitude: fixture.longitude,
    } as const;
    await createOrVerifySeedRecord({
      entity: "City",
      naturalKey,
      findExisting: () =>
        db.city.findUnique({ where: { cantonId_slug: { cantonId, slug: fixture.slug } } }),
      create: () => db.city.create({ data: expected }),
      project: (record) => ({
        id: record.id,
        cantonId: record.cantonId,
        name: record.name,
        slug: record.slug,
        latitude: record.latitude === null ? null : Number(record.latitude),
        longitude: record.longitude === null ? null : Number(record.longitude),
      }),
      expected,
    });
    cityIdsByNaturalKey[naturalKey] = id;
  }

  for (const fixture of CATEGORY_FIXTURES) {
    const id = stableSeedId("category", fixture.slug);
    const expected = {
      id,
      parentId: null,
      name: fixture.name,
      slug: fixture.slug,
      isActive: fixture.isActive,
      sortOrder: fixture.sortOrder,
    } as const;
    await createOrVerifySeedRecord({
      entity: "Category",
      naturalKey: fixture.slug,
      findExisting: () => db.category.findUnique({ where: { slug: fixture.slug } }),
      create: () => db.category.create({ data: expected }),
      project: (record) => ({
        id: record.id,
        parentId: record.parentId,
        name: record.name,
        slug: record.slug,
        isActive: record.isActive,
        sortOrder: record.sortOrder,
      }),
      expected,
    });
    categoryIdsBySlug[fixture.slug] = id;
  }

  for (const fixture of SKILL_FIXTURES) {
    const id = stableSeedId("skill", fixture.slug);
    const expected = { id, name: fixture.name, slug: fixture.slug } as const;
    await createOrVerifySeedRecord({
      entity: "Skill",
      naturalKey: fixture.slug,
      findExisting: () => db.skill.findUnique({ where: { slug: fixture.slug } }),
      create: () => db.skill.create({ data: expected }),
      project: (record) => ({ id: record.id, name: record.name, slug: record.slug }),
      expected,
    });
    skillIdsBySlug[fixture.slug] = id;
  }

  const occupationCodeVersionId = await seedOccupationCatalog(
    db,
    occupationCodeIdsByCode,
  );
  const salaryDatasetVersionId = await seedSalaryCatalog(
    db,
    categoryIdsBySlug,
    cantonIdsByCode,
  );

  for (const fixture of PLAN_FIXTURES) {
    const id = stableSeedId("plan", fixture.code);
    const expected = {
      id,
      code: fixture.code,
      name: fixture.name,
      isDefaultFree: fixture.isDefaultFree,
    } as const;
    await createOrVerifySeedRecord({
      entity: "Plan",
      naturalKey: fixture.code,
      findExisting: () => db.plan.findUnique({ where: { code: fixture.code } }),
      create: () => db.plan.create({ data: expected }),
      project: (record) => ({
        id: record.id,
        code: record.code,
        name: record.name,
        isDefaultFree: record.isDefaultFree,
      }),
      expected,
    });
    planIdsByCode[fixture.code] = id;
  }

  for (const fixture of PLAN_VERSION_FIXTURES) {
    const planId = requireLookup(planIdsByCode, fixture.planCode, "Plan");
    const versionId = stableSeedId("plan-version", fixture.naturalKey);
    await seedPlanVersion(db, fixture, planId, versionId);
    planVersionIdsByNaturalKey[fixture.naturalKey] = versionId;
  }

  for (const fixture of PRODUCT_FIXTURES) {
    const id = stableSeedId("product", fixture.code);
    const expected = {
      id,
      code: fixture.code,
      name: fixture.name,
      type: fixture.type,
    } as const;
    await createOrVerifySeedRecord({
      entity: "Product",
      naturalKey: fixture.code,
      findExisting: () => db.product.findUnique({ where: { code: fixture.code } }),
      create: () => db.product.create({ data: expected }),
      project: (record) => ({
        id: record.id,
        code: record.code,
        name: record.name,
        type: record.type,
      }),
      expected,
    });
    productIdsByCode[fixture.code] = id;
  }

  for (const fixture of PRODUCT_VERSION_FIXTURES) {
    const productId = requireLookup(
      productIdsByCode,
      fixture.productCode,
      "Product",
    );
    const versionId = stableSeedId("product-version", fixture.naturalKey);
    await seedProductVersion(db, fixture, productId, versionId);
    productVersionIdsByNaturalKey[fixture.naturalKey] = versionId;
  }

  return Object.freeze({
    cantonIdsByCode: Object.freeze(cantonIdsByCode),
    categoryIdsBySlug: Object.freeze(categoryIdsBySlug),
    cityIdsByNaturalKey: Object.freeze(cityIdsByNaturalKey),
    occupationCodeIdsByCode: Object.freeze(occupationCodeIdsByCode),
    occupationCodeVersionId,
    planIdsByCode: Object.freeze(planIdsByCode),
    planVersionIdsByNaturalKey: Object.freeze(planVersionIdsByNaturalKey),
    productIdsByCode: Object.freeze(productIdsByCode),
    productVersionIdsByNaturalKey: Object.freeze(productVersionIdsByNaturalKey),
    salaryDatasetVersionId,
    skillIdsBySlug: Object.freeze(skillIdsBySlug),
  });
}

async function seedOccupationCatalog(
  db: PrismaClient,
  codeIds: Record<string, string>,
): Promise<string> {
  const fixture = OCCUPATION_CODES_2026_FIXTURE;
  const id = stableSeedId("occupation-code-version", OCCUPATION_VERSION_NATURAL_KEY);
  const expected = {
    id,
    datasetKey: fixture.datasetKey,
    datasetYear: fixture.dataYear,
    version: fixture.datasetVersion,
    source: fixture.source,
    referenceUrl: fixture.sourceUrl,
    disclaimer: fixture.disclaimer,
    validFrom: fixture.validFrom,
    validTo: fixture.validTo,
  } as const;
  await createOrVerifySeedRecord({
    entity: "OccupationCodeVersion",
    naturalKey: OCCUPATION_VERSION_NATURAL_KEY,
    findExisting: () =>
      db.occupationCodeVersion.findUnique({
        where: {
          datasetKey_version: {
            datasetKey: fixture.datasetKey,
            version: fixture.datasetVersion,
          },
        },
      }),
    create: () =>
      db.occupationCodeVersion.create({
        data: {
          ...expected,
          validFrom: new Date(fixture.validFrom),
          validTo: new Date(fixture.validTo),
        },
      }),
    project: (record) => ({
      id: record.id,
      datasetKey: record.datasetKey,
      datasetYear: record.datasetYear,
      version: record.version,
      source: record.source,
      referenceUrl: record.referenceUrl,
      disclaimer: record.disclaimer,
      validFrom: record.validFrom.toISOString(),
      validTo: record.validTo?.toISOString() ?? null,
    }),
    expected,
  });

  for (const code of fixture.occupationCodes) {
    const naturalKey = `${OCCUPATION_VERSION_NATURAL_KEY}:${code.code}`;
    const codeId = stableSeedId("occupation-code", naturalKey);
    const codeExpected = {
      id: codeId,
      occupationCodeVersionId: id,
      code: code.code,
      label: code.label,
      result: code.result,
      effectiveFrom: dateOnly(code.effectiveFrom),
      effectiveTo: dateOnly(code.effectiveTo),
    } as const;
    await createOrVerifySeedRecord({
      entity: "OccupationCode",
      naturalKey,
      findExisting: () =>
        db.occupationCode.findUnique({
          where: {
            occupationCodeVersionId_code: {
              occupationCodeVersionId: id,
              code: code.code,
            },
          },
        }),
      create: () =>
        db.occupationCode.create({
          data: {
            ...codeExpected,
            effectiveFrom:
              code.effectiveFrom === null ? null : new Date(code.effectiveFrom),
            effectiveTo:
              code.effectiveTo === null ? null : new Date(code.effectiveTo),
          },
        }),
      project: (record) => ({
        id: record.id,
        occupationCodeVersionId: record.occupationCodeVersionId,
        code: record.code,
        label: record.label,
        result: record.result,
        effectiveFrom: dateOnly(record.effectiveFrom),
        effectiveTo: dateOnly(record.effectiveTo),
      }),
      expected: codeExpected,
    });
    codeIds[code.code] = codeId;
  }
  return id;
}

async function seedSalaryCatalog(
  db: PrismaClient,
  categoryIds: Readonly<Record<string, string>>,
  cantonIds: Readonly<Record<string, string>>,
): Promise<string> {
  const fixture = SALARY_DATASET_FIXTURE;
  const id = stableSeedId("salary-dataset-version", fixture.naturalKey);
  const finalExpected = salaryDatasetProjection({
    id,
    datasetKey: fixture.datasetKey,
    version: fixture.version,
    source: fixture.source,
    referenceUrl: fixture.referenceUrl,
    methodology: fixture.methodology,
    locale: fixture.locale,
    dataAsOf: new Date(fixture.dataAsOf),
    validFrom: new Date(fixture.validFrom),
    validTo: new Date(fixture.validTo),
    publishedAt: new Date(fixture.publishedAt),
    reviewStatus: fixture.reviewStatus,
  });
  let version = await db.salaryDatasetVersion.findUnique({
    where: {
      datasetKey_version: {
        datasetKey: fixture.datasetKey,
        version: fixture.version,
      },
    },
  });
  if (version === null) {
    version = await db.salaryDatasetVersion.create({
      data: {
        id,
        datasetKey: fixture.datasetKey,
        version: fixture.version,
        source: fixture.source,
        referenceUrl: fixture.referenceUrl,
        methodology: fixture.methodology,
        locale: fixture.locale,
        dataAsOf: new Date(fixture.dataAsOf),
        validFrom: new Date(fixture.validFrom),
        validTo: new Date(fixture.validTo),
        publishedAt: null,
        reviewStatus: "DRAFT",
      },
    });
  }
  assertSalaryVersion(version, fixture.naturalKey, finalExpected);

  for (const band of SALARY_BAND_FIXTURES) {
    const bandId = stableSeedId("salary-band", band.naturalKey);
    const categoryId = requireLookup(
      categoryIds,
      band.categorySlug,
      "Category",
    );
    const cantonId =
      band.cantonCode === null
        ? null
        : requireLookup(cantonIds, band.cantonCode, "Canton");
    const expected = {
      id: bandId,
      salaryDatasetVersionId: id,
      categoryId,
      cantonId,
      seniority: band.seniority,
      workloadMin: band.workloadMin,
      workloadMax: band.workloadMax,
      period: band.period,
      p25Chf: band.p25Chf,
      medianChf: band.medianChf,
      p75Chf: band.p75Chf,
      sampleSize: band.sampleSize,
      notes: band.notes,
    } as const;
    const existing = await db.salaryBand.findUnique({ where: { id: bandId } });
    if (existing === null && version.reviewStatus !== "DRAFT") {
      throw new SeedDataDriftError("SalaryBand", band.naturalKey);
    }
    await createOrVerifySeedRecord({
      entity: "SalaryBand",
      naturalKey: band.naturalKey,
      findExisting: () => db.salaryBand.findUnique({ where: { id: bandId } }),
      create: () => db.salaryBand.create({ data: expected }),
      project: (record) => ({
        id: record.id,
        salaryDatasetVersionId: record.salaryDatasetVersionId,
        categoryId: record.categoryId,
        cantonId: record.cantonId,
        seniority: record.seniority,
        workloadMin: record.workloadMin,
        workloadMax: record.workloadMax,
        period: record.period,
        p25Chf: record.p25Chf,
        medianChf: record.medianChf,
        p75Chf: record.p75Chf,
        sampleSize: record.sampleSize,
        notes: record.notes,
      }),
      expected,
    });
  }

  if (version.reviewStatus === "DRAFT") {
    version = await db.salaryDatasetVersion.update({
      where: { id },
      data: {
        reviewStatus: "APPROVED",
        publishedAt: new Date(fixture.publishedAt),
      },
    });
  }
  if (JSON.stringify(salaryDatasetProjection(version)) !== JSON.stringify(finalExpected)) {
    throw new SeedDataDriftError("SalaryDatasetVersion", fixture.naturalKey);
  }
  return id;
}

async function seedPlanVersion(
  db: PrismaClient,
  fixture: (typeof PLAN_VERSION_FIXTURES)[number],
  planId: string,
  id: string,
): Promise<void> {
  const expected = planVersionProjection({
    id,
    planId,
    ...fixture,
    status: fixture.status,
    validFrom: new Date(fixture.validFrom),
    validTo: fixture.validTo === null ? null : new Date(fixture.validTo),
  });
  let version = await db.planVersion.findUnique({
    where: { planId_version: { planId, version: fixture.version } },
  });
  if (version === null) {
    version = await db.planVersion.create({
      data: {
        id,
        planId,
        version: fixture.version,
        status: "DRAFT",
        priceMode: fixture.priceMode,
        billingInterval: fixture.billingInterval,
        termMonths: fixture.termMonths,
        netPriceRappen: fixture.netPriceRappen,
        monthlyEquivalentRappen: fixture.monthlyEquivalentRappen,
        currency: fixture.currency,
        isPublic: fixture.isPublic,
        isSelfService: fixture.isSelfService,
        validFrom: new Date(fixture.validFrom),
        validTo: fixture.validTo === null ? null : new Date(fixture.validTo),
      },
    });
  }
  assertDraftOrFinalProjection(
    "PlanVersion",
    fixture.naturalKey,
    planVersionProjection(version),
    expected,
    version.status,
  );

  for (const entitlement of PLAN_ENTITLEMENT_FIXTURES.filter(
    (item) => item.planVersionNaturalKey === fixture.naturalKey,
  )) {
    const entitlementId = stableSeedId(
      "plan-entitlement",
      entitlement.naturalKey,
    );
    const entitlementExpected = {
      id: entitlementId,
      planVersionId: id,
      key: entitlement.key,
      valueType: entitlement.valueType,
      booleanValue: entitlement.booleanValue,
      integerValue: entitlement.integerValue,
      analyticsLevelValue: entitlement.analyticsLevelValue,
    } as const;
    const existing = await db.planEntitlement.findUnique({
      where: { planVersionId_key: { planVersionId: id, key: entitlement.key } },
    });
    if (existing === null && version.status !== "DRAFT") {
      throw new SeedDataDriftError("PlanEntitlement", entitlement.naturalKey);
    }
    await createOrVerifySeedRecord({
      entity: "PlanEntitlement",
      naturalKey: entitlement.naturalKey,
      findExisting: () =>
        db.planEntitlement.findUnique({
          where: {
            planVersionId_key: { planVersionId: id, key: entitlement.key },
          },
        }),
      create: () => db.planEntitlement.create({ data: entitlementExpected }),
      project: (record) => ({
        id: record.id,
        planVersionId: record.planVersionId,
        key: record.key,
        valueType: record.valueType,
        booleanValue: record.booleanValue,
        integerValue: record.integerValue,
        analyticsLevelValue: record.analyticsLevelValue,
      }),
      expected: entitlementExpected,
    });
  }

  if (version.status === "DRAFT") {
    version = await db.planVersion.update({
      where: { id },
      data: { status: fixture.status },
    });
  }
  if (JSON.stringify(planVersionProjection(version)) !== JSON.stringify(expected)) {
    throw new SeedDataDriftError("PlanVersion", fixture.naturalKey);
  }
}

async function seedProductVersion(
  db: PrismaClient,
  fixture: (typeof PRODUCT_VERSION_FIXTURES)[number],
  productId: string,
  id: string,
): Promise<void> {
  const expected = productVersionProjection({
    id,
    productId,
    ...fixture,
    validFrom: new Date(fixture.validFrom),
    validTo: null,
  });
  let version = await db.productVersion.findUnique({
    where: { productId_version: { productId, version: fixture.version } },
  });
  if (version === null) {
    version = await db.productVersion.create({
      data: {
        id,
        productId,
        version: fixture.version,
        status: "DRAFT",
        netPriceRappen: fixture.netPriceRappen,
        currency: fixture.currency,
        durationDays: fixture.durationDays,
        creditType: fixture.creditType,
        creditAmount: fixture.creditAmount,
        isPublic: fixture.isPublic,
        isSelfService: fixture.isSelfService,
        priority: fixture.priority,
        requiresLegalReview: fixture.requiresLegalReview,
        validFrom: new Date(fixture.validFrom),
        validTo: null,
      },
    });
  }
  assertDraftOrFinalProjection(
    "ProductVersion",
    fixture.naturalKey,
    productVersionProjection(version),
    expected,
    version.status,
  );
  if (version.status === "DRAFT") {
    version = await db.productVersion.update({
      where: { id },
      data: { status: fixture.status },
    });
  }
  if (JSON.stringify(productVersionProjection(version)) !== JSON.stringify(expected)) {
    throw new SeedDataDriftError("ProductVersion", fixture.naturalKey);
  }
}

function projectCanton(record: {
  id: string;
  code: string;
  name: string;
  slug: string;
  language: string;
}): CanonicalJsonValue {
  return {
    id: record.id,
    code: record.code,
    name: record.name,
    slug: record.slug,
    language: record.language,
  };
}

function planVersionProjection(record: {
  id: string;
  planId: string;
  version: number;
  status: string;
  priceMode: string;
  billingInterval: string;
  termMonths: number;
  netPriceRappen: number | null;
  monthlyEquivalentRappen: number | null;
  currency: string;
  isPublic: boolean;
  isSelfService: boolean;
  validFrom: Date;
  validTo: Date | null;
}): CanonicalJsonValue {
  return {
    id: record.id,
    planId: record.planId,
    version: record.version,
    status: record.status,
    priceMode: record.priceMode,
    billingInterval: record.billingInterval,
    termMonths: record.termMonths,
    netPriceRappen: record.netPriceRappen,
    monthlyEquivalentRappen: record.monthlyEquivalentRappen,
    currency: record.currency,
    isPublic: record.isPublic,
    isSelfService: record.isSelfService,
    validFrom: record.validFrom.toISOString(),
    validTo: record.validTo?.toISOString() ?? null,
  };
}

function productVersionProjection(record: {
  id: string;
  productId: string;
  version: number;
  status: string;
  netPriceRappen: number;
  currency: string;
  durationDays: number | null;
  creditType: string | null;
  creditAmount: number | null;
  isPublic: boolean;
  isSelfService: boolean;
  priority: number;
  requiresLegalReview: boolean;
  validFrom: Date;
  validTo: Date | null;
}): CanonicalJsonValue {
  return {
    id: record.id,
    productId: record.productId,
    version: record.version,
    status: record.status,
    netPriceRappen: record.netPriceRappen,
    currency: record.currency,
    durationDays: record.durationDays,
    creditType: record.creditType,
    creditAmount: record.creditAmount,
    isPublic: record.isPublic,
    isSelfService: record.isSelfService,
    priority: record.priority,
    requiresLegalReview: record.requiresLegalReview,
    validFrom: record.validFrom.toISOString(),
    validTo: record.validTo?.toISOString() ?? null,
  };
}

function salaryDatasetProjection(record: {
  id: string;
  datasetKey: string;
  version: string;
  source: string;
  referenceUrl: string | null;
  methodology: string;
  locale: string;
  dataAsOf: Date;
  validFrom: Date;
  validTo: Date | null;
  publishedAt: Date | null;
  reviewStatus: string;
}): CanonicalJsonValue {
  return {
    id: record.id,
    datasetKey: record.datasetKey,
    version: record.version,
    source: record.source,
    referenceUrl: record.referenceUrl,
    methodology: record.methodology,
    locale: record.locale,
    dataAsOf: dateOnly(record.dataAsOf),
    validFrom: record.validFrom.toISOString(),
    validTo: record.validTo?.toISOString() ?? null,
    publishedAt: record.publishedAt?.toISOString() ?? null,
    reviewStatus: record.reviewStatus,
  };
}

function assertSalaryVersion(
  record: {
    id: string;
    datasetKey: string;
    version: string;
    source: string;
    referenceUrl: string | null;
    methodology: string;
    locale: string;
    dataAsOf: Date;
    validFrom: Date;
    validTo: Date | null;
    publishedAt: Date | null;
    reviewStatus: string;
  },
  naturalKey: string,
  finalExpected: CanonicalJsonValue,
): void {
  const projection = salaryDatasetProjection(record);
  if (record.reviewStatus === "DRAFT") {
    const draftExpected = {
      ...(finalExpected as Readonly<Record<string, CanonicalJsonValue>>),
      reviewStatus: "DRAFT",
      publishedAt: null,
    };
    if (JSON.stringify(projection) === JSON.stringify(draftExpected)) {
      return;
    }
  } else if (JSON.stringify(projection) === JSON.stringify(finalExpected)) {
    return;
  }
  throw new SeedDataDriftError("SalaryDatasetVersion", naturalKey);
}

function assertDraftOrFinalProjection(
  entity: string,
  naturalKey: string,
  projection: CanonicalJsonValue,
  finalExpected: CanonicalJsonValue,
  status: string,
): void {
  if (status === "DRAFT") {
    const draftExpected = {
      ...(finalExpected as Readonly<Record<string, CanonicalJsonValue>>),
      status: "DRAFT",
    };
    if (JSON.stringify(projection) === JSON.stringify(draftExpected)) {
      return;
    }
  } else if (JSON.stringify(projection) === JSON.stringify(finalExpected)) {
    return;
  }
  throw new SeedDataDriftError(entity, naturalKey);
}

function cityNaturalKey(cantonCode: string, slug: string): string {
  return `${cantonCode}:${slug}`;
}

function requireLookup(
  lookup: Readonly<Record<string, string>>,
  key: string,
  entity: string,
): string {
  const value = lookup[key];
  if (value === undefined) {
    throw new Error(`Missing seeded ${entity} dependency for ${key}.`);
  }
  return value;
}

function dateOnly(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  return (value instanceof Date ? value.toISOString() : value).slice(0, 10);
}
