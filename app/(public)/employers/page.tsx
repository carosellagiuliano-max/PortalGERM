import type { Metadata } from "next";
import {
  BadgeCheckIcon,
  Building2Icon,
  FilePlus2Icon,
  RadarIcon,
  ShieldCheckIcon,
  TimerResetIcon,
} from "lucide-react";

import { MarketingCta } from "@/components/marketing/marketing-cta";
import { MarketingFeatureCard } from "@/components/marketing/marketing-feature-card";
import { MarketingPageHero } from "@/components/marketing/marketing-page-hero";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Für Arbeitgeber",
  description:
    "SwissTalentHub als kontrollierten de-CH Pilot für transparente Stellen, faire Prozesse und kandidatenkontrollierte Kontakte kennenlernen.",
  alternates: { canonical: "/employers" },
};

const valueProps = [
  {
    icon: Building2Icon,
    title: "Sichtbarkeit mit Kontext",
    description:
      "Stellen erklären Lohn, Pensum, Arbeitsmodell und Prozess statt nur Reichweite zu versprechen.",
  },
  {
    icon: BadgeCheckIcon,
    title: "Faires Recruiting",
    description:
      "Der Fair-Job-Score bewertet Transparenz und ein erklärtes Antwortziel. Bezahlte Reichweite verändert ihn nicht.",
  },
  {
    icon: RadarIcon,
    title: "Talent Radar unter Kontrolle",
    description:
      "Ein geplanter Opt-in-Prozess trennt anonyme Orientierung, Kontaktanfrage und bewusste Identitätsfreigabe.",
  },
] as const;

const reasons = [
  {
    icon: ShieldCheckIcon,
    title: "Fair Hiring statt Black Box",
    description:
      "Lohn, Pensum, Arbeitsmodell, Prozess und Antwortziel werden als überprüfbare Inseratsangaben geführt.",
  },
  {
    icon: TimerResetIcon,
    title: "Antwortsignal nur mit Evidenz",
    description:
      "Ein öffentliches Antwortsignal ist erst vorgesehen, wenn aktuelle gemessene Daten die Aussage tragen. Der Mock zeigt kein erfundenes Badge.",
  },
  {
    icon: RadarIcon,
    title: "Anonymer Talentpool",
    description:
      "Kandidat:innen entscheiden per Opt-in über Sichtbarkeit, Kontakt und eine spätere Identitätsfreigabe.",
  },
  {
    icon: FilePlus2Icon,
    title: "Geführter Posting-Einstieg",
    description:
      "Der vorbereitete Ablauf erklärt die nötigen Transparenzfelder heute; der interaktive Editor folgt erst in Phase 10.",
  },
] as const;

