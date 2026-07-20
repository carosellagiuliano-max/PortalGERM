import {
  decodePlanEntitlementsV1,
  type EntitlementRights,
  type PlanEntitlementRecord,
} from "@/lib/billing/entitlements";

export const PUBLIC_PLAN_ORDER_V1 = [
  "FREE_BASIC",
  "STARTER",
  "PRO",
  "BUSINESS",
  "ENTERPRISE_CONTRACT",
] as const;

export const PUBLIC_PRODUCT_CODES_V1 = [
  "boost-7d",
  "boost-30d",
  "contact-pack-10",
  "contact-pack-50",
] as const;

export type PublicPlanCode = (typeof PUBLIC_PLAN_ORDER_V1)[number];
export type PublicProductCode = (typeof PUBLIC_PRODUCT_CODES_V1)[number];
export type PublicPlanSlug = "free" | "starter" | "pro" | "business" | "enterprise";

export type PublicPlanCatalogRow = Readonly<{
  id: string;
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
  plan: Readonly<{
    code: string;
    name: string;
    isDefaultFree: boolean;
  }>;
  entitlements: readonly PlanEntitlementRecord[];
}>;

export type PublicProductCatalogRow = Readonly<{
  id: string;
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
  product: Readonly<{
    code: string;
    name: string;
    type: string;
  }>;
}>;

export type PublicTaxCatalogRow = Readonly<{
  jurisdiction: string;
  taxType: string;
  rateBasisPoints: number;
  validFrom: Date;
  validTo: Date | null;
  source: string;
  reviewStatus: string;
}>;

export type PublicPricingPlan = Readonly<{
  code: PublicPlanCode;
  slug: PublicPlanSlug;
  name: string;
  sortOrder: number;
  price: Readonly<
    | { kind: "MONTHLY_FIXED"; netRappen: number; currency: "CHF" }
    | { kind: "INDIVIDUAL"; currency: "CHF" }
  >;
  entitlements: EntitlementRights | null;
  cta: Readonly<{
    kind: "REGISTER" | "QUALIFIED_LEAD" | "DEMO";
    href: string;
    label: string;
  }>;
  catalogDisclosure: "PUBLIC_VERSION" | "PRIVATE_CONTRACT_TEMPLATE";
}>;

export type PublicPricingProduct = Readonly<{
  code: PublicProductCode;
  name: string;
  priority: number;
  netPriceRappen: number;
  currency: "CHF";
  kind: "JOB_BOOST" | "CONTACT_PACK";
  durationDays: number | null;
  creditAmount: number | null;
  availability: "INFORMATION_ONLY";
}>;

export type PublicSuccessFeePlaceholder = Readonly<{
  title: "Erfolgsbasierte Vermittlung";
  availability: "DISABLED_LEGAL_REVIEW";
}>;

export type PublicTaxNotice = Readonly<{
  kind: "DEMO_PLANNING_ASSUMPTION" | "REVIEW_BEFORE_CONTRACT";
  text: string;
}>;

export type PublicPricingCatalog = Readonly<{
  policyVersion: "public-pricing-v1";
  plans: readonly PublicPricingPlan[];
  products: readonly PublicPricingProduct[];
  successFee: PublicSuccessFeePlaceholder;
  taxNotice: PublicTaxNotice;
}>;

export type PublicPricingCatalogResult =
  | Readonly<{ ok: true; value: PublicPricingCatalog }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        code:
          | "INVALID_CLOCK"
          | "PLAN_SET_INVALID"
          | "PLAN_VERSION_INVALID"
          | "PLAN_ENTITLEMENTS_INVALID"
          | "PRODUCT_SET_INVALID"
          | "PRODUCT_VERSION_INVALID"
          | "SUCCESS_FEE_INVALID"
          | "TAX_CONFIGURATION_INVALID";
      }>;
    }>;

const PLAN_PRESENTATION_V1: Readonly<
  Record<
    PublicPlanCode,
    Readonly<{
      slug: PublicPlanSlug;
      publicName: string;
      publicVersion: boolean;
      cta: PublicPricingPlan["cta"];
    }>
  >
> = Object.freeze({
  FREE_BASIC: Object.freeze({
    slug: "free",
    publicName: "Free Basic",
    publicVersion: true,
    cta: Object.freeze({ kind: "REGISTER", href: "/register/employer", label: "Kostenlos starten" }),
  }),
  STARTER: Object.freeze({
    slug: "starter",
    publicName: "Starter",
    publicVersion: true,
    cta: Object.freeze({ kind: "QUALIFIED_LEAD", href: "/employers/demo?interest=starter", label: "Starter anfragen" }),
  }),
  PRO: Object.freeze({
    slug: "pro",
    publicName: "Pro",
    publicVersion: true,
    cta: Object.freeze({ kind: "QUALIFIED_LEAD", href: "/employers/demo?interest=pro", label: "Pro anfragen" }),
  }),
  BUSINESS: Object.freeze({
    slug: "business",
    publicName: "Business",
    publicVersion: true,
    cta: Object.freeze({ kind: "DEMO", href: "/employers/demo?interest=business", label: "Business besprechen" }),
  }),
  ENTERPRISE_CONTRACT: Object.freeze({
    slug: "enterprise",
    publicName: "Enterprise",
    publicVersion: false,
    cta: Object.freeze({ kind: "DEMO", href: "/employers/demo?interest=enterprise", label: "Enterprise besprechen" }),
  }),
});

