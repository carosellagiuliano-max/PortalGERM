import {
  ANALYTICS_EVENT_CONTRACTS_V1,
  ANALYTICS_EVENT_KINDS_V1,
  ANALYTICS_SCHEMA_VERSION_V1,
  getAnalyticsRetainUntilV1,
} from "@/lib/analytics/event-contracts";
import { verifyPassword } from "@/lib/auth/password";
import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";
import {
  FAIR_JOB_FACTOR_ORDER_V2,
  FAIR_JOB_FACTOR_POINTS_V2,
} from "@/lib/scoring/fair-job-score";
import {
  calculateFairJobScoreFromSnapshotV2,
  verifyFairJobScoreSnapshotHashV2,
  type FairJobFactorBreakdownV2,
  type FairJobInputSnapshotV2,
  type FairJobScoreSnapshotRecordV2,
} from "@/lib/scoring/fair-job-snapshot";
import {
  canonicalJson,
  sha256CanonicalJson,
  sha256Utf8,
  type CanonicalJsonValue,
} from "@/prisma/seed/canonical-json";
import { ANALYTICS_SUPPRESSION_V1 } from "@/lib/analytics/metric-definitions-v1";
import {
  SEED_GOLDEN_COUNTS,
  type SeedBlockDigest,
  type SeedCounts,
} from "@/prisma/seed/contract";
import {
  CANDIDATE_FIXTURES,
  CANTON_FIXTURES,
  CATEGORY_FIXTURES,
  CITY_FIXTURES,
  COMPANY_FIXTURES,
  DEMO_ACCOUNT_FIXTURES,
  DEMO_GUIDE_FIXTURES,
  DEMO_LOGIN_PASSWORD,
  ENTITLEMENT_KEYS,
  JOB_CONTENT_LANGUAGE_DISTRIBUTION,
  JOB_EFFORT_DISTRIBUTION,
  JOB_STATUS_DISTRIBUTION,
  JOB_TYPE_DISTRIBUTION,
  OCCUPATION_CODES_2026_FIXTURE,
  PLAN_ENTITLEMENT_FIXTURES,
  PLAN_FIXTURES,
  PLAN_VERSION_FIXTURES,
  PRODUCT_FIXTURES,
  PRODUCT_VERSION_FIXTURES,
  SALARY_BAND_FIXTURES,
  SALARY_DATASET_FIXTURE,
  SKILL_FIXTURES,
  buildJobFixtures,
  countGuideWords,
} from "@/prisma/seed/fixtures";
import { BILLING_OPS_SEED_IDENTITIES } from "@/prisma/seed/blocks/billing-ops";
import { CANDIDATE_WORKFLOW_SEED_IDENTITIES } from "@/prisma/seed/fixtures/candidate-workflows";
import { stableSeedId } from "@/prisma/seed/ids";

const EXPECTED_REMOTE_OR_HYBRID_JOBS = 29;
const EXPECTED_SALARY_DISCLOSED_JOBS = 58;
const EXPECTED_PUBLIC_ELIGIBLE_JOBS = 100;
const EXPECTED_ZH_ENGINEERING_JOBS = 50;
const EXPECTED_CANDIDATE_SKILLS = 165;
const EXPECTED_CANDIDATE_LANGUAGES = 75;
const EXPECTED_GRANTED_RADAR_CONSENTS = 11;
const EXPECTED_RADAR_PROFILES = 10;
const EXPECTED_DEMO_SUBSCRIPTIONS = 23;
const EXPECTED_EFFECTIVE_PAID_SUBSCRIPTIONS = 20;
const EXPECTED_SUBSCRIPTION_SCHEDULES = 2;
const EXPECTED_TAX_RATE_BASIS_POINTS = 810;
const EXPECTED_CREDIT_ACCOUNTS = 31;
const EXPECTED_CREDIT_LEDGER_ENTRIES = 43;
const EXPECTED_SALARY_BANDS = 12;

export type DemoSeedEntityHandle = Readonly<{
  id: string;
  key: string;
}>;

export type DemoSeedVerificationExpectations = Readonly<{
  /** Optional full identity catalogue supplied by the orchestrator. */
  expectedIdentityIds?: readonly string[];
  companyHandles?: readonly DemoSeedEntityHandle[];
  jobHandles?: readonly DemoSeedEntityHandle[];
  candidateHandles?: readonly DemoSeedEntityHandle[];
  contentPageHandles?: readonly DemoSeedEntityHandle[];
}>;

export type DemoSeedVerificationCheck = Readonly<{
  actual: CanonicalJsonValue;
  expected: CanonicalJsonValue;
  name: string;
}>;

export type DemoSeedVerificationReport = Readonly<{
  anchorAt: string;
  checkCount: number;
  checks: readonly DemoSeedVerificationCheck[];
  observedDigestSha256: string;
}>;

export type DemoSeedVerificationResult = Readonly<{
  blockDigest: SeedBlockDigest;
  counts: SeedCounts;
  report: DemoSeedVerificationReport;
}>;

export class DemoSeedVerificationError extends Error {
  readonly actual: CanonicalJsonValue;
  readonly check: string;
  readonly expected: CanonicalJsonValue;

