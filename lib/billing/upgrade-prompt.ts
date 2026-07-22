import "server-only";

import type { FeatureGateReason } from "@/lib/billing/feature-gates";
import type { DatabaseClient } from "@/lib/db/factory";

export type UpgradePromptReason =
  | FeatureGateReason
  | "ENHANCED_PROFILE_NOT_INCLUDED";

export type UpgradePrompt = Readonly<{
  reason: UpgradePromptReason;
  title: string;
  description: string;
  cta: Readonly<{
    href: string;
    label: string;
  }>;
}>;

export type UpgradePromptInput = Readonly<{
  reason: UpgradePromptReason;
  suggestedPlanSlug?: string;
  suggestedProductSlug?: string;
  targetJobId?: string;
  actorRole?: "OWNER" | "ADMIN" | "RECRUITER" | "VIEWER";
}>;

export type UpgradePromptCatalogDependencies = Readonly<{
  database: Pick<DatabaseClient, "planVersion" | "productVersion">;
  now: Date;
}>;

const RELEASED_PRODUCT_TARGETS = Object.freeze({
  "contact-pack-10": Object.freeze({
    href: "/employer/billing/checkout?product=contact-pack-10",
    label: "Kontaktpaket ansehen",
  }),
  "contact-pack-50": Object.freeze({
    href: "/employer/billing/checkout?product=contact-pack-50",
    label: "Kontaktpaket ansehen",
  }),
} as const);

const DEFERRED_PRODUCT_SLUGS = new Set([
  "boost-7d",
  "boost-30d",
  "import-setup",
]);

/**
 * Pure allowlist/fail-safe basis. Real server callers use
 * buildCatalogUpgradePrompt so checkout copy is never authoritative without a
 * matching effective catalog snapshot.
 */
export function buildUpgradePrompt(input: UpgradePromptInput): UpgradePrompt {
  const copy = copyForReason(input.reason);
  return Object.freeze({
    reason: input.reason,
    ...copy,
    cta: resolveCta(input),
  });
}

/**
 * Resolves the suggested checkout option against the server-side catalog and
 * returns only client-safe German copy. A missing, ambiguous, inactive or
 * otherwise ineligible version deliberately falls back to public pricing.
 */
export async function buildCatalogUpgradePrompt(
  input: UpgradePromptInput,
  dependencies: UpgradePromptCatalogDependencies,
): Promise<UpgradePrompt> {
  const fallback = buildUpgradePrompt({
    reason: input.reason,
    actorRole: input.actorRole,
  });
  if (!Number.isFinite(dependencies.now.getTime())) return fallback;

  const productSlug = normalizeSlug(input.suggestedProductSlug);
  if (productSlug !== null) {
    if (!canManageProduct(input.actorRole) || !isKnownProductSlug(productSlug)) {
      return fallback;
    }
    try {
      const versions = await dependencies.database.productVersion.findMany({
        where: {
          status: "ACTIVE",
          isPublic: true,
          isSelfService: true,
          validFrom: { lte: dependencies.now },
          AND: [
            {
              OR: [
                { validTo: null },
                { validTo: { gt: dependencies.now } },
              ],
            },
          ],
          product: { code: productSlug },
        },
        select: {
          netPriceRappen: true,
          currency: true,
          product: { select: { code: true, name: true } },
        },
        orderBy: [{ validFrom: "desc" }, { id: "asc" }],
        take: 2,
      });
      if (versions.length !== 1) return fallback;
      const [version] = versions;
      if (
        version === undefined ||
        version.product.code !== productSlug ||
        !isClientSafeName(version.product.name) ||
        !isChfAmount(version.netPriceRappen, version.currency)
      ) {
        return fallback;
      }
      const base = buildUpgradePrompt({ ...input, suggestedPlanSlug: undefined });
      return catalogPrompt(base, {
        name: version.product.name.trim(),
        priceCopy: `${formatChfRappen(version.netPriceRappen)} netto`,
      });
    } catch {
      return fallback;
    }
  }

  const planSlug = normalizeSlug(input.suggestedPlanSlug);
  const planCode = planSlug === null ? null : CHECKOUT_PLAN_CODES[planSlug];
  if (planCode === undefined || planCode === null || !canManagePlan(input.actorRole)) {
    return fallback;
  }
  try {
    const versions = await dependencies.database.planVersion.findMany({
      where: {
        status: "ACTIVE",
        isPublic: true,
        isSelfService: true,
        validFrom: { lte: dependencies.now },
        AND: [
          {
            OR: [
              { validTo: null },
              { validTo: { gt: dependencies.now } },
            ],
          },
        ],
        plan: { code: planCode },
      },
      select: {
        priceMode: true,
        billingInterval: true,
        termMonths: true,
        netPriceRappen: true,
        currency: true,
        plan: { select: { code: true, name: true } },
      },
      orderBy: [{ validFrom: "desc" }, { id: "asc" }],
      take: 2,
    });
    if (versions.length !== 1) return fallback;
    const [version] = versions;
    if (
      version === undefined ||
      version.plan.code !== planCode ||
      version.priceMode !== "FIXED" ||
      version.billingInterval !== "MONTHLY" ||
      version.termMonths !== 1 ||
      version.netPriceRappen === null ||
      !isClientSafeName(version.plan.name) ||
      !isChfAmount(version.netPriceRappen, version.currency)
    ) {
      return fallback;
    }
    const base = buildUpgradePrompt({ ...input, suggestedProductSlug: undefined });
    return catalogPrompt(base, {
      name: version.plan.name.trim(),
      priceCopy: `${formatChfRappen(version.netPriceRappen)} netto pro Monat`,
    });
  } catch {
    return fallback;
  }
}