const PLAN_CODE_SET = new Set<string>(PUBLIC_PLAN_ORDER_V1);
const PRODUCT_CODE_SET = new Set<string>(PUBLIC_PRODUCT_CODES_V1);

export function isValidPublicPlanCatalogRowV1(row: PublicPlanCatalogRow) {
  if (!PLAN_CODE_SET.has(row.plan.code)) return false;
  const code = row.plan.code as PublicPlanCode;
  return isValidPlanVersion(code, row) && decodePlanEntitlementsV1(row.entitlements).ok;
}

export function buildPublicPricingCatalogV1(
  input: Readonly<{
    at: Date;
    productionLike: boolean;
    planVersions: readonly PublicPlanCatalogRow[];
    productVersions: readonly PublicProductCatalogRow[];
    successFeeVersions: readonly PublicProductCatalogRow[];
    taxRates: readonly PublicTaxCatalogRow[];
  }>,
): PublicPricingCatalogResult {
  if (!isValidDate(input.at)) return failure("INVALID_CLOCK");

  const planRows = input.planVersions.filter((row) => isEffective(row, input.at));
  if (
    planRows.length !== PUBLIC_PLAN_ORDER_V1.length ||
    planRows.some((row) => !PLAN_CODE_SET.has(row.plan.code))
  ) {
    return failure("PLAN_SET_INVALID");
  }

  const plans: PublicPricingPlan[] = [];
  for (const [sortOrder, code] of PUBLIC_PLAN_ORDER_V1.entries()) {
    const rows = planRows.filter((row) => row.plan.code === code);
    if (rows.length !== 1) return failure("PLAN_SET_INVALID");
    const row = rows[0];
    if (row === undefined || !isValidPlanVersion(code, row)) {
      return failure("PLAN_VERSION_INVALID");
    }
    const decoded = decodePlanEntitlementsV1(row.entitlements);
    if (!decoded.ok) return failure("PLAN_ENTITLEMENTS_INVALID");

    const presentation = PLAN_PRESENTATION_V1[code];
    plans.push(Object.freeze({
      code,
      slug: presentation.slug,
      name: presentation.publicName,
      sortOrder,
      price: row.priceMode === "CONTRACT"
        ? Object.freeze({ kind: "INDIVIDUAL" as const, currency: "CHF" as const })
        : Object.freeze({
            kind: "MONTHLY_FIXED" as const,
            netRappen: row.netPriceRappen as number,
            currency: "CHF" as const,
          }),
      entitlements: code === "ENTERPRISE_CONTRACT" ? null : decoded.value,
      cta: presentation.cta,
      catalogDisclosure: presentation.publicVersion
        ? "PUBLIC_VERSION" as const
        : "PRIVATE_CONTRACT_TEMPLATE" as const,
    }));
  }

  const productRows = input.productVersions.filter((row) => isEffective(row, input.at));
  if (
    productRows.length !== PUBLIC_PRODUCT_CODES_V1.length ||
    productRows.some((row) => !PRODUCT_CODE_SET.has(row.product.code))
  ) {
    return failure("PRODUCT_SET_INVALID");
  }
  const priorities = new Set<number>();
  const products: PublicPricingProduct[] = [];
  for (const code of PUBLIC_PRODUCT_CODES_V1) {
    const rows = productRows.filter((row) => row.product.code === code);
    const row = rows[0];
    if (rows.length !== 1 || row === undefined || !isValidProductVersion(code, row)) {
      return failure("PRODUCT_VERSION_INVALID");
    }
    if (priorities.has(row.priority)) return failure("PRODUCT_VERSION_INVALID");
    priorities.add(row.priority);
    products.push(Object.freeze({
      code,
      name: row.product.name,
      priority: row.priority,
      netPriceRappen: row.netPriceRappen,
      currency: "CHF",
      kind: row.product.type as "JOB_BOOST" | "CONTACT_PACK",
      durationDays: row.durationDays,
      creditAmount: row.creditAmount,
      availability: "INFORMATION_ONLY",
    }));
  }
  products.sort((left, right) => left.priority - right.priority || left.code.localeCompare(right.code));

  const successFeeRows = input.successFeeVersions.filter((row) => isEffective(row, input.at));
  if (successFeeRows.length !== 1 || !isValidSuccessFee(successFeeRows[0])) {
    return failure("SUCCESS_FEE_INVALID");
  }

  const taxNotice = buildTaxNotice(input.taxRates, input.at, input.productionLike);
  if (taxNotice === null) return failure("TAX_CONFIGURATION_INVALID");

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      policyVersion: "public-pricing-v1",
      plans: Object.freeze(plans),
      products: Object.freeze(products),
      successFee: Object.freeze({
        title: "Erfolgsbasierte Vermittlung",
        availability: "DISABLED_LEGAL_REVIEW",
      }),
      taxNotice,
    }),
  });
}

