export type ProductType =
  | "JOB_BOOST"
  | "ADDITIONAL_JOB"
  | "FEATURED_JOB"
  | "FEATURED_EMPLOYER"
  | "NEWSLETTER"
  | "SOCIAL_PUSH"
  | "IMPORT_SETUP"
  | "CONTACT_PACK"
  | "SUCCESS_FEE";

export type ProductCreditType =
  | "JOB_BOOST"
  | "TALENT_CONTACT"
  | "NEWSLETTER"
  | "SOCIAL_PUSH";

export interface ProductFixture {
  readonly code: string;
  readonly name: string;
  readonly type: ProductType;
}

export interface ProductVersionFixture {
  readonly naturalKey: string;
  readonly productCode: string;
  readonly version: 1;
  readonly status: "ACTIVE" | "INACTIVE";
  readonly netPriceRappen: number;
  readonly currency: "CHF";
  readonly durationDays: number | null;
  readonly creditType: ProductCreditType | null;
  readonly creditAmount: number | null;
  readonly isPublic: boolean;
  readonly isSelfService: boolean;
  readonly priority: number;
  readonly requiresLegalReview: boolean;
  readonly validFrom: string;
  readonly validTo: null;
}

interface ProductDefinition extends ProductFixture {
  readonly status: "ACTIVE" | "INACTIVE";
  readonly netPriceRappen: number;
  readonly durationDays: number | null;
  readonly creditType: ProductCreditType | null;
  readonly creditAmount: number | null;
  readonly requiresLegalReview?: boolean;
}

const PRODUCT_DEFINITIONS = [
  { code: "boost-7d", name: "Job Boost 7 Tage", type: "JOB_BOOST", status: "ACTIVE", netPriceRappen: 7_900, durationDays: 7, creditType: null, creditAmount: null },
  { code: "boost-30d", name: "Job Boost 30 Tage", type: "JOB_BOOST", status: "ACTIVE", netPriceRappen: 19_900, durationDays: 30, creditType: null, creditAmount: null },
  { code: "featured-job", name: "Homepage Featured Job", type: "FEATURED_JOB", status: "INACTIVE", netPriceRappen: 29_900, durationDays: 14, creditType: null, creditAmount: null },
  { code: "featured-employer", name: "Featured Employer", type: "FEATURED_EMPLOYER", status: "INACTIVE", netPriceRappen: 49_900, durationDays: 30, creditType: null, creditAmount: null },
  { code: "newsletter-placement", name: "Newsletter Placement", type: "NEWSLETTER", status: "INACTIVE", netPriceRappen: 24_900, durationDays: null, creditType: "NEWSLETTER", creditAmount: 1 },
  { code: "social-push", name: "Social Media Push", type: "SOCIAL_PUSH", status: "INACTIVE", netPriceRappen: 39_000, durationDays: null, creditType: "SOCIAL_PUSH", creditAmount: 1 },
  { code: "import-setup", name: "XML/JSON Import Setup", type: "IMPORT_SETUP", status: "INACTIVE", netPriceRappen: 75_000, durationDays: null, creditType: null, creditAmount: null },
  { code: "additional-job-30d", name: "Zusatzstelle 30 Tage", type: "ADDITIONAL_JOB", status: "INACTIVE", netPriceRappen: 12_900, durationDays: 30, creditType: null, creditAmount: null },
  { code: "contact-pack-10", name: "Talent Radar Contact Pack 10", type: "CONTACT_PACK", status: "ACTIVE", netPriceRappen: 9_900, durationDays: null, creditType: "TALENT_CONTACT", creditAmount: 10 },
  { code: "contact-pack-50", name: "Talent Radar Contact Pack 50", type: "CONTACT_PACK", status: "ACTIVE", netPriceRappen: 29_900, durationDays: null, creditType: "TALENT_CONTACT", creditAmount: 50 },
  { code: "success-fee", name: "Success Fee (Coming soon)", type: "SUCCESS_FEE", status: "INACTIVE", netPriceRappen: 0, durationDays: null, creditType: null, creditAmount: null, requiresLegalReview: true },
] satisfies ProductDefinition[];

export const PRODUCT_FIXTURES: readonly Readonly<ProductFixture>[] =
  Object.freeze(
    PRODUCT_DEFINITIONS.map(({ code, name, type }) =>
      Object.freeze({ code, name, type }),
    ),
  );

const PRODUCT_VALID_FROM = "2026-01-01T00:00:00.000Z";

export const PRODUCT_VERSION_FIXTURES: readonly Readonly<ProductVersionFixture>[] =
  Object.freeze(
    PRODUCT_DEFINITIONS.map((definition, priority) => {
      const isActive = definition.status === "ACTIVE";
      return Object.freeze({
        naturalKey: `${definition.code}:v1`,
        productCode: definition.code,
        version: 1 as const,
        status: definition.status,
        netPriceRappen: definition.netPriceRappen,
        currency: "CHF" as const,
        durationDays: definition.durationDays,
        creditType: definition.creditType,
        creditAmount: definition.creditAmount,
        isPublic: isActive,
        isSelfService: isActive,
        priority: priority + 1,
        requiresLegalReview: definition.requiresLegalReview ?? false,
        validFrom: PRODUCT_VALID_FROM,
        validTo: null,
      });
    }),
  );
