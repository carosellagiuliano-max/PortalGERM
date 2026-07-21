import { createHash } from "node:crypto";

import {
  ANALYTICS_EVENT_CONTRACTS_V1,
  ANALYTICS_EVENT_KINDS_V1,
  ANALYTICS_SCHEMA_VERSION_V1,
  getAnalyticsRetainUntilV1,
} from "@/lib/analytics/event-contracts";
import {
  allocateInvoiceNumber,
  getZurichYear,
  parseInvoiceNumber,
  type InvoiceNumberPort,
  type InvoiceNumberTransaction,
} from "@/lib/billing/invoice-number";
import {
  AnalyticsEventKind,
  type Prisma,
  type PrismaClient,
} from "@/lib/generated/prisma/client";
import {
  canonicalJson,
  type CanonicalJsonValue,
} from "@/prisma/seed/canonical-json";
import {
  createOrVerifySeedRecord,
  SeedDataDriftError,
} from "@/prisma/seed/create-or-verify";
import { createSeedBlockDigest } from "@/prisma/seed/manifest";
import {
  CANDIDATE_FIXTURES,
  DEMO_GUIDE_FIXTURES,
  PLAN_ENTITLEMENT_FIXTURES,
  PLAN_VERSION_FIXTURES,
  PRODUCT_VERSION_FIXTURES,
  type PlanCode,
} from "@/prisma/seed/fixtures";
import {
  createSeedIdentity,
  stableSeedId,
} from "@/prisma/seed/ids";
import type { SeedIdentityRecord } from "@/prisma/seed/contract";
import type { ReferenceCatalogSeedResult } from "@/prisma/seed/blocks/reference-catalog";

const DAY_MS = 86_400_000;
const TAX_RATE_BASIS_POINTS = 810;
const ORDER_COUNT = 12;
const INVOICE_COUNT = 7;
const JOB_BOOST_COUNT = 10;
const AUDIT_COUNT = 30;
const ANALYTICS_COUNT = 300;
const PHASE_11_IMPORT_SOURCE_KEY = "phase-11:licensed-supply-demo-json";

export const ANALYTICS_SEED_COHORT_CONTRACT = Object.freeze({
  candidateActivation: Object.freeze({ registered: 20, completed: 18, timely: 17 }),
  employerActivation: Object.freeze({ onboarded: 20, published: 18, timely: 17 }),
  searchToApply: Object.freeze({
    resultSessions: 20,
    detailSessions: 19,
    intentSessions: 18,
    submittedSessions: 17,
  }),
  leadFunnel: Object.freeze({ submitted: 4, qualified: 3, won: 2 }),
  checkoutFunnel: Object.freeze({ started: 12, completed: 7 }),
  suppressionSearchSessions: 5,
  totalEvents: ANALYTICS_COUNT,
} as const);

export type BillingCompanyHandle = Readonly<{
  id: string;
  name: string;
  ownerMembershipId: string;
  ownerUserId: string;
  planCode: PlanCode;
  slug: string;
}>;

export type BillingJobHandle = Readonly<{
  companyId: string;
  id: string;
  publishedRevisionId: string | null;
  revisionId: string;
  slug: string;
  status: string;
}>;

export type BillingOpsSeedInput = Readonly<{
  adminUserId: string;
  anchorAt: Date;
  companies: readonly BillingCompanyHandle[];
  db: PrismaClient;
  jobs: readonly BillingJobHandle[];
  referenceCatalog: ReferenceCatalogSeedResult;
}>;

export type AnalyticsSeedCohort =
  | "BACKGROUND"
  | "CANDIDATE_ACTIVATION"
  | "CHECKOUT_FUNNEL"
  | "EMPLOYER_ACTIVATION"
  | "LEAD_FUNNEL"
  | "SEARCH_SUPPRESSION"
  | "SEARCH_TO_APPLY";

export type AnalyticsSeedFixture = Readonly<{
  cohort: AnalyticsSeedCohort;
  cohortKey: string;
  companyId: string | null;
  dedupeKey: string;
  id: string;
  jobId: string | null;
  kind: AnalyticsEventKind;
  naturalKey: string;
  occurredAt: Date;
  properties: CanonicalJsonValue;
  pseudonymousActorId: string;
  pseudonymousSessionId: string;
}>;

export type BillingOpsSeedResult = Readonly<{
  analyticsEventIds: readonly string[];
  auditLogIds: readonly string[];
  blockDigest: ReturnType<typeof createSeedBlockDigest>;
  contentPageIds: readonly string[];
  creditAccountIds: readonly string[];
  invoiceIds: readonly string[];
  identities: readonly SeedIdentityRecord[];
  jobBoostIds: readonly string[];
  orderIds: readonly string[];
  salesLeadIds: readonly string[];
  subscriptionIds: readonly string[];
  taxRateVersionId: string;
}>;

type OrderScenario = Readonly<{
  company: BillingCompanyHandle;
  finalStatus: "PAID" | "PENDING" | "CANCELLED";
  index: number;
  line:
    | Readonly<{ kind: "PLAN"; planVersionNaturalKey: string }>
    | Readonly<{
        job: BillingJobHandle;
        kind: "BOOST";
        productVersionNaturalKey: "boost-7d:v1";
      }>
    | Readonly<{
        kind: "CONTACT_PACK";
        productVersionNaturalKey:
          | "contact-pack-10:v1"
          | "contact-pack-50:v1";
      }>;
}>;

type PersistedOrderScenario = OrderScenario &
  Readonly<{
    lineId: string;
    orderId: string;
  }>;

type SubscriptionScenario = Readonly<{
  company: BillingCompanyHandle;
  currentPeriodEnd: Date;
  currentPeriodStart: Date;
  finalStatus:
    | "ACTIVE"
    | "CANCELLING"
    | "EXPIRED"
    | "CANCELLED"
    | "SCHEDULED";
  naturalKey: string;
  planCode: Exclude<PlanCode, "FREE_BASIC"> | "STARTER";
  sourceOrderId: string | null;
}>;

/** Static rows whose natural keys do not depend on Company/Job handles. */
export const BILLING_OPS_SEED_IDENTITIES: readonly SeedIdentityRecord[] =
  Object.freeze([
    createSeedIdentity("tax-rate-version", "CH:VAT:810:phase-05"),
    ...Array.from({ length: ORDER_COUNT }, (_, index) =>
      createSeedIdentity("order", orderNaturalKey(index)),
    ),
    ...Array.from({ length: ORDER_COUNT }, (_, index) =>
      createSeedIdentity("order-line", orderNaturalKey(index)),
    ),
    ...Array.from({ length: ORDER_COUNT }, (_, index) =>
      createSeedIdentity(
        "payment-event",
        `${orderNaturalKey(index)}:checkout-created`,
      ),
    ),
    ...Array.from({ length: 7 }, (_, index) =>
      createSeedIdentity(
        "payment-event",
        `${orderNaturalKey(index)}:paid`,
      ),
    ),
    ...Array.from({ length: 2 }, (_, offset) =>
      createSeedIdentity(
        "payment-event",
        `${orderNaturalKey(10 + offset)}:cancelled`,
      ),
    ),
    ...Array.from({ length: INVOICE_COUNT }, (_, index) =>
      createSeedIdentity("invoice", invoiceNaturalKey(index)),
    ),
    ...Array.from({ length: INVOICE_COUNT }, (_, index) =>
      createSeedIdentity("invoice-line", invoiceNaturalKey(index)),
    ),
    ...Array.from({ length: JOB_BOOST_COUNT }, (_, index) =>
      createSeedIdentity("job-boost", boostNaturalKey(index)),
    ),
    ...Array.from({ length: 4 }, (_, index) =>
      createSeedIdentity("sales-lead", `phase-05:${index + 1}`),
    ),
    ...Array.from({ length: 4 }, (_, index) =>
      createSeedIdentity("sales-activity", `phase-05:${index + 1}:created`),
    ),
    ...Array.from({ length: 3 }, (_, index) =>
      createSeedIdentity("abuse-report", `phase-05:${index + 1}`),
    ),
    ...Array.from({ length: 3 }, (_, index) =>
      createSeedIdentity("abuse-report-event", `phase-05:${index + 1}:created`),
    ),
    ...Array.from({ length: AUDIT_COUNT }, (_, index) =>
      createSeedIdentity("audit-log", `phase-05:${index + 1}`),
    ),
    ...Array.from({ length: ANALYTICS_COUNT }, (_, index) =>
      createSeedIdentity("analytics-event", `phase-05:${index + 1}`),
    ),
    ...DEMO_GUIDE_FIXTURES.flatMap((guide) => [
      createSeedIdentity("content-page", guide.slug),
      createSeedIdentity("content-revision", `${guide.slug}:1`),
      ...(["drafted", "submitted", "approved", "published"] as const).map(
        (event) =>
          createSeedIdentity(
            "content-event",
            `${guide.slug}:1:${event}`,
          ),
      ),
    ]),
    ...Array.from({ length: 2 }, (_, index) =>
      createSeedIdentity("support-case", `phase-05:${index + 1}`),
    ),
    ...Array.from({ length: 4 }, (_, index) =>
      createSeedIdentity("support-case-event", `phase-05:${index + 1}`),
    ),
    ...Array.from({ length: 3 }, (_, index) =>
      createSeedIdentity("system-task", `phase-05:${index + 1}`),
    ),
    createSeedIdentity("import-source", PHASE_11_IMPORT_SOURCE_KEY),
  ]);

/**
 * Returns every static and dependency-derived identity before the first write.
 * The orchestrator can include this closed list in the contract hash.
 */
export function buildBillingOpsSeedIdentities(
  input: Pick<BillingOpsSeedInput, "companies" | "jobs">,
): readonly SeedIdentityRecord[] {
  const scenario = buildBillingScenario(input.companies, input.jobs);
  const paidCompanies = sortedPaidCompanies(input.companies);
  const entitledCompanies = paidCompanies.filter((company) =>
    ["PRO", "BUSINESS", "ENTERPRISE_CONTRACT"].includes(company.planCode),
  );
  const identities: SeedIdentityRecord[] = [...BILLING_OPS_SEED_IDENTITIES];
  const importCompany = requireAt(
    [...input.companies].sort(compareBySlug),
    0,
    "licensed import Company",
  );
  identities.push(
    createSeedIdentity(
      "import-source-company-right",
      `${PHASE_11_IMPORT_SOURCE_KEY}:${importCompany.slug}`,
    ),
  );

  for (const company of paidCompanies) {
    identities.push(createSeedIdentity("company-billing-profile", company.slug));
    identities.push(
      createSeedIdentity("employer-subscription", `${company.slug}:current`),
      createSeedIdentity(
        "subscription-event",
        `${company.slug}:current:activated`,
      ),
    );
  }
  const expiredCompany = requireAt(paidCompanies, 0, "expired subscription company");
  const cancelledCompany = requireAt(
    paidCompanies,
    1,
    "cancelled subscription company",
  );
  const downgradeCompany = requireProCompany(paidCompanies, 1);
  const cancellingCompany = requireAt(
    paidCompanies,
    2,
    "cancelling subscription company",
  );
  identities.push(
    ...subscriptionIdentitySet(`${expiredCompany.slug}:history-expired`, [
      "activated",
      "expired",
    ]),
    ...subscriptionIdentitySet(`${cancelledCompany.slug}:history-cancelled`, [
      "activated",
      "cancellation-scheduled",
      "cancelled",
    ]),
    createSeedIdentity(
      "subscription-event",
      `${cancellingCompany.slug}:current:cancellation-scheduled`,
    ),
    createSeedIdentity(
      "subscription-change-schedule",
      `${cancellingCompany.slug}:cancel`,
    ),
    createSeedIdentity(
      "employer-subscription",
      `${downgradeCompany.slug}:successor-starter`,
    ),
    createSeedIdentity(
      "subscription-change-schedule",
      `${downgradeCompany.slug}:downgrade-starter`,
    ),
    createSeedIdentity(
      "subscription-event",
      `${downgradeCompany.slug}:current:change-scheduled`,
    ),
  );

  for (const company of entitledCompanies) {
    for (const creditType of ["JOB_BOOST", "TALENT_CONTACT"] as const) {
      const accountKey = `${company.slug}:${creditType}:plan-allowance`;
      identities.push(
        createSeedIdentity("credit-account", accountKey),
        createSeedIdentity("credit-ledger-entry", `${accountKey}:grant`),
      );
    }
  }
  const purchasedCompany = requireAt(
    scenario.orders,
    0,
    "purchased Contact Pack order",
  ).company;
  const purchasedAccountKey = `${purchasedCompany.slug}:TALENT_CONTACT:purchased-pack`;
  identities.push(
    createSeedIdentity("credit-account", purchasedAccountKey),
    createSeedIdentity("credit-ledger-entry", `${purchasedAccountKey}:grant`),
  );
  for (let index = 4; index < JOB_BOOST_COUNT; index += 1) {
    identities.push(
      createSeedIdentity(
        "credit-ledger-entry",
        `${boostNaturalKey(index)}:consume`,
      ),
    );
  }
  return Object.freeze(identities);
}

/** Pure verifier projection; reconstructs the exact persisted block digest. */
export function buildBillingOpsSeedBlockDigest(
  input: Pick<BillingOpsSeedInput, "companies" | "jobs">,
): ReturnType<typeof createSeedBlockDigest> {
  const identities = buildBillingOpsSeedIdentities(input);
  return createSeedBlockDigest(
    "billing-ops-content",
    identities.length,
    billingOpsDigestProjection(identities),
  );
}

export async function seedBillingOpsContent(
  input: BillingOpsSeedInput,
): Promise<BillingOpsSeedResult> {
  validateBillingInput(input);
  const identities = buildBillingOpsSeedIdentities(input);
  const { db, anchorAt, adminUserId, referenceCatalog } = input;
  const scenario = buildBillingScenario(input.companies, input.jobs);
  await seedBillingProfiles(db, scenario.paidCompanies);
  const taxRateVersionId = await seedTaxRate(db, anchorAt, adminUserId);
  const orders = await seedOrders(
    db,
    anchorAt,
    scenario.orders,
    referenceCatalog,
    taxRateVersionId,
  );
  const invoiceIds = await seedInvoices(db, anchorAt, orders);
  const subscriptionIds = await seedSubscriptions(
    db,
    anchorAt,
    scenario.paidCompanies,
    orders,
    referenceCatalog,
  );
  const creditAndBoosts = await seedCreditsAndBoosts(
    db,
    anchorAt,
    scenario,
    orders,
    referenceCatalog,
  );
  const salesLeadIds = await seedSalesLeads(
    db,
    anchorAt,
    input.companies,
    adminUserId,
  );
  await seedAbuseReports(
    db,
    anchorAt,
    input.companies,
    input.jobs,
    adminUserId,
  );
  const auditLogIds = await seedAuditLogs(
    db,
    anchorAt,
    input.companies,
    input.jobs,
    invoiceIds,
    creditAndBoosts.jobBoostIds,
    salesLeadIds,
    adminUserId,
  );
  const analyticsEventIds = await seedAnalyticsEvents(
    db,
    anchorAt,
    input.companies,
    input.jobs,
  );
  const contentPageIds = await seedContentPages(db, anchorAt, adminUserId);
  await seedSupportAndSystemTasks(
    db,
    anchorAt,
    input.companies,
    adminUserId,
  );
  await seedPhase11LicensedImportSource(
    db,
    anchorAt,
    input.companies,
    adminUserId,
  );

  const blockDigest = buildBillingOpsSeedBlockDigest(input);

  return Object.freeze({
    analyticsEventIds,
    auditLogIds,
    blockDigest,
    contentPageIds,
    creditAccountIds: creditAndBoosts.creditAccountIds,
    invoiceIds,
    identities,
    jobBoostIds: creditAndBoosts.jobBoostIds,
    orderIds: orders.map((order) => order.orderId),
    salesLeadIds,
    subscriptionIds,
    taxRateVersionId,
  });
}

