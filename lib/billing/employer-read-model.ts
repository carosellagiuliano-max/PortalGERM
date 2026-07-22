import "server-only";

import { z } from "zod";

import {
  addZurichCalendarMonthsClampedV1,
  computeProratedPlanDeltaV1,
  selectDefaultRetainedSeatsV1,
} from "@/lib/billing/billing-policy-v1";
import { isContactPackPlanEligibleV1 } from "@/lib/billing/checkout-eligibility";
import { decodePlanEntitlementsV1 } from "@/lib/billing/entitlements";
import { getPrismaEffectiveEntitlements } from "@/lib/billing/prisma-publish-quota";
import { summarizeIncludedCreditUsage } from "@/lib/billing/usage";
import { computeVat } from "@/lib/billing/vat";
import { BOOST_POLICY_V1 } from "@/lib/billing/boosts";
import { getServerEnvironment } from "@/lib/config/env";
import type { DatabaseClient } from "@/lib/db/factory";
import { isJobPubliclyEligible } from "@/lib/jobs/public-eligibility";
import type { InvoiceStatus } from "@/lib/policies/status/invoice";

const EXPIRING_SOON_MS = 30 * 86_400_000;

export type InvoiceDisplayStatus = InvoiceStatus | "OVERDUE";

export function deriveInvoiceDisplayStatus(
  status: InvoiceStatus,
  dueAt: Date,
  now: Date,
): InvoiceDisplayStatus {
  return status === "ISSUED" && dueAt.getTime() <= now.getTime()
    ? "OVERDUE"
    : status;
}

export type BillingProfileReadModel = Readonly<{
  legalName: string;
  billingContactEmail: string;
  street: string;
  postalCode: string;
  city: string;
  countryCode: "CH";
  uid: string | null;
  vatNumber: string | null;
  version: number;
}>;

export type EmployerBillingOverview = Readonly<{
  plan: Readonly<{
    code: string;
    name: string;
    monthlyNetRappen: number;
    periodEnd: Date | null;
    status: "FREE" | "ACTIVE" | "CANCELLING";
    cancellationEffectiveAt: Date | null;
    pendingChange: Readonly<{
      kind: "DOWNGRADE" | "CANCEL";
      effectiveAt: Date;
      targetPlanName: string | null;
    }> | null;
  }>;
  usage: EmployerBillingUsage;
  openInvoiceCount: number;
  openInvoiceTotalRappen: number;
  recentOrders: readonly Readonly<{
    id: string;
    status: string;
    label: string;
    totalRappen: number;
    createdAt: Date;
  }>[];
  cancellationRetentionOptions: readonly Readonly<{
    membershipId: string;
    label: string;
    role: "OWNER" | "ADMIN" | "RECRUITER" | "VIEWER";
    selectedByDefault: boolean;
  }>[];
  profileComplete: boolean;
}>;

export type EmployerBillingUsage = Readonly<{
  talentRadarAccess: boolean;
  activeJobs: Readonly<{ used: number; limit: number }>;
  seats: Readonly<{ used: number; limit: number; pendingInvitations: number }>;
  includedContacts: Readonly<{ used: number; remaining: number; granted: number }>;
  includedBoosts: Readonly<{ used: number; remaining: number; granted: number }>;
  purchasedAndGranted: readonly Readonly<{
    id: string;
    creditType: string;
    fundingSource: "PURCHASED_PACK" | "ADMIN_GRANT";
    remaining: number;
    validTo: Date;
    expiringSoon: boolean;
  }>[];
  totalFundable: Readonly<{ talentContacts: number; jobBoosts: number }>;
  ledgerHistory: readonly Readonly<{
    id: string;
    creditType: string;
    fundingSource: string;
    kind: string;
    amount: number;
    validTo: Date;
    createdAt: Date;
    reasonCode: string | null;
  }>[];
}>;

export type CheckoutPreview = Readonly<{
  kind: "PLAN" | "PRODUCT";
  slug:
    | "starter"
    | "pro"
    | "contact-pack-10"
    | "contact-pack-50"
    | "additional-job-30d"
    | "boost-7d"
    | "boost-30d"
    | "import-setup";
  quantity: number;
  name: string;
  description: string;
  transitionLabel: string | null;
  unitNetRappen: number;
  netRappen: number;
  taxRateBasisPoints: number;
  vatRappen: number;
  totalRappen: number;
  profile: BillingProfileReadModel | null;
  planLimits: Readonly<{
    activeJobs: number;
    seats: number;
    talentContacts: number;
    jobBoosts: number;
  }> | null;
  retentionOptions: readonly Readonly<{
    membershipId: string;
    label: string;
    role: "OWNER" | "ADMIN" | "RECRUITER" | "VIEWER";
    selectedByDefault: boolean;
  }>[];
  targetJobId: string | null;
  importSetupApprovalId: string | null;
}>;