export default function EmployersPage() {
  return (
    <>
      <MarketingPageHero
        eyebrow="Für Arbeitgeber"
        title="Bessere Bewerbungen. Faires Recruiting. Im kontrollierten de-CH Pilot."
        description="SwissTalentHub erprobt seinen Start in Zürich, Aargau und Bern für Pflege/Gesundheit sowie Engineering/Technik. Diese Cluster sind eine Launchhypothese im Aufbau – keine Behauptung nationaler Reichweite oder aktueller Marktliquidität."
        primaryAction={{ href: "/register/employer", label: "Kostenlos starten" }}
        secondaryAction={{ href: "/employers/demo", label: "Demo anfragen" }}
      />

      <section className="border-y bg-muted/30 py-14 sm:py-18" aria-labelledby="employer-value-title">
        <div className="page-shell">
          <p className="eyebrow">Wofür wir bauen</p>
          <h2 id="employer-value-title" className="mt-3 text-3xl font-semibold tracking-tight">
            Verständliche Entscheidungen auf beiden Seiten.
          </h2>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {valueProps.map(({ icon: Icon, title, description }) => (
              <Card key={title} className="h-full">
                <CardHeader>
                  <Icon className="size-6 text-primary" aria-hidden="true" />
                  <CardTitle as="h3" className="mt-3">{title}</CardTitle>
                  <CardDescription className="leading-6">{description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="page-shell py-14 sm:py-20" aria-labelledby="employer-reasons-title">
        <p className="eyebrow">Warum SwissTalentHub</p>
        <h2 id="employer-reasons-title" className="mt-3 text-3xl font-semibold tracking-tight">
          Fairness wird erklärt, gemessen und kontrolliert freigegeben.
        </h2>
        <p className="mt-4 max-w-3xl leading-7 text-muted-foreground">
          Diese Produktprinzipien beschreiben den vorgesehenen Pilot. Sie behaupten
          weder vorhandene Marktliquidität noch bereits gemessene Arbeitgeberleistung.
        </p>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {reasons.map(({ icon: Icon, title, description }) => (
            <MarketingFeatureCard
              key={title}
              icon={Icon}
              title={title}
              description={description}
            />
          ))}
        </div>
      </section>

      <section className="border-t bg-muted/20 py-14 sm:py-20" aria-labelledby="employer-capabilities-title">
        <div className="page-shell">
          <p className="eyebrow">Geplante Pilotabläufe</p>
          <h2 id="employer-capabilities-title" className="mt-3 text-3xl font-semibold tracking-tight">
            Vom transparenten Inserat bis zum kontrollierten Kontakt.
          </h2>
          <p className="mt-4 max-w-3xl leading-7 text-muted-foreground">
            Jede Seite unterscheidet bereits nutzbare Einstiege von Funktionen, deren
            operative Freigabe erst in einer späteren Produktphase erfolgt.
          </p>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <MarketingFeatureCard
              icon={FilePlus2Icon}
              title="Inserat vorbereiten"
              description="Den vorgesehenen Ablauf und die Transparenzfaktoren eines guten Inserats verstehen."
              href="/employers/post-job"
              action="Ablauf ansehen"
            />
            <MarketingFeatureCard
              icon={RadarIcon}
              title="Talent Radar"
              description="Nachvollziehen, wie Opt-in, anonyme Profile und kandidateninitiierte Freigaben zusammenspielen."
              href="/employers/talent-radar"
              action="Modell kennenlernen"
            />
            <MarketingFeatureCard
              icon={Building2Icon}
              title="Firmenprofil"
              description="Modellierte Profilfelder für Arbeitsumfeld, Benefits und öffentliche Stellen kennenlernen."
              href="/employers/employer-branding"
              action="Profilvorschau öffnen"
            />
            <MarketingFeatureCard
              icon={TimerResetIcon}
              title="Import besprechen"
              description="Den geplanten, rechtebasierten XML-/JSON-Prozess mit Preview und Freigabe einordnen."
              href="/employers/xml-import"
              action="Importweg ansehen"
            />
          </div>
        </div>
      </section>

      <section className="border-y bg-secondary/35 py-12" aria-labelledby="employer-trust-title">
        <div className="page-shell">
          <h2 id="employer-trust-title" className="sr-only">Vertrauensgrundsätze</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <TrustItem
              icon={ShieldCheckIcon}
              title="Datenschutzfreundlich vorbereitet"
              text="Keine Aussage vollständiger DSG- oder Produktionsreife ohne separate fachliche Abnahme."
            />
            <TrustItem
              icon={RadarIcon}
              title="Kandidatenkontrolle"
              text="Talentprofile bleiben standardmässig privat; eine Identitätsfreigabe ist ein eigener bewusster Schritt."
            />
            <TrustItem
              icon={BadgeCheckIcon}
              title="Keine Drittanbieter-Tracking-Pixel"
              text="Die öffentlichen Seiten des Mock-MVP verzichten auf unsichtbare Marketing-Pixel Dritter."
            />
          </div>
        </div>
      </section>

      <MarketingCta
        eyebrow="Nächster Schritt"
        title="Den Pilotbedarf gemeinsam einordnen."
        description="Eine Demo-Anfrage erfasst Interesse und Anforderungen. Sie löst weder einen Kauf noch eine garantierte Leistung aus."
        href="/employers/demo"
        action="Demo anfragen"
      />
    </>
  );
}

function TrustItem({
  icon: Icon,
  title,
  text,
}: Readonly<{
  icon: typeof ShieldCheckIcon;
  title: string;
  text: string;
}>) {
  return (
    <div className="rounded-xl border bg-background p-5">
      <Icon className="size-5 text-primary" aria-hidden="true" />
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
    </div>
  );
}