function buildBillingScenario(
  companies: readonly BillingCompanyHandle[],
  jobs: readonly BillingJobHandle[],
) {
  const paidCompanies = sortedPaidCompanies(companies);
  if (paidCompanies.length !== 20) {
    throw new Error(
      `Phase-05 billing requires exactly 20 paid Companies; received ${paidCompanies.length}.`,
    );
  }
  const paidCompanyIds = new Set(paidCompanies.map((company) => company.id));
  const publishedPaidJobs = [...jobs]
    .filter(
      (job) => job.status === "PUBLISHED" && paidCompanyIds.has(job.companyId),
    )
    .sort(compareBySlug);
  const directBoostJobs = pickDistinctCompanyJobs(publishedPaidJobs, 4);
  const usedJobIds = new Set(directBoostJobs.map((job) => job.id));
  const entitledCompanyIds = new Set(
    paidCompanies
      .filter((company) =>
        ["PRO", "BUSINESS", "ENTERPRISE_CONTRACT"].includes(company.planCode),
      )
      .map((company) => company.id),
  );
  const ledgerBoostJobs = pickDistinctCompanyJobs(
    publishedPaidJobs.filter(
      (job) => entitledCompanyIds.has(job.companyId) && !usedJobIds.has(job.id),
    ),
    6,
  );
  const boostJobs = [...directBoostJobs, ...ledgerBoostJobs];
  if (boostJobs.length !== JOB_BOOST_COUNT) {
    throw new Error("Phase-05 billing requires ten distinct eligible Boost jobs.");
  }

  const orderCompanies = paidCompanies;
  const orders: readonly OrderScenario[] = Object.freeze([
    orderScenario(0, orderCompanies, "PAID", {
      kind: "CONTACT_PACK",
      productVersionNaturalKey: "contact-pack-10:v1",
    }),
    orderScenario(1, orderCompanies, "PAID", {
      kind: "CONTACT_PACK",
      productVersionNaturalKey: "contact-pack-50:v1",
    }),
    ...directBoostJobs.map((job, offset) =>
      orderScenario(2 + offset, orderCompanies, "PAID", {
        kind: "BOOST",
        job,
        productVersionNaturalKey: "boost-7d:v1",
      }),
    ),
    orderScenario(6, orderCompanies, "PAID", {
      kind: "PLAN",
      planVersionNaturalKey: `${requireAt(orderCompanies, 6, "subscription order company").planCode}:v1`,
    }),
    orderScenario(7, orderCompanies, "PENDING", {
      kind: "PLAN",
      planVersionNaturalKey: `${requireAt(orderCompanies, 7, "pending subscription order company").planCode}:v1`,
    }),
    orderScenario(8, orderCompanies, "PENDING", {
      kind: "BOOST",
      job: requireAt(publishedPaidJobs, 10, "pending Boost job"),
      productVersionNaturalKey: "boost-7d:v1",
    }),
    orderScenario(9, orderCompanies, "PENDING", {
      kind: "CONTACT_PACK",
      productVersionNaturalKey: "contact-pack-10:v1",
    }),
    orderScenario(10, orderCompanies, "CANCELLED", {
      kind: "PLAN",
      planVersionNaturalKey: `${requireAt(orderCompanies, 10, "cancelled subscription order company").planCode}:v1`,
    }),
    orderScenario(11, orderCompanies, "CANCELLED", {
      kind: "CONTACT_PACK",
      productVersionNaturalKey: "contact-pack-50:v1",
    }),
  ]);
  return Object.freeze({
    boostJobs: Object.freeze(boostJobs),
    ledgerBoostJobs: Object.freeze(ledgerBoostJobs),
    orders,
    paidCompanies,
  });
}

function orderScenario(
  index: number,
  companies: readonly BillingCompanyHandle[],
  finalStatus: OrderScenario["finalStatus"],
  line: OrderScenario["line"],
): OrderScenario {
  return Object.freeze({
    company:
      line.kind === "BOOST"
        ? requireCompanyById(companies, line.job.companyId)
        : requireAt(companies, index, "order company"),
    finalStatus,
    index,
    line,
  });
}

function validateBillingInput(input: BillingOpsSeedInput): void {
  if (!(input.anchorAt instanceof Date) || !Number.isFinite(input.anchorAt.getTime())) {
    throw new TypeError("Phase-05 Billing/Ops requires a valid anchorAt.");
  }
  if (new Set(input.companies.map((company) => company.id)).size !== input.companies.length) {
    throw new Error("Duplicate Company handles are not allowed in Billing/Ops seed input.");
  }
  if (new Set(input.jobs.map((job) => job.id)).size !== input.jobs.length) {
    throw new Error("Duplicate Job handles are not allowed in Billing/Ops seed input.");
  }
  buildBillingOpsSeedIdentities(input);
}

async function seedPhase11LicensedImportSource(
  db: PrismaClient,
  anchorAt: Date,
  companies: readonly BillingCompanyHandle[],
  adminUserId: string,
): Promise<void> {
  const company = requireAt(
    [...companies].sort(compareBySlug),
    0,
    "licensed import Company",
  );
  const importSourceId = stableSeedId("import-source", PHASE_11_IMPORT_SOURCE_KEY);
  const sourceExpected = {
    id: importSourceId,
    name: "Lizenzierter Demo-Supply-Feed",
    sourceReference: "local-demo-feed-v1",
    licenseReference: "demo-license-evidence:phase-11",
    provenance: "DEMO",
    format: "JSON",
    isActive: true,
  } as const;
  await createOrVerifySeedRecord({
    entity: "ImportSource",
    naturalKey: PHASE_11_IMPORT_SOURCE_KEY,
    findExisting: () => db.importSource.findUnique({ where: { id: importSourceId } }),
    create: () => db.importSource.create({ data: { ...sourceExpected, createdAt: anchorAt, updatedAt: anchorAt } }),
    project: (record) => ({
      id: record.id,
      name: record.name,
      sourceReference: record.sourceReference,
      licenseReference: record.licenseReference,
      provenance: record.provenance,
      format: record.format,
      isActive: record.isActive,
    }),
    expected: sourceExpected,
  });

  const rightNaturalKey = `${PHASE_11_IMPORT_SOURCE_KEY}:${company.slug}`;
  const rightId = stableSeedId("import-source-company-right", rightNaturalKey);
  const validFrom = addDays(anchorAt, -30);
  const validTo = addDays(anchorAt, 3650);
  const rightExpected = {
    id: rightId,
    importSourceId,
    companyId: company.id,
    rightsEvidence: "Demo-Lizenz: lokale Phase-11-Importprüfung für genau diese Firma.",
    grantedByUserId: adminUserId,
    validFrom: validFrom.toISOString(),
    validTo: validTo.toISOString(),
    revokedAt: null,
  } as const;
  await createOrVerifySeedRecord({
    entity: "ImportSourceCompanyRight",
    naturalKey: rightNaturalKey,
    findExisting: () => db.importSourceCompanyRight.findUnique({ where: { id: rightId } }),
    create: () => db.importSourceCompanyRight.create({ data: {
      id: rightId,
      importSourceId,
      companyId: company.id,
      rightsEvidence: rightExpected.rightsEvidence,
      grantedByUserId: adminUserId,
      validFrom,
      validTo,
      revokedAt: null,
      createdAt: anchorAt,
    } }),
    project: (record) => ({
      id: record.id,
      importSourceId: record.importSourceId,
      companyId: record.companyId,
      rightsEvidence: record.rightsEvidence,
      grantedByUserId: record.grantedByUserId,
      validFrom: record.validFrom.toISOString(),
      validTo: record.validTo?.toISOString() ?? null,
      revokedAt: record.revokedAt?.toISOString() ?? null,
    }),
    expected: rightExpected,
  });
}

async function seedBillingProfiles(
  db: PrismaClient,
  companies: readonly BillingCompanyHandle[],
): Promise<void> {
  for (const company of companies) {
    const id = stableSeedId("company-billing-profile", company.slug);
    const expected = {
      id,
      companyId: company.id,
      legalName: `${company.name} Demo AG`,
      billingContactEmail: `billing@${company.slug}.demo.invalid`,
      street: `Musterweg ${String((company.slug.length % 80) + 1)}`,
      postalCode: String(8_000 + (company.slug.length % 900)).padStart(4, "0"),
      city: "Zürich",
      countryCode: "CH",
      uid: null,
      vatNumber: "CHE-000.000.000 MWST",
      version: 1,
    } as const;
    await createOrVerifySeedRecord({
      entity: "CompanyBillingProfile",
      naturalKey: company.slug,
      findExisting: () =>
        db.companyBillingProfile.findUnique({ where: { companyId: company.id } }),
      create: () => db.companyBillingProfile.create({ data: expected }),
      project: (record) => ({
        id: record.id,
        companyId: record.companyId,
        legalName: record.legalName,
        billingContactEmail: record.billingContactEmail,
        street: record.street,
        postalCode: record.postalCode,
        city: record.city,
        countryCode: record.countryCode,
        uid: record.uid,
        vatNumber: record.vatNumber,
        version: record.version,
      }),
      expected,
    });
  }
}

async function seedTaxRate(
  db: PrismaClient,
  anchorAt: Date,
  adminUserId: string,
): Promise<string> {
  const naturalKey = "CH:VAT:810:phase-05";
  const id = stableSeedId("tax-rate-version", naturalKey);
  const validFrom = startOfUtcYear(anchorAt);
  const reviewedAt = addMinutes(validFrom, 1);
  const expected = {
    id,
    jurisdiction: "CH",
    taxType: "MWST_STANDARD_DEMO",
    rateBasisPoints: TAX_RATE_BASIS_POINTS,
    validFrom: validFrom.toISOString(),
    validTo: null,
    source: "SwissTalentHub Demo-Planungsannahme; fiktiver Satz für Billing-Tests",
    referenceUrl: null,
    reviewStatus: "APPROVED",
    reviewedByUserId: adminUserId,
    reviewedAt: reviewedAt.toISOString(),
  } as const;
  let record = await db.taxRateVersion.findUnique({ where: { id } });
  if (record === null) {
    record = await db.taxRateVersion.create({
      data: {
        id,
        jurisdiction: expected.jurisdiction,
        taxType: expected.taxType,
        rateBasisPoints: expected.rateBasisPoints,
        validFrom,
        validTo: null,
        source: expected.source,
        referenceUrl: null,
        reviewStatus: "DRAFT",
        reviewedByUserId: null,
        reviewedAt: null,
      },
    });
  }
  const projection = projectTaxRate(record);
  if (record.reviewStatus === "DRAFT") {
    assertProjection(
      "TaxRateVersion",
      naturalKey,
      projection,
      { ...expected, reviewStatus: "DRAFT", reviewedByUserId: null, reviewedAt: null },
    );
    record = await db.taxRateVersion.update({
      where: { id },
      data: {
        reviewStatus: "APPROVED",
        reviewedByUserId: adminUserId,
        reviewedAt,
      },
    });
  }
  assertProjection("TaxRateVersion", naturalKey, projectTaxRate(record), expected);
  return id;
}

async function seedOrders(
  db: PrismaClient,
  anchorAt: Date,
  scenarios: readonly OrderScenario[],
  catalog: ReferenceCatalogSeedResult,
  taxRateVersionId: string,
): Promise<readonly PersistedOrderScenario[]> {
  const persisted: PersistedOrderScenario[] = [];
  for (const scenario of scenarios) {
    const naturalKey = orderNaturalKey(scenario.index);
    const orderId = stableSeedId("order", naturalKey);
    const lineId = stableSeedId("order-line", naturalKey);
    const createdAt = addDays(anchorAt, -30 + scenario.index);
    const line = resolveOrderLine(scenario, catalog);
    const money = calculateMoney(line.unitNetRappen, 1);
    const snapshot = billingSnapshot(scenario.company);
    const finalExpected = {
      id: orderId,
      companyId: scenario.company.id,
      createdByUserId: scenario.company.ownerUserId,
      status: scenario.finalStatus,
      provider: "MOCK",
      clientIdempotencyKey: `seed:${naturalKey}:client`,
      providerIdempotencyKey: `seed:${naturalKey}:provider`,
      providerReference: `mock-${naturalKey}`,
      ...snapshot,
      currency: "CHF",
      netTotalRappen: money.netRappen,
      vatTotalRappen: money.vatRappen,
      totalRappen: money.totalRappen,
      paidAt:
        scenario.finalStatus === "PAID"
          ? addMinutes(createdAt, 30).toISOString()
          : null,
      failedAt: null,
      cancelledAt:
        scenario.finalStatus === "CANCELLED"
          ? addMinutes(createdAt, 45).toISOString()
          : null,
      expiresAt:
        scenario.finalStatus === "PENDING"
          ? addDays(createdAt, 2).toISOString()
          : null,
      createdAt: createdAt.toISOString(),
    } as const;
    let order = await db.order.findUnique({ where: { id: orderId } });
    if (order === null) {
      order = await db.order.create({
        data: {
          ...finalExpected,
          status: "DRAFT",
          paidAt: null,
          cancelledAt: null,
          createdAt,
          expiresAt:
            finalExpected.expiresAt === null
              ? null
              : new Date(finalExpected.expiresAt),
        },
      });
    }
    assertOrderDraftPendingOrFinal(order, naturalKey, finalExpected);

    const lineExpected = {
      id: lineId,
      orderId,
      planVersionId: line.planVersionId,
      productVersionId: line.productVersionId,
      taxRateVersionId,
      quantity: 1,
      unitNetRappen: line.unitNetRappen,
      netRappen: money.netRappen,
      taxRateBasisPoints: TAX_RATE_BASIS_POINTS,
      vatRappen: money.vatRappen,
      totalRappen: money.totalRappen,
      currency: "CHF",
      descriptionSnapshot: line.description,
      fulfillmentContext: line.fulfillmentContext,
      targetJobId: line.targetJobId,
      targetImportSourceId: null,
      targetCreditType: line.targetCreditType,
      createdAt: createdAt.toISOString(),
    } as const;
    const existingLine = await db.orderLine.findUnique({ where: { id: lineId } });
    if (existingLine === null && order.status !== "DRAFT") {
      throw new SeedDataDriftError("OrderLine", naturalKey);
    }
    await createOrVerifySeedRecord({
      entity: "OrderLine",
      naturalKey,
      findExisting: () => db.orderLine.findUnique({ where: { id: lineId } }),
      create: () =>
        db.orderLine.create({
          data: { ...lineExpected, createdAt },
        }),
      project: projectOrderLine,
      expected: lineExpected,
    });

    if (order.status === "DRAFT") {
      order = await db.order.update({
        where: { id: orderId },
        data: { status: "PENDING" },
      });
    }
    if (order.status === "PENDING" && scenario.finalStatus !== "PENDING") {
      order = await db.order.update({
        where: { id: orderId },
        data:
          scenario.finalStatus === "PAID"
            ? { status: "PAID", paidAt: addMinutes(createdAt, 30) }
            : { status: "CANCELLED", cancelledAt: addMinutes(createdAt, 45) },
      });
    }
    assertProjection("Order", naturalKey, projectOrder(order), finalExpected);
    await seedPaymentEvents(db, scenario, orderId, createdAt);
    persisted.push(Object.freeze({ ...scenario, lineId, orderId }));
  }
  return Object.freeze(persisted);
}

async function seedPaymentEvents(
  db: PrismaClient,
  scenario: OrderScenario,
  orderId: string,
  createdAt: Date,
): Promise<void> {
  const events: Array<Readonly<{ kind: "CHECKOUT_CREATED" | "PAID" | "CANCELLED"; suffix: string; at: Date }>> = [
    { kind: "CHECKOUT_CREATED", suffix: "checkout-created", at: addMinutes(createdAt, 5) },
  ];
  if (scenario.finalStatus === "PAID") {
    events.push({ kind: "PAID", suffix: "paid", at: addMinutes(createdAt, 30) });
  } else if (scenario.finalStatus === "CANCELLED") {
    events.push({ kind: "CANCELLED", suffix: "cancelled", at: addMinutes(createdAt, 45) });
  }
  for (const event of events) {
    const naturalKey = `${orderNaturalKey(scenario.index)}:${event.suffix}`;
    const id = stableSeedId("payment-event", naturalKey);
    const expected = {
      id,
      orderId,
      provider: "MOCK",
      kind: event.kind,
      providerReference: `mock-event-${naturalKey}`,
      idempotencyKey: `seed:${naturalKey}`,
      payload: {
        schemaVersion: "1",
        fixture: true,
        orderIndex: scenario.index + 1,
      },
      createdAt: event.at.toISOString(),
    } as const;
    await createOrVerifySeedRecord({
      entity: "PaymentEvent",
      naturalKey,
      findExisting: () => db.paymentEvent.findUnique({ where: { id } }),
      create: () =>
        db.paymentEvent.create({ data: { ...expected, createdAt: event.at } }),
      project: (record) => ({
        id: record.id,
        orderId: record.orderId,
        provider: record.provider,
        kind: record.kind,
        providerReference: record.providerReference,
        idempotencyKey: record.idempotencyKey,
        payload: record.payload as CanonicalJsonValue,
        createdAt: record.createdAt.toISOString(),
      }),
      expected,
    });
  }
}