export type CheckoutPreviewResult =
  | Readonly<{ ok: true; value: CheckoutPreview }>
  | Readonly<{
      ok: false;
      code:
        | "INVALID_SELECTION"
        | "CATALOG_UNAVAILABLE"
        | "TAX_UNAVAILABLE"
        | "SAME_PLAN"
        | "PLAN_NOT_SELF_SERVICE"
        | "TALENT_RADAR_REQUIRED"
        | "PRODUCT_RELEASE_REQUIRED"
        | "PRODUCT_CONTEXT_INVALID";
    }>;

export async function getEmployerBillingOverview(
  database: DatabaseClient,
  companyId: string,
  now: Date,
): Promise<EmployerBillingOverview | null> {
  const [usage, entitlements, subscription, freePlan, invoices, orders, profile, memberships] =
    await Promise.all([
      getEmployerBillingUsage(database, companyId, now),
      getPrismaEffectiveEntitlements(companyId, now, database),
      loadEffectiveSubscription(database, companyId, now),
      database.planVersion.findFirst({
        where: {
          status: "ACTIVE",
          validFrom: { lte: now },
          OR: [{ validTo: null }, { validTo: { gt: now } }],
          plan: { isDefaultFree: true },
        },
        select: {
          id: true,
          netPriceRappen: true,
          plan: { select: { code: true, name: true } },
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
      database.invoice.findMany({
        where: { companyId, status: { in: ["DRAFT", "ISSUED"] } },
        select: { totalRappen: true },
      }),
      database.order.findMany({
        where: { companyId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 10,
        select: {
          id: true,
          status: true,
          totalRappen: true,
          createdAt: true,
          lines: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: { descriptionSnapshot: true },
          },
        },
      }),
      getCompanyBillingProfile(database, companyId),
      database.companyMembership.findMany({
        where: { companyId, status: "ACTIVE", removedAt: null },
        orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          userId: true,
          role: true,
          status: true,
          joinedAt: true,
          user: { select: { name: true, email: true } },
        },
      }),
    ]);
  if (usage === null || !entitlements.ok || freePlan === null) return null;
  const freeEntitlements = decodePlanEntitlementsV1(freePlan.entitlements);
  if (!freeEntitlements.ok) return null;
  const retainedDefaults = selectDefaultRetainedSeatsV1({
    seatLimit: freeEntitlements.value.SEAT_LIMIT,
    memberships: memberships.map((membership) => ({
      id: membership.id,
      userId: membership.userId,
      role: membership.role,
      status: membership.status,
      joinedAt: membership.joinedAt,
    })),
  });
  if (!retainedDefaults.ok) return null;
  const retainedDefaultIds = new Set(
    retainedDefaults.value.retainedMembershipIds,
  );

  const plan = subscription === null
    ? {
        code: freePlan.plan.code,
        name: freePlan.plan.name,
        monthlyNetRappen: freePlan.netPriceRappen ?? 0,
        periodEnd: null,
        status: "FREE" as const,
        cancellationEffectiveAt: null,
        pendingChange: null,
      }
    : {
        code: subscription.planVersion.plan.code,
        name: subscription.planVersion.plan.name,
        monthlyNetRappen: subscription.monthlyEquivalentRappenSnapshot,
        periodEnd: subscription.currentPeriodEnd,
        status:
          subscription.status === "CANCELLING"
            ? ("CANCELLING" as const)
            : ("ACTIVE" as const),
        cancellationEffectiveAt:
          subscription.currentChangeSchedules[0]?.kind === "CANCEL"
            ? subscription.currentChangeSchedules[0].effectiveAt
            : null,
        pendingChange:
          subscription.currentChangeSchedules[0] === undefined
            ? null
            : Object.freeze({
                kind: subscription.currentChangeSchedules[0].kind,
                effectiveAt: subscription.currentChangeSchedules[0].effectiveAt,
                targetPlanName:
                  subscription.currentChangeSchedules[0].successorSubscription
                    ?.planVersion.plan.name ?? null,
              }),
      };

  return Object.freeze({
    plan: Object.freeze(plan),
    usage,
    openInvoiceCount: invoices.length,
    openInvoiceTotalRappen: invoices.reduce(
      (total, invoice) => total + invoice.totalRappen,
      0,
    ),
    recentOrders: orders.map((order) =>
      Object.freeze({
        id: order.id,
        status: order.status,
        label:
          order.lines.map((line) => line.descriptionSnapshot).join(", ") ||
          "Bestellung",
        totalRappen: order.totalRappen,
        createdAt: order.createdAt,
      }),
    ),
    cancellationRetentionOptions: memberships.map((membership) =>
      Object.freeze({
        membershipId: membership.id,
        label: membership.user.name ?? membership.user.email,
        role: membership.role,
        selectedByDefault: retainedDefaultIds.has(membership.id),
      }),
    ),
    profileComplete: profile !== null,
  });
}

export async function getEmployerBillingUsage(
  database: DatabaseClient,
  companyId: string,
  now: Date,
): Promise<EmployerBillingUsage | null> {
  const [entitlements, activeJobs, activeMembers, pendingInvitations, accounts, history] =
    await Promise.all([
      getPrismaEffectiveEntitlements(companyId, now, database),
      database.job.count({
        where: {
          companyId,
          status: "PUBLISHED",
          publishedAt: { lte: now },
          expiresAt: { gt: now },
        },
      }),
      database.companyMembership.count({
        where: { companyId, status: "ACTIVE", removedAt: null },
      }),
      database.companyInvitation.count({
        where: {
          companyId,
          status: "PENDING",
          revokedAt: null,
          expiresAt: { gt: now },
        },
      }),
      database.creditAccount.findMany({
        where: { companyId, periodStart: { lte: now }, periodEnd: { gt: now } },
        orderBy: [{ periodEnd: "asc" }, { id: "asc" }],
        select: {
          id: true,
          creditType: true,
          fundingSource: true,
          periodEnd: true,
          entries: {
            where: { validFrom: { lte: now }, validTo: { gt: now } },
            select: { kind: true, amount: true },
          },
        },
      }),
      database.creditLedgerEntry.findMany({
        where: { account: { companyId } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 20,
        select: {
          id: true,
          fundingSource: true,
          kind: true,
          amount: true,
          validTo: true,
          createdAt: true,
          reasonCode: true,
          account: { select: { creditType: true } },
        },
      }),
    ]);
  if (!entitlements.ok) return null;

  const planAccounts = accounts.filter(
    (account) => account.fundingSource === "PLAN_ALLOWANCE",
  );
  const summarizeIncluded = (creditType: "TALENT_CONTACT" | "JOB_BOOST") => {
    const entries = planAccounts
      .filter((account) => account.creditType === creditType)
      .flatMap((account) => account.entries);
    return summarizeIncludedCreditUsage(entries);
  };

  const purchasedAndGranted = accounts
    .filter(
      (account): account is typeof account & {
        fundingSource: "PURCHASED_PACK" | "ADMIN_GRANT";
      } =>
        account.fundingSource === "PURCHASED_PACK" ||
        account.fundingSource === "ADMIN_GRANT",
    )
    .map((account) =>
      Object.freeze({
        id: account.id,
        creditType: account.creditType,
        fundingSource: account.fundingSource,
        remaining: Math.max(
          0,
          account.entries.reduce((total, entry) => total + entry.amount, 0),
        ),
        validTo: account.periodEnd,
        expiringSoon:
          account.periodEnd.getTime() <= now.getTime() + EXPIRING_SOON_MS,
      }),
    )
    .filter((account) => account.remaining > 0);

  const fundable = entitlements.value.fundableBySource;
  const totalByType = (creditType: "TALENT_CONTACT" | "JOB_BOOST") =>
    fundable.PLAN_ALLOWANCE[creditType] +
    fundable.PURCHASED_PACK[creditType] +
    fundable.ADMIN_GRANT[creditType];

  return Object.freeze({
    talentRadarAccess: entitlements.value.rights.TALENT_RADAR_ACCESS,
    activeJobs: Object.freeze({
      used: activeJobs,
      limit: entitlements.value.rights.ACTIVE_JOB_LIMIT,
    }),
    seats: Object.freeze({
      used: activeMembers + pendingInvitations,
      limit: entitlements.value.rights.SEAT_LIMIT,
      pendingInvitations,
    }),
    includedContacts: summarizeIncluded("TALENT_CONTACT"),
    includedBoosts: summarizeIncluded("JOB_BOOST"),
    purchasedAndGranted,
    totalFundable: Object.freeze({
      talentContacts: totalByType("TALENT_CONTACT"),
      jobBoosts: totalByType("JOB_BOOST"),
    }),
    ledgerHistory: history.map((entry) =>
      Object.freeze({
        id: entry.id,
        creditType: entry.account.creditType,
        fundingSource: entry.fundingSource,
        kind: entry.kind,
        amount: entry.amount,
        validTo: entry.validTo,
        createdAt: entry.createdAt,
        reasonCode: entry.reasonCode,
      }),
    ),
  });
}

/**
 * A Company may start a new self-service Plan change only while no current
 * paid term is cancelling and no canonical change schedule is pending. More
 * than one effective paid row fails closed like entitlement resolution.
 */
export async function canStartEmployerPlanChange(
  database: DatabaseClient,
  companyId: string,
  now: Date,
): Promise<boolean> {
  const subscriptions = await database.employerSubscription.findMany({
    where: {
      companyId,
      status: { in: ["ACTIVE", "CANCELLING"] },
      currentPeriodStart: { lte: now },
      currentPeriodEnd: { gt: now },
    },
    take: 2,
    select: {
      status: true,
      currentChangeSchedules: {
        where: { status: "PENDING" },
        take: 1,
        select: { id: true },
      },
    },
  });
  if (subscriptions.length > 1) return false;
  const current = subscriptions[0];
  return current === undefined ||
    (current.status === "ACTIVE" && current.currentChangeSchedules.length === 0);
}

export async function getCompanyBillingProfile(
  database: DatabaseClient,
  companyId: string,
): Promise<BillingProfileReadModel | null> {
  const profile = await database.companyBillingProfile.findUnique({
    where: { companyId },
    select: {
      legalName: true,
      billingContactEmail: true,
      street: true,
      postalCode: true,
      city: true,
      countryCode: true,
      uid: true,
      vatNumber: true,
      version: true,
    },
  });
  if (profile === null || profile.countryCode !== "CH") return null;
  return Object.freeze({ ...profile, countryCode: "CH" });
}

export async function getCheckoutPreview(
  database: DatabaseClient,
  companyId: string,
  input: Readonly<{
    plan?: string;
    product?: string;
    quantity?: number;
    targetJobId?: string;
    importSetupApprovalId?: string;
  }>,
  now: Date,
): Promise<CheckoutPreviewResult> {
  const hasPlan = input.plan !== undefined;
  const hasProduct = input.product !== undefined;
  if (hasPlan === hasProduct) return { ok: false, code: "INVALID_SELECTION" };
  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    return { ok: false, code: "INVALID_SELECTION" };
  }

  const [profile, rates, entitlements, subscription] = await Promise.all([
    getCompanyBillingProfile(database, companyId),
    database.taxRateVersion.findMany({
      where: {
        jurisdiction: "CH",
        taxType: "MWST_STANDARD_DEMO",
        reviewStatus: "APPROVED",
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gt: now } }],
      },
      take: 2,
      select: { rateBasisPoints: true },
    }),
    getPrismaEffectiveEntitlements(companyId, now, database),
    loadEffectiveSubscription(database, companyId, now),
  ]);
  if (rates.length !== 1) return { ok: false, code: "TAX_UNAVAILABLE" };
  if (!entitlements.ok) return { ok: false, code: "CATALOG_UNAVAILABLE" };
  const rate = rates[0]!;

  if (hasPlan) {
    if (input.plan === "business" || input.plan === "enterprise") {
      return { ok: false, code: "PLAN_NOT_SELF_SERVICE" };
    }
    if (input.plan !== "starter" && input.plan !== "pro") {
      return { ok: false, code: "INVALID_SELECTION" };
    }
    const versions = await database.planVersion.findMany({
      where: {
        status: "ACTIVE",
        isPublic: true,
        isSelfService: true,
        billingInterval: "MONTHLY",
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gt: now } }],
        plan: { code: input.plan.toUpperCase() },
      },
      take: 2,
      select: {
        netPriceRappen: true,
        plan: { select: { code: true, name: true } },
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
    });
    const target = versions.length === 1 ? versions[0]! : null;
    if (target?.netPriceRappen === null || target === null) {
      return { ok: false, code: "CATALOG_UNAVAILABLE" };
    }
    const decoded = decodePlanEntitlementsV1(target.entitlements);
    if (!decoded.ok) return { ok: false, code: "CATALOG_UNAVAILABLE" };
    const currentCode = subscription?.planVersion.plan.code ?? "FREE_BASIC";
    if (currentCode === target.plan.code) return { ok: false, code: "SAME_PLAN" };

    let netRappen = target.netPriceRappen;
    let transitionLabel = "Neuer Monatsplan";
    let retentionOptions: CheckoutPreview["retentionOptions"] = [];
    if (currentCode === "STARTER" && target.plan.code === "PRO") {
      const prorated = computeProratedPlanDeltaV1({
        currentPlanNetRappen: subscription!.recurringNetRappenSnapshot,
        targetPlanNetRappen: target.netPriceRappen,
        period: {
          start: subscription!.currentPeriodStart,
          end: subscription!.currentPeriodEnd,
        },
        at: now,
      });
      if (!prorated.ok) return { ok: false, code: "PLAN_NOT_SELF_SERVICE" };
      netRappen = prorated.value.amountRappen;
      transitionLabel = `Sofortiges Upgrade bis ${formatIsoDate(subscription!.currentPeriodEnd)}`;
    } else if (currentCode === "PRO" && target.plan.code === "STARTER") {
      transitionLabel = `Planwechsel per ${formatIsoDate(subscription!.currentPeriodEnd)}`;
      const memberships = await database.companyMembership.findMany({
        where: { companyId, status: "ACTIVE", removedAt: null },
        orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          userId: true,
          role: true,
          status: true,
          joinedAt: true,
          user: { select: { name: true, email: true } },
        },
      });
      const defaults = selectDefaultRetainedSeatsV1({
        seatLimit: decoded.value.SEAT_LIMIT,
        memberships: memberships.map((membership) => ({
          id: membership.id,
          userId: membership.userId,
          role: membership.role,
          status: membership.status,
          joinedAt: membership.joinedAt,
        })),
      });
      if (!defaults.ok) return { ok: false, code: "CATALOG_UNAVAILABLE" };
      const defaultIds = new Set(defaults.value.retainedMembershipIds);
      retentionOptions = memberships.map((membership) =>
        Object.freeze({
          membershipId: membership.id,
          label: membership.user.name ?? membership.user.email,
          role: membership.role,
          selectedByDefault: defaultIds.has(membership.id),
        }),
      );
    } else if (currentCode !== "FREE_BASIC") {
      return { ok: false, code: "PLAN_NOT_SELF_SERVICE" };
    }
    const totals = computeVat(netRappen, rate.rateBasisPoints);
    return {
      ok: true,
      value: Object.freeze({
        kind: "PLAN",
        slug: input.plan,
        quantity: 1,
        name: target.plan.name,
        description: `${target.plan.name} Monatsplan`,
        transitionLabel,
        unitNetRappen: netRappen,
        netRappen: totals.net,
        taxRateBasisPoints: rate.rateBasisPoints,
        vatRappen: totals.vatAmount,
        totalRappen: totals.total,
        profile,
        planLimits: Object.freeze({
          activeJobs: decoded.value.ACTIVE_JOB_LIMIT,
          seats: decoded.value.SEAT_LIMIT,
          talentContacts: decoded.value.TALENT_CONTACT_ALLOWANCE,
          jobBoosts: decoded.value.JOB_BOOST_ALLOWANCE,
        }),
        retentionOptions,
        targetJobId: null,
        importSetupApprovalId: null,
      }),
    };
  }

  if (
    input.product === "boost-7d" ||
    input.product === "boost-30d"
  ) {
    return getBoostCheckoutPreview(
      database,
      companyId,
      input,
      now,
      profile,
      rate.rateBasisPoints,
    );
  }

  if (
    input.product === "additional-job-30d" ||
    input.product === "import-setup"
  ) {
    return getP1ProductCheckoutPreview(
      database,
      companyId,
      input,
      now,
      profile,
      rate.rateBasisPoints,
      subscription,
      entitlements,
    );
  }
  if (input.product !== "contact-pack-10" && input.product !== "contact-pack-50") {
    return { ok: false, code: "INVALID_SELECTION" };
  }
  const currentPlan = subscription === null
    ? null
    : {
        code: subscription.planVersion.plan.code,
        priceMode: subscription.planVersion.priceMode,
        isPublic: subscription.planVersion.isPublic,
        isSelfService: subscription.planVersion.isSelfService,
      };
  if (
    !isContactPackPlanEligibleV1(currentPlan) ||
    !entitlements.value.rights.TALENT_RADAR_ACCESS
  ) {
    return { ok: false, code: "TALENT_RADAR_REQUIRED" };
  }
  const products = await database.productVersion.findMany({
    where: {
      status: "ACTIVE",
      isPublic: true,
      isSelfService: true,
      requiresLegalReview: false,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
      product: { code: input.product, type: "CONTACT_PACK" },
    },
    take: 2,
    select: {
      netPriceRappen: true,
      product: { select: { name: true } },
    },
  });
  const product = products.length === 1 ? products[0]! : null;
  if (product === null) return { ok: false, code: "CATALOG_UNAVAILABLE" };
  const netRappen = product.netPriceRappen * quantity;
  const totals = computeVat(netRappen, rate.rateBasisPoints);
  return {
    ok: true,
    value: Object.freeze({
      kind: "PRODUCT",
      slug: input.product,
      quantity,
      name: product.product.name,
      description: "Zusätzliche Talent-Radar-Kontakte, 12 Monate gültig",
      transitionLabel: null,
      unitNetRappen: product.netPriceRappen,
      netRappen: totals.net,
      taxRateBasisPoints: rate.rateBasisPoints,
      vatRappen: totals.vatAmount,
      totalRappen: totals.total,
      profile,
      planLimits: null,
      retentionOptions: [],
      targetJobId: null,
      importSetupApprovalId: null,
    }),
  };
}