function isValidPlanVersion(code: PublicPlanCode, row: PublicPlanCatalogRow) {
  if (
    row.status !== "ACTIVE" ||
    row.currency !== "CHF" ||
    !Number.isSafeInteger(row.version) ||
    row.version < 1
  ) return false;

  if (code === "ENTERPRISE_CONTRACT") {
    return (
      row.priceMode === "CONTRACT" &&
      row.billingInterval === "MONTHLY" &&
      row.termMonths === 12 &&
      row.netPriceRappen === null &&
      row.monthlyEquivalentRappen === null &&
      !row.isPublic &&
      !row.isSelfService &&
      !row.plan.isDefaultFree
    );
  }

  return (
    row.priceMode === "FIXED" &&
    row.billingInterval === "MONTHLY" &&
    row.termMonths === 1 &&
    isNonNegativeInteger(row.netPriceRappen) &&
    row.monthlyEquivalentRappen === row.netPriceRappen &&
    row.isPublic &&
    (code === "FREE_BASIC" ? row.plan.isDefaultFree : !row.plan.isDefaultFree) &&
    (code === "STARTER" || code === "PRO" ? row.isSelfService : !row.isSelfService)
  );
}

function isValidProductVersion(code: PublicProductCode, row: PublicProductCatalogRow) {
  if (
    row.status !== "ACTIVE" ||
    row.currency !== "CHF" ||
    !row.isPublic ||
    !row.isSelfService ||
    row.requiresLegalReview ||
    !isNonNegativeInteger(row.netPriceRappen) ||
    row.netPriceRappen === 0 ||
    !Number.isSafeInteger(row.priority) ||
    row.priority < 0
  ) return false;

  if (code === "boost-7d" || code === "boost-30d") {
    return (
      row.product.type === "JOB_BOOST" &&
      row.durationDays === (code === "boost-7d" ? 7 : 30) &&
      row.creditType === null &&
      row.creditAmount === null
    );
  }
  return (
    row.product.type === "CONTACT_PACK" &&
    row.durationDays === null &&
    row.creditType === "TALENT_CONTACT" &&
    row.creditAmount === (code === "contact-pack-10" ? 10 : 50)
  );
}

function isValidSuccessFee(row: PublicProductCatalogRow | undefined) {
  return row !== undefined &&
    row.product.code === "success-fee" &&
    row.product.type === "SUCCESS_FEE" &&
    row.status === "INACTIVE" &&
    row.requiresLegalReview &&
    !row.isPublic &&
    !row.isSelfService;
}

function buildTaxNotice(
  rows: readonly PublicTaxCatalogRow[],
  at: Date,
  productionLike: boolean,
): PublicTaxNotice | null {
  if (productionLike) {
    return Object.freeze({
      kind: "REVIEW_BEFORE_CONTRACT",
      text: "Preise zzgl. anwendbarer MWST; Steuerbehandlung und Satz vor Vertragsabschluss prüfen.",
    });
  }
  const current = rows.filter(
    (row) =>
      isEffective(row, at) &&
      row.jurisdiction === "CH" &&
      row.taxType === "MWST_STANDARD_DEMO" &&
      row.reviewStatus === "APPROVED" &&
      row.source.toLocaleLowerCase("de-CH").includes("fiktiv"),
  );
  const row = current[0];
  if (
    current.length !== 1 ||
    row === undefined ||
    !Number.isSafeInteger(row.rateBasisPoints) ||
    row.rateBasisPoints < 0
  ) return null;

  const percent = new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: row.rateBasisPoints % 100 === 0 ? 0 : 1,
    maximumFractionDigits: 2,
  }).format(row.rateBasisPoints / 100);
  return Object.freeze({
    kind: "DEMO_PLANNING_ASSUMPTION",
    text: `Preise zzgl. aktuell als Demo-Annahme geplant ${percent} % MWST; Steuerbehandlung vor Vertragsabschluss prüfen.`,
  });
}

function isEffective(
  row: Readonly<{ validFrom: Date; validTo: Date | null }>,
  at: Date,
) {
  return isValidDate(row.validFrom) &&
    (row.validTo === null || isValidDate(row.validTo)) &&
    row.validFrom.getTime() <= at.getTime() &&
    (row.validTo === null || at.getTime() < row.validTo.getTime());
}

function isValidDate(value: Date) {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function isNonNegativeInteger(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

function failure(
  code: Extract<PublicPricingCatalogResult, { ok: false }>["error"]["code"],
): Extract<PublicPricingCatalogResult, { ok: false }> {
  return Object.freeze({ ok: false, error: Object.freeze({ code }) });
}