async function seedInvoices(
  db: PrismaClient,
  anchorAt: Date,
  orders: readonly PersistedOrderScenario[],
): Promise<readonly string[]> {
  const paidOrders = orders.filter((order) => order.finalStatus === "PAID");
  if (paidOrders.length !== INVOICE_COUNT) {
    throw new Error("Phase-05 billing requires exactly seven paid invoice Orders.");
  }
  const statuses = [
    "PAID",
    "PAID",
    "PAID",
    "ISSUED",
    "ISSUED",
    "VOID",
    "ISSUED",
  ] as const;
  const ids: string[] = [];
  for (const [index, order] of paidOrders.entries()) {
    const status = requireAt(statuses, index, "invoice status");
    const naturalKey = invoiceNaturalKey(index);
    const id = stableSeedId("invoice", naturalKey);
    const orderRecord = await db.order.findUniqueOrThrow({ where: { id: order.orderId } });
    const orderLine = await db.orderLine.findUniqueOrThrow({ where: { id: order.lineId } });
    const issuedAt = addDays(anchorAt, -20 + index);
    const dueAt =
      index === 3 ? addDays(anchorAt, -5) : addDays(issuedAt, 30);
    let invoice = await db.invoice.findUnique({ where: { orderId: order.orderId } });
    if (invoice === null) {
      invoice = await allocateAndCreateInvoice(
        db,
        id,
        orderRecord,
        issuedAt,
        dueAt,
      );
    }
    assertInvoiceNumber(invoice.number, issuedAt);
    const lineId = stableSeedId("invoice-line", naturalKey);
    const invoiceLineExpected = {
      id: lineId,
      invoiceId: id,
      orderLineId: order.lineId,
      sortOrder: 1,
      descriptionSnapshot: orderLine.descriptionSnapshot,
      quantity: orderLine.quantity,
      unitNetRappen: orderLine.unitNetRappen,
      netRappen: orderLine.netRappen,
      taxRateBasisPoints: orderLine.taxRateBasisPoints,
      vatRappen: orderLine.vatRappen,
      totalRappen: orderLine.totalRappen,
      currency: orderLine.currency,
    } as const;
    const existingLine = await db.invoiceLine.findUnique({ where: { id: lineId } });
    if (existingLine === null && invoice.status !== "DRAFT") {
      throw new SeedDataDriftError("InvoiceLine", naturalKey);
    }
    await createOrVerifySeedRecord({
      entity: "InvoiceLine",
      naturalKey,
      findExisting: () => db.invoiceLine.findUnique({ where: { id: lineId } }),
      create: () => db.invoiceLine.create({ data: invoiceLineExpected }),
      project: projectInvoiceLine,
      expected: invoiceLineExpected,
    });
    if (invoice.status === "DRAFT") {
      invoice = await db.invoice.update({
        where: { id },
        data: { status: "ISSUED", issuedAt },
      });
    }
    if (invoice.status === "ISSUED" && status !== "ISSUED") {
      invoice = await db.invoice.update({
        where: { id },
        data:
          status === "PAID"
            ? { status: "PAID", paidAt: addDays(issuedAt, 4) }
            : { status: "VOID", voidedAt: addDays(issuedAt, 2) },
      });
    }
    const expected = {
      id,
      orderId: order.orderId,
      companyId: order.company.id,
      status,
      ...billingSnapshot(order.company),
      currency: "CHF",
      netTotalRappen: orderRecord.netTotalRappen,
      vatTotalRappen: orderRecord.vatTotalRappen,
      totalRappen: orderRecord.totalRappen,
      dueAt: dueAt.toISOString(),
      issuedAt: issuedAt.toISOString(),
      paidAt: status === "PAID" ? addDays(issuedAt, 4).toISOString() : null,
      voidedAt: status === "VOID" ? addDays(issuedAt, 2).toISOString() : null,
    } as const;
    assertProjection("Invoice", naturalKey, projectInvoice(invoice), expected);
    ids.push(id);
  }
  return Object.freeze(ids);
}

async function allocateAndCreateInvoice(
  db: PrismaClient,
  id: string,
  order: Awaited<ReturnType<PrismaClient["order"]["findUniqueOrThrow"]>>,
  issuedAt: Date,
  dueAt: Date,
) {
  const clients = new WeakMap<object, Prisma.TransactionClient>();
  const port: InvoiceNumberPort = {
    transaction: async (callback) =>
      db.$transaction(async (transaction) => {
        const adapter: InvoiceNumberTransaction = {
          acquireInvoiceYearAdvisoryLock: async (namespace, year) => {
            await transaction.$queryRaw<Array<Readonly<{ locked: boolean }>>>`
              SELECT pg_advisory_xact_lock(${namespace}::integer, ${year}::integer) IS NULL AS locked
            `;
          },
          findHighestInvoiceSequence: async (year) => {
            const prefix = `STH-${year}-%`;
            const rows = await transaction.$queryRaw<
              Array<Readonly<{ highest: bigint | null }>>
            >`SELECT MAX(split_part("number", '-', 3)::bigint) AS highest FROM "Invoice" WHERE "number" LIKE ${prefix}`;
            const highest = rows[0]?.highest ?? null;
            return highest === null ? null : Number(highest);
          },
        };
        clients.set(adapter, transaction);
        return callback(adapter);
      }),
  };
  const allocation = await allocateInvoiceNumber(
    issuedAt,
    port,
    async (adapter, number) => {
      const transaction = clients.get(adapter);
      if (transaction === undefined) {
        throw new Error("Invoice allocator lost its transaction binding.");
      }
      return transaction.invoice.create({
        data: {
          id,
          orderId: order.id,
          companyId: order.companyId,
          number,
          status: "DRAFT",
          billingLegalNameSnapshot: order.billingLegalNameSnapshot,
          billingContactEmailSnapshot: order.billingContactEmailSnapshot,
          billingStreetSnapshot: order.billingStreetSnapshot,
          billingPostalCodeSnapshot: order.billingPostalCodeSnapshot,
          billingCitySnapshot: order.billingCitySnapshot,
          billingCountryCodeSnapshot: order.billingCountryCodeSnapshot,
          billingUidSnapshot: order.billingUidSnapshot,
          billingVatNumberSnapshot: order.billingVatNumberSnapshot,
          currency: order.currency,
          netTotalRappen: order.netTotalRappen,
          vatTotalRappen: order.vatTotalRappen,
          totalRappen: order.totalRappen,
          dueAt,
        },
      });
    },
  );
  return allocation.value;
}

async function seedSubscriptions(
  db: PrismaClient,
  anchorAt: Date,
  paidCompanies: readonly BillingCompanyHandle[],
  orders: readonly PersistedOrderScenario[],
  catalog: ReferenceCatalogSeedResult,
): Promise<readonly string[]> {
  const currentStart = addDays(anchorAt, -15);
  const currentEnd = addDays(anchorAt, 15);
  const ids: string[] = [];
  const expiredCompany = requireAt(paidCompanies, 0, "expired subscription company");
  const cancelledCompany = requireAt(
    paidCompanies,
    1,
    "cancelled subscription company",
  );
  const cancellingCompany = requireAt(
    paidCompanies,
    2,
    "cancelling subscription company",
  );
  const downgradeCompany = requireProCompany(paidCompanies, 1);
  const sourceOrder = requireAt(orders, 6, "subscription source Order");

  const history: readonly SubscriptionScenario[] = Object.freeze([
    {
      company: expiredCompany,
      currentPeriodStart: addDays(anchorAt, -45),
      currentPeriodEnd: currentStart,
      finalStatus: "EXPIRED",
      naturalKey: `${expiredCompany.slug}:history-expired`,
      planCode: paidPlanCode(expiredCompany),
      sourceOrderId: null,
    },
    {
      company: cancelledCompany,
      currentPeriodStart: addDays(anchorAt, -45),
      currentPeriodEnd: currentStart,
      finalStatus: "CANCELLED",
      naturalKey: `${cancelledCompany.slug}:history-cancelled`,
      planCode: paidPlanCode(cancelledCompany),
      sourceOrderId: null,
    },
  ]);
  for (const item of history) {
    ids.push(await seedSubscription(db, item, catalog));
  }

  const currentSubscriptions = paidCompanies.map<SubscriptionScenario>(
    (company) => ({
      company,
      currentPeriodStart: currentStart,
      currentPeriodEnd: currentEnd,
      finalStatus: company.id === cancellingCompany.id ? "CANCELLING" : "ACTIVE",
      naturalKey: `${company.slug}:current`,
      planCode: paidPlanCode(company),
      sourceOrderId:
        company.id === sourceOrder.company.id ? sourceOrder.orderId : null,
    }),
  );
  const currentIdsByCompany = new Map<string, string>();
  for (const item of currentSubscriptions) {
    const id = await seedSubscription(db, item, catalog);
    ids.push(id);
    currentIdsByCompany.set(item.company.id, id);
  }

  const successor: SubscriptionScenario = {
    company: downgradeCompany,
    currentPeriodStart: currentEnd,
    currentPeriodEnd: addDays(currentEnd, 30),
    finalStatus: "SCHEDULED",
    naturalKey: `${downgradeCompany.slug}:successor-starter`,
    planCode: "STARTER",
    sourceOrderId: null,
  };
  const successorId = await seedSubscription(db, successor, catalog);
  ids.push(successorId);

  const cancellingCurrentId = requireMap(
    currentIdsByCompany,
    cancellingCompany.id,
    "cancelling current Subscription",
  );
  await seedSubscriptionSchedule(db, {
    actorUserId: cancellingCompany.ownerUserId,
    company: cancellingCompany,
    currentSubscriptionId: cancellingCurrentId,
    effectiveAt: currentEnd,
    kind: "CANCEL",
    naturalKey: `${cancellingCompany.slug}:cancel`,
    successorSubscriptionId: null,
  });
  await seedSubscriptionEvent(
    db,
    cancellingCurrentId,
    `${cancellingCompany.slug}:current:cancellation-scheduled`,
    "CANCELLATION_SCHEDULED",
    cancellingCompany.ownerUserId,
    addMinutes(anchorAt, -30),
  );

  const downgradeCurrentId = requireMap(
    currentIdsByCompany,
    downgradeCompany.id,
    "downgrade current Subscription",
  );
  await seedSubscriptionSchedule(db, {
    actorUserId: downgradeCompany.ownerUserId,
    company: downgradeCompany,
    currentSubscriptionId: downgradeCurrentId,
    effectiveAt: currentEnd,
    kind: "DOWNGRADE",
    naturalKey: `${downgradeCompany.slug}:downgrade-starter`,
    successorSubscriptionId: successorId,
  });
  await seedSubscriptionEvent(
    db,
    downgradeCurrentId,
    `${downgradeCompany.slug}:current:change-scheduled`,
    "CHANGE_SCHEDULED",
    downgradeCompany.ownerUserId,
    addMinutes(anchorAt, -20),
  );
  return Object.freeze(ids);
}

async function seedSubscription(
  db: PrismaClient,
  scenario: SubscriptionScenario,
  catalog: ReferenceCatalogSeedResult,
): Promise<string> {
  const id = stableSeedId("employer-subscription", scenario.naturalKey);
  const planVersionNaturalKey = `${scenario.planCode}:v1`;
  const planVersionId = requireLookup(
    catalog.planVersionIdsByNaturalKey,
    planVersionNaturalKey,
    "PlanVersion",
  );
  const commercial = subscriptionCommercialSnapshot(scenario.planCode);
  const expectedBase = {
    id,
    companyId: scenario.company.id,
    planVersionId,
    sourceOrderId: scenario.sourceOrderId,
    currentPeriodStart: scenario.currentPeriodStart.toISOString(),
    currentPeriodEnd: scenario.currentPeriodEnd.toISOString(),
    billingIntervalSnapshot: commercial.billingInterval,
    termMonthsSnapshot: commercial.termMonths,
    recurringNetRappenSnapshot: commercial.netRappen,
    monthlyEquivalentRappenSnapshot: commercial.monthlyEquivalentRappen,
    currencySnapshot: "CHF",
  } as const;
  let record = await db.employerSubscription.findUnique({ where: { id } });
  if (record === null) {
    record = await db.employerSubscription.create({
      data: {
        ...expectedBase,
        currentPeriodStart: scenario.currentPeriodStart,
        currentPeriodEnd: scenario.currentPeriodEnd,
        status: "SCHEDULED",
        activatedAt: null,
        endedAt: null,
      },
    });
  }
  assertSubscriptionSnapshot(record, scenario.naturalKey, expectedBase);

  if (record.status === "SCHEDULED" && scenario.finalStatus !== "SCHEDULED") {
    record = await db.employerSubscription.update({
      where: { id },
      data: { status: "ACTIVE", activatedAt: scenario.currentPeriodStart },
    });
  }
  if (
    record.status === "ACTIVE" &&
    (scenario.finalStatus === "CANCELLING" || scenario.finalStatus === "CANCELLED")
  ) {
    record = await db.employerSubscription.update({
      where: { id },
      data: { status: "CANCELLING" },
    });
  }
  if (record.status === "ACTIVE" && scenario.finalStatus === "EXPIRED") {
    record = await db.employerSubscription.update({
      where: { id },
      data: { status: "EXPIRED", endedAt: scenario.currentPeriodEnd },
    });
  }
  if (record.status === "CANCELLING" && scenario.finalStatus === "CANCELLED") {
    record = await db.employerSubscription.update({
      where: { id },
      data: { status: "CANCELLED", endedAt: scenario.currentPeriodEnd },
    });
  }
  const finalExpected = {
    ...expectedBase,
    status: scenario.finalStatus,
    activatedAt:
      scenario.finalStatus === "SCHEDULED"
        ? null
        : scenario.currentPeriodStart.toISOString(),
    endedAt:
      scenario.finalStatus === "EXPIRED" || scenario.finalStatus === "CANCELLED"
        ? scenario.currentPeriodEnd.toISOString()
        : null,
  } as const;
  assertProjection(
    "EmployerSubscription",
    scenario.naturalKey,
    projectSubscription(record),
    finalExpected,
  );

  if (scenario.finalStatus !== "SCHEDULED") {
    await seedSubscriptionEvent(
      db,
      id,
      `${scenario.naturalKey}:activated`,
      "ACTIVATED",
      scenario.company.ownerUserId,
      addMinutes(scenario.currentPeriodStart, 1),
    );
  }
  if (scenario.finalStatus === "EXPIRED") {
    await seedSubscriptionEvent(
      db,
      id,
      `${scenario.naturalKey}:expired`,
      "EXPIRED",
      null,
      scenario.currentPeriodEnd,
    );
  }
  if (scenario.finalStatus === "CANCELLED") {
    await seedSubscriptionEvent(
      db,
      id,
      `${scenario.naturalKey}:cancellation-scheduled`,
      "CANCELLATION_SCHEDULED",
      scenario.company.ownerUserId,
      addDays(scenario.currentPeriodEnd, -2),
    );
    await seedSubscriptionEvent(
      db,
      id,
      `${scenario.naturalKey}:cancelled`,
      "CANCELLED",
      scenario.company.ownerUserId,
      scenario.currentPeriodEnd,
    );
  }
  return id;
}