async function getBoostCheckoutPreview(
  database: DatabaseClient,
  companyId: string,
  input: Readonly<{
    product?: string;
    quantity?: number;
    targetJobId?: string;
  }>,
  now: Date,
  profile: BillingProfileReadModel | null,
  taxRateBasisPoints: number,
): Promise<CheckoutPreviewResult> {
  const slug = input.product;
  if (
    (slug !== "boost-7d" && slug !== "boost-30d") ||
    (input.quantity ?? 1) !== 1 ||
    !z.uuid().safeParse(input.targetJobId).success
  ) {
    return { ok: false, code: "PRODUCT_CONTEXT_INVALID" };
  }
  const targetJobId = input.targetJobId!;
  const durationDays = BOOST_POLICY_V1.durations[slug];
  const endsAt = new Date(now.getTime() + durationDays * 86_400_000);
  const appEnvironment = getServerEnvironment().APP_ENV;
  const eligibilityEnvironment =
    appEnvironment === "production" || appEnvironment === "staging"
      ? "production"
      : "non-production";
  const [versions, job, overlap, eligibility] = await Promise.all([
    database.productVersion.findMany({
      where: {
        status: "ACTIVE",
        isPublic: true,
        isSelfService: true,
        requiresLegalReview: false,
        releaseDecisionId: null,
        netPriceRappen: BOOST_POLICY_V1.pricesRappen[slug],
        durationDays,
        creditType: null,
        creditAmount: null,
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gt: now } }],
        product: { code: slug, type: "JOB_BOOST" },
      },
      take: 2,
      select: {
        id: true,
        netPriceRappen: true,
        product: { select: { name: true } },
      },
    }),
    database.job.findFirst({
      where: { id: targetJobId, companyId, expiresAt: { gte: endsAt } },
      select: {
        id: true,
        expiresAt: true,
        publishedRevision: { select: { title: true } },
      },
    }),
    database.jobBoost.findFirst({
      where: {
        jobId: targetJobId,
        status: { not: "CANCELLED" },
        startsAt: { lt: endsAt },
        endsAt: { gt: now },
      },
      select: { id: true },
    }),
    isJobPubliclyEligible(targetJobId, now, eligibilityEnvironment, database),
  ]);
  const version = versions.length === 1 ? versions[0]! : null;
  if (version === null) return { ok: false, code: "CATALOG_UNAVAILABLE" };
  if (job?.publishedRevision === null || job === null || overlap !== null || !eligibility.eligible) {
    return { ok: false, code: "PRODUCT_CONTEXT_INVALID" };
  }
  const totals = computeVat(version.netPriceRappen, taxRateBasisPoints);
  return {
    ok: true,
    value: Object.freeze({
      kind: "PRODUCT",
      slug,
      quantity: 1,
      name: version.product.name,
      description: `${durationDays} Tage Boost nur für «${job.publishedRevision.title}».`,
      transitionLabel: `Start sofort · Ende ${formatIsoDate(endsAt)} · keine automatische Verlängerung`,
      unitNetRappen: version.netPriceRappen,
      netRappen: totals.net,
      taxRateBasisPoints,
      vatRappen: totals.vatAmount,
      totalRappen: totals.total,
      profile,
      planLimits: null,
      retentionOptions: [],
      targetJobId: job.id,
      importSetupApprovalId: null,
    }),
  };
}

