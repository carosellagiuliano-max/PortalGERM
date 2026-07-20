import type { Metadata } from "next";
import { CheckCircle2Icon, FileJson2Icon, FileSearchIcon, ShieldCheckIcon } from "lucide-react";

import { MarketingCta } from "@/components/marketing/marketing-cta";
import { MarketingPageHero } from "@/components/marketing/marketing-page-hero";

export const metadata: Metadata = {
  title: "XML- und JSON-Stellenimport",
  description:
    "Den geplanten, rechtebasierten XML-/JSON-Import mit Quellenprüfung, Preview und kontrollierter Freigabe kennenlernen.",
  alternates: { canonical: "/employers/xml-import" },
};

const supportedFields = [
  "ID",
  "Unternehmen",
  "Titel",
  "Arbeitsland",
  "PLZ",
  "Ort",
  "Kanton",
  "Beschreibung",
  "Anforderungen",
  "Angebot",
  "Kontakt",
  "Bewerbungs-URL",
  "Jobtyp",
  "Pensum min./max.",
  "Keywords",
] as const;

const safeguards = [
  {
    icon: ShieldCheckIcon,
    title: "Nutzungsgrundlage zuerst",
    text: "Eine Quelle benötigt dokumentierte Rechte. Fremde Portale werden weder gescrapt noch ungeprüft kopiert.",
  },
  {
    icon: FileSearchIcon,
    title: "Preview vor Übernahme",
    text: "Felder, Zuordnung und mögliche Konflikte werden vor einem späteren Draft-Commit geprüft.",
  },
  {
    icon: CheckCircle2Icon,
    title: "Keine Auto-Publikation",
    text: "Ein Import ersetzt weder Transparenzprüfung noch Moderation und publiziert Stellen nicht automatisch.",
  },
] as const;

export default function XmlImportMarketingPage() {
  return (
    <>
      <MarketingPageHero
        eyebrow="XML-/JSON-Import"
        title="Wiederkehrende Stellen strukturiert vorbereiten – mit Quellenrechten und Preview."
        description="Der betreute Import ist eine P1-Hypothese und in dieser Phase weder freigeschaltet noch kaufbar. Die Demo-Anfrage erfasst ausschliesslich Interesse; sie gewährt kein Import-Entitlement."
        primaryAction={{ href: "/employers/demo?interest=import", label: "Import besprechen" }}
        secondaryAction={{ href: "/pricing", label: "Pläne ansehen" }}
      />

      <section className="border-y bg-muted/30 py-14 sm:py-18" aria-labelledby="import-safeguards-title">
        <div className="page-shell">
          <p className="eyebrow">Kontrollierter Ablauf</p>
          <h2 id="import-safeguards-title" className="mt-3 text-3xl font-semibold tracking-tight">
            Ein Feed ist eine Quelle – keine Publikationsfreigabe.
          </h2>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {safeguards.map(({ icon: Icon, title, text }) => (
              <article key={title} className="rounded-xl border bg-background p-5">
                <Icon className="size-6 text-primary" aria-hidden="true" />
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="page-shell py-14 sm:py-20" aria-labelledby="import-fields-title">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.65fr)_minmax(0,1.35fr)] lg:items-start">
          <div>
            <FileJson2Icon className="size-7 text-primary" aria-hidden="true" />
            <p className="eyebrow mt-5">Vorgesehener Vertrag</p>
            <h2 id="import-fields-title" className="mt-3 text-3xl font-semibold tracking-tight">
              Unterstützte Felder der geplanten Schnittstelle.
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              Die Feldliste beschreibt den Zielvertrag. Sie verspricht noch keine aktive
              API, kein ATS und keinen automatischen Produktivbetrieb.
            </p>
          </div>
          <ul className="grid gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3" aria-label="Vorgesehene Importfelder">
            {supportedFields.map((field) => (
              <li key={field} className="flex min-h-11 items-center rounded-lg border bg-card px-3 text-sm font-medium">
                {field}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <MarketingCta
        eyebrow="Interest only"
        title="Importbedarf unverbindlich besprechen."
        description="Die Anfrage dokumentiert nur den Bedarf. CHF 750, Business-Zugang oder eine technische Aktivierung werden nicht als verfügbar dargestellt."
        href="/employers/demo?interest=import"
        action="Import besprechen"
      />
    </>
  );
}