async function seedSubscriptionEvent(
  db: PrismaClient,
  subscriptionId: string,
  naturalKey: string,
  kind:
    | "ACTIVATED"
    | "CHANGE_SCHEDULED"
    | "CANCELLATION_SCHEDULED"
    | "EXPIRED"
    | "CANCELLED",
  actorUserId: string | null,
  createdAt: Date,
): Promise<void> {
  const id = stableSeedId("subscription-event", naturalKey);
  const expected = {
    id,
    subscriptionId,
    kind,
    actorUserId,
    reasonCode: "PHASE_05_DEMO_SCENARIO",
    idempotencyKey: `seed:${naturalKey}`,
    correlationId: `seed:${naturalKey}:correlation`,
    createdAt: createdAt.toISOString(),
  } as const;
  await createOrVerifySeedRecord({
    entity: "SubscriptionEvent",
    naturalKey,
    findExisting: () => db.subscriptionEvent.findUnique({ where: { id } }),
    create: () => db.subscriptionEvent.create({ data: { ...expected, createdAt } }),
    project: (record) => ({
      id: record.id,
      subscriptionId: record.subscriptionId,
      kind: record.kind,
      actorUserId: record.actorUserId,
      reasonCode: record.reasonCode,
      idempotencyKey: record.idempotencyKey,
      correlationId: record.correlationId,
      createdAt: record.createdAt.toISOString(),
    }),
    expected,
  });
}

async function seedSubscriptionSchedule(
  db: PrismaClient,
  scenario: Readonly<{
    actorUserId: string;
    company: BillingCompanyHandle;
    currentSubscriptionId: string;
    effectiveAt: Date;
    kind: "CANCEL" | "DOWNGRADE";
    naturalKey: string;
    successorSubscriptionId: string | null;
  }>,
): Promise<void> {
  const id = stableSeedId("subscription-change-schedule", scenario.naturalKey);
  const expected = {
    id,
    companyId: scenario.company.id,
    currentSubscriptionId: scenario.currentSubscriptionId,
    successorSubscriptionId: scenario.successorSubscriptionId,
    kind: scenario.kind,
    status: "PENDING",
    effectiveAt: scenario.effectiveAt.toISOString(),
    retainedMembershipIds: [scenario.company.ownerMembershipId],
    retainedDefaultOwnerId: scenario.company.ownerUserId,
    invitationRevocationScope: {
      schemaVersion: "1",
      scope: "PENDING_ONLY",
    },
    actorUserId: scenario.actorUserId,
    idempotencyKey: `seed:${scenario.naturalKey}`,
    appliedAt: null,
    revokedAt: null,
  } as const;
  await createOrVerifySeedRecord({
    entity: "SubscriptionChangeSchedule",
    naturalKey: scenario.naturalKey,
    findExisting: () =>
      db.subscriptionChangeSchedule.findUnique({ where: { id } }),
    create: () =>
      db.subscriptionChangeSchedule.create({
        data: {
          ...expected,
          effectiveAt: scenario.effectiveAt,
          retainedMembershipIds: [...expected.retainedMembershipIds],
        },
      }),
    project: (record) => ({
      id: record.id,
      companyId: record.companyId,
      currentSubscriptionId: record.currentSubscriptionId,
      successorSubscriptionId: record.successorSubscriptionId,
      kind: record.kind,
      status: record.status,
      effectiveAt: record.effectiveAt.toISOString(),
      retainedMembershipIds: [...record.retainedMembershipIds],
      retainedDefaultOwnerId: record.retainedDefaultOwnerId,
      invitationRevocationScope:
        record.invitationRevocationScope as CanonicalJsonValue,
      actorUserId: record.actorUserId,
      idempotencyKey: record.idempotencyKey,
      appliedAt: record.appliedAt?.toISOString() ?? null,
      revokedAt: record.revokedAt?.toISOString() ?? null,
    }),
    expected,
  });
}

async function seedCreditsAndBoosts(
  db: PrismaClient,
  anchorAt: Date,
  scenario: ReturnType<typeof buildBillingScenario>,
  orders: readonly PersistedOrderScenario[],
  catalog: ReferenceCatalogSeedResult,
): Promise<Readonly<{ creditAccountIds: readonly string[]; jobBoostIds: readonly string[] }>> {
  const periodStart = addDays(anchorAt, -15);
  const periodEnd = addDays(anchorAt, 15);
  const creditAccountIds: string[] = [];
  const planAccountIdByCompanyAndType = new Map<string, string>();
  const entitledCompanies = scenario.paidCompanies.filter((company) =>
    ["PRO", "BUSINESS", "ENTERPRISE_CONTRACT"].includes(company.planCode),
  );

  for (const company of entitledCompanies) {
    const planVersionNaturalKey = `${company.planCode}:v1`;
    const planVersionId = requireLookup(
      catalog.planVersionIdsByNaturalKey,
      planVersionNaturalKey,
      "PlanVersion",
    );
    for (const creditType of ["JOB_BOOST", "TALENT_CONTACT"] as const) {
      const amount = planAllowance(planVersionNaturalKey, creditType);
      const accountKey = `${company.slug}:${creditType}:plan-allowance`;
      const accountId = await seedCreditAccount(db, {
        companyId: company.id,
        creditType,
        fundingSource: "PLAN_ALLOWANCE",
        naturalKey: accountKey,
        periodEnd,
        periodStart,
      });
      creditAccountIds.push(accountId);
      planAccountIdByCompanyAndType.set(`${company.id}:${creditType}`, accountId);
      await seedCreditLedgerEntry(db, {
        accountId,
        actorUserId: null,
        amount,
        createdAt: addMinutes(periodStart, 1),
        fundingSource: "PLAN_ALLOWANCE",
        kind: "GRANT",
        naturalKey: `${accountKey}:grant`,
        reasonCode: "PERIOD_ALLOWANCE",
        sourceOrderLineId: null,
        sourcePlanVersionId: planVersionId,
        validFrom: periodStart,
        validTo: periodEnd,
      });
    }
  }

  const purchasedOrder = requireAt(orders, 0, "purchased Contact Pack order");
  const purchasedAccountKey = `${purchasedOrder.company.slug}:TALENT_CONTACT:purchased-pack`;
  const purchasedStart = addDays(anchorAt, -30);
  const purchasedEnd = addDays(anchorAt, 335);
  const purchasedAccountId = await seedCreditAccount(db, {
    companyId: purchasedOrder.company.id,
    creditType: "TALENT_CONTACT",
    fundingSource: "PURCHASED_PACK",
    naturalKey: purchasedAccountKey,
    periodEnd: purchasedEnd,
    periodStart: purchasedStart,
  });
  creditAccountIds.push(purchasedAccountId);
  await seedCreditLedgerEntry(db, {
    accountId: purchasedAccountId,
    actorUserId: purchasedOrder.company.ownerUserId,
    amount: 10,
    createdAt: addDays(anchorAt, -10),
    fundingSource: "PURCHASED_PACK",
    kind: "GRANT",
    naturalKey: `${purchasedAccountKey}:grant`,
    reasonCode: "CONTACT_PACK_PURCHASED",
    sourceOrderLineId: purchasedOrder.lineId,
    sourcePlanVersionId: null,
    validFrom: purchasedStart,
    validTo: purchasedEnd,
  });

  const directBoostOrders = orders.filter(
    (order) => order.finalStatus === "PAID" && order.line.kind === "BOOST",
  );
  if (directBoostOrders.length !== 4) {
    throw new Error("Phase-05 billing requires four directly purchased Boosts.");
  }
  const jobBoostIds: string[] = [];
  for (let index = 0; index < JOB_BOOST_COUNT; index += 1) {
    const naturalKey = boostNaturalKey(index);
    const job = requireAt(scenario.boostJobs, index, "Boost Job");
    const company = requireCompanyById(scenario.paidCompanies, job.companyId);
    const active = index === 2 || index === 3 || index >= 7;
    const startsAt = active
      ? addDays(anchorAt, -1 - (index % 3))
      : addDays(anchorAt, index < 4 ? -20 + index : -14 + (index - 4));
    const endsAt = addDays(startsAt, 7);
    let orderLineId: string | null = null;
    let consumedCreditLedgerEntryId: string | null = null;

    if (index < 4) {
      const order = requireAt(directBoostOrders, index, "direct Boost order");
      if (order.line.kind !== "BOOST" || order.line.job.id !== job.id) {
        throw new Error("Direct Boost order and Boost scenario lost alignment.");
      }
      orderLineId = order.lineId;
    } else {
      const accountId = requireMap(
        planAccountIdByCompanyAndType,
        `${company.id}:JOB_BOOST`,
        "Job Boost allowance CreditAccount",
      );
      const consumeKey = `${naturalKey}:consume`;
      consumedCreditLedgerEntryId = stableSeedId(
        "credit-ledger-entry",
        consumeKey,
      );
      await seedCreditLedgerEntry(db, {
        accountId,
        actorUserId: company.ownerUserId,
        amount: -1,
        createdAt: startsAt,
        fundingSource: "PLAN_ALLOWANCE",
        kind: "CONSUME",
        naturalKey: consumeKey,
        reasonCode: "JOB_BOOST_ACTIVATED",
        sourceOrderLineId: null,
        sourcePlanVersionId: null,
        validFrom: periodStart,
        validTo: periodEnd,
      });
    }
    const id = stableSeedId("job-boost", naturalKey);
    const expected = {
      id,
      jobId: job.id,
      companyId: company.id,
      orderLineId,
      consumedCreditLedgerEntryId,
      idempotencyKey: `seed:${naturalKey}`,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      status: active ? "ACTIVE" : "EXPIRED",
      cancellationReason: null,
      cancelledByUserId: null,
      cancelledAt: null,
      createdAt: startsAt.toISOString(),
    } as const;
    await createOrVerifySeedRecord({
      entity: "JobBoost",
      naturalKey,
      findExisting: () => db.jobBoost.findUnique({ where: { id } }),
      create: () =>
        db.jobBoost.create({
          data: { ...expected, startsAt, endsAt, createdAt: startsAt },
        }),
      project: (record) => ({
        id: record.id,
        jobId: record.jobId,
        companyId: record.companyId,
        orderLineId: record.orderLineId,
        consumedCreditLedgerEntryId: record.consumedCreditLedgerEntryId,
        idempotencyKey: record.idempotencyKey,
        startsAt: record.startsAt.toISOString(),
        endsAt: record.endsAt.toISOString(),
        status: record.status,
        cancellationReason: record.cancellationReason,
        cancelledByUserId: record.cancelledByUserId,
        cancelledAt: record.cancelledAt?.toISOString() ?? null,
        createdAt: record.createdAt.toISOString(),
      }),
      expected,
    });
    jobBoostIds.push(id);
  }
  return Object.freeze({
    creditAccountIds: Object.freeze(creditAccountIds),
    jobBoostIds: Object.freeze(jobBoostIds),
  });
}

async function seedCreditAccount(
  db: PrismaClient,
  input: Readonly<{
    companyId: string;
    creditType: "JOB_BOOST" | "TALENT_CONTACT";
    fundingSource: "PLAN_ALLOWANCE" | "PURCHASED_PACK";
    naturalKey: string;
    periodEnd: Date;
    periodStart: Date;
  }>,
): Promise<string> {
  const id = stableSeedId("credit-account", input.naturalKey);
  const expected = {
    id,
    companyId: input.companyId,
    creditType: input.creditType,
    fundingSource: input.fundingSource,
    periodStart: input.periodStart.toISOString(),
    periodEnd: input.periodEnd.toISOString(),
  } as const;
  await createOrVerifySeedRecord({
    entity: "CreditAccount",
    naturalKey: input.naturalKey,
    findExisting: () => db.creditAccount.findUnique({ where: { id } }),
    create: () =>
      db.creditAccount.create({
        data: {
          ...expected,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
        },
      }),
    project: (record) => ({
      id: record.id,
      companyId: record.companyId,
      creditType: record.creditType,
      fundingSource: record.fundingSource,
      periodStart: record.periodStart.toISOString(),
      periodEnd: record.periodEnd.toISOString(),
    }),
    expected,
  });
  return id;
}

async function seedCreditLedgerEntry(
  db: PrismaClient,
  input: Readonly<{
    accountId: string;
    actorUserId: string | null;
    amount: number;
    createdAt: Date;
    fundingSource: "PLAN_ALLOWANCE" | "PURCHASED_PACK";
    kind: "GRANT" | "CONSUME";
    naturalKey: string;
    reasonCode: string;
    sourceOrderLineId: string | null;
    sourcePlanVersionId: string | null;
    validFrom: Date;
    validTo: Date;
  }>,
): Promise<string> {
  const id = stableSeedId("credit-ledger-entry", input.naturalKey);
  const expected = {
    id,
    accountId: input.accountId,
    fundingSource: input.fundingSource,
    kind: input.kind,
    amount: input.amount,
    sourcePlanVersionId: input.sourcePlanVersionId,
    sourceOrderLineId: input.sourceOrderLineId,
    reversalOfEntryId: null,
    validFrom: input.validFrom.toISOString(),
    validTo: input.validTo.toISOString(),
    idempotencyKey: `seed:${input.naturalKey}`,
    reasonCode: input.reasonCode,
    actorUserId: input.actorUserId,
    createdAt: input.createdAt.toISOString(),
  } as const;
  await createOrVerifySeedRecord({
    entity: "CreditLedgerEntry",
    naturalKey: input.naturalKey,
    findExisting: () => db.creditLedgerEntry.findUnique({ where: { id } }),
    create: () =>
      db.creditLedgerEntry.create({
        data: {
          ...expected,
          validFrom: input.validFrom,
          validTo: input.validTo,
          createdAt: input.createdAt,
        },
      }),
    project: (record) => ({
      id: record.id,
      accountId: record.accountId,
      fundingSource: record.fundingSource,
      kind: record.kind,
      amount: record.amount,
      sourcePlanVersionId: record.sourcePlanVersionId,
      sourceOrderLineId: record.sourceOrderLineId,
      reversalOfEntryId: record.reversalOfEntryId,
      validFrom: record.validFrom.toISOString(),
      validTo: record.validTo.toISOString(),
      idempotencyKey: record.idempotencyKey,
      reasonCode: record.reasonCode,
      actorUserId: record.actorUserId,
      createdAt: record.createdAt.toISOString(),
    }),
    expected,
  });
  return id;
}

async function seedSalesLeads(
  db: PrismaClient,
  anchorAt: Date,
  companies: readonly BillingCompanyHandle[],
  adminUserId: string,
): Promise<readonly string[]> {
  const statuses = ["NEW", "CONTACTED", "QUALIFIED", "WON"] as const;
  const purposes = [
    "EMPLOYER_DEMO",
    "SALES_CONTACT",
    "ENTERPRISE",
    "IMPORT",
  ] as const;
  const ids: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    const naturalKey = `phase-05:${index + 1}`;
    const id = stableSeedId("sales-lead", naturalKey);
    const company = requireAt(companies, index, "Sales Lead Company");
    const createdAt = addDays(anchorAt, -12 + index);
    const expected = {
      id,
      companyId: company.id,
      emailNormalized: `kontakt-${index + 1}@sales.demo.invalid`,
      organizationNormalized: company.name.toLocaleLowerCase("de-CH"),
      purpose: requireAt(purposes, index, "Sales Lead purpose"),
      consentSource: "PHASE_05_DEMO_FORM",
      needSummary:
        "Fiktive Demo-Anfrage für eine nachvollziehbare Sales-Pipeline ohne echte Kontaktdaten.",
      status: requireAt(statuses, index, "Sales Lead status"),
      ownerUserId: index === 0 ? null : adminUserId,
      nextAt: index < 3 ? addDays(anchorAt, index + 2).toISOString() : null,
      retainUntil: addDays(anchorAt, 730).toISOString(),
      createdAt: createdAt.toISOString(),
    } as const;
    await createOrVerifySeedRecord({
      entity: "SalesLead",
      naturalKey,
      findExisting: () => db.salesLead.findUnique({ where: { id } }),
      create: () =>
        db.salesLead.create({
          data: {
            ...expected,
            createdAt,
            nextAt: expected.nextAt === null ? null : new Date(expected.nextAt),
            retainUntil: new Date(expected.retainUntil),
          },
        }),
      project: (record) => ({
        id: record.id,
        companyId: record.companyId,
        emailNormalized: record.emailNormalized,
        organizationNormalized: record.organizationNormalized,
        purpose: record.purpose,
        consentSource: record.consentSource,
        needSummary: record.needSummary,
        status: record.status,
        ownerUserId: record.ownerUserId,
        nextAt: record.nextAt?.toISOString() ?? null,
        retainUntil: record.retainUntil.toISOString(),
        createdAt: record.createdAt.toISOString(),
      }),
      expected,
    });

    const activityKey = `${naturalKey}:created`;
    const activityId = stableSeedId("sales-activity", activityKey);
    const activityExpected = {
      id: activityId,
      salesLeadId: id,
      kind: index === 0 ? "NOTE" : "STATUS_CHANGE",
      actorUserId: index === 0 ? null : adminUserId,
      safeNote: "Fiktiver Seed-Verlauf; keine echte Vertriebsinteraktion.",
      outcomeCode: `DEMO_${requireAt(statuses, index, "Sales activity outcome")}`,
      createdAt: addMinutes(createdAt, 10).toISOString(),
    } as const;
    await createOrVerifySeedRecord({
      entity: "SalesActivity",
      naturalKey: activityKey,
      findExisting: () => db.salesActivity.findUnique({ where: { id: activityId } }),
      create: () =>
        db.salesActivity.create({
          data: { ...activityExpected, createdAt: addMinutes(createdAt, 10) },
        }),
      project: (record) => ({
        id: record.id,
        salesLeadId: record.salesLeadId,
        kind: record.kind,
        actorUserId: record.actorUserId,
        safeNote: record.safeNote,
        outcomeCode: record.outcomeCode,
        createdAt: record.createdAt.toISOString(),
      }),
      expected: activityExpected,
    });
    ids.push(id);
  }
  return Object.freeze(ids);
}

