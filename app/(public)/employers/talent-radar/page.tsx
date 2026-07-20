import type { Metadata } from "next";
import { CheckCircle2Icon, EyeOffIcon, MessageCircleQuestionIcon, ShieldCheckIcon } from "lucide-react";

import { MarketingCta } from "@/components/marketing/marketing-cta";
import { MarketingPageHero } from "@/components/marketing/marketing-page-hero";
import { TalentRadarPreview } from "@/components/marketing/talent-radar-preview";

export const metadata: Metadata = {
  title: "Talent Radar für Arbeitgeber",
  description:
    "Das geplante, kandidatenkontrollierte Talent-Radar-Modell mit anonymen Opt-in-Profilen und getrenntem Identitäts-Reveal verstehen.",
  alternates: { canonical: "/employers/talent-radar" },
};

const steps = [
  {
    icon: CheckCircle2Icon,
    title: "Freiwilliges Opt-in",
    text: "Nur vollständig vorbereitete Profile mit ausdrücklicher aktueller Einwilligung können später in die anonyme Suche gelangen.",
  },
  {
    icon: EyeOffIcon,
    title: "Anonyme Orientierung",
    text: "Arbeitgeber sehen ausschliesslich einen begrenzten, serverseitig freigegebenen Datensatz – keine direkte Identität und keine CV-Datei.",
  },
  {
    icon: MessageCircleQuestionIcon,
    title: "Kontaktanfrage",
    text: "Ein berechtigtes Unternehmen kann nach Firmen-, Entitlement- und Credit-Prüfung eine kontextbezogene Anfrage stellen.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Separate Freigabe",
    text: "Nach Annahme bleibt die Identität geschützt, bis die Kandidatin oder der Kandidat vorgesehene Felder bewusst freigibt.",
  },
] as const;

export default function TalentRadarMarketingPage() {
  return (
    <>
      <MarketingPageHero
        eyebrow="Talent Radar"
        title="Anonyme Talente entdecken – ohne die Kontrolle der Kandidat:innen zu umgehen."
        description="Talent Radar ist als gesperrter, späterer Arbeitgeberworkflow vorbereitet. Kontakt-Credits allein gewähren weder Suchzugriff noch Identität. Die operative Freigabe folgt erst nach den vorgesehenen Produkt-, Firmen- und Privacy-Gates."
        primaryAction={{ href: "/pricing", label: "Pläne ansehen" }}
        secondaryAction={{ href: "/employers/demo?interest=pro", label: "Interesse anmelden" }}
      />

      <section className="border-y bg-muted/30 py-14 sm:py-18" aria-labelledby="radar-process-title">
        <div className="page-shell">
          <p className="eyebrow">Privacy by default</p>
          <h2 id="radar-process-title" className="mt-3 text-3xl font-semibold tracking-tight">
            Vier getrennte Schutzschritte.
          </h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map(({ icon: Icon, title, text }) => (
              <article key={title} className="rounded-xl border bg-background p-5">
                <Icon className="size-6 text-primary" aria-hidden="true" />
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="page-shell py-14 sm:py-20" aria-labelledby="radar-preview-title">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:items-center">
          <div>
            <p className="eyebrow">Gesperrte Vorschau</p>
            <h2 id="radar-preview-title" className="mt-3 text-3xl font-semibold tracking-tight">
              Das UI erklärt die Grenze, bevor es Zugriff verspricht.
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              Pro und Business enthalten Talent-Radar-Entitlements als Kataloghypothese.
              Contact Packs sind nur Add-ons für bereits berechtigte Firmen und schalten
              die Suche nicht frei.
            </p>
          </div>
          <TalentRadarPreview />
        </div>
      </section>

      <MarketingCta
        eyebrow="Kataloghypothese"
        title="Talent Radar ist in Pro und Business vorgesehen."
        description="Die Preisübersicht erklärt Kontingente und bewusste Grenzen. Ein Checkout oder Radarzugriff wird in dieser Phase nicht angeboten."
        href="/pricing"
        action="Pricing öffnen"
      />
    </>
  );
}