  constructor(
    check: string,
    actual: CanonicalJsonValue,
    expected: CanonicalJsonValue,
  ) {
    super(
      `Demo seed verification failed for ${check}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
    this.name = "DemoSeedVerificationError";
    this.check = check;
    this.actual = actual;
    this.expected = expected;
  }
}

type VerificationContext = {
  checks: DemoSeedVerificationCheck[];
};

type PublicEligibilityJob = Readonly<{
  companyId: string;
  dataProvenance: string;
  expiresAt: Date | null;
  id: string;
  publishedAt: Date | null;
  publishedRevisionId: string | null;
  status: string;
  company: Readonly<{
    dataProvenance: string;
    status: string;
    verificationRequests: readonly Readonly<{
      status: string;
      supersededBy: Readonly<{ id: string }> | null;
    }>[];
  }>;
  publishedRevision: Readonly<{
    approvedAt: Date | null;
    id: string;
    rejectedAt: Date | null;
    validThrough: Date | null;
  }> | null;
}>;

type EffectiveRestriction = Readonly<{
  targetId: string;
  targetType: string;
}>;

const CITY_INCLUDE = {
  canton: { select: { code: true } },
} satisfies Prisma.CityInclude;
const APPLICATION_INCLUDE = {
  candidateProfile: { include: { user: true } },
  conversation: true,
  job: { include: { company: true } },
  submissionDocuments: {
    include: { documentMetadata: true },
    orderBy: { id: "asc" },
  },
  submissionSnapshot: true,
  submittedJobRevision: true,
} satisfies Prisma.ApplicationInclude;
const CONVERSATION_INCLUDE = {
  messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  participants: { orderBy: { id: "asc" } },
} satisfies Prisma.ConversationInclude;
const CONTACT_REQUEST_INCLUDE = {
  conversation: true,
  creditLedgerEntry: { include: { account: true } },
  revealGrant: true,
} satisfies Prisma.EmployerContactRequestInclude;
const REVEAL_GRANT_INCLUDE = {
  confirmations: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  fields: { orderBy: { id: "asc" } },
} satisfies Prisma.IdentityRevealGrantInclude;
const RADAR_SEARCH_SESSION_INCLUDE = {
  candidates: { orderBy: { position: "asc" } },
} satisfies Prisma.RadarSearchSessionInclude;
const SUBSCRIPTION_INCLUDE = {
  planVersion: { include: { plan: true } },
} satisfies Prisma.EmployerSubscriptionInclude;
const ORDER_INCLUDE = {
  lines: { include: { taxRateVersion: true } },
} satisfies Prisma.OrderInclude;
const INVOICE_INCLUDE = {
  lines: { include: { orderLine: true } },
  order: true,
} satisfies Prisma.InvoiceInclude;
const BOOST_INCLUDE = {
  consumedCreditLedgerEntry: { include: { account: true } },
  job: true,
  orderLine: true,
} satisfies Prisma.JobBoostInclude;
const ABUSE_REPORT_INCLUDE = {
  events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.AbuseReportInclude;

type ObservedCity = Prisma.CityGetPayload<{ include: typeof CITY_INCLUDE }>;
type ObservedApplication = Prisma.ApplicationGetPayload<{
  include: typeof APPLICATION_INCLUDE;
}>;
type ObservedConversation = Prisma.ConversationGetPayload<{
  include: typeof CONVERSATION_INCLUDE;
}>;
type ObservedContactRequest = Prisma.EmployerContactRequestGetPayload<{
  include: typeof CONTACT_REQUEST_INCLUDE;
}>;
type ObservedRevealGrant = Prisma.IdentityRevealGrantGetPayload<{
  include: typeof REVEAL_GRANT_INCLUDE;
}>;
type ObservedRadarSearchSession = Prisma.RadarSearchSessionGetPayload<{
  include: typeof RADAR_SEARCH_SESSION_INCLUDE;
}>;
type ObservedSubscription = Prisma.EmployerSubscriptionGetPayload<{
  include: typeof SUBSCRIPTION_INCLUDE;
}>;
type ObservedOrder = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;
type ObservedInvoice = Prisma.InvoiceGetPayload<{
  include: typeof INVOICE_INCLUDE;
}>;
type ObservedBoost = Prisma.JobBoostGetPayload<{
  include: typeof BOOST_INCLUDE;
}>;
type ObservedAbuseReport = Prisma.AbuseReportGetPayload<{
  include: typeof ABUSE_REPORT_INCLUDE;
}>;

/**
 * Independently reads and verifies the complete Phase-05 demo dataset.
 *
 * The verifier never writes and never trusts block return counts. Every count
 * and relationship below is derived from rows observed in one repeatable-read
 * snapshot. Password hashes are checked but deliberately excluded from hashes
 * and reports because bcrypt salts are non-deterministic secrets.
 */
export async function verifyDemoSeedDatabase(
  db: PrismaClient,
  anchorAt: Date,
  expectations: DemoSeedVerificationExpectations = {},
): Promise<DemoSeedVerificationResult> {
  assertValidAnchor(anchorAt);
  const expected = buildExpectedScope(anchorAt);
  verifySuppliedExpectations(expectations, expected);

  const observed = await db.$transaction(
    async (transaction) =>
      loadObservedSeedState(transaction, anchorAt, expected),
    { isolationLevel: "RepeatableRead", timeout: 30_000 },
  );
  const context: VerificationContext = { checks: [] };

  const counts = verifyGoldenCounts(context, observed);
  verifyReferenceCatalog(context, observed, expected);
  await verifyDemoCredentials(context, observed.demoAccounts);
  verifyCompanies(context, observed, expected, anchorAt);
  verifyJobs(context, observed, expected, anchorAt);
  verifyCandidateWorkflows(context, observed, expected);
  verifyBilling(context, observed, expected, anchorAt);
  verifyOperationsAndContent(context, observed, expected);

  const observedDigestSha256 = buildObservedDigest(observed);
  const report: DemoSeedVerificationReport = Object.freeze({
    anchorAt: anchorAt.toISOString(),
    checkCount: context.checks.length,
    checks: Object.freeze([...context.checks]),
    observedDigestSha256,
  });
  const blockDigest: SeedBlockDigest = Object.freeze({
    name: "database-verification",
    recordCount: report.checkCount,
    digestSha256: sha256CanonicalJson(report as CanonicalJsonValue),
  });

  return Object.freeze({ blockDigest, counts, report });
}

function buildExpectedScope(anchorAt: Date) {
  const jobs = buildJobFixtures(anchorAt);
  const companies = COMPANY_FIXTURES.map(({ id, slug }) => ({ id, key: slug }));
  const candidates = CANDIDATE_FIXTURES.map((candidate) => ({
    id: stableSeedId("candidate-profile", candidate.email),
    key: candidate.email,
  }));
  const contentPages = DEMO_GUIDE_FIXTURES.map((guide) => ({
    id: stableSeedId("content-page", guide.slug),
    key: guide.slug,
  }));
  const paidCompanies = [...COMPANY_FIXTURES]
    .filter((company) => company.planCode !== "FREE_BASIC")
    .sort(compareKey("slug"));
  const expiredCompany = requireIndex(paidCompanies, 0, "expired Company");
  const cancelledCompany = requireIndex(paidCompanies, 1, "cancelled Company");
  const cancellingCompany = requireIndex(
    paidCompanies,
    2,
    "cancelling Company",
  );
  const downgradeCompany = requireIndex(
    paidCompanies.filter((company) => company.planCode === "PRO"),
    1,
    "downgrade Company",
  );

  const subscriptionIds = [
    ...paidCompanies.map((company) =>
      stableSeedId("employer-subscription", `${company.slug}:current`),
    ),
    stableSeedId(
      "employer-subscription",
      `${expiredCompany.slug}:history-expired`,
    ),
    stableSeedId(
      "employer-subscription",
      `${cancelledCompany.slug}:history-cancelled`,
    ),
    stableSeedId(
      "employer-subscription",
      `${downgradeCompany.slug}:successor-starter`,
    ),
  ];
  const subscriptionScheduleIds = [
    stableSeedId(
      "subscription-change-schedule",
      `${cancellingCompany.slug}:cancel`,
    ),
    stableSeedId(
      "subscription-change-schedule",
      `${downgradeCompany.slug}:downgrade-starter`,
    ),
  ];

  const canonicalIdentityIds = new Set<string>([
    ...companies.map((handle) => handle.id),
    ...jobs.map((job) => job.id),
    ...candidates.map((handle) => handle.id),
    ...contentPages.map((handle) => handle.id),
    ...BILLING_OPS_SEED_IDENTITIES.map((identity) => identity.id),
    ...CANDIDATE_WORKFLOW_SEED_IDENTITIES.map((identity) => identity.id),
  ]);

  return Object.freeze({
    anchorAt,
    canonicalIdentityIds,
    candidates: Object.freeze(candidates),
    companies: Object.freeze(companies),
    contentPages: Object.freeze(contentPages),
    jobs: Object.freeze(jobs.map(({ id, slug }) => ({ id, key: slug }))),
    paidCompanies: Object.freeze(paidCompanies),
    subscriptionIds: Object.freeze(subscriptionIds),
    subscriptionScheduleIds: Object.freeze(subscriptionScheduleIds),
  });
}

async function loadObservedSeedState(
  db: Prisma.TransactionClient,
  anchorAt: Date,
  expected: ReturnType<typeof buildExpectedScope>,
) {
  const cantonIds = fixtureIds("canton", CANTON_FIXTURES_FOR_IDS());
  const cityIds = CITY_FIXTURES_FOR_IDS();
  const categoryIds = CATEGORY_FIXTURES_FOR_IDS();
  const skillIds = SKILL_FIXTURES_FOR_IDS();
  const occupationVersionId = stableSeedId(
    "occupation-code-version",
    `${OCCUPATION_CODES_2026_FIXTURE.datasetKey}:${OCCUPATION_CODES_2026_FIXTURE.datasetVersion}`,
  );
  const salaryDatasetVersionId = stableSeedId(
    "salary-dataset-version",
    SALARY_DATASET_FIXTURE.naturalKey,
  );
  const planIds = PLAN_FIXTURES.map((fixture) =>
    stableSeedId("plan", fixture.code),
  );
  const planVersionIds = PLAN_VERSION_FIXTURES.map((fixture) =>
    stableSeedId("plan-version", fixture.naturalKey),
  );
  const entitlementIds = PLAN_ENTITLEMENT_FIXTURES.map((fixture) =>
    stableSeedId("plan-entitlement", fixture.naturalKey),
  );
  const productIds = PRODUCT_FIXTURES.map((fixture) =>
    stableSeedId("product", fixture.code),
  );
  const productVersionIds = PRODUCT_VERSION_FIXTURES.map((fixture) =>
    stableSeedId("product-version", fixture.naturalKey),
  );
  const companyIds = expected.companies.map((handle) => handle.id);
  const jobIds = expected.jobs.map((handle) => handle.id);
  const candidateIds = expected.candidates.map((handle) => handle.id);
  const applicationIds = identityIdsByEntity(
    CANDIDATE_WORKFLOW_SEED_IDENTITIES,
    "application",
  );
  const conversationIds = identityIdsByEntity(
    CANDIDATE_WORKFLOW_SEED_IDENTITIES,
    "conversation",
  );
  const contactRequestIds = identityIdsByEntity(
    CANDIDATE_WORKFLOW_SEED_IDENTITIES,
    "employer-contact-request",
  );
  const revealIds = identityIdsByEntity(
    CANDIDATE_WORKFLOW_SEED_IDENTITIES,
    "identity-reveal-grant",
  );
  const radarMappingIds = identityIdsByEntity(
    CANDIDATE_WORKFLOW_SEED_IDENTITIES,
    "radar-opaque-mapping",
  );
  const radarSearchBudgetIds = identityIdsByEntity(
    CANDIDATE_WORKFLOW_SEED_IDENTITIES,
    "radar-search-budget",
  );
  const radarSearchSessionIds = identityIdsByEntity(
    CANDIDATE_WORKFLOW_SEED_IDENTITIES,
    "radar-search-session",
  );
  const orderIds = identityIdsByEntity(BILLING_OPS_SEED_IDENTITIES, "order");
  const invoiceIds = identityIdsByEntity(
    BILLING_OPS_SEED_IDENTITIES,
    "invoice",
  );
  const boostIds = identityIdsByEntity(
    BILLING_OPS_SEED_IDENTITIES,
    "job-boost",
  );
  const salesLeadIds = identityIdsByEntity(
    BILLING_OPS_SEED_IDENTITIES,
    "sales-lead",
  );
  const auditIds = identityIdsByEntity(
    BILLING_OPS_SEED_IDENTITIES,
    "audit-log",
  );
  const analyticsIds = identityIdsByEntity(
    BILLING_OPS_SEED_IDENTITIES,
    "analytics-event",
  );
  const abuseIds = identityIdsByEntity(
    BILLING_OPS_SEED_IDENTITIES,
    "abuse-report",
  );

  const cantons = await db.canton.findMany({
    where: { id: { in: cantonIds } },
    orderBy: { code: "asc" },
  });
  const cities: ObservedCity[] = await db.city.findMany({
    where: { id: { in: cityIds } },
    include: CITY_INCLUDE,
    orderBy: { id: "asc" },
  });
  const categories = await db.category.findMany({
    where: { id: { in: categoryIds } },
    orderBy: { slug: "asc" },
  });
  const skills = await db.skill.findMany({
    where: { id: { in: skillIds } },
    orderBy: { slug: "asc" },
  });
  const occupationVersion = await db.occupationCodeVersion.findUnique({
    where: { id: occupationVersionId },
    include: { codes: { orderBy: { code: "asc" } } },
  });
  const salaryDataset = await db.salaryDatasetVersion.findUnique({
    where: { id: salaryDatasetVersionId },
    include: { bands: { orderBy: { id: "asc" } } },
  });
  const plans = await db.plan.findMany({
    where: { id: { in: planIds } },
    orderBy: { code: "asc" },
  });
  const planVersions = await db.planVersion.findMany({
    where: { id: { in: planVersionIds } },
    include: {
      plan: { select: { code: true } },
      entitlements: { orderBy: { key: "asc" } },
    },
    orderBy: { id: "asc" },
  });
  const planEntitlementCount = await db.planEntitlement.count({
    where: { id: { in: entitlementIds } },
  });
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    orderBy: { code: "asc" },
  });
  const productVersions = await db.productVersion.findMany({
    where: { id: { in: productVersionIds } },
    include: { product: { select: { code: true } } },
    orderBy: { id: "asc" },
  });
  const demoAccounts = await db.user.findMany({
    where: { id: { in: DEMO_ACCOUNT_FIXTURES.map((account) => account.id) } },
    include: { credential: true },
    orderBy: { emailNormalized: "asc" },
  });
  const companies = await db.company.findMany({
    where: { dataProvenance: "DEMO" },
    include: {
      memberships: true,
      verificationRequests: {
        include: { supersededBy: { select: { id: true } } },
      },
    },
    orderBy: { slug: "asc" },
  });
  const jobs = await db.job.findMany({
    where: { dataProvenance: "DEMO" },
    include: {
      company: {
        select: {
          dataProvenance: true,
          status: true,
          verificationRequests: {
            include: { supersededBy: { select: { id: true } } },
          },
        },
      },
      currentRevision: {
        include: {
          canton: { select: { code: true } },
          category: { select: { slug: true } },
          languages: { select: { code: true } },
          reportingChecks: { select: { id: true } },
          scoreSnapshots: {
            where: { scoreVersion: "v2" },
            select: {
              calculatedAt: true,
              evidence: true,
              evidenceHash: true,
              factorBreakdown: true,
              id: true,
              inputSnapshot: true,
              jobRevisionId: true,
              maxPoints: true,
              scorePoints: true,
              scoreVersion: true,
            },
          },
          skills: { select: { skillId: true } },
        },
      },
      publishedRevision: {
        select: {
          approvedAt: true,
          id: true,
          rejectedAt: true,
          validThrough: true,
        },
      },
    },
    orderBy: { slug: "asc" },
  });
  const restrictions = await db.moderationRestriction.findMany({
    where: {
      status: "ACTIVE",
      startsAt: { lte: anchorAt },
      liftedAt: null,
      OR: [{ endsAt: null }, { endsAt: { gt: anchorAt } }],
      targetId: { in: [...companyIds, ...jobIds] },
    },
    select: { targetId: true, targetType: true },
  });
  const candidates = await db.candidateProfile.findMany({
    where: { user: { dataProvenance: "DEMO", role: "CANDIDATE" } },
    include: {
      documents: true,
      languages: true,
      preference: { include: { categories: true } },
      radarConsents: {
        orderBy: [{ effectiveAt: "asc" }, { createdAt: "asc" }],
      },
      radarProfile: true,
      skills: true,
      user: true,
    },
    orderBy: { id: "asc" },
  });
  const applications: ObservedApplication[] = await db.application.findMany({
    where: { id: { in: applicationIds } },
    include: APPLICATION_INCLUDE,
    orderBy: { id: "asc" },
  });
  const savedJobs = await db.savedJob.findMany({
    where: { candidateProfileId: { in: candidateIds } },
    orderBy: { id: "asc" },
  });
  const jobAlerts = await db.jobAlert.findMany({
    where: { candidateProfileId: { in: candidateIds } },
    orderBy: { id: "asc" },
  });
  const conversations: ObservedConversation[] = await db.conversation.findMany({
    where: { id: { in: conversationIds } },
    include: CONVERSATION_INCLUDE,
    orderBy: { id: "asc" },
  });
  const contactRequests: ObservedContactRequest[] =
    await db.employerContactRequest.findMany({
      where: { id: { in: contactRequestIds } },
      include: CONTACT_REQUEST_INCLUDE,
      orderBy: { id: "asc" },
    });
  const revealGrants: ObservedRevealGrant[] =
    await db.identityRevealGrant.findMany({
      where: { id: { in: revealIds } },
      include: REVEAL_GRANT_INCLUDE,
      orderBy: { id: "asc" },
    });
  const radarMappings = await db.radarOpaqueMapping.findMany({
    where: { id: { in: radarMappingIds } },
    orderBy: { id: "asc" },
  });
  const radarSearchBudgets = await db.radarSearchBudget.findMany({
    where: { id: { in: radarSearchBudgetIds } },
    orderBy: { id: "asc" },
  });
  const radarSearchSessions: ObservedRadarSearchSession[] =
    await db.radarSearchSession.findMany({
      where: { id: { in: radarSearchSessionIds } },
      include: RADAR_SEARCH_SESSION_INCLUDE,
      orderBy: { id: "asc" },
    });
  const subscriptions: ObservedSubscription[] =
    await db.employerSubscription.findMany({
      where: { id: { in: [...expected.subscriptionIds] } },
      include: SUBSCRIPTION_INCLUDE,
      orderBy: { id: "asc" },
    });
  const subscriptionSchedules = await db.subscriptionChangeSchedule.findMany({
    where: { id: { in: [...expected.subscriptionScheduleIds] } },
    orderBy: { id: "asc" },
  });
  const orders: ObservedOrder[] = await db.order.findMany({
    where: { id: { in: orderIds } },
    include: ORDER_INCLUDE,
    orderBy: { id: "asc" },
  });
  const invoices: ObservedInvoice[] = await db.invoice.findMany({
    where: { id: { in: invoiceIds } },
    include: INVOICE_INCLUDE,
    orderBy: { id: "asc" },
  });
  const boosts: ObservedBoost[] = await db.jobBoost.findMany({
    where: { id: { in: boostIds } },
    include: BOOST_INCLUDE,
    orderBy: { id: "asc" },
  });
  const creditAccounts = await db.creditAccount.findMany({
    where: { companyId: { in: companyIds } },
    include: { entries: { orderBy: { id: "asc" } } },
    orderBy: { id: "asc" },
  });
  const salesLeads = await db.salesLead.findMany({
    where: { id: { in: salesLeadIds } },
    orderBy: { id: "asc" },
  });
  const abuseReports: ObservedAbuseReport[] = await db.abuseReport.findMany({
    where: { id: { in: abuseIds } },
    include: ABUSE_REPORT_INCLUDE,
    orderBy: { id: "asc" },
  });
  const auditLogs = await db.auditLog.findMany({
    where: { id: { in: auditIds } },
    orderBy: { id: "asc" },
  });
  const analyticsEvents = await db.analyticsEvent.findMany({
    where: { id: { in: analyticsIds } },
    orderBy: { id: "asc" },
  });
  const producerAnalyticsCount = await db.analyticsEvent.count({
    where: { producer: "phase-05-demo-seed" },
  });
  const contentPages = await db.contentPage.findMany({
    where: { dataProvenance: "DEMO" },
    include: {
      currentPublishedRevision: { include: { events: true } },
      revisions: { select: { id: true } },
    },
    orderBy: { slug: "asc" },
  });
  const metricRowsForDemoCompanies = await db.metricDaily.count({
    where: { companyId: { in: companyIds } },
  });

  return {
    abuseReports,
    analyticsEvents,
    applications,
    auditLogs,
    boosts,
    candidates,
    cantons,
    categories,
    cities,
    companies,
    contactRequests,
    contentPages,
    conversations,
    creditAccounts,
    demoAccounts,
    invoices,
    jobAlerts,
    jobs,
    metricRowsForDemoCompanies,
    occupationVersion,
    orders,
    planEntitlementCount,
    planVersions,
    plans,
    producerAnalyticsCount,
    productVersions,
    products,
    radarMappings,
    radarSearchBudgets,
    radarSearchSessions,
    restrictions,
    revealGrants,
    salaryDataset,
    salesLeads,
    savedJobs,
    skills,
    subscriptionSchedules,
    subscriptions,
  };
}

function verifyGoldenCounts(
  context: VerificationContext,
  observed: Awaited<ReturnType<typeof loadObservedSeedState>>,
): SeedCounts {
  const counts: SeedCounts = Object.freeze({
    cantons: observed.cantons.length,
    cities: observed.cities.length,
    categories: observed.categories.length,
    skills: observed.skills.length,
    occupationCodes: observed.occupationVersion?.codes.length ?? 0,
    plans: observed.plans.length,
    planVersions: observed.planVersions.length,
    planEntitlements: observed.planEntitlementCount,
    products: observed.products.length,
    companies: observed.companies.length,
    jobs: observed.jobs.length,
    candidates: observed.candidates.length,
    applications: observed.applications.length,
    savedJobs: observed.savedJobs.length,
    jobAlerts: observed.jobAlerts.length,
    employerContactRequests: observed.contactRequests.length,
    identityRevealGrants: observed.revealGrants.length,
    conversations: observed.conversations.length,
    orders: observed.orders.length,
    invoices: observed.invoices.length,
    jobBoosts: observed.boosts.length,
    salesLeads: observed.salesLeads.length,
    auditLogs: observed.auditLogs.length,
    analyticsEvents: observed.analyticsEvents.length,
    contentPages: observed.contentPages.length,
  });
  check(context, "golden counts", counts, SEED_GOLDEN_COUNTS);
  return counts;
}

function verifyReferenceCatalog(
  context: VerificationContext,
  observed: Awaited<ReturnType<typeof loadObservedSeedState>>,
  expected: ReturnType<typeof buildExpectedScope>,
): void {
  checkHandleSet(
    context,
    "canonical Companies",
    observed.companies.map((company) => ({
      id: company.id,
      key: company.slug,
    })),
    expected.companies,
  );
  checkHandleSet(
    context,
    "canonical Jobs",
    observed.jobs.map((job) => ({ id: job.id, key: job.slug })),
    expected.jobs,
  );
  checkHandleSet(
    context,
    "canonical Candidate profiles",
    observed.candidates.map((candidate) => ({
      id: candidate.id,
      key: candidate.user.emailNormalized,
    })),
    expected.candidates,
  );
  checkHandleSet(
    context,
    "canonical Content pages",
    observed.contentPages.map((page) => ({ id: page.id, key: page.slug })),
    expected.contentPages,
  );

  const expectedCantonHandles = CANTON_FIXTURES_FOR_IDS().map((code) => ({
    id: stableSeedId("canton", code),
    key: code,
  }));
  checkHandleSet(
    context,
    "canonical Cantons",
    observed.cantons.map((canton) => ({ id: canton.id, key: canton.code })),
    expectedCantonHandles,
  );
  check(
    context,
    "canonical Cities reference valid Cantons",
    observed.cities.every((city) =>
      CANTON_FIXTURES_FOR_IDS().includes(city.canton.code),
    ),
    true,
  );
  checkHandleSet(
    context,
    "canonical Cities",
    observed.cities.map((city) => ({
      id: city.id,
      key: `${city.canton.code}:${city.slug}`,
    })),
    CITY_FIXTURES.map((city) => ({
      id: stableSeedId("city", `${city.cantonCode}:${city.slug}`),
      key: `${city.cantonCode}:${city.slug}`,
    })),
  );
  checkHandleSet(
    context,
    "canonical Categories",
    observed.categories.map((category) => ({
      id: category.id,
      key: category.slug,
    })),
    CATEGORY_FIXTURES.map((category) => ({
      id: stableSeedId("category", category.slug),
      key: category.slug,
    })),
  );
  check(
    context,
    "canonical Categories active",
    observed.categories.every((category) => category.isActive),
    true,
  );
  checkHandleSet(
    context,
    "canonical Skills",
    observed.skills.map((skill) => ({ id: skill.id, key: skill.slug })),
    SKILL_FIXTURES.map((skill) => ({
      id: stableSeedId("skill", skill.slug),
      key: skill.slug,
    })),
  );
  check(
    context,
    "canonical Skills non-empty",
    observed.skills.every(
      (skill) => skill.name.trim().length > 0 && skill.slug.trim().length > 0,
    ),
    true,
  );

  const occupationVersion = requireValue(
    observed.occupationVersion,
    "Occupation-code version",
  );
  check(
    context,
    "Occupation-code dataset identity",
    {
      datasetKey: occupationVersion.datasetKey,
      datasetYear: occupationVersion.datasetYear,
      disclaimerPresent: occupationVersion.disclaimer.trim().length > 0,
      source: occupationVersion.source,
      version: occupationVersion.version,
    },
    {
      datasetKey: OCCUPATION_CODES_2026_FIXTURE.datasetKey,
      datasetYear: OCCUPATION_CODES_2026_FIXTURE.dataYear,
      disclaimerPresent: true,
      source: OCCUPATION_CODES_2026_FIXTURE.source,
      version: OCCUPATION_CODES_2026_FIXTURE.datasetVersion,
    },
  );
  check(
    context,
    "Occupation-code closed code set",
    sortedStrings(occupationVersion.codes.map((code) => code.code)),
    sortedStrings(
      OCCUPATION_CODES_2026_FIXTURE.occupationCodes.map((code) => code.code),
    ),
  );

  const salaryDataset = requireValue(observed.salaryDataset, "Salary dataset");
  check(
    context,
    "Salary dataset lifecycle",
    {
      bands: salaryDataset.bands.length,
      datasetKey: salaryDataset.datasetKey,
      reviewStatus: salaryDataset.reviewStatus,
      version: salaryDataset.version,
    },
    {
      bands: EXPECTED_SALARY_BANDS,
      datasetKey: SALARY_DATASET_FIXTURE.datasetKey,
      reviewStatus: "APPROVED",
      version: SALARY_DATASET_FIXTURE.version,
    },
  );
  check(
    context,
    "Salary band ordered percentiles",
    salaryDataset.bands.every(
      (band) =>
        band.p25Chf < band.medianChf &&
        band.medianChf < band.p75Chf &&
        band.sampleSize > 0,
    ),
    true,
  );
  check(
    context,
    "Salary band canonical identities",
    sortedStrings(salaryDataset.bands.map((band) => band.id)),
    sortedStrings(
      SALARY_BAND_FIXTURES.map((fixture) =>
        stableSeedId("salary-band", fixture.naturalKey),
      ),
    ),
  );

  checkHandleSet(
    context,
    "Plan handles",
    observed.plans.map((plan) => ({ id: plan.id, key: plan.code })),
    PLAN_FIXTURES.map((plan) => ({
      id: stableSeedId("plan", plan.code),
      key: plan.code,
    })),
  );
  check(
    context,
    "single default Free plan",
    observed.plans
      .filter((plan) => plan.isDefaultFree)
      .map((plan) => plan.code),
    ["FREE_BASIC"],
  );
  for (const version of observed.planVersions) {
    const naturalKey = `${version.plan.code}:v${version.version}`;
    const fixture = PLAN_VERSION_FIXTURES.find(
      (candidate) => candidate.naturalKey === naturalKey,
    );
    check(
      context,
      `PlanVersion ${naturalKey} exists`,
      fixture !== undefined,
      true,
    );
    if (fixture === undefined) continue;
    check(
      context,
      `PlanVersion ${naturalKey} contract`,
      {
        billingInterval: version.billingInterval,
        id: version.id,
        isPublic: version.isPublic,
        isSelfService: version.isSelfService,
        priceMode: version.priceMode,
        status: version.status,
        termMonths: version.termMonths,
      },
      {
        billingInterval: fixture.billingInterval,
        id: stableSeedId("plan-version", fixture.naturalKey),
        isPublic: fixture.isPublic,
        isSelfService: fixture.isSelfService,
        priceMode: fixture.priceMode,
        status: fixture.status,
        termMonths: fixture.termMonths,
      },
    );
    check(
      context,
      `PlanVersion ${naturalKey} entitlement keys`,
      sortedStrings(version.entitlements.map((entitlement) => entitlement.key)),
      sortedStrings(ENTITLEMENT_KEYS),
    );
    for (const entitlement of version.entitlements) {
      const entitlementFixture = PLAN_ENTITLEMENT_FIXTURES.find(
        (candidate) =>
          candidate.planVersionNaturalKey === naturalKey &&
          candidate.key === entitlement.key,
      );
      check(
        context,
        `Plan entitlement ${naturalKey}:${entitlement.key} exists`,
        entitlementFixture !== undefined,
        true,
      );
      if (entitlementFixture === undefined) continue;
      check(
        context,
        `Plan entitlement ${naturalKey}:${entitlement.key} typed value`,
        {
          analyticsLevelValue: entitlement.analyticsLevelValue,
          booleanValue: entitlement.booleanValue,
          id: entitlement.id,
          integerValue: entitlement.integerValue,
          valueType: entitlement.valueType,
        },
        {
          analyticsLevelValue: entitlementFixture.analyticsLevelValue,
          booleanValue: entitlementFixture.booleanValue,
          id: stableSeedId("plan-entitlement", entitlementFixture.naturalKey),
          integerValue: entitlementFixture.integerValue,
          valueType: entitlementFixture.valueType,
        },
      );
    }
  }

  checkHandleSet(
    context,
    "Product handles",
    observed.products.map((product) => ({ id: product.id, key: product.code })),
    PRODUCT_FIXTURES.map((product) => ({
      id: stableSeedId("product", product.code),
      key: product.code,
    })),
  );
  check(
    context,
    "active Product versions",
    observed.productVersions.filter((version) => version.status === "ACTIVE")
      .length,
    4,
  );
  check(
    context,
    "Product version count",
    observed.productVersions.length,
    PRODUCT_VERSION_FIXTURES.length,
  );
  for (const version of observed.productVersions) {
    const naturalKey = `${version.product.code}:v${version.version}`;
    const fixture = PRODUCT_VERSION_FIXTURES.find(
      (candidate) => candidate.naturalKey === naturalKey,
    );
    check(
      context,
      `ProductVersion ${naturalKey} exists`,
      fixture !== undefined,
      true,
    );
    if (fixture === undefined) continue;
    check(
      context,
      `ProductVersion ${naturalKey} contract`,
      {
        creditAmount: version.creditAmount,
        creditType: version.creditType,
        durationDays: version.durationDays,
        id: version.id,
        isPublic: version.isPublic,
        isSelfService: version.isSelfService,
        status: version.status,
      },
      {
        creditAmount: fixture.creditAmount,
        creditType: fixture.creditType,
        durationDays: fixture.durationDays,
        id: stableSeedId("product-version", fixture.naturalKey),
        isPublic: fixture.isPublic,
        isSelfService: fixture.isSelfService,
        status: fixture.status,
      },
    );
  }
}

async function verifyDemoCredentials(
  context: VerificationContext,
  accounts: Awaited<ReturnType<typeof loadObservedSeedState>>["demoAccounts"],
): Promise<void> {
  check(context, "Demo login account count", accounts.length, 4);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const passwordChecks = await Promise.all(
    DEMO_ACCOUNT_FIXTURES.map(async (fixture) => {
      const account = accountById.get(fixture.id);
      if (account === undefined || account.credential === null) return false;
      return (
        account.emailNormalized === fixture.email &&
        account.role === fixture.role &&
        account.status === "ACTIVE" &&
        account.dataProvenance === "DEMO" &&
        account.credential.algorithm === "bcryptjs" &&
        account.credential.algorithmVersion === 1 &&
        (await verifyPassword(
          DEMO_LOGIN_PASSWORD,
          account.credential.passwordHash,
        ))
      );
    }),
  );
  check(context, "Demo credentials bcrypt-verifiable", passwordChecks, [
    true,
    true,
    true,
    true,
  ]);
}

function verifyCompanies(
  context: VerificationContext,
  observed: Awaited<ReturnType<typeof loadObservedSeedState>>,
  expected: ReturnType<typeof buildExpectedScope>,
  anchorAt: Date,
): void {
  check(
    context,
    "all canonical Companies are active DEMO",
    observed.companies.every(
      (company) =>
        company.dataProvenance === "DEMO" && company.status === "ACTIVE",
    ),
    true,
  );
  check(
    context,
    "all canonical Companies have one active owner",
    observed.companies.every(
      (company) =>
        company.memberships.filter(
          (membership) =>
            membership.role === "OWNER" && membership.status === "ACTIVE",
        ).length === 1,
    ),
    true,
  );
  check(
    context,
    "all canonical Companies have one current verified cycle",
    observed.companies.every(
      (company) =>
        company.verificationRequests.filter(
          (request) =>
            request.status === "VERIFIED" && request.supersededBy === null,
        ).length === 1,
    ),
    true,
  );

  const effectiveSubscriptions = observed.subscriptions.filter(
    (subscription) =>
      subscription.currentPeriodStart.getTime() <= anchorAt.getTime() &&
      anchorAt.getTime() < subscription.currentPeriodEnd.getTime() &&
      (subscription.status === "ACTIVE" ||
        subscription.status === "CANCELLING"),
  );
  const effectiveByCompany = new Map(
    effectiveSubscriptions.map((subscription) => [
      subscription.companyId,
      subscription.planVersion.plan.code,
    ]),
  );
  const companyPlanDistribution: Record<string, number> = {};
  for (const company of COMPANY_FIXTURES) {
    const actualPlan = effectiveByCompany.get(company.id) ?? "FREE_BASIC";
    check(
      context,
      `Company ${company.slug} effective plan`,
      actualPlan,
      company.planCode,
    );
    companyPlanDistribution[actualPlan] =
      (companyPlanDistribution[actualPlan] ?? 0) + 1;
  }
  check(
    context,
    "Company plan distribution",
    sortedNumberRecord(companyPlanDistribution),
    sortedNumberRecord({
      BUSINESS: 5,
      ENTERPRISE_CONTRACT: 3,
      FREE_BASIC: 5,
      PRO: 6,
      STARTER: 6,
    }),
  );
  check(
    context,
    "canonical Company handle count",
    expected.companies.length,
    SEED_GOLDEN_COUNTS.companies,
  );
}

function verifyJobs(
  context: VerificationContext,
  observed: Awaited<ReturnType<typeof loadObservedSeedState>>,
  expected: ReturnType<typeof buildExpectedScope>,
  anchorAt: Date,
): void {
  const statusDistribution = countBy(observed.jobs, (job) => job.status);
  const jobTypeDistribution = countBy(
    observed.jobs,
    (job) => requireValue(job.currentRevision, "Job current revision").jobType,
  );
  const contentLanguageDistribution = countBy(
    observed.jobs,
    (job) =>
      requireValue(job.currentRevision, "Job current revision").contentLanguage,
  );
  const effortDistribution = countBy(
    observed.jobs,
    (job) =>
      requireValue(job.currentRevision, "Job current revision")
        .applicationEffort,
  );
  check(
    context,
    "Job status distribution",
    sortedNumberRecord(statusDistribution),
    sortedNumberRecord(JOB_STATUS_DISTRIBUTION),
  );
  check(
    context,
    "Job type distribution",
    sortedNumberRecord(jobTypeDistribution),
    sortedNumberRecord(JOB_TYPE_DISTRIBUTION),
  );
  check(
    context,
    "Job content-language distribution",
    sortedNumberRecord(contentLanguageDistribution),
    sortedNumberRecord(JOB_CONTENT_LANGUAGE_DISTRIBUTION),
  );
  check(
    context,
    "Job application-effort distribution",
    sortedNumberRecord(effortDistribution),
    sortedNumberRecord(JOB_EFFORT_DISTRIBUTION),
  );
  check(
    context,
    "Remote plus Hybrid Jobs",
    observed.jobs.filter((job) => {
      const remoteType = requireValue(
        job.currentRevision,
        "Job current revision",
      ).remoteType;
      return remoteType === "REMOTE" || remoteType === "HYBRID";
    }).length,
    EXPECTED_REMOTE_OR_HYBRID_JOBS,
  );
  check(
    context,
    "salary-disclosed Jobs",
    observed.jobs.filter((job) => {
      const revision = requireValue(
        job.currentRevision,
        "Job current revision",
      );
      return (
        revision.salaryPeriod !== null &&
        revision.salaryMin !== null &&
        revision.salaryMax !== null
      );
    }).length,
    EXPECTED_SALARY_DISCLOSED_JOBS,
  );
  check(
    context,
    "Job salary fields are all-or-none",
    observed.jobs.every((job) => {
      const revision = requireValue(
        job.currentRevision,
        "Job current revision",
      );
      const present = [
        revision.salaryPeriod,
        revision.salaryMin,
        revision.salaryMax,
      ].filter((value) => value !== null).length;
      return present === 0 || present === 3;
    }),
    true,
  );
  check(
    context,
    "all Jobs have one current revision with skills, languages and reporting evidence",
    observed.jobs.every((job) => {
      const revision = job.currentRevision;
      return (
        job.dataProvenance === "DEMO" &&
        revision !== null &&
        job.currentRevisionId === revision.id &&
        revision.skills.length >= 1 &&
        revision.languages.length >= 1 &&
        revision.reportingChecks.length === 1
      );
    }),
    true,
  );
  check(
    context,
    "all Job revisions declare an explicit valid required-document selection",
    observed.jobs.every((job) => {
      const kinds = requireValue(
        job.currentRevision,
        "Job current revision",
      ).requiredDocumentKinds;
      return (
        kinds.length >= 1 &&
        (!kinds.includes("NONE") || kinds.length === 1)
      );
    }),
    true,
  );
  check(
    context,
    "Job revision skill links",
    observed.jobs.reduce(
      (total, job) =>
        total +
        requireValue(job.currentRevision, "Job current revision").skills.length,
      0,
    ),
    230,
  );
  check(
    context,
    "Job revision language links",
    observed.jobs.reduce(
      (total, job) =>
        total +
        requireValue(job.currentRevision, "Job current revision").languages
          .length,
      0,
    ),
    155,
  );
  check(
    context,
    "Fair-Job-Score v2 snapshots",
    observed.jobs.reduce(
      (total, job) =>
        total +
        requireValue(job.currentRevision, "Job current revision").scoreSnapshots
          .length,
      0,
    ),
    105,
  );
  for (const snapshot of observed.jobs.flatMap(
    (job) =>
      requireValue(job.currentRevision, "Job current revision").scoreSnapshots,
  )) {
    const inputSnapshot =
      snapshot.inputSnapshot as unknown as FairJobInputSnapshotV2;
    const recalculated = calculateFairJobScoreFromSnapshotV2(inputSnapshot);
    const storedRecord: FairJobScoreSnapshotRecordV2 = {
      calculatedAt: snapshot.calculatedAt,
      evidence:
        snapshot.evidence as unknown as FairJobScoreSnapshotRecordV2["evidence"],
      evidenceHash: snapshot.evidenceHash,
      factorBreakdown:
        snapshot.factorBreakdown as unknown as FairJobFactorBreakdownV2,
      inputSnapshot,
      jobRevisionId: snapshot.jobRevisionId,
      maxPoints:
        snapshot.maxPoints as FairJobScoreSnapshotRecordV2["maxPoints"],
      scorePoints: snapshot.scorePoints,
      scoreVersion:
        snapshot.scoreVersion as FairJobScoreSnapshotRecordV2["scoreVersion"],
    };
    check(
      context,
      `Fair-Job-Score v2 snapshot ${snapshot.id} recomputes and hashes`,
      {
        evidence: snapshot.evidence as CanonicalJsonValue,
        factorBreakdown: snapshot.factorBreakdown as CanonicalJsonValue,
        hashValid: verifyFairJobScoreSnapshotHashV2(storedRecord),
        scorePoints: snapshot.scorePoints,
      },
      {
        evidence: recalculated.evidence as CanonicalJsonValue,
        factorBreakdown: buildFairJobFactorBreakdownForVerification(
          recalculated,
        ) as CanonicalJsonValue,
        hashValid: true,
        scorePoints: recalculated.score,
      },
    );
  }
  const publishedJobs = observed.jobs.filter(
    (job) => job.status === "PUBLISHED",
  );
  check(
    context,
    "published Jobs have one Fair-Job-Score v2 snapshot",
    publishedJobs.every((job) => {
      const snapshots = requireValue(
        job.currentRevision,
        "Published Job current revision",
      ).scoreSnapshots;
      return (
        snapshots.length === 1 &&
        (snapshots[0]?.scorePoints ?? -1) >= 0 &&
        (snapshots[0]?.scorePoints ?? 101) <= 100
      );
    }),
    true,
  );
  check(
    context,
    "ZH Engineering Jobs",
    observed.jobs.filter((job) => {
      const revision = requireValue(
        job.currentRevision,
        "Job current revision",
      );
      return (
        revision.canton?.code === "ZH" &&
        revision.category.slug === "engineering-technik"
      );
    }).length,
    EXPECTED_ZH_ENGINEERING_JOBS,
  );

  const nonProductionEligible = observed.jobs.filter((job) =>
    isPubliclyEligible(job, observed.restrictions, anchorAt, "non-production"),
  );
  const productionEligibleDemo = observed.jobs.filter((job) =>
    isPubliclyEligible(job, observed.restrictions, anchorAt, "production"),
  );
  check(
    context,
    "non-production public-eligible Jobs at anchor",
    nonProductionEligible.length,
    EXPECTED_PUBLIC_ELIGIBLE_JOBS,
  );
  check(
    context,
    "production predicate excludes every DEMO Job",
    productionEligibleDemo.length,
    0,
  );
  check(
    context,
    "canonical Job handle count",
    expected.jobs.length,
    SEED_GOLDEN_COUNTS.jobs,
  );
}

function verifyCandidateWorkflows(
  context: VerificationContext,
  observed: Awaited<ReturnType<typeof loadObservedSeedState>>,
  expected: ReturnType<typeof buildExpectedScope>,
): void {
  check(
    context,
    "Candidate skill links",
    observed.candidates.reduce(
      (total, candidate) => total + candidate.skills.length,
      0,
    ),
    EXPECTED_CANDIDATE_SKILLS,
  );
  check(
    context,
    "Candidate language links",
    observed.candidates.reduce(
      (total, candidate) => total + candidate.languages.length,
      0,
    ),
    EXPECTED_CANDIDATE_LANGUAGES,
  );
  check(
    context,
    "Candidate preference completeness",
    observed.candidates.every(
      (candidate) =>
        candidate.preference !== null &&
        candidate.preference.categories.length === 1 &&
        candidate.preference.desiredTitles.length >= 1 &&
        candidate.preference.desiredJobTypes.length >= 1,
    ),
    true,
  );
  const grantedConsents = observed.candidates.flatMap((candidate) =>
    candidate.radarConsents.filter(
      (consent) =>
        consent.kind === "TALENT_RADAR_VISIBILITY" && consent.granted,
    ),
  );
  check(
    context,
    "granted Talent Radar consents",
    grantedConsents.length,
    EXPECTED_GRANTED_RADAR_CONSENTS,
  );
  const radarProfiles = observed.candidates.flatMap((candidate) =>
    candidate.radarProfile === null ? [] : [candidate.radarProfile],
  );
  check(
    context,
    "published Talent Radar profiles",
    radarProfiles.length,
    EXPECTED_RADAR_PROFILES,
  );
  check(
    context,
    "Talent Radar profiles are published, anonymous and consent-backed",
    observed.candidates.every((candidate) => {
      if (candidate.radarProfile === null) return true;
      const latestConsent = candidate.radarConsents.at(-1);
      return (
        candidate.onboardingStatus === "COMPLETE" &&
        candidate.user.status === "ACTIVE" &&
        latestConsent?.granted === true &&
        candidate.radarProfile.publishedAt !== null &&
        candidate.radarProfile.withdrawnAt === null &&
        !candidate.radarProfile.displayLabel.includes(
          candidate.firstName ?? "\u0000",
        ) &&
        !candidate.radarProfile.displayLabel.includes(
          candidate.lastName ?? "\u0000",
        )
      );
    }),
    true,
  );
  check(
    context,
    "Candidate CV metadata boundary",
    observed.candidates.reduce(
      (total, candidate) => total + candidate.documents.length,
      0,
    ),
    1,
  );
  check(
    context,
    "Candidate CV contains metadata only",
    observed.candidates
      .flatMap((candidate) => candidate.documents)
      .every(
        (document) =>
          document.purpose === "CV" &&
          document.status === "ACTIVE" &&
          document.safeFilename === "lebenslauf.pdf" &&
          document.mimeType === "application/pdf" &&
          document.sizeBytes === 123_456 &&
          /^mock-storage\/[a-f0-9-]+\/lebenslauf\.pdf$/u.test(
            document.storageKey,
          ),
      ),
    true,
  );

  check(
    context,
    "Application submission snapshots",
    observed.applications.filter(
      (application) => application.submissionSnapshot !== null,
    ).length,
    SEED_GOLDEN_COUNTS.applications,
  );
  check(
    context,
    "Application snapshots preserve submitted relationships",
    observed.applications.every((application) => {
      const snapshot = application.submissionSnapshot;
      return (
        snapshot !== null &&
        snapshot.applicationId === application.id &&
        snapshot.jobRevisionId === application.submittedJobRevisionId &&
        application.submittedJobRevision.jobId === application.jobId &&
        snapshot.candidateEmail ===
          application.candidateProfile.user.emailNormalized &&
        snapshot.candidateFirstName ===
          application.candidateProfile.firstName &&
        snapshot.candidateLastName === application.candidateProfile.lastName &&
        snapshot.recipientCompanyName === application.job.company.name &&
        snapshot.applicationContactKind ===
          application.submittedJobRevision.applicationContactKind &&
        snapshot.applicationContactValue ===
          application.submittedJobRevision.applicationContactValue &&
        snapshot.responseTargetDays ===
          application.submittedJobRevision.responseTargetDays &&
        snapshot.applicationEffort ===
          application.submittedJobRevision.applicationEffort &&
        canonicalJson(snapshot.requiredDocumentKinds) ===
          canonicalJson(
            application.submittedJobRevision.requiredDocumentKinds,
          )
      );
    }),
    true,
  );
  check(
    context,
    "Application required documents are exactly linked and active",
    observed.applications.every((application) => {
      const declaredKinds =
        application.submittedJobRevision.requiredDocumentKinds;
      const validDeclaration =
        declaredKinds.length >= 1 &&
        (!declaredKinds.includes("NONE") || declaredKinds.length === 1);
      const requiredKinds = declaredKinds
          .filter((kind) => kind !== "NONE")
          .sort();
      const linkedKinds = application.submissionDocuments
        .map(({ documentMetadata }) => documentMetadata.purpose)
        .sort();
      return (
        validDeclaration &&
        canonicalJson(requiredKinds) === canonicalJson(linkedKinds) &&
        application.submissionDocuments.every(
          ({ documentMetadata }) =>
            documentMetadata.candidateProfileId ===
              application.candidateProfileId &&
            documentMetadata.status === "ACTIVE" &&
            documentMetadata.removedAt === null,
        )
      );
    }),
    true,
  );
  check(
    context,
    "Application CV submission links",
    observed.applications.reduce(
      (total, application) => total + application.submissionDocuments.length,
      0,
    ),
    3,
  );
  check(
    context,
    "Application conversation split",
    sortedNumberRecord(
      countBy(observed.conversations, (conversation) => conversation.kind),
    ),
    sortedNumberRecord({ APPLICATION: 80, TALENT_RADAR: 2 }),
  );
  check(
    context,
    "Conversation ownership and participants",
    observed.conversations.every(
      (conversation) =>
        conversation.participants.length === 2 &&
        ((conversation.kind === "APPLICATION" &&
          conversation.applicationId !== null) ||
          (conversation.kind === "TALENT_RADAR" &&
            conversation.contactRequestId !== null)),
    ),
    true,
  );

  check(
    context,
    "Contact request status distribution",
    sortedNumberRecord(
      countBy(observed.contactRequests, (request) => request.status),
    ),
    sortedNumberRecord({ ACCEPTED: 2, DECLINED: 2, PENDING: 2 }),
  );
  check(
    context,
    "Contact request credit consumption",
    observed.contactRequests.every(
      (request) =>
        request.creditLedgerEntry.kind === "CONSUME" &&
        request.creditLedgerEntry.amount === -1 &&
        request.creditLedgerEntry.account.companyId === request.companyId &&
        request.creditLedgerEntry.account.creditType === "TALENT_CONTACT" &&
        request.creditLedgerEntry.fundingSource === request.fundingSource,
    ),
    true,
  );
  check(
    context,
    "accepted Contact requests own reveal and conversation",
    observed.contactRequests.every((request) =>
      request.status === "ACCEPTED"
        ? request.revealGrant !== null && request.conversation !== null
        : request.revealGrant === null && request.conversation === null,
    ),
    true,
  );
  check(
    context,
    "Identity reveals remain scoped to accepted requests",
    observed.revealGrants.every(
      (grant) =>
        grant.fields.length >= 2 &&
        observed.contactRequests.some(
          (request) =>
            request.id === grant.contactRequestId &&
            request.status === "ACCEPTED" &&
            request.candidateProfileId === grant.candidateProfileId &&
            request.companyId === grant.companyId,
        ),
    ),
    true,
  );
  check(
    context,
    "Identity reveal privacy lifecycle",
    {
      active: observed.revealGrants.filter((grant) => grant.revokedAt === null)
        .length,
      revoked: observed.revealGrants.filter((grant) => grant.revokedAt !== null)
        .length,
    },
    { active: 1, revoked: 1 },
  );
  check(
    context,
    "canonical Candidate handle count",
    expected.candidates.length,
    SEED_GOLDEN_COUNTS.candidates,
  );
}

function verifyBilling(
  context: VerificationContext,
  observed: Awaited<ReturnType<typeof loadObservedSeedState>>,
  expected: ReturnType<typeof buildExpectedScope>,
  anchorAt: Date,
): void {
  check(
    context,
    "Demo subscription rows",
    observed.subscriptions.length,
    EXPECTED_DEMO_SUBSCRIPTIONS,
  );
  check(
    context,
    "Subscription status distribution",
    sortedNumberRecord(
      countBy(observed.subscriptions, (subscription) => subscription.status),
    ),
    sortedNumberRecord({
      ACTIVE: 19,
      CANCELLED: 1,
      CANCELLING: 1,
      EXPIRED: 1,
      SCHEDULED: 1,
    }),
  );
  const effective = observed.subscriptions.filter(
    (subscription) =>
      subscription.currentPeriodStart.getTime() <= anchorAt.getTime() &&
      anchorAt.getTime() < subscription.currentPeriodEnd.getTime() &&
      (subscription.status === "ACTIVE" ||
        subscription.status === "CANCELLING"),
  );
  check(
    context,
    "effective paid Company subscriptions",
    effective.length,
    EXPECTED_EFFECTIVE_PAID_SUBSCRIPTIONS,
  );
  check(
    context,
    "effective subscriptions have immutable commercial snapshots",
    effective.every(
      (subscription) =>
        subscription.billingIntervalSnapshot ===
          subscription.planVersion.billingInterval &&
        subscription.termMonthsSnapshot ===
          subscription.planVersion.termMonths &&
        (subscription.planVersion.priceMode === "CONTRACT"
          ? subscription.recurringNetRappenSnapshot > 0 &&
            subscription.monthlyEquivalentRappenSnapshot > 0
          : subscription.recurringNetRappenSnapshot ===
              subscription.planVersion.netPriceRappen &&
            subscription.monthlyEquivalentRappenSnapshot ===
              subscription.planVersion.monthlyEquivalentRappen) &&
        subscription.currencySnapshot === subscription.planVersion.currency,
    ),
    true,
  );
  check(
    context,
    "pending Subscription schedules",
    observed.subscriptionSchedules.length,
    EXPECTED_SUBSCRIPTION_SCHEDULES,
  );
  check(
    context,
    "Subscription schedule scope",
    observed.subscriptionSchedules.every(
      (schedule) =>
        schedule.status === "PENDING" &&
        schedule.effectiveAt.getTime() > anchorAt.getTime() &&
        expected.subscriptionIds.includes(schedule.currentSubscriptionId) &&
        (schedule.kind === "CANCEL"
          ? schedule.successorSubscriptionId === null
          : schedule.kind === "DOWNGRADE" &&
            schedule.successorSubscriptionId !== null &&
            expected.subscriptionIds.includes(
              schedule.successorSubscriptionId,
            )),
    ),
    true,
  );

  check(
    context,
    "Order status distribution",
    sortedNumberRecord(countBy(observed.orders, (order) => order.status)),
    sortedNumberRecord({ CANCELLED: 2, PAID: 7, PENDING: 3 }),
  );
  check(
    context,
    "Orders have one taxed line and closed totals",
    observed.orders.every((order) => {
      const line = order.lines[0];
      return (
        order.lines.length === 1 &&
        line !== undefined &&
        line.taxRateBasisPoints === EXPECTED_TAX_RATE_BASIS_POINTS &&
        line.taxRateVersion.rateBasisPoints ===
          EXPECTED_TAX_RATE_BASIS_POINTS &&
        line.taxRateVersion.reviewStatus === "APPROVED" &&
        line.taxRateVersion.taxType === "MWST_STANDARD_DEMO" &&
        line.netRappen + line.vatRappen === line.totalRappen &&
        order.netTotalRappen === line.netRappen &&
        order.vatTotalRappen === line.vatRappen &&
        order.totalRappen === line.totalRappen &&
        order.provider === "MOCK"
      );
    }),
    true,
  );
  check(
    context,
    "Order lines use the single canonical TaxRateVersion",
    sortedStrings([
      ...new Set(
        observed.orders.flatMap((order) =>
          order.lines.map((line) => line.taxRateVersionId),
        ),
      ),
    ]),
    [stableSeedId("tax-rate-version", "CH:VAT:810:phase-05")],
  );
  check(
    context,
    "Invoice status distribution",
    sortedNumberRecord(countBy(observed.invoices, (invoice) => invoice.status)),
    sortedNumberRecord({ ISSUED: 3, PAID: 3, VOID: 1 }),
  );
  check(
    context,
    "Invoices snapshot their paid Order exactly",
    observed.invoices.every((invoice) => {
      const line = invoice.lines[0];
      return (
        invoice.lines.length === 1 &&
        line !== undefined &&
        invoice.order.status === "PAID" &&
        invoice.companyId === invoice.order.companyId &&
        invoice.netTotalRappen === invoice.order.netTotalRappen &&
        invoice.vatTotalRappen === invoice.order.vatTotalRappen &&
        invoice.totalRappen === invoice.order.totalRappen &&
        line.orderLine.orderId === invoice.orderId &&
        line.taxRateBasisPoints === EXPECTED_TAX_RATE_BASIS_POINTS &&
        line.netRappen + line.vatRappen === line.totalRappen
      );
    }),
    true,
  );
  check(
    context,
    "Job Boost status distribution",
    sortedNumberRecord(countBy(observed.boosts, (boost) => boost.status)),
    sortedNumberRecord({ ACTIVE: 5, EXPIRED: 5 }),
  );
  check(
    context,
    "Job Boost funding and Company scope",
    observed.boosts.every((boost) => {
      const hasOrder = boost.orderLineId !== null;
      const hasLedger = boost.consumedCreditLedgerEntryId !== null;
      const timeMatchesStatus =
        boost.status === "ACTIVE"
          ? boost.startsAt.getTime() <= anchorAt.getTime() &&
            anchorAt.getTime() < boost.endsAt.getTime()
          : boost.status === "EXPIRED" &&
            boost.endsAt.getTime() <= anchorAt.getTime();
      const orderScope =
        !hasOrder ||
        (boost.orderLine !== null &&
          boost.orderLine.targetJobId === boost.jobId &&
          boost.orderLine.fulfillmentContext === "JOB_BOOST");
      const ledgerScope =
        !hasLedger ||
        (boost.consumedCreditLedgerEntry !== null &&
          boost.consumedCreditLedgerEntry.kind === "CONSUME" &&
          boost.consumedCreditLedgerEntry.amount === -1 &&
          boost.consumedCreditLedgerEntry.account.companyId ===
            boost.companyId &&
          boost.consumedCreditLedgerEntry.account.creditType === "JOB_BOOST");
      return (
        hasOrder !== hasLedger &&
        boost.job.companyId === boost.companyId &&
        timeMatchesStatus &&
        orderScope &&
        ledgerScope
      );
    }),
    true,
  );

  check(
    context,
    "Demo CreditAccount scope",
    observed.creditAccounts.length,
    EXPECTED_CREDIT_ACCOUNTS,
  );
  const ledgerEntries = observed.creditAccounts.flatMap((account) =>
    account.entries.map((entry) => ({ account, entry })),
  );
  check(
    context,
    "Demo CreditLedgerEntry scope",
    ledgerEntries.length,
    EXPECTED_CREDIT_LEDGER_ENTRIES,
  );
  check(
    context,
    "Credit ledger funding and sign invariants",
    ledgerEntries.every(({ account, entry }) => {
      const correctSign =
        (entry.kind === "GRANT" && entry.amount > 0) ||
        (entry.kind === "CONSUME" && entry.amount < 0);
      const correctFunding =
        entry.fundingSource === account.fundingSource &&
        (entry.fundingSource === "PLAN_ALLOWANCE"
          ? entry.kind === "CONSUME" || entry.sourcePlanVersionId !== null
          : entry.fundingSource === "PURCHASED_PACK"
            ? entry.kind === "CONSUME" || entry.sourceOrderLineId !== null
            : entry.fundingSource === "ADMIN_GRANT" &&
              entry.sourcePlanVersionId === null &&
              entry.sourceOrderLineId === null);
      return (
        correctSign &&
        correctFunding &&
        entry.validFrom.getTime() < entry.validTo.getTime() &&
        COMPANY_FIXTURES.some((company) => company.id === account.companyId)
      );
    }),
    true,
  );
}

function verifyOperationsAndContent(
  context: VerificationContext,
  observed: Awaited<ReturnType<typeof loadObservedSeedState>>,
  expected: ReturnType<typeof buildExpectedScope>,
): void {
  check(
    context,
    "open Abuse cases",
    observed.abuseReports.length >= 3 &&
      observed.abuseReports.every(
        (report) => report.status === "OPEN" && report.events.length >= 1,
      ),
    true,
  );
  check(
    context,
    "Audit log demo evidence",
    observed.auditLogs.every(
      (entry) =>
        entry.result === "SUCCEEDED" &&
        entry.reasonCode === "PHASE_05_DEMO_EVIDENCE" &&
        entry.correlationId.startsWith("seed:audit:"),
    ),
    true,
  );

  check(
    context,
    "closed analytics producer count",
    observed.producerAnalyticsCount,
    SEED_GOLDEN_COUNTS.analyticsEvents,
  );
  const analyticsKindCounts = countBy(
    observed.analyticsEvents,
    (event) => event.kind,
  );
  const demoCompanyIds = new Set(
    observed.companies.map((company) => company.id),
  );
  const demoJobIds = new Set(observed.jobs.map((job) => job.id));
  check(
    context,
    "closed analytics v1 kind coverage",
    sortedStrings(Object.keys(analyticsKindCounts)),
    sortedStrings(ANALYTICS_EVENT_KINDS_V1),
  );
  for (const event of observed.analyticsEvents) {
    const contract = ANALYTICS_EVENT_CONTRACTS_V1[event.kind];
    contract.propertiesSchema.parse(event.properties);
    check(
      context,
      `Analytics ${event.id} closed v1 envelope`,
      {
        actorProvenanceSnapshot: event.actorProvenanceSnapshot,
        companySnapshotCorrect:
          event.companyId === null
            ? event.companyProvenanceSnapshot === null
            : event.companyProvenanceSnapshot === "DEMO" &&
              demoCompanyIds.has(event.companyId),
        jobSnapshotCorrect:
          event.jobId === null
            ? event.jobProvenanceSnapshot === null
            : event.jobProvenanceSnapshot === "DEMO" &&
              demoJobIds.has(event.jobId),
        purpose: event.purpose,
        retentionCorrect:
          event.retainUntil.getTime() ===
          getAnalyticsRetainUntilV1(event.kind, event.occurredAt).getTime(),
        schemaVersion: event.schemaVersion,
      },
      {
        actorProvenanceSnapshot: "DEMO",
        companySnapshotCorrect: true,
        jobSnapshotCorrect: true,
        purpose: contract.purpose,
        retentionCorrect: true,
        schemaVersion: ANALYTICS_SCHEMA_VERSION_V1,
      },
    );
  }
  verifyAnalyticsSeedCohorts(context, observed);
  check(
    context,
    "DEMO analytics never become LIVE MetricDaily rows",
    observed.metricRowsForDemoCompanies,
    0,
  );

  checkHandleSet(
    context,
    "Content DEMO scope",
    observed.contentPages.map((page) => ({ id: page.id, key: page.slug })),
    expected.contentPages,
  );
  check(
    context,
    "published DEMO guide contract",
    observed.contentPages.every((page) => {
      const revision = page.currentPublishedRevision;
      if (revision === null) return false;
      const eventKinds = sortedStrings(
        revision.events.map((event) => event.kind),
      );
      return (
        page.dataProvenance === "DEMO" &&
        page.type === "GUIDE" &&
        page.locale === "de-CH" &&
        page.revisions.length === 1 &&
        revision.status === "PUBLISHED" &&
        revision.reviewedAt !== null &&
        revision.publishedAt !== null &&
        countGuideWords(revision.body) >= 300 &&
        countGuideWords(revision.body) <= 600 &&
        sameCanonicalValue(eventKinds, [
          "APPROVED",
          "DRAFTED",
          "PUBLISHED",
          "SUBMITTED_FOR_REVIEW",
        ])
      );
    }),
    true,
  );
}

function verifyAnalyticsSeedCohorts(
  context: VerificationContext,
  observed: Awaited<ReturnType<typeof loadObservedSeedState>>,
): void {
  const candidateEvents = observed.analyticsEvents.filter(
    (event) =>
      event.pseudonymousActorId?.startsWith("demo-candidate-") === true &&
      (event.kind === "CANDIDATE_REGISTERED" ||
        event.kind === "CANDIDATE_PROFILE_COMPLETED"),
  );
  const candidateGroups = groupAnalyticsEvents(
    candidateEvents,
    (event) => event.pseudonymousActorId,
  );
  let candidateCompleted = 0;
  let candidateTimely = 0;
  let candidateValid = true;
  for (const events of candidateGroups.values()) {
    const ordered = sortAnalyticsEvents(events);
    const registered = ordered.find(
      (event) => event.kind === "CANDIDATE_REGISTERED",
    );
    const completed = ordered.find(
      (event) => event.kind === "CANDIDATE_PROFILE_COMPLETED",
    );
    candidateValid &&=
      registered !== undefined &&
      new Set(events.map((event) => event.pseudonymousSessionId)).size === 1;
    if (registered !== undefined && completed !== undefined) {
      candidateCompleted += 1;
      const delay =
        completed.occurredAt.getTime() - registered.occurredAt.getTime();
      candidateValid &&= delay >= 0;
      if (delay < 7 * 86_400_000) candidateTimely += 1;
    }
  }
  check(
    context,
    "Analytics Candidate activation cohorts",
    {
      completed: candidateCompleted,
      cohorts: candidateGroups.size,
      registered: candidateEvents.filter(
        (event) => event.kind === "CANDIDATE_REGISTERED",
      ).length,
      timely: candidateTimely,
      valid: candidateValid,
    },
    { completed: 18, cohorts: 20, registered: 20, timely: 17, valid: true },
  );

  const employerEvents = observed.analyticsEvents.filter(
    (event) =>
      event.pseudonymousActorId?.startsWith("demo-employer-") === true &&
      [
        "EMPLOYER_REGISTERED",
        "COMPANY_ONBOARDING_COMPLETED",
        "JOB_PUBLISHED",
      ].includes(event.kind),
  );
  const employerGroups = groupAnalyticsEvents(
    employerEvents,
    (event) => event.companyId,
  );
  const jobsById = new Map(observed.jobs.map((job) => [job.id, job]));
  let employerPublished = 0;
  let employerTimely = 0;
  let employerValid = true;
  for (const [companyId, events] of employerGroups) {
    const ordered = sortAnalyticsEvents(events);
    const registered = ordered.find(
      (event) => event.kind === "EMPLOYER_REGISTERED",
    );
    const onboarded = ordered.find(
      (event) => event.kind === "COMPANY_ONBOARDING_COMPLETED",
    );
    const published = ordered.find((event) => event.kind === "JOB_PUBLISHED");
    employerValid &&=
      registered !== undefined &&
      onboarded !== undefined &&
      registered.occurredAt.getTime() <= onboarded.occurredAt.getTime() &&
      new Set(events.map((event) => event.pseudonymousActorId)).size === 1 &&
      new Set(events.map((event) => event.pseudonymousSessionId)).size === 1;
    if (onboarded !== undefined && published !== undefined) {
      employerPublished += 1;
      const delay =
        published.occurredAt.getTime() - onboarded.occurredAt.getTime();
      employerValid &&=
        delay >= 0 &&
        published.jobId !== null &&
        jobsById.get(published.jobId)?.companyId === companyId;
      if (delay < 14 * 86_400_000) employerTimely += 1;
    }
  }
  check(
    context,
    "Analytics Employer activation cohorts",
    {
      cohorts: employerGroups.size,
      onboarded: employerEvents.filter(
        (event) => event.kind === "COMPANY_ONBOARDING_COMPLETED",
      ).length,
      published: employerPublished,
      registered: employerEvents.filter(
        (event) => event.kind === "EMPLOYER_REGISTERED",
      ).length,
      timely: employerTimely,
      valid: employerValid,
    },
    {
      cohorts: 20,
      onboarded: 20,
      published: 18,
      registered: 20,
      timely: 17,
      valid: true,
    },
  );

  const searchEvents = observed.analyticsEvents.filter(
    (event) => event.pseudonymousSessionId?.startsWith("demo-search-") === true,
  );
  const searchGroups = groupAnalyticsEvents(
    searchEvents,
    (event) => event.pseudonymousSessionId,
  );
  let resultSessions = 0;
  let detailSessions = 0;
  let intentSessions = 0;
  let submittedSessions = 0;
  let searchValid = true;
  for (const events of searchGroups.values()) {
    const ordered = sortAnalyticsEvents(events);
    const searchSubmitted = ordered.find(
      (event) => event.kind === "SEARCH_SUBMITTED",
    );
    const results = ordered.find(
      (event) => event.kind === "SEARCH_RESULTS_VIEWED",
    );
    const detail = ordered.find((event) => event.kind === "JOB_DETAIL_VIEWED");
    const intent = ordered.find(
      (event) => event.kind === "APPLY_INTENT_STARTED",
    );
    const submitted = ordered.find(
      (event) => event.kind === "APPLICATION_SUBMITTED",
    );
    if (results !== undefined) resultSessions += 1;
    if (detail !== undefined) detailSessions += 1;
    if (intent !== undefined) intentSessions += 1;
    if (submitted !== undefined) submittedSessions += 1;
    const scoped = events.filter((event) => event.jobId !== null);
    searchValid &&=
      searchSubmitted !== undefined &&
      results !== undefined &&
      searchSubmitted.occurredAt.getTime() <= results.occurredAt.getTime() &&
      (detail === undefined ||
        results.occurredAt.getTime() <= detail.occurredAt.getTime()) &&
      (intent === undefined ||
        (detail !== undefined &&
          detail.occurredAt.getTime() <= intent.occurredAt.getTime())) &&
      (submitted === undefined ||
        (intent !== undefined &&
          intent.occurredAt.getTime() <= submitted.occurredAt.getTime())) &&
      new Set(events.map((event) => event.pseudonymousActorId)).size === 1 &&
      (scoped.length === 0 ||
        (new Set(scoped.map((event) => event.companyId)).size === 1 &&
          new Set(scoped.map((event) => event.jobId)).size === 1 &&
          scoped.every(
            (event) =>
              event.jobId !== null &&
              jobsById.get(event.jobId)?.companyId === event.companyId,
          )));
  }
  check(
    context,
    "Analytics Search to Apply cohorts",
    {
      cohorts: searchGroups.size,
      detailSessions,
      intentSessions,
      resultSessions,
      submittedSessions,
      valid: searchValid,
    },
    {
      cohorts: 20,
      detailSessions: 19,
      intentSessions: 18,
      resultSessions: 20,
      submittedSessions: 17,
      valid: true,
    },
  );

  const leadEvents = observed.analyticsEvents.filter(
    (event) => event.pseudonymousSessionId?.startsWith("demo-lead-") === true,
  );
  const leadGroups = groupAnalyticsEvents(
    leadEvents,
    (event) => event.pseudonymousSessionId,
  );
  const expectedLeads = new Map(
    observed.salesLeads.map((lead) => [
      analyticsVerifierPseudonym("lead", lead.id),
      lead.companyId,
    ]),
  );
  check(
    context,
    "Analytics Lead cohorts and suppression population",
    summarizeOrderedAnalyticsFunnel(leadGroups, expectedLeads, [
      "LEAD_SUBMITTED",
      "LEAD_QUALIFIED",
      "LEAD_WON",
    ]),
    {
      cohortCount: 4,
      populationSuppressed: true,
      stageCounts: [4, 3, 2],
      valid: true,
    },
  );

  const checkoutEvents = observed.analyticsEvents.filter(
    (event) => event.pseudonymousSessionId?.startsWith("demo-order-") === true,
  );
  const checkoutGroups = groupAnalyticsEvents(
    checkoutEvents,
    (event) => event.pseudonymousSessionId,
  );
  const expectedOrders = new Map(
    observed.orders.map((order) => [
      analyticsVerifierPseudonym("order", order.id),
      order.companyId,
    ]),
  );
  check(
    context,
    "Analytics Checkout cohorts and suppression population",
    summarizeOrderedAnalyticsFunnel(checkoutGroups, expectedOrders, [
      "PRICING_VIEWED",
      "CHECKOUT_STARTED",
      "CHECKOUT_COMPLETED",
    ]),
    {
      cohortCount: 12,
      populationSuppressed: true,
      stageCounts: [12, 12, 7],
      valid: true,
    },
  );

  const suppressionEvents = observed.analyticsEvents.filter(
    (event) =>
      event.pseudonymousSessionId?.startsWith("demo-suppression-search-") ===
      true,
  );
  const suppressionGroups = groupAnalyticsEvents(
    suppressionEvents,
    (event) => event.pseudonymousSessionId,
  );
  check(
    context,
    "Analytics explicit Search suppression negative population",
    {
      cohorts: suppressionGroups.size,
      onlyResultStage: suppressionEvents.every(
        (event) => event.kind === "SEARCH_RESULTS_VIEWED",
      ),
      populationSuppressed:
        suppressionGroups.size <
        ANALYTICS_SUPPRESSION_V1.minimumDistinctDenominatorSubjects,
      uniqueSingleStageKeys: [...suppressionGroups.values()].every(
        (events) => events.length === 1,
      ),
    },
    {
      cohorts: 5,
      onlyResultStage: true,
      populationSuppressed: true,
      uniqueSingleStageKeys: true,
    },
  );
}

function groupAnalyticsEvents<T>(
  events: readonly T[],
  select: (event: T) => string | null,
): ReadonlyMap<string, readonly T[]> {
  const groups = new Map<string, T[]>();
  for (const event of events) {
    const key = select(event);
    if (key === null) continue;
    const values = groups.get(key) ?? [];
    values.push(event);
    groups.set(key, values);
  }
  return groups;
}

function sortAnalyticsEvents<T extends Readonly<{ occurredAt: Date }>>(
  events: readonly T[],
): readonly T[] {
  return [...events].sort(
    (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
  );
}

function summarizeOrderedAnalyticsFunnel<
  T extends Readonly<{
    companyId: string | null;
    kind: string;
    occurredAt: Date;
  }>,
>(
  groups: ReadonlyMap<string, readonly T[]>,
  expectedSubjects: ReadonlyMap<string, string | null>,
  stages: readonly string[],
) {
  const stageCounts = stages.map(
    (stage) =>
      [...groups.values()].filter((events) =>
        events.some((event) => event.kind === stage),
      ).length,
  );
  let valid = groups.size === expectedSubjects.size;
  for (const [key, events] of groups) {
    const ordered = sortAnalyticsEvents(events);
    const expectedCompanyId = expectedSubjects.get(key);
    valid &&=
      expectedCompanyId !== undefined &&
      events.every((event) => event.companyId === expectedCompanyId);
    let previous = Number.NEGATIVE_INFINITY;
    for (const stage of stages) {
      const event = ordered.find((candidate) => candidate.kind === stage);
      if (event === undefined) continue;
      valid &&= event.occurredAt.getTime() >= previous;
      previous = event.occurredAt.getTime();
    }
  }
  return {
    cohortCount: groups.size,
    populationSuppressed:
      groups.size < ANALYTICS_SUPPRESSION_V1.minimumDistinctDenominatorSubjects,
    stageCounts,
    valid,
  };
}

function analyticsVerifierPseudonym(scope: string, sourceId: string): string {
  return `demo-${scope}-${sha256Utf8(`phase-05:${scope}:${sourceId}`).slice(0, 24)}`;
}

function buildFairJobFactorBreakdownForVerification(
  result: ReturnType<typeof calculateFairJobScoreFromSnapshotV2>,
): FairJobFactorBreakdownV2 {
  return Object.fromEntries(
    FAIR_JOB_FACTOR_ORDER_V2.map((factor) => {
      const state = result.evidence[factor];
      const pointsAwarded =
        state === "MET"
          ? FAIR_JOB_FACTOR_POINTS_V2[factor]
          : factor === "TASKS_REQUIREMENTS" && state === "PARTIAL"
            ? 8
            : 0;
      return [
        factor,
        {
          maxPoints: FAIR_JOB_FACTOR_POINTS_V2[factor],
          pointsAwarded,
          reasonCode: `${factor}_${state}`,
          state,
        },
      ];
    }),
  ) as FairJobFactorBreakdownV2;
}

function buildObservedDigest(
  observed: Awaited<ReturnType<typeof loadObservedSeedState>>,
): string {
  const projection: CanonicalJsonValue = {
    analytics: observed.analyticsEvents.map((event) => ({
      id: event.id,
      kind: event.kind,
      schemaVersion: event.schemaVersion,
    })),
    applications: observed.applications.map((application) => ({
      candidateProfileId: application.candidateProfileId,
      id: application.id,
      jobId: application.jobId,
      status: application.status,
      submissionDocuments: application.submissionDocuments.map((link) => ({
        applicationId: link.applicationId,
        candidateProfileId: link.documentMetadata.candidateProfileId,
        createdAt: link.createdAt.toISOString(),
        documentMetadataId: link.documentMetadataId,
        documentPurpose: link.documentMetadata.purpose,
        documentStatus: link.documentMetadata.status,
        id: link.id,
        removedAt: link.documentMetadata.removedAt?.toISOString() ?? null,
      })),
      submittedAt: application.submittedAt.toISOString(),
      submittedJobRevisionId: application.submittedJobRevisionId,
      updatedAt: application.updatedAt.toISOString(),
    })),
    billing: {
      boosts: observed.boosts.map((boost) => ({
        id: boost.id,
        status: boost.status,
      })),
      invoices: observed.invoices.map((invoice) => ({
        id: invoice.id,
        status: invoice.status,
        totalRappen: invoice.totalRappen,
      })),
      orders: observed.orders.map((order) => ({
        id: order.id,
        status: order.status,
        totalRappen: order.totalRappen,
      })),
      subscriptions: observed.subscriptions.map((subscription) => ({
        companyId: subscription.companyId,
        id: subscription.id,
        planVersionId: subscription.planVersionId,
        status: subscription.status,
      })),
    },
    candidates: observed.candidates.map((candidate) => ({
      id: candidate.id,
      languages: candidate.languages.map((language) => language.code).sort(),
      onboardingStatus: candidate.onboardingStatus,
      radarPublished:
        candidate.radarProfile !== null &&
        candidate.radarProfile.publishedAt !== null,
      skillIds: candidate.skills.map((skill) => skill.skillId).sort(),
    })),
    conversations: observed.conversations.map((conversation) => ({
      applicationId: conversation.applicationId,
      companyId: conversation.companyId,
      contactRequestId: conversation.contactRequestId,
      createdAt: conversation.createdAt.toISOString(),
      id: conversation.id,
      kind: conversation.kind,
      messages: conversation.messages.map((message) => ({
        bodyHash: sha256Utf8(message.body),
        conversationId: message.conversationId,
        createdAt: message.createdAt.toISOString(),
        editedAt: message.editedAt?.toISOString() ?? null,
        id: message.id,
        senderUserId: message.senderUserId,
      })),
      participants: conversation.participants.map((participant) => ({
        companyId: participant.companyId,
        conversationId: participant.conversationId,
        id: participant.id,
        joinedAt: participant.joinedAt.toISOString(),
        kind: participant.kind,
        lastReadAt: participant.lastReadAt?.toISOString() ?? null,
        leftAt: participant.leftAt?.toISOString() ?? null,
        userId: participant.userId,
      })),
      subjectHash: sha256Utf8(conversation.subject),
      updatedAt: conversation.updatedAt.toISOString(),
    })),
    content: observed.contentPages.map((page) => ({
      contentHash: page.currentPublishedRevision?.contentHash ?? null,
      id: page.id,
      revisionId: page.currentPublishedRevisionId,
    })),
    jobs: observed.jobs.map((job) => ({
      contentChecksum: job.currentRevision?.contentChecksum ?? null,
      id: job.id,
      scoreSnapshots:
        job.currentRevision?.scoreSnapshots.map((snapshot) => ({
          evidenceHash: snapshot.evidenceHash,
          id: snapshot.id,
          maxPoints: snapshot.maxPoints,
          scorePoints: snapshot.scorePoints,
          scoreVersion: snapshot.scoreVersion,
        })) ?? [],
      status: job.status,
    })),
    operations: {
      abuseReports: observed.abuseReports.map((report) => ({
        assigneeUserId: report.assigneeUserId,
        createdAt: report.createdAt.toISOString(),
        descriptionHash: sha256Utf8(report.description),
        dueAt: report.dueAt.toISOString(),
        events: report.events.map((event) => ({
          abuseReportId: event.abuseReportId,
          actorUserId: event.actorUserId,
          correlationId: event.correlationId,
          createdAt: event.createdAt.toISOString(),
          id: event.id,
          kind: event.kind,
          reasonCode: event.reasonCode,
          safeNoteHash:
            event.safeNote === null ? null : sha256Utf8(event.safeNote),
        })),
        id: report.id,
        reasonCode: report.reasonCode,
        reporterUserId: report.reporterUserId,
        resolutionCode: report.resolutionCode,
        resolvedAt: report.resolvedAt?.toISOString() ?? null,
        severity: report.severity,
        status: report.status,
        targetId: report.targetId,
        targetType: report.targetType,
        updatedAt: report.updatedAt.toISOString(),
      })),
      auditLogs: observed.auditLogs.map((log) => ({
        action: log.action,
        actorKind: log.actorKind,
        actorUserId: log.actorUserId,
        capability: log.capability,
        companyId: log.companyId,
        correlationId: log.correlationId,
        createdAt: log.createdAt.toISOString(),
        id: log.id,
        metadataHash:
          log.metadata === null
            ? null
            : sha256CanonicalJson(log.metadata as CanonicalJsonValue),
        reasonCode: log.reasonCode,
        result: log.result,
        retainUntil: log.retainUntil.toISOString(),
        targetId: log.targetId,
        targetType: log.targetType,
      })),
      salesLeads: observed.salesLeads.map((lead) => ({
        companyId: lead.companyId,
        consentSource: lead.consentSource,
        createdAt: lead.createdAt.toISOString(),
        emailHash: sha256Utf8(lead.emailNormalized),
        id: lead.id,
        needSummaryHash:
          lead.needSummary === null ? null : sha256Utf8(lead.needSummary),
        nextAt: lead.nextAt?.toISOString() ?? null,
        organizationHash:
          lead.organizationNormalized === null
            ? null
            : sha256Utf8(lead.organizationNormalized),
        ownerUserId: lead.ownerUserId,
        purpose: lead.purpose,
        retainUntil: lead.retainUntil.toISOString(),
        status: lead.status,
        updatedAt: lead.updatedAt.toISOString(),
      })),
    },
    radar: {
      mappings: observed.radarMappings.map((mapping) => ({
        candidateProfileId: mapping.candidateProfileId,
        companyId: mapping.companyId,
        encryptionKeyVersion: mapping.encryptionKeyVersion,
        epoch: mapping.epoch.toISOString(),
        id: mapping.id,
        lookupKeyVersion: mapping.lookupKeyVersion,
        revocationReason: mapping.revocationReason,
        revokedAt: mapping.revokedAt?.toISOString() ?? null,
        validFrom: mapping.validFrom.toISOString(),
        validTo: mapping.validTo.toISOString(),
      })),
      searchBudgets: observed.radarSearchBudgets.map((budget) => ({
        calendarDate: budget.calendarDate.toISOString(),
        companyId: budget.companyId,
        filterHash: budget.filterHash,
        firstUsedAt: budget.firstUsedAt.toISOString(),
        id: budget.id,
        lastUsedAt: budget.lastUsedAt.toISOString(),
      })),
      searchSessions: observed.radarSearchSessions.map((session) => ({
        calendarDate: session.calendarDate.toISOString(),
        candidates: session.candidates.map((candidate) => ({
          candidateProfileId: candidate.candidateProfileId,
          id: candidate.id,
          position: candidate.position,
          radarSearchSessionId: candidate.radarSearchSessionId,
        })),
        companyId: session.companyId,
        createdAt: session.createdAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        filterHash: session.filterHash,
        id: session.id,
        membershipId: session.membershipId,
        normalizedFiltersHash: sha256CanonicalJson(
          session.normalizedFilters as CanonicalJsonValue,
        ),
        policyVersion: session.policyVersion,
        requestingUserId: session.requestingUserId,
        resultCount: session.resultCount,
      })),
    },
    references: {
      cantons: observed.cantons.map((canton) => canton.id),
      categories: observed.categories.map((category) => category.id),
      cities: observed.cities.map((city) => city.id),
      occupationCodes:
        observed.occupationVersion?.codes.map((code) => code.id) ?? [],
      skills: observed.skills.map((skill) => skill.id),
    },
    revealGrants: observed.revealGrants.map((grant) => ({
      candidateProfileId: grant.candidateProfileId,
      companyId: grant.companyId,
      confirmationSnapshotHash: grant.confirmationSnapshotHash,
      confirmations: grant.confirmations.map((confirmation) => ({
        actorUserId: confirmation.actorUserId,
        completeFieldSet: sortedStrings(confirmation.completeFieldSet),
        contactRequestId: confirmation.contactRequestId,
        conversationId: confirmation.conversationId,
        createdAt: confirmation.createdAt.toISOString(),
        grantId: confirmation.grantId,
        id: confirmation.id,
        idempotencyKeyHash: sha256Utf8(confirmation.idempotencyKey),
        newlyAddedFields: sortedStrings(confirmation.newlyAddedFields),
        noticeVersion: confirmation.noticeVersion,
      })),
      contactRequestId: grant.contactRequestId,
      conversationId: grant.conversationId,
      fields: grant.fields.map((field) => ({
        createdAt: field.createdAt.toISOString(),
        encryptionKeyVersion: field.encryptionKeyVersion,
        field: field.field,
        grantId: field.grantId,
        id: field.id,
        schemaVersion: field.schemaVersion,
      })),
      id: grant.id,
      noticeVersion: grant.noticeVersion,
      revealAt: grant.revealedAt.toISOString(),
      revokeReason: grant.revokeReason,
      revokedAt: grant.revokedAt?.toISOString() ?? null,
      revokedByUserId: grant.revokedByUserId,
    })),
    creditLedger: observed.creditAccounts.map((account) => ({
      companyId: account.companyId,
      createdAt: account.createdAt.toISOString(),
      creditType: account.creditType,
      entries: account.entries.map((entry) => ({
        accountId: entry.accountId,
        actorUserId: entry.actorUserId,
        amount: entry.amount,
        createdAt: entry.createdAt.toISOString(),
        fundingSource: entry.fundingSource,
        id: entry.id,
        idempotencyKeyHash: sha256Utf8(entry.idempotencyKey),
        kind: entry.kind,
        reasonCode: entry.reasonCode,
        reversalOfEntryId: entry.reversalOfEntryId,
        sourceOrderLineId: entry.sourceOrderLineId,
        sourcePlanVersionId: entry.sourcePlanVersionId,
        validFrom: entry.validFrom.toISOString(),
        validTo: entry.validTo.toISOString(),
      })),
      fundingSource: account.fundingSource,
      id: account.id,
      periodEnd: account.periodEnd.toISOString(),
      periodStart: account.periodStart.toISOString(),
    })),
  };
  return sha256CanonicalJson(projection);
}

function isPubliclyEligible(
  job: PublicEligibilityJob,
  restrictions: readonly EffectiveRestriction[],
  now: Date,
  environment: "non-production" | "production",
): boolean {
  const revision = job.publishedRevision;
  if (revision === null) return false;
  const hasCurrentVerifiedCycle =
    job.company.verificationRequests.filter(
      (request) =>
        request.status === "VERIFIED" && request.supersededBy === null,
    ).length === 1;
  const hidden = restrictions.some(
    (restriction) =>
      (restriction.targetType === "HIDE_JOB" &&
        restriction.targetId === job.id) ||
      (restriction.targetType === "PAUSE_COMPANY" &&
        restriction.targetId === job.companyId),
  );
  return (
    job.status === "PUBLISHED" &&
    job.publishedRevisionId === revision.id &&
    revision.approvedAt !== null &&
    revision.rejectedAt === null &&
    job.publishedAt !== null &&
    job.expiresAt !== null &&
    revision.validThrough !== null &&
    job.publishedAt.getTime() <= now.getTime() &&
    now.getTime() < job.expiresAt.getTime() &&
    job.expiresAt.getTime() === revision.validThrough.getTime() &&
    job.company.status === "ACTIVE" &&
    hasCurrentVerifiedCycle &&
    !hidden &&
    (environment === "non-production" ||
      (job.dataProvenance === "LIVE" && job.company.dataProvenance === "LIVE"))
  );
}

function verifySuppliedExpectations(
  supplied: DemoSeedVerificationExpectations,
  expected: ReturnType<typeof buildExpectedScope>,
): void {
  if (supplied.companyHandles !== undefined) {
    assertHandleSetsEqual(
      "supplied Company handles",
      supplied.companyHandles,
      expected.companies,
    );
  }
  if (supplied.jobHandles !== undefined) {
    assertHandleSetsEqual(
      "supplied Job handles",
      supplied.jobHandles,
      expected.jobs,
    );
  }
  if (supplied.candidateHandles !== undefined) {
    assertHandleSetsEqual(
      "supplied Candidate handles",
      supplied.candidateHandles,
      expected.candidates,
    );
  }
  if (supplied.contentPageHandles !== undefined) {
    assertHandleSetsEqual(
      "supplied ContentPage handles",
      supplied.contentPageHandles,
      expected.contentPages,
    );
  }
  if (supplied.expectedIdentityIds !== undefined) {
    const suppliedIds = new Set(supplied.expectedIdentityIds);
    const missing = [...expected.canonicalIdentityIds]
      .filter((id) => !suppliedIds.has(id))
      .sort();
    if (missing.length > 0) {
      throw new DemoSeedVerificationError(
        "supplied identity catalogue coverage",
        missing,
        [],
      );
    }
  }
}

function assertHandleSetsEqual(
  name: string,
  actual: readonly DemoSeedEntityHandle[],
  expected: readonly DemoSeedEntityHandle[],
): void {
  const actualKeys = normalizeHandles(actual);
  const expectedKeys = normalizeHandles(expected);
  if (!sameCanonicalValue(actualKeys, expectedKeys)) {
    throw new DemoSeedVerificationError(name, actualKeys, expectedKeys);
  }
}

function checkHandleSet(
  context: VerificationContext,
  name: string,
  actual: readonly DemoSeedEntityHandle[],
  expected: readonly DemoSeedEntityHandle[],
): void {
  check(context, name, normalizeHandles(actual), normalizeHandles(expected));
}

function normalizeHandles(
  handles: readonly DemoSeedEntityHandle[],
): readonly string[] {
  return handles.map((handle) => `${handle.key}\u0000${handle.id}`).sort();
}

function check(
  context: VerificationContext,
  name: string,
  actual: CanonicalJsonValue,
  expected: CanonicalJsonValue,
): void {
  if (!sameCanonicalValue(actual, expected)) {
    throw new DemoSeedVerificationError(name, actual, expected);
  }
  context.checks.push(Object.freeze({ actual, expected, name }));
}

function sameCanonicalValue(
  actual: CanonicalJsonValue,
  expected: CanonicalJsonValue,
): boolean {
  return sha256CanonicalJson(actual) === sha256CanonicalJson(expected);
}

function countBy<T>(
  values: readonly T[],
  select: (value: T) => string,
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = select(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function sortedNumberRecord(
  value: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function sortedStrings(values: readonly string[]): readonly string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function compareKey<Key extends string>(
  key: Key,
): <T extends Readonly<Record<Key, string>>>(left: T, right: T) => number {
  return (left, right) => left[key].localeCompare(right[key]);
}

function identityIdsByEntity(
  identities: readonly Readonly<{ entity: string; id: string }>[],
  entity: string,
): string[] {
  return identities
    .filter((identity) => identity.entity === entity)
    .map((identity) => identity.id);
}

function fixtureIds(entity: string, naturalKeys: readonly string[]): string[] {
  return naturalKeys.map((naturalKey) => stableSeedId(entity, naturalKey));
}

function CANTON_FIXTURES_FOR_IDS(): string[] {
  return CANTON_FIXTURES.map((canton) => canton.code);
}

function CITY_FIXTURES_FOR_IDS(): string[] {
  return CITY_FIXTURES.map((city) =>
    stableSeedId("city", `${city.cantonCode}:${city.slug}`),
  );
}

function CATEGORY_FIXTURES_FOR_IDS(): string[] {
  return CATEGORY_FIXTURES.map((category) =>
    stableSeedId("category", category.slug),
  );
}

function SKILL_FIXTURES_FOR_IDS(): string[] {
  return SKILL_FIXTURES.map((skill) => stableSeedId("skill", skill.slug));
}

function requireIndex<T>(
  values: readonly T[],
  index: number,
  label: string,
): T {
  const value = values[index];
  if (value === undefined) throw new Error(`Missing ${label} fixture.`);
  return value;
}

function requireValue<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new DemoSeedVerificationError(`${label} present`, false, true);
  }
  return value;
}

function assertValidAnchor(anchorAt: Date): void {
  if (!(anchorAt instanceof Date) || !Number.isFinite(anchorAt.getTime())) {
    throw new TypeError(
      "Demo seed verification requires a valid anchorAt Date.",
    );
  }
}