async function seedAbuseReports(
  db: PrismaClient,
  anchorAt: Date,
  companies: readonly BillingCompanyHandle[],
  jobs: readonly BillingJobHandle[],
  adminUserId: string,
): Promise<void> {
  const firstCompany = requireAt(companies, 0, "Abuse Company");
  const targets = [
    { type: "JOB" as const, id: requireAt(jobs, 0, "Abuse Job").id },
    { type: "COMPANY" as const, id: firstCompany.id },
    { type: "USER" as const, id: firstCompany.ownerUserId },
  ];
  const severities = ["MEDIUM", "HIGH", "LOW"] as const;
  for (let index = 0; index < targets.length; index += 1) {
    const naturalKey = `phase-05:${index + 1}`;
    const id = stableSeedId("abuse-report", naturalKey);
    const target = requireAt(targets, index, "Abuse target");
    const createdAt = addDays(anchorAt, -4 + index);
    const expected = {
      id,
      targetType: target.type,
      targetId: target.id,
      reporterUserId: null,
      reasonCode: `DEMO_REVIEW_${index + 1}`,
      description:
        "Fiktiver, nicht personenbezogener Moderationsfall für die offene Admin-Queue.",
      severity: requireAt(severities, index, "Abuse severity"),
      status: "OPEN",
      assigneeUserId: index === 1 ? adminUserId : null,
      dueAt: addDays(anchorAt, index + 1).toISOString(),
      resolutionCode: null,
      resolvedAt: null,
      createdAt: createdAt.toISOString(),
    } as const;
    await createOrVerifySeedRecord({
      entity: "AbuseReport",
      naturalKey,
      findExisting: () => db.abuseReport.findUnique({ where: { id } }),
      create: () =>
        db.abuseReport.create({
          data: {
            ...expected,
            createdAt,
            dueAt: new Date(expected.dueAt),
          },
        }),
      project: (record) => ({
        id: record.id,
        targetType: record.targetType,
        targetId: record.targetId,
        reporterUserId: record.reporterUserId,
        reasonCode: record.reasonCode,
        description: record.description,
        severity: record.severity,
        status: record.status,
        assigneeUserId: record.assigneeUserId,
        dueAt: record.dueAt.toISOString(),
        resolutionCode: record.resolutionCode,
        resolvedAt: record.resolvedAt?.toISOString() ?? null,
        createdAt: record.createdAt.toISOString(),
      }),
      expected,
    });
    const eventKey = `${naturalKey}:created`;
    const eventId = stableSeedId("abuse-report-event", eventKey);
    const eventExpected = {
      id: eventId,
      abuseReportId: id,
      kind: "CREATED",
      actorUserId: null,
      reasonCode: expected.reasonCode,
      safeNote: "Automatisch erzeugter Demo-Modererationsfall.",
      correlationId: `seed:${eventKey}`,
      createdAt: createdAt.toISOString(),
    } as const;
    await createOrVerifySeedRecord({
      entity: "AbuseReportEvent",
      naturalKey: eventKey,
      findExisting: () => db.abuseReportEvent.findUnique({ where: { id: eventId } }),
      create: () =>
        db.abuseReportEvent.create({ data: { ...eventExpected, createdAt } }),
      project: (record) => ({
        id: record.id,
        abuseReportId: record.abuseReportId,
        kind: record.kind,
        actorUserId: record.actorUserId,
        reasonCode: record.reasonCode,
        safeNote: record.safeNote,
        correlationId: record.correlationId,
        createdAt: record.createdAt.toISOString(),
      }),
      expected: eventExpected,
    });
  }
}

async function seedAuditLogs(
  db: PrismaClient,
  anchorAt: Date,
  companies: readonly BillingCompanyHandle[],
  jobs: readonly BillingJobHandle[],
  invoiceIds: readonly string[],
  boostIds: readonly string[],
  salesLeadIds: readonly string[],
  adminUserId: string,
): Promise<readonly string[]> {
  const definitions = [
    ["JOB_APPROVED", "JOB", "jobs"],
    ["JOB_REJECTED", "JOB", "jobs"],
    ["COMPANY_VERIFIED", "COMPANY", "companies"],
    ["INVOICE_PAID", "INVOICE", "invoices"],
    ["CREDITS_GRANTED", "CREDIT_LEDGER_ENTRY", "credits"],
    ["USER_SUSPENDED", "USER", "users"],
    ["ORDER_PAID", "ORDER", "orders"],
    ["JOB_BOOST_ACTIVATED", "JOB_BOOST", "boosts"],
    ["LEAD_STATUS_CHANGED", "SALES_LEAD", "leads"],
    ["CONTENT_PUBLISHED", "CONTENT_REVISION", "content"],
  ] as const;
  const ids: string[] = [];
  for (let index = 0; index < AUDIT_COUNT; index += 1) {
    const naturalKey = `phase-05:${index + 1}`;
    const id = stableSeedId("audit-log", naturalKey);
    const definition = requireAt(definitions, index % definitions.length, "Audit definition");
    const company = requireAt(companies, index % companies.length, "Audit Company");
    const targetId = resolveAuditTarget(
      definition[2],
      index,
      company,
      companies,
      jobs,
      invoiceIds,
      boostIds,
      salesLeadIds,
      adminUserId,
    );
    const createdAt = addMinutes(addDays(anchorAt, -10), index * 15);
    const expected = {
      id,
      actorUserId: adminUserId,
      actorKind: "USER",
      capability: `seed.demo.${definition[0].toLocaleLowerCase("en-US")}`,
      action: definition[0],
      targetType: definition[1],
      targetId,
      companyId: definition[1] === "COMPANY" ? company.id : null,
      result: "SUCCEEDED",
      reasonCode: "PHASE_05_DEMO_EVIDENCE",
      correlationId: `seed:audit:${index + 1}`,
      metadata: { fixture: true, schemaVersion: "1", scenario: definition[0] },
      ipHash: null,
      ipHashVersion: null,
      retainUntil: addDays(createdAt, 400).toISOString(),
      createdAt: createdAt.toISOString(),
    } as const;
    await createOrVerifySeedRecord({
      entity: "AuditLog",
      naturalKey,
      findExisting: () => db.auditLog.findUnique({ where: { id } }),
      create: () =>
        db.auditLog.create({
          data: {
            ...expected,
            createdAt,
            retainUntil: new Date(expected.retainUntil),
          },
        }),
      project: (record) => ({
        id: record.id,
        actorUserId: record.actorUserId,
        actorKind: record.actorKind,
        capability: record.capability,
        action: record.action,
        targetType: record.targetType,
        targetId: record.targetId,
        companyId: record.companyId,
        result: record.result,
        reasonCode: record.reasonCode,
        correlationId: record.correlationId,
        metadata: record.metadata as CanonicalJsonValue,
        ipHash: record.ipHash,
        ipHashVersion: record.ipHashVersion,
        retainUntil: record.retainUntil.toISOString(),
        createdAt: record.createdAt.toISOString(),
      }),
      expected,
    });
    ids.push(id);
  }
  return Object.freeze(ids);
}

async function seedAnalyticsEvents(
  db: PrismaClient,
  anchorAt: Date,
  companies: readonly BillingCompanyHandle[],
  jobs: readonly BillingJobHandle[],
): Promise<readonly string[]> {
  const ids: string[] = [];
  const fixtures = buildAnalyticsSeedFixtures(anchorAt, companies, jobs);
  for (const fixture of fixtures) {
    const contract = ANALYTICS_EVENT_CONTRACTS_V1[fixture.kind];
    const occurredAt = new Date(fixture.occurredAt);
    const expected = {
      id: fixture.id,
      producer: "phase-05-demo-seed",
      dedupeKey: fixture.dedupeKey,
      kind: fixture.kind,
      schemaVersion: ANALYTICS_SCHEMA_VERSION_V1,
      purpose: contract.purpose,
      occurredAt: occurredAt.toISOString(),
      receivedAt: addMinutes(occurredAt, 1).toISOString(),
      pseudonymousActorId: fixture.pseudonymousActorId,
      pseudonymousSessionId: fixture.pseudonymousSessionId,
      companyId: fixture.companyId,
      jobId: fixture.jobId,
      actorProvenanceSnapshot: "DEMO",
      companyProvenanceSnapshot:
        fixture.companyId === null ? null : "DEMO",
      jobProvenanceSnapshot: fixture.jobId === null ? null : "DEMO",
      properties: fixture.properties,
      retainUntil: getAnalyticsRetainUntilV1(
        fixture.kind,
        occurredAt,
      ).toISOString(),
    } as const;
    await createOrVerifySeedRecord({
      entity: "AnalyticsEvent",
      naturalKey: fixture.naturalKey,
      findExisting: () =>
        db.analyticsEvent.findUnique({ where: { id: fixture.id } }),
      create: () =>
        db.analyticsEvent.create({
          data: {
            ...expected,
            occurredAt,
            receivedAt: addMinutes(occurredAt, 1),
            properties: fixture.properties as Prisma.InputJsonValue,
            retainUntil: new Date(expected.retainUntil),
          },
        }),
      project: (record) => ({
        id: record.id,
        producer: record.producer,
        dedupeKey: record.dedupeKey,
        kind: record.kind,
        schemaVersion: record.schemaVersion,
        purpose: record.purpose,
        occurredAt: record.occurredAt.toISOString(),
        receivedAt: record.receivedAt.toISOString(),
        pseudonymousActorId: record.pseudonymousActorId,
        pseudonymousSessionId: record.pseudonymousSessionId,
        companyId: record.companyId,
        jobId: record.jobId,
        actorProvenanceSnapshot: record.actorProvenanceSnapshot,
        companyProvenanceSnapshot: record.companyProvenanceSnapshot,
        jobProvenanceSnapshot: record.jobProvenanceSnapshot,
        properties: record.properties as CanonicalJsonValue,
        retainUntil: record.retainUntil.toISOString(),
      }),
      expected,
    });
    ids.push(fixture.id);
  }
  return Object.freeze(ids);
}

type AnalyticsSeedSpec = Readonly<{
  cohort: AnalyticsSeedCohort;
  cohortKey: string;
  companyId: string | null;
  jobId: string | null;
  kind: AnalyticsEventKind;
  occurredAt: Date;
  pseudonymousActorId: string;
  pseudonymousSessionId: string;
}>;

/**
 * Builds real, ordered demo cohorts instead of rotating independent event
 * fields. Lead and Order subjects use stable pseudonymous correlation keys
 * derived from their canonical seed IDs because AnalyticsEvent intentionally
 * stores neither raw Lead nor Order identifiers.
 */
