import type { Metadata } from "next";
import { CheckCircle2Icon, FilePenLineIcon } from "lucide-react";

import { MarketingCta } from "@/components/marketing/marketing-cta";
import { MarketingPageHero } from "@/components/marketing/marketing-page-hero";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FAIR_JOB_FACTOR_ORDER_V2,
  FAIR_JOB_FACTOR_POINTS_V2,
  FAIR_JOB_SCORE_VERSION,
} from "@/lib/scoring/fair-job-score";

export const metadata: Metadata = {
  title: "Transparentes Stelleninserat vorbereiten",
  description:
    "Den geplanten SwissTalentHub-Ablauf für strukturierte Stelleninserate und den Fair-Job-Score kennenlernen.",
  alternates: { canonical: "/employers/post-job" },
};

const workflow = [
  ["Grundlagen", "Titel, Arbeitsort, Pensum und Vertragsart strukturiert erfassen."],
  ["Aufgaben und Anforderungen", "Konkrete Verantwortungen und nachvollziehbare Anforderungen beschreiben."],
  ["Lohn und Arbeitsmodell", "Lohnspanne, Remote-Modell und weitere Rahmenbedingungen transparent machen."],
  ["Prozess prüfen", "Bewerbungsweg, benötigte Unterlagen und angestrebte Antwortzeit erklären."],
  ["Freigabe vorbereiten", "Inserat und Transparenzfaktoren vor einer späteren Publikation nochmals prüfen."],
] as const;

const factorLabels = {
  SALARY: "Lohnspanne",
  TASKS_REQUIREMENTS: "Aufgaben und Anforderungen",
  WORKLOAD_CONTRACT_START: "Pensum, Vertrag und Start",
  LOCATION_REMOTE: "Arbeitsort und Remote-Modell",
  APPLICATION_PROCESS: "Bewerbungsprozess",
  RESPONSE_TARGET: "Antwortziel",
  BENEFITS: "Konkrete Benefits",
  INCLUSION_CONTACT: "Inklusion und Kontakt",
  FRESHNESS: "Aktualität",
} as const satisfies Record<(typeof FAIR_JOB_FACTOR_ORDER_V2)[number], string>;

export default function PostJobMarketingPage() {
  return (
    <>
      <MarketingPageHero
        eyebrow="Inserat vorbereiten"
        title="Ein klarer Ablauf für ein transparentes Stelleninserat."
        description="Diese redaktionelle Übersicht zeigt den geplanten Pilotablauf. Sie ist kein interaktiver Jobeditor und erzeugt weder ein Inserat noch ein erfundenes Score-Ergebnis."
        primaryAction={{ href: "/register/employer", label: "Arbeitgeberkonto erstellen" }}
        secondaryAction={{ href: "/employers/demo?interest=general", label: "Ablauf besprechen" }}
      />

      <section className="border-y bg-muted/30 py-14 sm:py-18" aria-labelledby="post-job-workflow-title">
        <div className="page-shell">
          <p className="eyebrow">Fünf Schritte</p>
          <h2 id="post-job-workflow-title" className="mt-3 text-3xl font-semibold tracking-tight">
            Vom ersten Entwurf zur kontrollierten Freigabe.
          </h2>
          <ol className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-5">
            {workflow.map(([title, description], index) => (
              <li key={title} className="rounded-xl border bg-background p-5">
                <span className="grid size-9 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  {index + 1}
                </span>
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="page-shell py-14 sm:py-20" aria-labelledby="fair-score-marketing-title">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-start">
          <div>
            <FilePenLineIcon className="size-7 text-primary" aria-hidden="true" />
            <p className="eyebrow mt-5">Fair-Job-Score {FAIR_JOB_SCORE_VERSION}</p>
            <h2 id="fair-score-marketing-title" className="mt-3 text-3xl font-semibold tracking-tight">
              Vollständigkeit wird erklärbar – nicht käuflich.
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              Der Score bewertet die Transparenz eines Inserats anhand der versionierten
              Faktoren. Ein Boost verändert weder Punkte noch Fairnessbewertung.
            </p>
            <p className="mt-4 rounded-lg border bg-muted/30 p-4 text-sm leading-6 text-muted-foreground">
              Die Maximalpunkte zeigen die Gewichtung. Ein konkretes Inserat erhält Punkte
              nur, wenn die jeweilige Evidenzregel erfüllt ist.
            </p>
          </div>
          <Card>
            <CardHeader>
              <CardTitle as="h3">Faktoren und Maximalpunkte</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-1">
                {FAIR_JOB_FACTOR_ORDER_V2.map((factor) => (
                  <div
                    key={factor}
                    className="flex min-h-11 items-center justify-between gap-4 border-b py-2 last:border-b-0"
                  >
                    <dt className="flex items-center gap-2 text-sm">
                      <CheckCircle2Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                      {factorLabels[factor]}
                    </dt>
                    <dd className="shrink-0 font-semibold tabular-nums">
                      {FAIR_JOB_FACTOR_POINTS_V2[factor]} Punkte
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </div>
      </section>

      <MarketingCta
        eyebrow="Sicherer Einstieg"
        title="Zuerst einen Arbeitgeberzugang anlegen."
        description="Der aktuelle Einstieg erstellt einen persönlichen Zugang. Ein Jobeditor und eine Publikation werden nicht durch diese Marketingseite vorgetäuscht."
        href="/register/employer"
        action="Arbeitgeberkonto erstellen"
      />
    </>
  );
}