async function getP1ProductCheckoutPreview(
  database: DatabaseClient,
  companyId: string,
  input: Readonly<{
    product?: string;
    quantity?: number;
    targetJobId?: string;
    importSetupApprovalId?: string;
  }>,
  now: Date,
  profile: BillingProfileReadModel | null,
  taxRateBasisPoints: number,
  subscription: Awaited<ReturnType<typeof loadEffectiveSubscription>>,
  entitlements: Awaited<ReturnType<typeof getPrismaEffectiveEntitlements>>,
): Promise<CheckoutPreviewResult> {
  if ((input.quantity ?? 1) !== 1) {
    return { ok: false, code: "INVALID_SELECTION" };
  }
  if (input.product === "additional-job-30d") {
    if (!z.uuid().safeParse(input.targetJobId).success) {
      return { ok: false, code: "PRODUCT_CONTEXT_INVALID" };
    }
    if (subscription?.planVersion.plan.code !== "STARTER") {
      return { ok: false, code: "PRODUCT_CONTEXT_INVALID" };
    }
    const validTo = new Date(now.getTime() + 30 * 86_400_000);
    const [versions, job, permit] = await Promise.all([
      database.productVersion.findMany({
        where: {
          status: "ACTIVE",
          isPublic: true,
          isSelfService: true,
          requiresLegalReview: false,
          netPriceRappen: 12_900,
          durationDays: 30,
          creditType: null,
          creditAmount: null,
          validFrom: { lte: now },
          OR: [{ validTo: null }, { validTo: { gt: now } }],
          product: { code: "additional-job-30d", type: "ADDITIONAL_JOB" },
          releaseDecision: {
            is: {
              releaseTier: "P1",
              allowsPublic: true,
              allowsSelfService: true,
            },
          },
        },
        take: 2,
        select: { id: true, netPriceRappen: true, product: { select: { name: true } } },
      }),
      database.job.findFirst({
        where: {
          id: input.targetJobId,
          companyId,
          status: "APPROVED",
          publishedAt: null,
          publishedRevisionId: null,
          currentRevision: {
            is: {
              approvedAt: { not: null },
              rejectedAt: null,
              validThrough: { gt: now, lte: validTo },
            },
          },
        },
        select: { id: true, currentRevision: { select: { title: true } } },
      }),
      database.additionalJobPermit.findFirst({
        where: {
          OR: [{ companyId }, { targetJobId: input.targetJobId }],
          status: { in: ["SCHEDULED", "ACTIVE"] },
          revokedAt: null,
          validFrom: { lt: validTo },
          validTo: { gt: now },
        },
        select: { id: true },
      }),
    ]);
    const version = versions.length === 1 ? versions[0]! : null;
    if (version === null) return { ok: false, code: "PRODUCT_RELEASE_REQUIRED" };
    if (job === null || permit !== null) {
      return { ok: false, code: "PRODUCT_CONTEXT_INVALID" };
    }
    const totals = computeVat(version.netPriceRappen, taxRateBasisPoints);
    return {
      ok: true,
      value: Object.freeze({
        kind: "PRODUCT",
        slug: "additional-job-30d",
        quantity: 1,
        name: version.product.name,
        description: `30-Tage-Permit nur für «${job.currentRevision?.title ?? "ausgewählte Stelle"}»; veröffentlicht die Stelle nicht automatisch.`,
        transitionLabel: "Zielgebundene Zusatzstelle · kein globales Plan-Limit",
        unitNetRappen: version.netPriceRappen,
        netRappen: totals.net,
        taxRateBasisPoints,
        vatRappen: totals.vatAmount,
        totalRappen: totals.total,
        profile,
        planLimits: null,
        retentionOptions: [],
        targetJobId: job.id,
        importSetupApprovalId: null,
      }),
    };
  }

  if (input.product !== "import-setup") {
    return { ok: false, code: "INVALID_SELECTION" };
  }
  if (!z.uuid().safeParse(input.importSetupApprovalId).success) {
    return { ok: false, code: "PRODUCT_CONTEXT_INVALID" };
  }
  const planCode = subscription?.planVersion.plan.code;
  if (
    !entitlements.ok ||
    !entitlements.value.planRights.EMPLOYER_IMPORT_ACCESS ||
    (planCode !== "BUSINESS" && planCode !== "ENTERPRISE_CONTRACT") ||
    (planCode === "ENTERPRISE_CONTRACT" &&
      (subscription?.planVersion.priceMode !== "CONTRACT" ||
        subscription.planVersion.isPublic !== false ||
        subscription.planVersion.isSelfService))
  ) {
    return { ok: false, code: "PRODUCT_CONTEXT_INVALID" };
  }
  const [versions, approval] = await Promise.all([
    database.productVersion.findMany({
      where: {
        status: "ACTIVE",
        isPublic: false,
        isSelfService: false,
        requiresLegalReview: false,
        netPriceRappen: 75_000,
        durationDays: null,
        creditType: null,
        creditAmount: null,
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gt: now } }],
        product: { code: "import-setup", type: "IMPORT_SETUP" },
        releaseDecision: {
          is: {
            releaseTier: "P1",
            allowsPublic: false,
            allowsSelfService: false,
          },
        },
      },
      take: 2,
      select: { id: true, netPriceRappen: true, product: { select: { name: true } } },
    }),
    database.importSetupApproval.findFirst({
      where: {
        id: input.importSetupApprovalId,
        companyId,
        status: "APPROVED",
        validUntil: { gt: now },
        orderLineId: null,
        importSource: { isActive: true },
      },
      select: {
        id: true,
        importSourceId: true,
        importSource: { select: { name: true } },
      },
    }),
  ]);
  const version = versions.length === 1 ? versions[0]! : null;
  if (version === null) return { ok: false, code: "PRODUCT_RELEASE_REQUIRED" };
  if (approval === null) return { ok: false, code: "PRODUCT_CONTEXT_INVALID" };
  const validTo = addZurichCalendarMonthsClampedV1(now, 12);
  if (!validTo.ok) return { ok: false, code: "PRODUCT_CONTEXT_INVALID" };
  const overlap = await database.importAccessGrant.findFirst({
    where: {
      companyId,
      importSourceId: approval.importSourceId,
      status: { in: ["SCHEDULED", "ACTIVE"] },
      revokedAt: null,
      validFrom: { lt: validTo.value },
      validTo: { gt: now },
    },
    select: { id: true },
  });
  if (overlap !== null) return { ok: false, code: "PRODUCT_CONTEXT_INVALID" };
  const totals = computeVat(version.netPriceRappen, taxRateBasisPoints);
  return {
    ok: true,
    value: Object.freeze({
      kind: "PRODUCT",
      slug: "import-setup",
      quantity: 1,
      name: version.product.name,
      description: `12 Zürich-Kalendermonate Zugriff nur für die geprüfte Quelle «${approval.importSource.name}»; kein Parserlauf und keine Stellenanlage.`,
      transitionLabel: "Sales/Admin-Freigabe geprüft · quellgebundener Zugriff",
      unitNetRappen: version.netPriceRappen,
      netRappen: totals.net,
      taxRateBasisPoints,
      vatRappen: totals.vatAmount,
      totalRappen: totals.total,
      profile,
      planLimits: null,
      retentionOptions: [],
      targetJobId: null,
      importSetupApprovalId: approval.id,
    }),
  };
}

