import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, ShieldCheckIcon } from "lucide-react";

import { OneTimeProductCard } from "@/components/marketing/one-time-product-card";
import { PricingCard } from "@/components/marketing/pricing-card";
import { PricingFaq } from "@/components/marketing/pricing-faq";
import { SuccessFeeCard } from "@/components/marketing/success-fee-card";
import { buttonVariants } from "@/components/ui/button";
import { canStartEmployerPlanChange } from "@/lib/billing/employer-read-model";
import { getPublicPricingCatalog } from "@/lib/billing/public-catalog";
import { getPrismaEffectiveEntitlements } from "@/lib/billing/prisma-publish-quota";
import { getEmployerContext } from "@/lib/auth/employer-context";
import { getDatabase } from "@/lib/db/client";

export const metadata: Metadata = {
  title: "Preise für Arbeitgeber",
  description: "Versionierte SwissTalentHub-Plan- und Produkthypothesen für Arbeitgeber transparent vergleichen.",
  alternates: { canonical: "/pricing" },
};
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PricingPage() {
  const now = new Date();
  const [catalog, employerContext] = await Promise.all([
    getPublicPricingCatalog(now),
    getEmployerContext(),
  ]);
  if (!catalog.ok) {
    return (
      <section className="page-shell py-20 text-center" aria-labelledby="pricing-unavailable-title">
        <p className="eyebrow">Katalogprüfung</p>
        <h1 id="pricing-unavailable-title" className="mt-3 text-4xl font-semibold">Preise momentan nicht verfügbar</h1>
        <p className="mx-auto mt-4 max-w-xl leading-7 text-muted-foreground">
          Die aktuellen Katalogversionen konnten nicht eindeutig bestätigt werden. Wir zeigen deshalb keine Ersatzpreise an.
        </p>
        <Link href="/employers/demo" className={buttonVariants({ variant: "outline", className: "mt-7" })}>
          Angebot besprechen
        </Link>
      </section>
    );
  }
  const current = employerContext?.current;
  const database = getDatabase();
  const [effective, canStartPlanChange] =
    current?.companyStatus === "ACTIVE"
      ? await Promise.all([
          getPrismaEffectiveEntitlements(current.companyId, now, database),
          canStartEmployerPlanChange(database, current.companyId, now),
        ])
      : ([null, false] as const);
  const signedIn =
    current === null || current === undefined || effective?.ok !== true
      ? employerContext === null
        ? null
        : {
            canManagePlan: false,
            canStartPlanChange: false,
            currentPlanCode: null,
          }
      : {
          canManagePlan: current.membershipRole === "OWNER",
          canStartPlanChange,
          currentPlanCode: effective.value.source.planSlug as
            | "FREE_BASIC"
            | "STARTER"
            | "PRO"
            | "BUSINESS"
            | "ENTERPRISE_CONTRACT",
        };
  const canBuyContactPack =
    current?.companyStatus === "ACTIVE" &&
    (current.membershipRole === "OWNER" || current.membershipRole === "ADMIN") &&
    effective?.ok === true &&
    effective.value.rights.TALENT_RADAR_ACCESS;

  return (
    <>
      <section className="page-shell py-16 text-center sm:py-24">
        <p className="eyebrow">Transparente Pakethypothesen</p>
        <h1 className="mx-auto mt-4 max-w-4xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          Wähle den Plan, der dein Recruiting wachsen lässt
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
          SwissTalentHub ist als Schweizer Recruiting-SaaS für transparente Stellen,
          erklärbare Grenzen und kontrollierte Arbeitgeberzugänge im Aufbau.
        </p>
        <div className="mt-6 inline-flex items-center gap-2 rounded-full border bg-muted/25 px-4 py-2 text-sm">
          <ShieldCheckIcon className="size-4 text-primary" aria-hidden="true" />
          Lokaler Mock-Checkout · keine echte Belastung oder automatische Verlängerung
        </div>
      </section>

      <section className="page-shell pb-16" aria-label="Arbeitgeberpläne">
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {catalog.value.plans.map((plan) => <PricingCard key={plan.code} plan={plan} signedIn={signedIn} />)}
        </div>
        <p className="mt-6 rounded-xl border bg-muted/25 p-4 text-sm leading-6 text-muted-foreground">
          {catalog.value.taxNotice.text}
        </p>
      </section>

      <section className="border-y bg-muted/30 py-16" aria-labelledby="products-title">
        <div className="page-shell">
          <p className="eyebrow">Einmalige Add-ons</p>
          <h2 id="products-title" className="mt-3 text-3xl font-semibold tracking-tight">
            Transparente einmalige Produkte mit klaren Freigabegrenzen.
          </h2>
          <p className="mt-4 max-w-3xl leading-7 text-muted-foreground">
            Die Katalogwerte stammen aus aktuell wirksamen ProductVersion-Snapshots.
            Contact Packs sind bei bestehendem Talent-Radar-Zugang im lokalen Mock kaufbar.
            Job-Boosts bleiben bis Phase 13 ausschliesslich an einer geeigneten eigenen Stelle auswählbar.
          </p>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {catalog.value.products.map((product) => (
              <OneTimeProductCard
                key={product.code}
                product={product}
                canBuyContactPack={canBuyContactPack}
                signedInEmployer={employerContext !== null}
              />
            ))}
            <SuccessFeeCard />
          </div>
        </div>
      </section>

      <section className="page-shell py-16 sm:py-20" aria-labelledby="pricing-faq-title">
        <p className="eyebrow">Häufige Fragen</p>
        <h2 id="pricing-faq-title" className="mt-3 text-3xl font-semibold">Vor dem Start verständlich geklärt.</h2>
        <div className="mt-8"><PricingFaq /></div>
      </section>

      <section className="page-shell pb-20">
        <div className="rounded-2xl bg-primary px-6 py-10 text-primary-foreground sm:px-10">
          <h2 className="text-3xl font-semibold">Noch unsicher, welcher Einstieg passt?</h2>
          <p className="mt-3 max-w-2xl leading-7 opacity-85">
            Eine Demo-Anfrage ist unverbindlich und löst weder Bestellung noch Subscription aus.
          </p>
          <Link href="/employers/demo" className={buttonVariants({ variant: "secondary", size: "lg", className: "mt-6" })}>
            Demo anfragen <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </>
  );
}
