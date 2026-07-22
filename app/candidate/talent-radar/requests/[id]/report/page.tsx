import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ReportForm } from "@/components/public/report-form";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import { getCandidateRadarRequest } from "@/lib/talentradar/candidate-request-view";

export const metadata: Metadata = {
  title: "Firma aus Kontaktanfrage melden",
  robots: { index: false, follow: false, noarchive: true },
};
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function CandidateRadarRequestReportPage({ params }: PageProps) {
  const user = await requireCandidatePage();
  const { id } = await params;
  const request = await getCandidateRadarRequest(getDatabase(), user.id, id);
  if (request === null) notFound();

  return (
    <section aria-labelledby="report-company-title" className="grid max-w-3xl gap-7">
      <div>
        <Link
          href={`/candidate/talent-radar/requests/${request.id}`}
          className={buttonVariants({ variant: "ghost" })}
        >
          ← Zurück zur Kontaktanfrage
        </Link>
        <p className="eyebrow mt-5">Sicherheit</p>
        <h1
          id="report-company-title"
          className="mt-2 text-3xl font-semibold tracking-tight"
        >
          {request.company.name} melden
        </h1>
        <p className="mt-3 leading-7 text-muted-foreground">
          Beschreibe den Verdacht ohne zusätzliche sensible persönliche Daten.
          Die Meldung ändert deine Kontakt- oder Identitätsfreigabe nicht.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Missbrauchsmeldung</CardTitle>
        </CardHeader>
        <CardContent>
          <ReportForm targetType="COMPANY" slug={request.company.slug} />
        </CardContent>
      </Card>
    </section>
  );
}

type PageProps = Readonly<{ params: Promise<{ id: string }> }>;
