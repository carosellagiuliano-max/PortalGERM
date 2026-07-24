import type { Metadata } from "next";

import { SalaryRadarForm } from "@/components/public/salary-radar-form";
import { getPublicCatalog } from "@/lib/jobs/public-read-model";
import { getPublicDataContext } from "@/lib/public/environment";

export function generateMetadata(): Metadata {
  const liveOnly = getPublicDataContext().liveOnly;
  return {
    title: liveOnly ? "Lohn-Radar in Vorbereitung" : "Lohn-Radar",
    description: liveOnly
      ? "Der Schweizer Lohn-Radar bleibt bis zur fachlichen Freigabe einer geeigneten LIVE-Datenquelle ohne Werte."
      : "Nachvollziehbare Demo-Lohnbänder nach Kategorie, Kanton, Seniorität und Pensum einordnen.",
    alternates: { canonical: "/salary-radar" },
    robots: {
      index: false,
      follow: true,
      noarchive: true,
      nosnippet: true,
    },
  };
}
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function SalaryRadarPage() {
  const dataContext = getPublicDataContext();
  if (dataContext.liveOnly) {
    return (
      <div className="page-shell py-12 sm:py-16">
        <p className="eyebrow">Lohn-Radar</p>
        <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          Schweizer Lohnorientierung ist in Vorbereitung.
        </h1>
        <div
          className="mt-6 max-w-3xl rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-950"
          role="status"
        >
          Für den LIVE-Betrieb ist noch kein fachlich freigegebener,
          versionierter Lohndatensatz aktiv. Bis Quelle, Berufsgruppen- und
          Regionsmapping, Datenstand sowie Methodik geprüft sind, zeigen wir
          bewusst keine Lohnwerte.
        </div>
      </div>
    );
  }

  const catalog = await getPublicCatalog();
  return (
    <div className="page-shell py-12 sm:py-16">
      <p className="eyebrow">Lohn-Radar</p>
      <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">Ordne deinen Lohn nachvollziehbar ein.</h1>
      <p className="mt-4 max-w-3xl text-lg leading-8 text-muted-foreground">Wir zeigen nur vorab berechnete, geprüfte Bänder mit genügend grosser Stichprobe. Dünne Daten werden nicht zusammengemischt oder als präzise Werte ausgegeben.</p>
      <div className="mt-8"><SalaryRadarForm catalog={catalog} /></div>
    </div>
  );
}