const CHECKOUT_PLAN_CODES: Readonly<Record<string, "PRO">> = Object.freeze({
  pro: "PRO",
});

function catalogPrompt(
  base: UpgradePrompt,
  option: Readonly<{ name: string; priceCopy: string }>,
): UpgradePrompt {
  const label = base.cta.href.includes("?plan=")
    ? `${option.name}-Upgrade ansehen`
    : base.cta.href.includes("?product=")
      ? `${option.name} kaufen`
      : `${option.name} im Billing ansehen`;
  return Object.freeze({
    ...base,
    description: `${base.description} Verfügbare Katalogoption: ${option.name} für ${option.priceCopy}.`,
    cta: Object.freeze({ ...base.cta, label }),
  });
}

function isKnownProductSlug(value: string) {
  return value === "additional-job-30d" ||
    value in RELEASED_PRODUCT_TARGETS ||
    DEFERRED_PRODUCT_SLUGS.has(value);
}

function canManagePlan(role: UpgradePromptInput["actorRole"]) {
  return role === undefined || role === "OWNER";
}

function canManageProduct(role: UpgradePromptInput["actorRole"]) {
  return role === undefined || role === "OWNER" || role === "ADMIN";
}

function isClientSafeName(value: string) {
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 160;
}

function isChfAmount(amountRappen: number, currency: string) {
  return Number.isSafeInteger(amountRappen) && amountRappen >= 0 && currency === "CHF";
}

function formatChfRappen(amountRappen: number) {
  return `CHF ${(amountRappen / 100).toFixed(2)}`;
}

function resolveCta(input: UpgradePromptInput): UpgradePrompt["cta"] {
  const canManagePlan = input.actorRole === undefined || input.actorRole === "OWNER";
  const canManageOneTimeProducts =
    input.actorRole === undefined ||
    input.actorRole === "OWNER" ||
    input.actorRole === "ADMIN";
  const productSlug = normalizeSlug(input.suggestedProductSlug);
  if (productSlug !== null) {
    if (productSlug === "additional-job-30d") {
      if (!canManageOneTimeProducts) return pricingCta();
      const targetJobId = normalizeUuid(input.targetJobId);
      return targetJobId === null
        ? Object.freeze({
            href: "/employer/billing",
            label: "Billing und verfügbare Optionen ansehen",
          })
        : Object.freeze({
            href: `/employer/billing/checkout?product=additional-job-30d&job=${targetJobId}`,
            label: "Zusatzstelle ansehen",
          });
    }
    if (productSlug in RELEASED_PRODUCT_TARGETS) {
      if (!canManageOneTimeProducts) return pricingCta();
      return RELEASED_PRODUCT_TARGETS[
        productSlug as keyof typeof RELEASED_PRODUCT_TARGETS
      ];
    }
    if (DEFERRED_PRODUCT_SLUGS.has(productSlug)) {
      if (!canManageOneTimeProducts) return pricingCta();
      return Object.freeze({
        href: "/employer/billing",
        label: "Billing und verfügbare Optionen ansehen",
      });
    }
    return pricingCta();
  }

  return normalizeSlug(input.suggestedPlanSlug) === "pro" && canManagePlan
    ? Object.freeze({
        href: "/employer/billing/checkout?plan=pro",
        label: "Pro-Upgrade ansehen",
      })
    : pricingCta();
}

function copyForReason(reason: UpgradePromptReason) {
  if (reason === "SEAT_LIMIT_REACHED") {
    return Object.freeze({
      title: "Sitzplatzlimit erreicht",
      description:
        "Dein aktueller Plan erlaubt keinen weiteren reservierten Team-Sitz. Bestehende Mitglieder und Einladungen bleiben unverändert.",
    });
  }
  if (
    reason === "ACTIVE_JOB_LIMIT_REACHED" ||
    reason === "ADDITIONAL_JOB_PERMIT_REQUIRED" ||
    reason === "ADDITIONAL_JOB_PERMIT_INVALID"
  ) {
    return Object.freeze({
      title: "Aktives Joblimit erreicht",
      description:
        "Die Stelle bleibt unverändert. Prüfe die verfügbaren Planoptionen, bevor du sie erneut veröffentlichst.",
    });
  }
  if (reason === "ADVANCED_ANALYTICS_NOT_INCLUDED") {
    return Object.freeze({
      title: "Erweiterte Analytics nicht enthalten",
      description:
        "Diese Auswertung benötigt einen Plan mit erweiterten Analytics-Rechten.",
    });
  }
  if (reason === "ENHANCED_PROFILE_NOT_INCLUDED") {
    return Object.freeze({
      title: "Erweitertes Firmenprofil nicht enthalten",
      description:
        "Cover, Unternehmenswerte und Firmen-Benefits bleiben mit den aktuell wirksamen Rechten schreibgeschützt.",
    });
  }
  if (
    reason === "TALENT_RADAR_NOT_INCLUDED" ||
    reason === "CONTACT_FUNDING_UNAVAILABLE"
  ) {
    return Object.freeze({
      title: "Talent-Radar-Kontingent nicht verfügbar",
      description:
        "Für diese Aktion fehlen ein wirksamer Talent-Radar-Zugang oder aktuell nutzbare Kontakt-Credits.",
    });
  }
  return Object.freeze({
    title: "Im aktuellen Plan nicht verfügbar",
    description:
      "Diese Funktion ist mit den aktuell wirksamen Rechten nicht verfügbar. Es wurde nichts verändert.",
  });
}

function normalizeSlug(value: string | undefined): string | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeUuid(value: string | undefined): string | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
    normalized,
  )
    ? normalized
    : null;
}

function pricingCta(): UpgradePrompt["cta"] {
  return Object.freeze({ href: "/pricing", label: "Pläne vergleichen" });
}
