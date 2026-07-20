import type { Metadata } from "next";

import { SalaryRadarForm } from "@/components/public/salary-radar-form";
import { getPublicCatalog } from "@/lib/jobs/public-read-model";

export const metadata: Metadata = {
  title: "Lohn-Radar",
  description: "Nachvollziehbare Schweizer Lohnbänder nach Kategorie, Kanton, Seniorität und Pensum einordnen.",
  alternates: { canonical: "/salary-radar" },
  robots: { index: false, follow: true },
};
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function SalaryRadarPage() {
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