export function buildAnalyticsSeedFixtures(
  anchorAt: Date,
  companies: readonly BillingCompanyHandle[],
  jobs: readonly BillingJobHandle[],
): readonly AnalyticsSeedFixture[] {
  if (!(anchorAt instanceof Date) || !Number.isFinite(anchorAt.getTime())) {
    throw new TypeError("Analytics seed fixtures require a valid anchorAt.");
  }
  const specs: AnalyticsSeedSpec[] = [];
  const eligibleCandidates = CANDIDATE_FIXTURES.filter(
    (candidate) => candidate.finalOnboardingStatus === "COMPLETE",
  ).slice(0, ANALYTICS_SEED_COHORT_CONTRACT.candidateActivation.registered);
  if (
    eligibleCandidates.length !==
    ANALYTICS_SEED_COHORT_CONTRACT.candidateActivation.registered
  ) {
    throw new Error("Analytics seed requires twenty complete Candidate fixtures.");
  }

  for (const [index, candidate] of eligibleCandidates.entries()) {
    const userId = stableSeedId("user", candidate.email);
    const actorKey = analyticsPseudonym("candidate", userId);
    const sessionKey = analyticsPseudonym("candidate-onboarding", userId);
    const registeredAt = addMinutes(addDays(anchorAt, -24), index * 10);
    specs.push({
      cohort: "CANDIDATE_ACTIVATION",
      cohortKey: actorKey,
      companyId: null,
      jobId: null,
      kind: AnalyticsEventKind.CANDIDATE_REGISTERED,
      occurredAt: registeredAt,
      pseudonymousActorId: actorKey,
      pseudonymousSessionId: sessionKey,
    });
    if (index < ANALYTICS_SEED_COHORT_CONTRACT.candidateActivation.completed) {
      const completionDays =
        index < ANALYTICS_SEED_COHORT_CONTRACT.candidateActivation.timely
          ? 2
          : 8;
      specs.push({
        cohort: "CANDIDATE_ACTIVATION",
        cohortKey: actorKey,
        companyId: null,
        jobId: null,
        kind: AnalyticsEventKind.CANDIDATE_PROFILE_COMPLETED,
        occurredAt: addDays(registeredAt, completionDays),
        pseudonymousActorId: actorKey,
        pseudonymousSessionId: sessionKey,
      });
    }
  }

  const publishedJobs = [...jobs]
    .filter((job) => job.status === "PUBLISHED")
    .sort(compareBySlug);
  const activationPairs = [...companies]
    .sort(compareBySlug)
    .map((company) => ({
      company,
      job: publishedJobs.find((job) => job.companyId === company.id),
    }))
    .filter(
      (pair): pair is Readonly<{
        company: BillingCompanyHandle;
        job: BillingJobHandle;
      }> => pair.job !== undefined,
    )
    .slice(0, ANALYTICS_SEED_COHORT_CONTRACT.employerActivation.onboarded);
  if (
    activationPairs.length !==
    ANALYTICS_SEED_COHORT_CONTRACT.employerActivation.onboarded
  ) {
    throw new Error("Analytics seed requires twenty publish-capable Companies.");
  }

  for (const [index, { company, job }] of activationPairs.entries()) {
    const actorKey = analyticsPseudonym("employer", company.ownerUserId);
    const sessionKey = analyticsPseudonym("employer-onboarding", company.id);
    const registeredAt = addMinutes(addDays(anchorAt, -22), index * 10);
    const onboardedAt = addDays(registeredAt, 1);
    for (const [kind, occurredAt, selectedJob] of [
      [AnalyticsEventKind.EMPLOYER_REGISTERED, registeredAt, null],
      [AnalyticsEventKind.COMPANY_ONBOARDING_COMPLETED, onboardedAt, null],
    ] as const) {
      specs.push({
        cohort: "EMPLOYER_ACTIVATION",
        cohortKey: company.id,
        companyId: company.id,
        jobId: selectedJob,
        kind,
        occurredAt,
        pseudonymousActorId: actorKey,
        pseudonymousSessionId: sessionKey,
      });
    }
    if (index < ANALYTICS_SEED_COHORT_CONTRACT.employerActivation.published) {
      const publicationDays =
        index < ANALYTICS_SEED_COHORT_CONTRACT.employerActivation.timely
          ? 5
          : 15;
      specs.push({
        cohort: "EMPLOYER_ACTIVATION",
        cohortKey: company.id,
        companyId: company.id,
        jobId: job.id,
        kind: AnalyticsEventKind.JOB_PUBLISHED,
        occurredAt: addDays(onboardedAt, publicationDays),
        pseudonymousActorId: actorKey,
        pseudonymousSessionId: sessionKey,
      });
    }
  }

  for (
    let index = 0;
    index < ANALYTICS_SEED_COHORT_CONTRACT.searchToApply.resultSessions;
    index += 1
  ) {
    const candidate = requireAt(eligibleCandidates, index, "Search Candidate");
    const job = requireAt(publishedJobs, index, "Search Job");
    const company = requireCompanyById(companies, job.companyId);
    const actorKey = analyticsPseudonym(
      "candidate",
      stableSeedId("user", candidate.email),
    );
    const sessionKey = analyticsPseudonym(
      "search",
      `${stableSeedId("user", candidate.email)}:${job.id}`,
    );
    const submittedAt = addMinutes(addDays(anchorAt, -9), index * 20);
    const stages: Array<Readonly<{
      companyId: string | null;
      jobId: string | null;
      kind: AnalyticsEventKind;
      minute: number;
    }>> = [
      { companyId: null, jobId: null, kind: AnalyticsEventKind.SEARCH_SUBMITTED, minute: 0 },
      { companyId: null, jobId: null, kind: AnalyticsEventKind.SEARCH_RESULTS_VIEWED, minute: 1 },
    ];
    if (index < ANALYTICS_SEED_COHORT_CONTRACT.searchToApply.detailSessions) {
      stages.push({
        companyId: company.id,
        jobId: job.id,
        kind: AnalyticsEventKind.JOB_DETAIL_VIEWED,
        minute: 2,
      });
    }
    if (index < ANALYTICS_SEED_COHORT_CONTRACT.searchToApply.intentSessions) {
      stages.push({
        companyId: company.id,
        jobId: job.id,
        kind: AnalyticsEventKind.APPLY_INTENT_STARTED,
        minute: 3,
      });
    }
    if (index < ANALYTICS_SEED_COHORT_CONTRACT.searchToApply.submittedSessions) {
      stages.push({
        companyId: company.id,
        jobId: job.id,
        kind: AnalyticsEventKind.APPLICATION_SUBMITTED,
        minute: 4,
      });
    }
    for (const stage of stages) {
      specs.push({
        cohort: "SEARCH_TO_APPLY",
        cohortKey: sessionKey,
        companyId: stage.companyId,
        jobId: stage.jobId,
        kind: stage.kind,
        occurredAt: addMinutes(submittedAt, stage.minute),
        pseudonymousActorId: actorKey,
        pseudonymousSessionId: sessionKey,
      });
    }
  }

  for (
    let index = 0;
    index < ANALYTICS_SEED_COHORT_CONTRACT.leadFunnel.submitted;
    index += 1
  ) {
    const company = requireAt(companies, index, "Analytics Lead Company");
    const leadId = stableSeedId("sales-lead", `phase-05:${index + 1}`);
    const leadKey = analyticsPseudonym("lead", leadId);
    const actorKey = analyticsPseudonym("sales-actor", company.ownerUserId);
    const submittedAt = addMinutes(addDays(anchorAt, -12 + index), 30);
    const stages: Array<Readonly<{ kind: AnalyticsEventKind; day: number }>> = [
      { kind: AnalyticsEventKind.LEAD_SUBMITTED, day: 0 },
    ];
    if (index < ANALYTICS_SEED_COHORT_CONTRACT.leadFunnel.qualified) {
      stages.push({ kind: AnalyticsEventKind.LEAD_QUALIFIED, day: 1 });
    }
    if (index < ANALYTICS_SEED_COHORT_CONTRACT.leadFunnel.won) {
      stages.push({ kind: AnalyticsEventKind.LEAD_WON, day: 2 });
    }
    for (const stage of stages) {
      specs.push({
        cohort: "LEAD_FUNNEL",
        cohortKey: leadKey,
        companyId: company.id,
        jobId: null,
        kind: stage.kind,
        occurredAt: addDays(submittedAt, stage.day),
        pseudonymousActorId: actorKey,
        pseudonymousSessionId: leadKey,
      });
    }
  }

  const orderScenarios = buildBillingScenario(companies, jobs).orders;
  for (const scenario of orderScenarios) {
    const orderId = stableSeedId("order", orderNaturalKey(scenario.index));
    const orderKey = analyticsPseudonym("order", orderId);
    const actorKey = analyticsPseudonym(
      "checkout-actor",
      scenario.company.ownerUserId,
    );
    const startedAt = addMinutes(addDays(anchorAt, -7), scenario.index * 60);
    const stages: Array<Readonly<{ kind: AnalyticsEventKind; minute: number }>> = [
      { kind: AnalyticsEventKind.PRICING_VIEWED, minute: -10 },
      { kind: AnalyticsEventKind.CHECKOUT_STARTED, minute: 0 },
    ];
    if (scenario.finalStatus === "PAID") {
      stages.push({ kind: AnalyticsEventKind.CHECKOUT_COMPLETED, minute: 30 });
    }
    for (const stage of stages) {
      specs.push({
        cohort: "CHECKOUT_FUNNEL",
        cohortKey: orderKey,
        companyId: scenario.company.id,
        jobId: null,
        kind: stage.kind,
        occurredAt: addMinutes(startedAt, stage.minute),
        pseudonymousActorId: actorKey,
        pseudonymousSessionId: orderKey,
      });
    }
  }

  for (
    let index = 0;
    index < ANALYTICS_SEED_COHORT_CONTRACT.suppressionSearchSessions;
    index += 1
  ) {
    const actorKey = analyticsPseudonym("suppression-actor", String(index + 1));
    const sessionKey = analyticsPseudonym("suppression-search", String(index + 1));
    specs.push({
      cohort: "SEARCH_SUPPRESSION",
      cohortKey: sessionKey,
      companyId: null,
      jobId: null,
      kind: AnalyticsEventKind.SEARCH_RESULTS_VIEWED,
      occurredAt: addMinutes(addDays(anchorAt, -4), index * 5),
      pseudonymousActorId: actorKey,
      pseudonymousSessionId: sessionKey,
    });
  }

  // The 300-row Phase-05 analytics stream is sealed evidence. Phase 09 adds
  // EXTERNAL_APPLY_CLICKED to the runtime taxonomy, but inserting it into this
  // modulo stream would silently rewrite every subsequent deterministic row.
  // External-click behavior has dedicated action/contract tests instead.
  const sealedSeedKinds = ANALYTICS_EVENT_KINDS_V1.filter(
    (kind) => kind !== AnalyticsEventKind.EXTERNAL_APPLY_CLICKED,
  );
  const backgroundCount = ANALYTICS_COUNT - specs.length;
  if (backgroundCount < sealedSeedKinds.length) {
    throw new Error("Analytics seed background cannot cover the closed taxonomy.");
  }
  for (let index = 0; index < backgroundCount; index += 1) {
    const kind = requireAt(
      sealedSeedKinds,
      index % sealedSeedKinds.length,
      "Background Analytics kind",
    );
    const company = requireAt(
      companies,
      index % companies.length,
      "Background Analytics Company",
    );
    const job = requireAt(
      publishedJobs,
      index % publishedJobs.length,
      "Background Analytics Job",
    );
    const dimensions = analyticsDimensions(kind, company, job);
    const eventKey = analyticsPseudonym("background", `${kind}:${index + 1}`);
    specs.push({
      cohort: "BACKGROUND",
      cohortKey: eventKey,
      companyId: dimensions.companyId,
      jobId: dimensions.jobId,
      kind,
      occurredAt: addMinutes(addDays(anchorAt, -3), index * 10),
      pseudonymousActorId: analyticsPseudonym("background-actor", String(index + 1)),
      pseudonymousSessionId: eventKey,
    });
  }

  if (specs.length !== ANALYTICS_COUNT) {
    throw new Error(
      `Analytics seed requires exactly ${ANALYTICS_COUNT} events; received ${specs.length}.`,
    );
  }
  const fixtures = specs.map((spec, index) => {
    const naturalKey = `phase-05:${index + 1}`;
    const properties = analyticsProperties(spec.kind, index);
    ANALYTICS_EVENT_CONTRACTS_V1[spec.kind].propertiesSchema.parse(properties);
    return Object.freeze({
      ...spec,
      dedupeKey: `seed:analytics:${index + 1}`,
      id: stableSeedId("analytics-event", naturalKey),
      naturalKey,
      properties,
    });
  });
  const coveredKinds = new Set(fixtures.map((fixture) => fixture.kind));
  if (
    coveredKinds.size !== sealedSeedKinds.length ||
    sealedSeedKinds.some((kind) => !coveredKinds.has(kind))
  ) {
    throw new Error("Analytics seed does not cover the closed v1 taxonomy.");
  }
  return Object.freeze(fixtures);
}

function analyticsPseudonym(scope: string, sourceId: string): string {
  const digest = createHash("sha256")
    .update(`phase-05:${scope}:${sourceId}`, "utf8")
    .digest("hex")
    .slice(0, 24);
  return `demo-${scope}-${digest}`;
}

function analyticsDimensions(
  kind: AnalyticsEventKind,
  company: BillingCompanyHandle,
  job: BillingJobHandle,
): Readonly<{ companyId: string | null; jobId: string | null }> {
  const jobKinds = new Set<AnalyticsEventKind>([
    AnalyticsEventKind.JOB_DETAIL_VIEWED,
    AnalyticsEventKind.JOB_SAVED,
    AnalyticsEventKind.APPLY_INTENT_STARTED,
    AnalyticsEventKind.EXTERNAL_APPLY_CLICKED,
    AnalyticsEventKind.APPLICATION_SUBMITTED,
    AnalyticsEventKind.APPLICATION_STATUS_CHANGED,
    AnalyticsEventKind.JOB_DRAFT_CREATED,
    AnalyticsEventKind.JOB_SUBMITTED,
    AnalyticsEventKind.JOB_PUBLISHED,
    AnalyticsEventKind.EMPLOYER_RESPONSE_RECORDED,
    AnalyticsEventKind.BOOST_ACTIVATED,
  ]);
  const companyKinds = new Set<AnalyticsEventKind>([
    ...jobKinds,
    AnalyticsEventKind.EMPLOYER_REGISTERED,
    AnalyticsEventKind.COMPANY_ONBOARDING_COMPLETED,
    AnalyticsEventKind.COMPANY_VERIFICATION_SUBMITTED,
    AnalyticsEventKind.COMPANY_VERIFIED,
    AnalyticsEventKind.CONTACT_REQUEST_SENT,
    AnalyticsEventKind.CONTACT_REQUEST_ACCEPTED,
    AnalyticsEventKind.CONTACT_REQUEST_DECLINED,
    AnalyticsEventKind.IDENTITY_REVEAL_GRANTED,
    AnalyticsEventKind.PRICING_VIEWED,
    AnalyticsEventKind.LIMIT_REACHED,
    AnalyticsEventKind.CHECKOUT_STARTED,
    AnalyticsEventKind.CHECKOUT_COMPLETED,
    AnalyticsEventKind.SUBSCRIPTION_CHANGED,
    AnalyticsEventKind.LEAD_SUBMITTED,
    AnalyticsEventKind.LEAD_QUALIFIED,
    AnalyticsEventKind.LEAD_WON,
  ]);
  return Object.freeze({
    companyId: companyKinds.has(kind) ? company.id : null,
    jobId: jobKinds.has(kind) ? job.id : null,
  });
}

function analyticsProperties(
  kind: AnalyticsEventKind,
  index: number,
): CanonicalJsonValue {
  switch (kind) {
    case AnalyticsEventKind.PUBLIC_VALUE_VIEWED:
      return {
        surface: "JOB_SEARCH",
        locale: "de-CH",
        cantonCode: "ZH",
        categorySlug: "engineering-technik",
      };
    case AnalyticsEventKind.SEARCH_SUBMITTED:
      return {
        surface: "JOB_SEARCH",
        locale: "de-CH",
        sort: "relevance",
        intent: "BROWSE",
      };
    case AnalyticsEventKind.SEARCH_RESULTS_VIEWED:
      return {
        surface: "JOB_SEARCH",
        locale: "de-CH",
        sort: "relevance",
        intent: "BROWSE",
        resultCountBucket: index % 5 === 0 ? "1-9" : "50+",
      };
    case AnalyticsEventKind.JOB_DETAIL_VIEWED:
      return {
        surface: "JOB_DETAIL",
        locale: "de-CH",
        placement: index % 4 === 0 ? "SEARCH_SPONSORED" : "ORGANIC",
      };
    case AnalyticsEventKind.JOB_SAVED:
      return { surface: "JOB_DETAIL", intent: "SAVE" };
    case AnalyticsEventKind.APPLY_INTENT_STARTED:
      return { surface: "JOB_DETAIL", intent: "APPLY" };
    case AnalyticsEventKind.EXTERNAL_APPLY_CLICKED:
      return {
        surface: "JOB_DETAIL",
        intent: "APPLY",
        destinationKind: "EXTERNAL_HTTP_URL",
      };
    case AnalyticsEventKind.CANDIDATE_REGISTERED:
    case AnalyticsEventKind.CANDIDATE_PROFILE_COMPLETED:
    case AnalyticsEventKind.RADAR_OPTED_IN:
    case AnalyticsEventKind.EMPLOYER_REGISTERED:
    case AnalyticsEventKind.COMPANY_ONBOARDING_COMPLETED:
      return {
        onboardingRuleVersion: "phase-05-v1",
        completionPercentBucket: index % 3 === 0 ? "75-99" : "100",
      };
    case AnalyticsEventKind.JOB_ALERT_ACTIVATED:
      return {
        onboardingRuleVersion: "phase-05-v1",
        completionPercentBucket: "100",
        alertFrequency: index % 2 === 0 ? "DAILY" : "WEEKLY",
      };
    case AnalyticsEventKind.APPLICATION_SUBMITTED:
    case AnalyticsEventKind.APPLICATION_STATUS_CHANGED:
      return {
        fromStatus: "SUBMITTED",
        toStatus: "IN_REVIEW",
        applicationEffort: "MEDIUM",
      };
    case AnalyticsEventKind.JOB_DRAFT_CREATED:
    case AnalyticsEventKind.JOB_SUBMITTED:
    case AnalyticsEventKind.JOB_PUBLISHED:
      return {
        fromStatus: "DRAFT",
        toStatus: kind === AnalyticsEventKind.JOB_PUBLISHED ? "PUBLISHED" : "SUBMITTED",
        applicationEffort: "SIMPLE",
      };
    case AnalyticsEventKind.CONTACT_REQUEST_SENT:
    case AnalyticsEventKind.CONTACT_REQUEST_ACCEPTED:
    case AnalyticsEventKind.CONTACT_REQUEST_DECLINED:
    case AnalyticsEventKind.IDENTITY_REVEAL_GRANTED:
      return { fundingSource: index % 2 === 0 ? "PLAN_ALLOWANCE" : "ADMIN_GRANT" };
    case AnalyticsEventKind.PRICING_VIEWED:
      return { surface: "PRICING", planSlug: "pro" };
    case AnalyticsEventKind.LIMIT_REACHED:
      return { planSlug: "starter" };
    case AnalyticsEventKind.CHECKOUT_STARTED:
    case AnalyticsEventKind.CHECKOUT_COMPLETED:
    case AnalyticsEventKind.SUBSCRIPTION_CHANGED:
      return { planSlug: "pro", amountRappen: 39_900 };
    case AnalyticsEventKind.LEAD_SUBMITTED:
    case AnalyticsEventKind.LEAD_QUALIFIED:
    case AnalyticsEventKind.LEAD_WON:
      return { leadPurpose: index % 2 === 0 ? "EMPLOYER_DEMO" : "ENTERPRISE" };
    case AnalyticsEventKind.BOOST_ACTIVATED:
      return {
        productSlug: "boost-7d",
        fundingSource: index % 2 === 0 ? "PLAN_ALLOWANCE" : "PURCHASED_PACK",
        placement: "SEARCH_SPONSORED",
      };
    case AnalyticsEventKind.MODERATION_ACTIONED:
      return { fromStatus: "OPEN", toStatus: "IN_REVIEW" };
    case AnalyticsEventKind.COMPANY_VERIFICATION_SUBMITTED:
    case AnalyticsEventKind.COMPANY_VERIFIED:
    case AnalyticsEventKind.EMPLOYER_RESPONSE_RECORDED:
      return {};
  }
}

