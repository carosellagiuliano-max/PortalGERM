import type { Metadata } from "next";
import { BriefcaseBusinessIcon, Building2Icon, ListChecksIcon } from "lucide-react";

import { EmployerBrandingPreview } from "@/components/marketing/employer-branding-preview";
import { MarketingCta } from "@/components/marketing/marketing-cta";
import { MarketingPageHero } from "@/components/marketing/marketing-page-hero";

export const metadata: Metadata = {
  title: "Erweitertes Arbeitgeberprofil",
  description:
    "Eine sichere, schematische Vorschau der modellierten Felder eines erweiterten SwissTalentHub-Arbeitgeberprofils.",
  alternates: { canonical: "/employers/employer-branding" },
};

export default function EmployerBrandingMarketingPage() {
  return (
    <>
      <MarketingPageHero
        eyebrow="Arbeitgeberprofil"
        title="Zeige Arbeitsumfeld und Benefits mit strukturierten, belegbaren Angaben."
        description="Das erweiterte Profil ist eine Kataloghypothese für berechtigte Pakete. Diese Seite zeigt nur modellierte Felder in einer klar beschrifteten schematischen Demo – keine echte Firma, keine erfundenen Mitarbeitendenstimmen und keine unbelegten Leistungswerte."
        primaryAction={{ href: "/pricing", label: "Pläne ansehen" }}
        secondaryAction={{ href: "/employers/demo?interest=pro", label: "Profil besprechen" }}
      />

      <section className="border-y bg-muted/30 py-14 sm:py-18" aria-labelledby="branding-value-title">
        <div className="page-shell grid gap-8 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:items-center">
          <div>
            <p className="eyebrow">Modellierte Profilfelder</p>
            <h2 id="branding-value-title" className="mt-3 text-3xl font-semibold tracking-tight">
              Mehr Kontext, ohne Belege zu erfinden.
            </h2>
            <ul className="mt-6 grid gap-4">
              <ProfilePoint
                icon={Building2Icon}
                title="Öffentliche Firmenidentität"
                text="Name, Branche, Grösse und Standort bleiben von privaten Owner- oder Membership-Daten getrennt."
              />
              <ProfilePoint
                icon={ListChecksIcon}
                title="Strukturierte Benefits"
                text="Nur vorgesehene, konkret gepflegte Benefits werden angezeigt; leere Felder erzeugen keine Platzhalterbehauptung."
              />
              <ProfilePoint
                icon={BriefcaseBusinessIcon}
                title="Öffentliche Stellen"
                text="Das Profil kann auf aktuell öffentlich geeignete Stellen verweisen, ohne interne Entwürfe offenzulegen."
              />
            </ul>
          </div>
          <EmployerBrandingPreview />
        </div>
      </section>

      <MarketingCta
        eyebrow="Erweitertes Profil"
        title="Premium-Felder sind in Pro und Business vorgesehen."
        description="Die Preisübersicht zeigt die versionierte Verpackung. Eine Profilberechtigung entsteht erst durch die spätere wirksame Entitlement-Freigabe."
        href="/pricing"
        action="Pricing öffnen"
      />
    </>
  );
}

function ProfilePoint({
  icon: Icon,
  title,
  text,
}: Readonly<{
  icon: typeof Building2Icon;
  title: string;
  text: string;
}>) {
  return (
    <li className="flex gap-3 rounded-xl border bg-background p-4">
      <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{text}</p>
      </div>
    </li>
  );
}
