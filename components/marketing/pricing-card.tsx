import Link from "next/link";
import { CheckIcon, InfoIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { PublicPricingPlan } from "@/lib/billing/public-catalog-core";
import { formatChfFromRappen } from "@/lib/utils/format";

export function PricingCard({ plan }: Readonly<{ plan: PublicPricingPlan }>) {
  const features = planFeatures(plan);
  return (
    <Card className="h-full">
      <article aria-labelledby={`plan-${plan.slug}`} className="contents">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-wider text-primary uppercase">
                Planhypothese
              </p>
              <CardTitle as="h2" id={`plan-${plan.slug}`} className="mt-2 text-2xl">
                {plan.name}
              </CardTitle>
            </div>
            {plan.code === "PRO" ? <Badge variant="secondary">Für wachsende Teams</Badge> : null}
          </div>
          <div className="mt-4">
            {plan.price.kind === "MONTHLY_FIXED" ? (
              <p>
                <span className="text-3xl font-semibold tracking-tight">
                  {formatChfFromRappen(plan.price.netRappen)}
                </span>
                <span className="text-sm text-muted-foreground"> / Monat netto</span>
              </p>
            ) : (
              <p className="text-3xl font-semibold tracking-tight">Individuell</p>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex-1">
          <ul className="grid gap-3 text-sm leading-6">
            {features.map((feature) => (
              <li key={feature} className="flex gap-2">
                <CheckIcon className="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          {plan.catalogDisclosure === "PRIVATE_CONTRACT_TEMPLATE" ? (
            <p className="mt-5 flex gap-2 rounded-lg border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
              <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Öffentliche Vergleichskarte auf Basis einer nicht bestellbaren
              Vertragsvorlage. Konkrete Rechte entstehen nur aus vereinbarten Bedingungen.
            </p>
          ) : null}
        </CardContent>
        <CardFooter>
          <Link href={plan.cta.href} className={buttonVariants({
            variant: plan.code === "PRO" ? "default" : "outline",
            className: "w-full bg-background",
          })}>
            {plan.cta.label}
          </Link>
        </CardFooter>
      </article>
    </Card>
  );
}

function planFeatures(plan: PublicPricingPlan) {
  const rights = plan.entitlements;
  if (rights === null) {
    return [
      "Vereinbarte Job-, Seat- und Kontaktkontingente",
      "Betreutes Onboarding nach individueller Vereinbarung",
      "ATS, API, SSO und Vertragsbilling erst nach separater Prüfung und Freigabe",
      "Keine direkte Bestellung im aktuellen Mock-MVP",
    ];
  }

  const features = [
    `${rights.ACTIVE_JOB_LIMIT} ${rights.ACTIVE_JOB_LIMIT === 1 ? "aktiver Job" : "aktive Jobs"}`,
    `${rights.SEAT_LIMIT} ${rights.SEAT_LIMIT === 1 ? "Seat" : "Seats"}`,
  ];
  if (plan.code === "FREE_BASIC") {
    features.push(
      "Basis-Firmenprofil und Standard-Sichtbarkeit",
      "Bewerbungen per E-Mail oder Dashboard vorgesehen",
      "Kein Talent Radar, kein Premium-Analytics, keine inkludierten Boosts",
    );
  } else if (plan.code === "STARTER") {
    features.push(
      "Basis-Analytics",
      "Gleiche organische Rankingregeln wie Free",
      "Basisverifizierung bleibt in jedem Plan verfügbar und ist nicht kaufbar",
    );
  } else {
    features.push(
      rights.ENHANCED_COMPANY_PROFILE
        ? "Erweitertes Firmenprofil"
        : "Basis-Firmenprofil",
      `${analyticsLabel(rights.ANALYTICS_LEVEL)} Analytics`,
      rights.TALENT_RADAR_ACCESS
        ? `Talent Radar mit ${rights.TALENT_CONTACT_ALLOWANCE} Kontakten pro Monat`
        : "Talent Radar nicht enthalten",
      `${rights.JOB_BOOST_ALLOWANCE} klar gekennzeichnete Boost-Credits pro Monat`,
    );
    if (plan.code === "BUSINESS") {
      features.push("Import erst nach Quellenrechts-, Preview- und Aktivierungsgate");
    }
  }
  return features;
}

function analyticsLabel(level: "NONE" | "BASIC" | "ADVANCED" | "PRO") {
  if (level === "ADVANCED") return "Erweiterte";
  if (level === "PRO") return "Pro";
  if (level === "BASIC") return "Basis";
  return "Keine Premium";
}