async function seedContentPages(
  db: PrismaClient,
  anchorAt: Date,
  adminUserId: string,
): Promise<readonly string[]> {
  const ids: string[] = [];
  for (const [index, guide] of DEMO_GUIDE_FIXTURES.entries()) {
    const pageId = stableSeedId("content-page", guide.slug);
    const revisionNaturalKey = `${guide.slug}:1`;
    const revisionId = stableSeedId("content-revision", revisionNaturalKey);
    const createdAt = addDays(anchorAt, -40 + index);
    let page = await db.contentPage.findUnique({ where: { slug: guide.slug } });
    if (page === null) {
      page = await db.contentPage.create({
        data: {
          id: pageId,
          slug: guide.slug,
          locale: guide.locale,
          type: guide.type,
          canonicalPath: guide.canonicalPath,
          dataProvenance: "DEMO",
          currentPublishedRevisionId: null,
          createdAt,
        },
      });
    }
    assertContentPageSnapshot(page, guide, pageId, revisionId);

    const contentHash = createHash("sha256")
      .update(`${guide.title}\n${guide.excerpt}\n${guide.body}`, "utf8")
      .digest("hex");
    let revision = await db.contentRevision.findUnique({
      where: { contentPageId_revisionNumber: { contentPageId: pageId, revisionNumber: 1 } },
    });
    if (revision === null) {
      revision = await db.contentRevision.create({
        data: {
          id: revisionId,
          contentPageId: pageId,
          revisionNumber: 1,
          status: "DRAFT",
          title: guide.title,
          excerpt: guide.excerpt,
          body: guide.body,
          heroMetadata: { fixture: true, theme: "guide" },
          authoredByUserId: adminUserId,
          contentHash,
          reviewedAt: null,
          publishedAt: null,
          createdAt,
        },
      });
    }
    assertContentRevisionAuthoredSnapshot(
      revision,
      guide,
      revisionId,
      pageId,
      adminUserId,
      contentHash,
    );
    if (revision.status === "DRAFT") {
      revision = await db.contentRevision.update({
        where: { id: revisionId },
        data: { status: "IN_REVIEW", version: { increment: 1 } },
      });
    }
    const reviewedAt = addMinutes(createdAt, 20);
    if (revision.status === "IN_REVIEW") {
      revision = await db.contentRevision.update({
        where: { id: revisionId },
        data: { status: "APPROVED", reviewedAt, version: { increment: 1 } },
      });
    }
    const publishedAt = addMinutes(createdAt, 30);
    if (revision.status === "APPROVED") {
      revision = await db.contentRevision.update({
        where: { id: revisionId },
        data: { status: "PUBLISHED", publishedAt, version: { increment: 1 } },
      });
    }
    if (
      revision.status !== "PUBLISHED" ||
      revision.reviewedAt?.getTime() !== reviewedAt.getTime() ||
      revision.publishedAt?.getTime() !== publishedAt.getTime()
    ) {
      throw new SeedDataDriftError("ContentRevision", revisionNaturalKey);
    }

    if (page.currentPublishedRevisionId === null) {
      page = await db.contentPage.update({
        where: { id: pageId },
        data: { currentPublishedRevisionId: revisionId },
      });
    }
    if (page.currentPublishedRevisionId !== revisionId) {
      throw new SeedDataDriftError("ContentPage", guide.slug);
    }
    await seedContentEvents(
      db,
      guide.slug,
      pageId,
      revisionId,
      adminUserId,
      createdAt,
    );
    ids.push(pageId);
  }
  return Object.freeze(ids);
}

async function seedContentEvents(
  db: PrismaClient,
  slug: string,
  contentPageId: string,
  contentRevisionId: string,
  actorUserId: string,
  createdAt: Date,
): Promise<void> {
  const definitions = [
    ["drafted", "DRAFTED", 0],
    ["submitted", "SUBMITTED_FOR_REVIEW", 10],
    ["approved", "APPROVED", 20],
    ["published", "PUBLISHED", 30],
  ] as const;
  for (const [suffix, kind, minuteOffset] of definitions) {
    const naturalKey = `${slug}:1:${suffix}`;
    const id = stableSeedId("content-event", naturalKey);
    const eventAt = addMinutes(createdAt, minuteOffset);
    const expected = {
      id,
      contentPageId,
      contentRevisionId,
      kind,
      actorUserId,
      reasonCode: "PHASE_05_ORIGINAL_DEMO_GUIDE",
      correlationId: `seed:${naturalKey}`,
      createdAt: eventAt.toISOString(),
    } as const;
    await createOrVerifySeedRecord({
      entity: "ContentEvent",
      naturalKey,
      findExisting: () => db.contentEvent.findUnique({ where: { id } }),
      create: () =>
        db.contentEvent.create({ data: { ...expected, createdAt: eventAt } }),
      project: (record) => ({
        id: record.id,
        contentPageId: record.contentPageId,
        contentRevisionId: record.contentRevisionId,
        kind: record.kind,
        actorUserId: record.actorUserId,
        reasonCode: record.reasonCode,
        correlationId: record.correlationId,
        createdAt: record.createdAt.toISOString(),
      }),
      expected,
    });
  }
}

async function seedSupportAndSystemTasks(
  db: PrismaClient,
  anchorAt: Date,
  companies: readonly BillingCompanyHandle[],
  adminUserId: string,
): Promise<void> {
  const supportDefinitions = [
    {
      category: "BILLING" as const,
      priority: "HIGH" as const,
      status: "TRIAGED" as const,
      subject: "Demo: Rechnung im Portal einordnen",
      description:
        "Fiktiver Supportfall zur Darstellung einer priorisierten Billing-Anfrage ohne echte Personen- oder Zahlungsdaten.",
    },
    {
      category: "ACCOUNT" as const,
      priority: "NORMAL" as const,
      status: "OPEN" as const,
      subject: "Demo: Teamzugang vorbereiten",
      description:
        "Fiktiver Supportfall für die leere und offene Bearbeitungsansicht im Arbeitgeberkonto.",
    },
  ];
  for (let index = 0; index < supportDefinitions.length; index += 1) {
    const naturalKey = `phase-05:${index + 1}`;
    const id = stableSeedId("support-case", naturalKey);
    const company = requireAt(companies, index, "Support Company");
    const definition = requireAt(
      supportDefinitions,
      index,
      "Support definition",
    );
    const createdAt = addDays(anchorAt, -2 + index);
    const expected = {
      id,
      requesterUserId: company.ownerUserId,
      companyId: company.id,
      category: definition.category,
      priority: definition.priority,
      status: definition.status,
      subject: definition.subject,
      description: definition.description,
      assigneeUserId: index === 0 ? adminUserId : null,
      dueAt: addDays(anchorAt, index + 1).toISOString(),
      correlationId: `seed:support:${index + 1}`,
      createdAt: createdAt.toISOString(),
    } as const;
    await createOrVerifySeedRecord({
      entity: "SupportCase",
      naturalKey,
      findExisting: () => db.supportCase.findUnique({ where: { id } }),
      create: () =>
        db.supportCase.create({
          data: { ...expected, dueAt: new Date(expected.dueAt), createdAt },
        }),
      project: (record) => ({
        id: record.id,
        requesterUserId: record.requesterUserId,
        companyId: record.companyId,
        category: record.category,
        priority: record.priority,
        status: record.status,
        subject: record.subject,
        description: record.description,
        assigneeUserId: record.assigneeUserId,
        dueAt: record.dueAt.toISOString(),
        correlationId: record.correlationId,
        createdAt: record.createdAt.toISOString(),
      }),
      expected,
    });
    const eventDefinitions = index === 0
      ? (["CREATED", "TRIAGED"] as const)
      : (["CREATED", "REPLIED"] as const);
    for (const [eventIndex, kind] of eventDefinitions.entries()) {
      const eventOrdinal = index * 2 + eventIndex + 1;
      const eventKey = `phase-05:${eventOrdinal}`;
      const eventId = stableSeedId("support-case-event", eventKey);
      const eventAt = addMinutes(createdAt, eventIndex * 15);
      const eventExpected = {
        id: eventId,
        supportCaseId: id,
        kind,
        actorUserId: eventIndex === 0 ? company.ownerUserId : adminUserId,
        safeBody: "Fiktiver Supportverlauf ohne sensible Freitextdaten.",
        reasonCode: "PHASE_05_DEMO_SUPPORT",
        correlationId: `seed:support-event:${eventOrdinal}`,
        createdAt: eventAt.toISOString(),
      } as const;
      await createOrVerifySeedRecord({
        entity: "SupportCaseEvent",
        naturalKey: eventKey,
        findExisting: () => db.supportCaseEvent.findUnique({ where: { id: eventId } }),
        create: () =>
          db.supportCaseEvent.create({
            data: { ...eventExpected, createdAt: eventAt },
          }),
        project: (record) => ({
          id: record.id,
          supportCaseId: record.supportCaseId,
          kind: record.kind,
          actorUserId: record.actorUserId,
          safeBody: record.safeBody,
          reasonCode: record.reasonCode,
          correlationId: record.correlationId,
          createdAt: record.createdAt.toISOString(),
        }),
        expected: eventExpected,
      });
    }
  }

  const taskDefinitions = [
    ["CONTENT_REVIEW", "GUIDE_REFRESH", "OPEN"],
    ["RENEWAL_REVIEW", "DEMO_RENEWAL_WINDOW", "ASSIGNED"],
    ["CREDIT_EXPIRY", "DEMO_CREDIT_WINDOW", "OPEN"],
  ] as const;
  for (let index = 0; index < taskDefinitions.length; index += 1) {
    const naturalKey = `phase-05:${index + 1}`;
    const id = stableSeedId("system-task", naturalKey);
    const definition = requireAt(taskDefinitions, index, "System Task definition");
    const company = index === 0 ? null : requireAt(companies, index, "Task Company");
    const expected = {
      id,
      companyId: company?.id ?? null,
      kind: definition[0],
      reasonCode: definition[1],
      evidenceWindowStart: addDays(anchorAt, -30).toISOString(),
      evidenceWindowEnd: anchorAt.toISOString(),
      evidenceReference: `seed:system-task:${index + 1}`,
      ownerUserId: index === 1 ? adminUserId : null,
      dueAt: addDays(anchorAt, index + 2).toISOString(),
      status: definition[2],
      outcomeCode: null,
      idempotencyKey: `seed:system-task:${index + 1}`,
      createdAt: addDays(anchorAt, -1).toISOString(),
    } as const;
    await createOrVerifySeedRecord({
      entity: "SystemTask",
      naturalKey,
      findExisting: () => db.systemTask.findUnique({ where: { id } }),
      create: () =>
        db.systemTask.create({
          data: {
            ...expected,
            evidenceWindowStart: new Date(expected.evidenceWindowStart),
            evidenceWindowEnd: new Date(expected.evidenceWindowEnd),
            dueAt: new Date(expected.dueAt),
            createdAt: new Date(expected.createdAt),
          },
        }),
      project: (record) => ({
        id: record.id,
        companyId: record.companyId,
        kind: record.kind,
        reasonCode: record.reasonCode,
        evidenceWindowStart: record.evidenceWindowStart?.toISOString() ?? null,
        evidenceWindowEnd: record.evidenceWindowEnd?.toISOString() ?? null,
        evidenceReference: record.evidenceReference,
        ownerUserId: record.ownerUserId,
        dueAt: record.dueAt.toISOString(),
        status: record.status,
        outcomeCode: record.outcomeCode,
        idempotencyKey: record.idempotencyKey,
        createdAt: record.createdAt.toISOString(),
      }),
      expected,
    });
  }
}

function orderNaturalKey(index: number): string {
  return `phase-05:${index + 1}`;
}

function billingOpsDigestProjection(
  identities: readonly SeedIdentityRecord[],
): CanonicalJsonValue {
  return {
    counts: {
      billingProfiles: 20,
      subscriptions: 23,
      subscriptionSchedules: 2,
      orders: 12,
      orderLines: 12,
      paymentEvents: 21,
      invoices: 7,
      invoiceLines: 7,
      creditAccounts: 29,
      creditLedgerEntries: 35,
      jobBoosts: 10,
      salesLeads: 4,
      abuseReports: 3,
      auditLogs: 30,
      analyticsEvents: 300,
      contentPages: 7,
      contentRevisions: 7,
      contentEvents: 28,
      supportCases: 2,
      systemTasks: 3,
    },
    identities: identities.map(({ entity, id, naturalKey }) => ({
      entity,
      id,
      naturalKey,
    })),
  };
}

function invoiceNaturalKey(index: number): string {
  return `phase-05:${index + 1}`;
}

function boostNaturalKey(index: number): string {
  return `phase-05:${index + 1}`;
}

function subscriptionIdentitySet(
  naturalKey: string,
  events: readonly string[],
): readonly SeedIdentityRecord[] {
  return Object.freeze([
    createSeedIdentity("employer-subscription", naturalKey),
    ...events.map((event) =>
      createSeedIdentity("subscription-event", `${naturalKey}:${event}`),
    ),
  ]);
}

function sortedPaidCompanies(
  companies: readonly BillingCompanyHandle[],
): readonly BillingCompanyHandle[] {
  return Object.freeze(
    [...companies]
      .filter((company) => company.planCode !== "FREE_BASIC")
      .sort(compareBySlug),
  );
}

function compareBySlug<T extends Readonly<{ slug: string }>>(
  left: T,
  right: T,
): number {
  return left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0;
}

function pickDistinctCompanyJobs(
  jobs: readonly BillingJobHandle[],
  count: number,
): readonly BillingJobHandle[] {
  const selected: BillingJobHandle[] = [];
  const companies = new Set<string>();
  for (const job of jobs) {
    if (!companies.has(job.companyId)) {
      selected.push(job);
      companies.add(job.companyId);
      if (selected.length === count) {
        break;
      }
    }
  }
  if (selected.length !== count) {
    throw new Error(
      `Phase-05 Billing needs ${count} published Jobs from distinct Companies.`,
    );
  }
  return Object.freeze(selected);
}

function requireAt<T>(
  values: readonly T[],
  index: number,
  description: string,
): T {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`Missing Phase-05 ${description} at index ${index}.`);
  }
  return value;
}

function requireMap<K, V>(
  values: ReadonlyMap<K, V>,
  key: K,
  description: string,
): V {
  const value = values.get(key);
  if (value === undefined) {
    throw new Error(`Missing Phase-05 ${description}.`);
  }
  return value;
}

function requireLookup(
  values: Readonly<Record<string, string>>,
  key: string,
  description: string,
): string {
  const value = values[key];
  if (value === undefined) {
    throw new Error(`Missing Phase-05 ${description} for ${key}.`);
  }
  return value;
}

function requireCompanyById(
  companies: readonly BillingCompanyHandle[],
  id: string,
): BillingCompanyHandle {
  const company = companies.find((candidate) => candidate.id === id);
  if (company === undefined) {
    throw new Error(`Missing Phase-05 Company handle for ${id}.`);
  }
  return company;
}

function requireProCompany(
  companies: readonly BillingCompanyHandle[],
  ordinal: number,
): BillingCompanyHandle {
  return requireAt(
    companies.filter((company) => company.planCode === "PRO"),
    ordinal,
    "Pro Company",
  );
}

function paidPlanCode(
  company: BillingCompanyHandle,
): Exclude<PlanCode, "FREE_BASIC"> {
  if (company.planCode === "FREE_BASIC") {
    throw new Error(`Free Company ${company.slug} cannot receive a paid Subscription.`);
  }
  return company.planCode;
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_MS);
}

function addMinutes(value: Date, minutes: number): Date {
  return new Date(value.getTime() + minutes * 60_000);
}

function startOfUtcYear(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
}

function calculateMoney(unitNetRappen: number, quantity: number) {
  const netRappen = unitNetRappen * quantity;
  const vatRappen = Math.floor(
    (netRappen * TAX_RATE_BASIS_POINTS) / 10_000 + 0.5,
  );
  return Object.freeze({
    netRappen,
    vatRappen,
    totalRappen: netRappen + vatRappen,
  });
}

function billingSnapshot(company: BillingCompanyHandle) {
  return Object.freeze({
    billingLegalNameSnapshot: `${company.name} Demo AG`,
    billingContactEmailSnapshot: `billing@${company.slug}.demo.invalid`,
    billingStreetSnapshot: `Musterweg ${String((company.slug.length % 80) + 1)}`,
    billingPostalCodeSnapshot: String(8_000 + (company.slug.length % 900)).padStart(
      4,
      "0",
    ),
    billingCitySnapshot: "Zürich",
    billingCountryCodeSnapshot: "CH",
    billingUidSnapshot: null,
    billingVatNumberSnapshot: "CHE-000.000.000 MWST",
  });
}

