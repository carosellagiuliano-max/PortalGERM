import type {
  PublicPricingCatalog,
  PublicPricingPlan,
  PublicPricingProduct,
} from "@/lib/billing/public-catalog-core";

export type EmployerCheckoutRole = "OWNER" | "ADMIN";

export type EmployerCheckoutChoice = Readonly<{
  kind: "PLAN" | "PRODUCT";
  code: string;
  href: string;
  name: string;
  detail: string;
  netPriceRappen: number;
}>;

export type EmployerCheckoutChoiceResult =
  | Readonly<{ ok: true; value: readonly EmployerCheckoutChoice[] }>
  | Readonly<{ ok: false; code: "CATALOG_UNAVAILABLE" }>;

const CHECKOUT_PLAN_CODES = ["STARTER", "PRO"] as const;
const CHECKOUT_PRODUCT_CODES = ["contact-pack-10", "contact-pack-50"] as const;

/**
 * Builds presentation-only checkout links from an already validated catalog snapshot.
 * The query string remains purchase intent; order creation re-resolves every value.
 */
export function buildEmployerCheckoutChoices(
  catalog: PublicPricingCatalog,
  role: EmployerCheckoutRole,
): EmployerCheckoutChoiceResult {
  const plans = exactRows(
    catalog.plans,
    CHECKOUT_PLAN_CODES,
    (plan) => plan.code,
  );
  const products = exactRows(
    catalog.products,
    CHECKOUT_PRODUCT_CODES,
    (product) => product.code,
  );
  if (plans === null || products === null) return unavailable();

  const planChoices = plans.map(toPlanChoice);
  const productChoices = products.map(toProductChoice);
  if (
    planChoices.some((choice) => choice === null) ||
    productChoices.some((choice) => choice === null)
  ) {
    return unavailable();
  }

  return Object.freeze({
    ok: true,
    value: Object.freeze([
      ...(role === "OWNER"
        ? (planChoices as readonly EmployerCheckoutChoice[])
        : []),
      ...(productChoices as readonly EmployerCheckoutChoice[]),
    ]),
  });
}

function toPlanChoice(plan: PublicPricingPlan): EmployerCheckoutChoice | null {
  if (
    (plan.code !== "STARTER" && plan.code !== "PRO") ||
    plan.catalogDisclosure !== "PUBLIC_VERSION" ||
    plan.price.kind !== "MONTHLY_FIXED" ||
    plan.price.currency !== "CHF" ||
    !isPositiveRappen(plan.price.netRappen) ||
    plan.entitlements === null ||
    !isNonEmpty(plan.name) ||
    plan.slug !== plan.code.toLocaleLowerCase("en-US")
  ) {
    return null;
  }

  const rights = plan.entitlements;
  if (
    !isNonNegativeInteger(rights.ACTIVE_JOB_LIMIT) ||
    !isNonNegativeInteger(rights.SEAT_LIMIT) ||
    !isNonNegativeInteger(rights.TALENT_CONTACT_ALLOWANCE) ||
    !isNonNegativeInteger(rights.JOB_BOOST_ALLOWANCE)
  ) {
    return null;
  }

  const details = [
    jobLimitLabel(rights.ACTIVE_JOB_LIMIT),
    seatLimitLabel(rights.SEAT_LIMIT),
  ];
  if (rights.TALENT_RADAR_ACCESS) {
    details.push("Talent Radar");
  }
  if (rights.TALENT_CONTACT_ALLOWANCE > 0) {
    details.push(`${rights.TALENT_CONTACT_ALLOWANCE} Talent-Kontakte pro Monat`);
  }
  if (rights.JOB_BOOST_ALLOWANCE > 0) {
    details.push(`${rights.JOB_BOOST_ALLOWANCE} Boost-Credits pro Monat`);
  }

  return Object.freeze({
    kind: "PLAN",
    code: plan.code,
    href: `/employer/billing/checkout?plan=${plan.slug}`,
    name: plan.name,
    detail: details.join(" · "),
    netPriceRappen: plan.price.netRappen,
  });
}

function toProductChoice(
  product: PublicPricingProduct,
): EmployerCheckoutChoice | null {
  if (
    product.kind !== "CONTACT_PACK" ||
    (product.code !== "contact-pack-10" &&
      product.code !== "contact-pack-50") ||
    product.currency !== "CHF" ||
    !isPositiveRappen(product.netPriceRappen) ||
    !isPositiveInteger(product.creditAmount) ||
    !isNonEmpty(product.name)
  ) {
    return null;
  }

  return Object.freeze({
    kind: "PRODUCT",
    code: product.code,
    href: `/employer/billing/checkout?product=${product.code}`,
    name: product.name,
    detail: `${product.creditAmount} zusätzliche Talent-Kontakte`,
    netPriceRappen: product.netPriceRappen,
  });
}

function exactRows<
  Row,
  Code extends string,
>(
  rows: readonly Row[],
  expectedCodes: readonly Code[],
  codeOf: (row: Row) => string,
): readonly Row[] | null {
  const selected = rows.filter((row) =>
    expectedCodes.some((code) => code === codeOf(row)),
  );
  if (selected.length !== expectedCodes.length) return null;

  const ordered: Row[] = [];
  for (const code of expectedCodes) {
    const matches = selected.filter((row) => codeOf(row) === code);
    const row = matches[0];
    if (matches.length !== 1 || row === undefined) return null;
    ordered.push(row);
  }
  return Object.freeze(ordered);
}

function jobLimitLabel(limit: number) {
  return `${limit} ${limit === 1 ? "aktiver Job" : "aktive Jobs"}`;
}

function seatLimitLabel(limit: number) {
  return `${limit} ${limit === 1 ? "Sitzplatz" : "Sitzplätze"}`;
}

function isPositiveRappen(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

function isPositiveInteger(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isNonEmpty(value: string) {
  return value.trim().length > 0;
}

function unavailable(): EmployerCheckoutChoiceResult {
  return Object.freeze({ ok: false, code: "CATALOG_UNAVAILABLE" });
}
