import "server-only";

import { requireCapability, adminNow, type AdminDependencies } from "@/lib/admin/common";

export const ADMIN_FINANCIAL_METRICS_V1 = Object.freeze({
  version: "ADMIN_FINANCIAL_METRICS_V1" as const,
  timeZone: "Europe/Zurich" as const,
  mrrDefinition:
    "Summe der unveraenderlichen Monthly-Equivalent-Snapshots aller am Messzeitpunkt wirksamen bezahlten Abonnemente.",
  revenueDefinition:
    "Mock-Cash-Basis: Netto-Rechnungszeilen beim ersten PAID-Event des Mock-Auftrags im Zuercher Kalendermonat; MWST, VOID und Duplikate sind ausgeschlossen.",
});

export type ZurichMonthWindow = Readonly<{
  label: string;
  start: Date;
  end: Date;
}>;

export type AdminFinancialMetrics = Readonly<{
  policyVersion: typeof ADMIN_FINANCIAL_METRICS_V1.version;
  measuredAt: Date;
  month: ZurichMonthWindow;
  mrrRappen: number;
  customContractsWithoutValue: number;
  monthlyMockPaidNetRappen: number;
  monthlyMockPaidPlanNetRappen: number;
  monthlyMockPaidProductNetRappen: number;
  activeSubscriptions: number;
  freeEmployers: number;
  paidEmployers: number;
  boostSales: Readonly<{ count: number; netRappen: number }>;
  contactPackSales: Readonly<{ count: number; netRappen: number }>;
  invoices: Readonly<Record<"DRAFT" | "ISSUED" | "PAID" | "VOID", Readonly<{ count: number; totalRappen: number }>>>;
}>;

/** Returns null for unauthorized callers so routes do not disclose financial existence. */
export async function getAdminFinancialMetrics(
  dependencies: AdminDependencies,
): Promise<AdminFinancialMetrics | null> {
  if (!requireCapability(dependencies, "ADMIN_ANALYTICS_READ")) return null;
  const now = adminNow(dependencies.now);
  const month = getZurichMonthWindow(now);

  const { subscriptions, activeCompanyCount, paidInvoices, invoiceGroups } =
    await dependencies.database.$transaction(
      async (transaction) => {
        const [
          subscriptionRows,
          companyCount,
          paidInvoiceRows,
          invoiceStatusGroups,
        ] = await Promise.all([
          transaction.employerSubscription.findMany({
            where: {
              status: { in: ["ACTIVE", "CANCELLING"] },
              currentPeriodStart: { lte: now },
              currentPeriodEnd: { gt: now },
              company: { status: "ACTIVE" },
            },
            select: {
              companyId: true,
              monthlyEquivalentRappenSnapshot: true,
              recurringNetRappenSnapshot: true,
            },
          }),
          transaction.company.count({ where: { status: "ACTIVE" } }),
          transaction.invoice.findMany({
            where: {
              status: "PAID",
              order: {
                provider: "MOCK",
                paymentEvents: {
                  some: {
                    provider: "MOCK",
                    kind: "PAID",
                    createdAt: { gte: month.start, lt: month.end },
                  },
                },
              },
            },
            select: {
              id: true,
              order: {
                select: {
                  paymentEvents: {
                    where: { provider: "MOCK", kind: "PAID" },
                    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                    select: { id: true, createdAt: true },
                  },
                },
              },
              lines: {
                orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
                select: {
                  netRappen: true,
                  orderLine: {
                    select: {
                      planVersionId: true,
                      productVersion: {
                        select: { product: { select: { type: true } } },
                      },
                    },
                  },
                },
              },
            },
          }),
          transaction.invoice.groupBy({
            by: ["status"],
            _count: { _all: true },
            _sum: { totalRappen: true },
          }),
        ]);
        return {
          subscriptions: subscriptionRows,
          activeCompanyCount: companyCount,
          paidInvoices: paidInvoiceRows,
          invoiceGroups: invoiceStatusGroups,
        };
      },
      { isolationLevel: "RepeatableRead" },
    );

  const paidCompanyIds = new Set<string>();
  let mrrRappen = 0;
  let customContractsWithoutValue = 0;
  for (const subscription of subscriptions) {
    // Free is represented by the no-subscription fallback. A current custom
    // contract remains a paid employer even when its commercial value is not
    // recorded and therefore contributes zero to MRR.
    paidCompanyIds.add(subscription.companyId);
    if (subscription.monthlyEquivalentRappenSnapshot > 0) {
      mrrRappen = safeAdd(mrrRappen, subscription.monthlyEquivalentRappenSnapshot);
    } else if (subscription.recurringNetRappenSnapshot === 0) {
      customContractsWithoutValue += 1;
    }
  }

  let monthlyMockPaidNetRappen = 0;
  let monthlyMockPaidPlanNetRappen = 0;
  let monthlyMockPaidProductNetRappen = 0;
  let boostSalesCount = 0;
  let boostSalesNetRappen = 0;
  let contactPackSalesCount = 0;
  let contactPackSalesNetRappen = 0;

  for (const invoice of paidInvoices) {
    const firstPaidAt = invoice.order.paymentEvents[0]?.createdAt;
    if (
      firstPaidAt === undefined ||
      firstPaidAt.getTime() < month.start.getTime() ||
      firstPaidAt.getTime() >= month.end.getTime()
    ) {
      continue;
    }
    for (const line of invoice.lines) {
      monthlyMockPaidNetRappen = safeAdd(monthlyMockPaidNetRappen, line.netRappen);
      if (line.orderLine.planVersionId !== null) {
        monthlyMockPaidPlanNetRappen = safeAdd(monthlyMockPaidPlanNetRappen, line.netRappen);
      } else {
        monthlyMockPaidProductNetRappen = safeAdd(monthlyMockPaidProductNetRappen, line.netRappen);
      }
      const productType = line.orderLine.productVersion?.product.type;
      if (productType === "JOB_BOOST") {
        boostSalesCount += 1;
        boostSalesNetRappen = safeAdd(boostSalesNetRappen, line.netRappen);
      }
      if (productType === "CONTACT_PACK") {
        contactPackSalesCount += 1;
        contactPackSalesNetRappen = safeAdd(contactPackSalesNetRappen, line.netRappen);
      }
    }
  }

  const invoiceBreakdown: Record<"DRAFT" | "ISSUED" | "PAID" | "VOID", { count: number; totalRappen: number }> = {
    DRAFT: { count: 0, totalRappen: 0 },
    ISSUED: { count: 0, totalRappen: 0 },
    PAID: { count: 0, totalRappen: 0 },
    VOID: { count: 0, totalRappen: 0 },
  };
  for (const group of invoiceGroups) {
    invoiceBreakdown[group.status] = {
      count: group._count._all,
      totalRappen: group._sum.totalRappen ?? 0,
    };
  }

  return Object.freeze({
    policyVersion: ADMIN_FINANCIAL_METRICS_V1.version,
    measuredAt: new Date(now),
    month,
    mrrRappen,
    customContractsWithoutValue,
    monthlyMockPaidNetRappen,
    monthlyMockPaidPlanNetRappen,
    monthlyMockPaidProductNetRappen,
    activeSubscriptions: subscriptions.length,
    freeEmployers: Math.max(0, activeCompanyCount - paidCompanyIds.size),
    paidEmployers: paidCompanyIds.size,
    boostSales: Object.freeze({ count: boostSalesCount, netRappen: boostSalesNetRappen }),
    contactPackSales: Object.freeze({ count: contactPackSalesCount, netRappen: contactPackSalesNetRappen }),
    invoices: Object.freeze({
      DRAFT: Object.freeze(invoiceBreakdown.DRAFT),
      ISSUED: Object.freeze(invoiceBreakdown.ISSUED),
      PAID: Object.freeze(invoiceBreakdown.PAID),
      VOID: Object.freeze(invoiceBreakdown.VOID),
    }),
  });
}