function resolveOrderLine(
  scenario: OrderScenario,
  catalog: ReferenceCatalogSeedResult,
) {
  const line = scenario.line;
  if (line.kind === "PLAN") {
    const fixture = PLAN_VERSION_FIXTURES.find(
      (candidate) => candidate.naturalKey === line.planVersionNaturalKey,
    );
    if (fixture === undefined) {
      throw new Error(
        `Missing Plan fixture ${line.planVersionNaturalKey}.`,
      );
    }
    const unitNetRappen =
      fixture.netPriceRappen ??
      subscriptionCommercialSnapshot(fixture.planCode).netRappen;
    return Object.freeze({
      planVersionId: requireLookup(
        catalog.planVersionIdsByNaturalKey,
        fixture.naturalKey,
        "PlanVersion",
      ),
      productVersionId: null,
      unitNetRappen,
      description: `${fixture.planCode} Demo-Abonnement`,
      fulfillmentContext: "SUBSCRIPTION" as const,
      targetJobId: null,
      targetCreditType: null,
    });
  }
  const fixture = PRODUCT_VERSION_FIXTURES.find(
    (candidate) => candidate.naturalKey === line.productVersionNaturalKey,
  );
  if (fixture === undefined) {
    throw new Error(
      `Missing Product fixture ${line.productVersionNaturalKey}.`,
    );
  }
  return Object.freeze({
    planVersionId: null,
    productVersionId: requireLookup(
      catalog.productVersionIdsByNaturalKey,
      fixture.naturalKey,
      "ProductVersion",
    ),
    unitNetRappen: fixture.netPriceRappen,
    description:
      line.kind === "BOOST"
        ? "Job Boost 7 Tage"
        : "Talent Radar Contact Pack",
    fulfillmentContext:
      line.kind === "BOOST"
        ? ("JOB_BOOST" as const)
        : ("CONTACT_PACK" as const),
    targetJobId: line.kind === "BOOST" ? line.job.id : null,
    targetCreditType:
      line.kind === "CONTACT_PACK"
        ? ("TALENT_CONTACT" as const)
        : null,
  });
}

function subscriptionCommercialSnapshot(planCode: PlanCode) {
  const values = {
    FREE_BASIC: 0,
    STARTER: 14_900,
    PRO: 39_900,
    BUSINESS: 89_900,
    ENTERPRISE_CONTRACT: 149_900,
  } as const;
  const netRappen = values[planCode];
  return Object.freeze({
    billingInterval: "MONTHLY" as const,
    termMonths: planCode === "ENTERPRISE_CONTRACT" ? 12 : 1,
    netRappen,
    monthlyEquivalentRappen: netRappen,
  });
}

function planAllowance(
  planVersionNaturalKey: string,
  creditType: "JOB_BOOST" | "TALENT_CONTACT",
): number {
  const entitlementKey =
    creditType === "JOB_BOOST"
      ? "JOB_BOOST_ALLOWANCE"
      : "TALENT_CONTACT_ALLOWANCE";
  const fixture = PLAN_ENTITLEMENT_FIXTURES.find(
    (candidate) =>
      candidate.planVersionNaturalKey === planVersionNaturalKey &&
      candidate.key === entitlementKey,
  );
  if (fixture === undefined || fixture.integerValue === null || fixture.integerValue < 1) {
    throw new Error(`Missing positive ${entitlementKey} for ${planVersionNaturalKey}.`);
  }
  return fixture.integerValue;
}

function assertProjection(
  entity: string,
  naturalKey: string,
  actual: CanonicalJsonValue,
  expected: CanonicalJsonValue,
): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new SeedDataDriftError(entity, naturalKey);
  }
}

function projectTaxRate(record: {
  id: string;
  jurisdiction: string;
  taxType: string;
  rateBasisPoints: number;
  validFrom: Date;
  validTo: Date | null;
  source: string;
  referenceUrl: string | null;
  reviewStatus: string;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
}): CanonicalJsonValue {
  return {
    id: record.id,
    jurisdiction: record.jurisdiction,
    taxType: record.taxType,
    rateBasisPoints: record.rateBasisPoints,
    validFrom: record.validFrom.toISOString(),
    validTo: record.validTo?.toISOString() ?? null,
    source: record.source,
    referenceUrl: record.referenceUrl,
    reviewStatus: record.reviewStatus,
    reviewedByUserId: record.reviewedByUserId,
    reviewedAt: record.reviewedAt?.toISOString() ?? null,
  };
}

function projectOrder(record: {
  id: string;
  companyId: string;
  createdByUserId: string;
  status: string;
  provider: string;
  clientIdempotencyKey: string;
  providerIdempotencyKey: string | null;
  providerReference: string | null;
  billingLegalNameSnapshot: string;
  billingContactEmailSnapshot: string;
  billingStreetSnapshot: string;
  billingPostalCodeSnapshot: string;
  billingCitySnapshot: string;
  billingCountryCodeSnapshot: string;
  billingUidSnapshot: string | null;
  billingVatNumberSnapshot: string | null;
  currency: string;
  netTotalRappen: number;
  vatTotalRappen: number;
  totalRappen: number;
  paidAt: Date | null;
  failedAt: Date | null;
  cancelledAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}): CanonicalJsonValue {
  return {
    id: record.id,
    companyId: record.companyId,
    createdByUserId: record.createdByUserId,
    status: record.status,
    provider: record.provider,
    clientIdempotencyKey: record.clientIdempotencyKey,
    providerIdempotencyKey: record.providerIdempotencyKey,
    providerReference: record.providerReference,
    billingLegalNameSnapshot: record.billingLegalNameSnapshot,
    billingContactEmailSnapshot: record.billingContactEmailSnapshot,
    billingStreetSnapshot: record.billingStreetSnapshot,
    billingPostalCodeSnapshot: record.billingPostalCodeSnapshot,
    billingCitySnapshot: record.billingCitySnapshot,
    billingCountryCodeSnapshot: record.billingCountryCodeSnapshot,
    billingUidSnapshot: record.billingUidSnapshot,
    billingVatNumberSnapshot: record.billingVatNumberSnapshot,
    currency: record.currency,
    netTotalRappen: record.netTotalRappen,
    vatTotalRappen: record.vatTotalRappen,
    totalRappen: record.totalRappen,
    paidAt: record.paidAt?.toISOString() ?? null,
    failedAt: record.failedAt?.toISOString() ?? null,
    cancelledAt: record.cancelledAt?.toISOString() ?? null,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}

function assertOrderDraftPendingOrFinal(
  record: Parameters<typeof projectOrder>[0],
  naturalKey: string,
  finalExpected: CanonicalJsonValue,
): void {
  if (record.status === "DRAFT" || record.status === "PENDING") {
    const expected = {
      ...(finalExpected as Readonly<Record<string, CanonicalJsonValue>>),
      status: record.status,
      paidAt: null,
      cancelledAt: null,
    };
    assertProjection("Order", naturalKey, projectOrder(record), expected);
    return;
  }
  assertProjection("Order", naturalKey, projectOrder(record), finalExpected);
}

function projectOrderLine(record: {
  id: string;
  orderId: string;
  planVersionId: string | null;
  productVersionId: string | null;
  taxRateVersionId: string;
  quantity: number;
  unitNetRappen: number;
  netRappen: number;
  taxRateBasisPoints: number;
  vatRappen: number;
  totalRappen: number;
  currency: string;
  descriptionSnapshot: string;
  fulfillmentContext: string;
  targetJobId: string | null;
  targetImportSourceId: string | null;
  targetCreditType: string | null;
  createdAt: Date;
}): CanonicalJsonValue {
  return {
    id: record.id,
    orderId: record.orderId,
    planVersionId: record.planVersionId,
    productVersionId: record.productVersionId,
    taxRateVersionId: record.taxRateVersionId,
    quantity: record.quantity,
    unitNetRappen: record.unitNetRappen,
    netRappen: record.netRappen,
    taxRateBasisPoints: record.taxRateBasisPoints,
    vatRappen: record.vatRappen,
    totalRappen: record.totalRappen,
    currency: record.currency,
    descriptionSnapshot: record.descriptionSnapshot,
    fulfillmentContext: record.fulfillmentContext,
    targetJobId: record.targetJobId,
    targetImportSourceId: record.targetImportSourceId,
    targetCreditType: record.targetCreditType,
    createdAt: record.createdAt.toISOString(),
  };
}

function projectInvoice(record: {
  id: string;
  orderId: string;
  companyId: string;
  status: string;
  billingLegalNameSnapshot: string;
  billingContactEmailSnapshot: string;
  billingStreetSnapshot: string;
  billingPostalCodeSnapshot: string;
  billingCitySnapshot: string;
  billingCountryCodeSnapshot: string;
  billingUidSnapshot: string | null;
  billingVatNumberSnapshot: string | null;
  currency: string;
  netTotalRappen: number;
  vatTotalRappen: number;
  totalRappen: number;
  dueAt: Date;
  issuedAt: Date | null;
  paidAt: Date | null;
  voidedAt: Date | null;
}): CanonicalJsonValue {
  return {
    id: record.id,
    orderId: record.orderId,
    companyId: record.companyId,
    status: record.status,
    billingLegalNameSnapshot: record.billingLegalNameSnapshot,
    billingContactEmailSnapshot: record.billingContactEmailSnapshot,
    billingStreetSnapshot: record.billingStreetSnapshot,
    billingPostalCodeSnapshot: record.billingPostalCodeSnapshot,
    billingCitySnapshot: record.billingCitySnapshot,
    billingCountryCodeSnapshot: record.billingCountryCodeSnapshot,
    billingUidSnapshot: record.billingUidSnapshot,
    billingVatNumberSnapshot: record.billingVatNumberSnapshot,
    currency: record.currency,
    netTotalRappen: record.netTotalRappen,
    vatTotalRappen: record.vatTotalRappen,
    totalRappen: record.totalRappen,
    dueAt: record.dueAt.toISOString(),
    issuedAt: record.issuedAt?.toISOString() ?? null,
    paidAt: record.paidAt?.toISOString() ?? null,
    voidedAt: record.voidedAt?.toISOString() ?? null,
  };
}

function projectInvoiceLine(record: {
  id: string;
  invoiceId: string;
  orderLineId: string;
  sortOrder: number;
  descriptionSnapshot: string;
  quantity: number;
  unitNetRappen: number;
  netRappen: number;
  taxRateBasisPoints: number;
  vatRappen: number;
  totalRappen: number;
  currency: string;
}): CanonicalJsonValue {
  return {
    id: record.id,
    invoiceId: record.invoiceId,
    orderLineId: record.orderLineId,
    sortOrder: record.sortOrder,
    descriptionSnapshot: record.descriptionSnapshot,
    quantity: record.quantity,
    unitNetRappen: record.unitNetRappen,
    netRappen: record.netRappen,
    taxRateBasisPoints: record.taxRateBasisPoints,
    vatRappen: record.vatRappen,
    totalRappen: record.totalRappen,
    currency: record.currency,
  };
}

function assertInvoiceNumber(number: string, issuedAt: Date): void {
  const parsed = parseInvoiceNumber(number);
  if (parsed === null || parsed.year !== getZurichYear(issuedAt)) {
    throw new SeedDataDriftError("Invoice", number);
  }
}

function projectSubscription(record: {
  id: string;
  companyId: string;
  planVersionId: string;
  sourceOrderId: string | null;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  billingIntervalSnapshot: string;
  termMonthsSnapshot: number;
  recurringNetRappenSnapshot: number;
  monthlyEquivalentRappenSnapshot: number;
  currencySnapshot: string;
  activatedAt: Date | null;
  endedAt: Date | null;
}): CanonicalJsonValue {
  return {
    id: record.id,
    companyId: record.companyId,
    planVersionId: record.planVersionId,
    sourceOrderId: record.sourceOrderId,
    status: record.status,
    currentPeriodStart: record.currentPeriodStart.toISOString(),
    currentPeriodEnd: record.currentPeriodEnd.toISOString(),
    billingIntervalSnapshot: record.billingIntervalSnapshot,
    termMonthsSnapshot: record.termMonthsSnapshot,
    recurringNetRappenSnapshot: record.recurringNetRappenSnapshot,
    monthlyEquivalentRappenSnapshot: record.monthlyEquivalentRappenSnapshot,
    currencySnapshot: record.currencySnapshot,
    activatedAt: record.activatedAt?.toISOString() ?? null,
    endedAt: record.endedAt?.toISOString() ?? null,
  };
}

function assertSubscriptionSnapshot(
  record: Parameters<typeof projectSubscription>[0],
  naturalKey: string,
  expectedBase: CanonicalJsonValue,
): void {
  const projected = projectSubscription(record) as Readonly<
    Record<string, CanonicalJsonValue>
  >;
  const snapshot = { ...projected };
  delete snapshot.status;
  delete snapshot.activatedAt;
  delete snapshot.endedAt;
  assertProjection(
    "EmployerSubscription",
    naturalKey,
    snapshot,
    expectedBase,
  );
}

function assertContentPageSnapshot(
  record: {
    id: string;
    slug: string;
    locale: string;
    type: string;
    canonicalPath: string;
    dataProvenance: string;
    currentPublishedRevisionId: string | null;
  },
  guide: (typeof DEMO_GUIDE_FIXTURES)[number],
  id: string,
  revisionId: string,
): void {
  if (
    record.id !== id ||
    record.slug !== guide.slug ||
    record.locale !== guide.locale ||
    record.type !== guide.type ||
    record.canonicalPath !== guide.canonicalPath ||
    record.dataProvenance !== "DEMO" ||
    (record.currentPublishedRevisionId !== null &&
      record.currentPublishedRevisionId !== revisionId)
  ) {
    throw new SeedDataDriftError("ContentPage", guide.slug);
  }
}

function assertContentRevisionAuthoredSnapshot(
  record: {
    id: string;
    contentPageId: string;
    revisionNumber: number;
    title: string;
    excerpt: string;
    body: string;
    heroMetadata: unknown;
    authoredByUserId: string;
    contentHash: string;
  },
  guide: (typeof DEMO_GUIDE_FIXTURES)[number],
  id: string,
  pageId: string,
  adminUserId: string,
  contentHash: string,
): void {
  const hero = record.heroMetadata as CanonicalJsonValue;
  if (
    record.id !== id ||
    record.contentPageId !== pageId ||
    record.revisionNumber !== 1 ||
    record.title !== guide.title ||
    record.excerpt !== guide.excerpt ||
    record.body !== guide.body ||
    canonicalJson(hero) !== canonicalJson({ fixture: true, theme: "guide" }) ||
    record.authoredByUserId !== adminUserId ||
    record.contentHash !== contentHash
  ) {
    throw new SeedDataDriftError("ContentRevision", `${guide.slug}:1`);
  }
}

function resolveAuditTarget(
  source: "jobs" | "companies" | "invoices" | "credits" | "users" | "orders" | "boosts" | "leads" | "content",
  index: number,
  company: BillingCompanyHandle,
  companies: readonly BillingCompanyHandle[],
  jobs: readonly BillingJobHandle[],
  invoiceIds: readonly string[],
  boostIds: readonly string[],
  salesLeadIds: readonly string[],
  adminUserId: string,
): string {
  switch (source) {
    case "jobs":
      return requireAt(jobs, index % jobs.length, "Audit Job").id;
    case "companies":
      return company.id;
    case "invoices":
      return requireAt(invoiceIds, index % invoiceIds.length, "Audit Invoice");
    case "credits":
      return stableSeedId(
        "credit-ledger-entry",
        `${requireProCompany(companies, 0).slug}:JOB_BOOST:plan-allowance:grant`,
      );
    case "users":
      return company.ownerUserId;
    case "orders":
      return stableSeedId("order", orderNaturalKey(index % ORDER_COUNT));
    case "boosts":
      return requireAt(boostIds, index % boostIds.length, "Audit Boost");
    case "leads":
      return requireAt(salesLeadIds, index % salesLeadIds.length, "Audit Lead");
    case "content":
      return stableSeedId(
        "content-revision",
        `${requireAt(DEMO_GUIDE_FIXTURES, index % DEMO_GUIDE_FIXTURES.length, "Audit Content").slug}:1`,
      );
  }
  return adminUserId;
}