export async function listCompanyInvoices(
  database: DatabaseClient,
  companyId: string,
  now: Date,
) {
  const invoices = await database.invoice.findMany({
    where: { companyId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
    select: {
      id: true,
      number: true,
      status: true,
      issuedAt: true,
      dueAt: true,
      totalRappen: true,
      currency: true,
    },
  });
  return invoices.map((invoice) =>
    Object.freeze({
      ...invoice,
      displayStatus: deriveInvoiceDisplayStatus(
        invoice.status,
        invoice.dueAt,
        now,
      ),
    }),
  );
}

export async function getCompanyInvoice(
  database: DatabaseClient,
  companyId: string,
  invoiceId: string,
  now: Date,
) {
  const invoice = await database.invoice.findFirst({
    where: { id: invoiceId, companyId },
    include: {
      lines: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
    },
  });
  if (invoice === null) return null;
  return Object.freeze({
    ...invoice,
    displayStatus: deriveInvoiceDisplayStatus(
      invoice.status,
      invoice.dueAt,
      now,
    ),
  });
}

export function getCompanyOrder(
  database: DatabaseClient,
  companyId: string,
  orderId: string,
) {
  return database.order.findFirst({
    where: { id: orderId, companyId },
    include: {
      lines: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          planVersion: { include: { plan: true, entitlements: true } },
          productVersion: { include: { product: true } },
          subscriptionSnapshot: true,
        },
      },
      invoice: true,
      subscription: true,
    },
  });
}

async function loadEffectiveSubscription(
  database: DatabaseClient,
  companyId: string,
  now: Date,
) {
  const rows = await database.employerSubscription.findMany({
    where: {
      companyId,
      status: { in: ["ACTIVE", "CANCELLING"] },
      currentPeriodStart: { lte: now },
      currentPeriodEnd: { gt: now },
    },
    take: 2,
    include: {
      planVersion: { include: { plan: true } },
      currentChangeSchedules: {
        where: { status: "PENDING" },
        orderBy: [{ effectiveAt: "asc" }, { id: "asc" }],
        take: 1,
        include: {
          successorSubscription: {
            include: { planVersion: { include: { plan: true } } },
          },
        },
      },
    },
  });
  return rows.length === 1 ? rows[0]! : null;
}

function formatIsoDate(value: Date) {
  return new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Zurich",
  }).format(value);
}