export function getZurichMonthWindow(at: Date): ZurichMonthWindow {
  if (!(at instanceof Date) || !Number.isFinite(at.getTime())) {
    throw new TypeError("A valid measurement instant is required.");
  }
  const local = getZurichParts(at);
  const nextYear = local.month === 12 ? local.year + 1 : local.year;
  const nextMonth = local.month === 12 ? 1 : local.month + 1;
  return Object.freeze({
    label: `${String(local.year).padStart(4, "0")}-${String(local.month).padStart(2, "0")}`,
    start: resolveZurichMidnight(local.year, local.month, 1),
    end: resolveZurichMidnight(nextYear, nextMonth, 1),
  });
}

const ZURICH_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: ADMIN_FINANCIAL_METRICS_V1.timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function getZurichParts(at: Date) {
  const map = new Map(ZURICH_PARTS.formatToParts(at).map((part) => [part.type, part.value]));
  const year = Number(map.get("year"));
  const month = Number(map.get("month"));
  const day = Number(map.get("day"));
  const hour = Number(map.get("hour"));
  const minute = Number(map.get("minute"));
  const second = Number(map.get("second"));
  if (![year, month, day, hour, minute, second].every(Number.isInteger)) {
    throw new RangeError("Europe/Zurich date parts could not be resolved.");
  }
  return { year, month, day, hour, minute, second };
}

function resolveZurichMidnight(year: number, month: number, day: number) {
  const target = Date.UTC(year, month - 1, day, 0, 0, 0);
  let candidate = target;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const parts = getZurichParts(new Date(candidate));
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    candidate += target - represented;
  }
  const result = new Date(candidate);
  const parts = getZurichParts(result);
  if (parts.year !== year || parts.month !== month || parts.day !== day || parts.hour !== 0 || parts.minute !== 0 || parts.second !== 0) {
    throw new RangeError("Europe/Zurich month boundary could not be resolved.");
  }
  return result;
}

function safeAdd(current: number, amount: number) {
  const result = current + amount;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new RangeError("Billing metric exceeds the safe integer range.");
  }
  return result;
}
