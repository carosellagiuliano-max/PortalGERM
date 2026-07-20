import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";

import { JobGrid } from "@/components/public/job-grid";
import { JobSearchForm } from "@/components/public/job-search-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { getPublicCatalog, listPublicJobs } from "@/lib/jobs/public-read-model";
import { parsePublicJobSearchParams, publicJobSearchQuery, type RawPublicSearchParams } from "@/lib/public/query-params";

const JOBS_METADATA = Object.freeze({
  title: "Jobs suchen",
  description: "Faire und transparente Stellenangebote in der Schweiz durchsuchen.",
});

export async function generateMetadata({
  searchParams,
}: Readonly<{ searchParams: Promise<RawPublicSearchParams> }>): Promise<Metadata> {
  const input = parsePublicJobSearchParams(await searchParams);
  return {
    ...JOBS_METADATA,
    alternates: { canonical: "/jobs" },
    ...(hasActiveFilters(input)
      ? { robots: { index: false, follow: true, noarchive: true } }
      : {}),
  };
}

export default async function JobsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<RawPublicSearchParams> }>) {
  const input = parsePublicJobSearchParams(await searchParams);
  const [result, catalog] = await Promise.all([listPublicJobs(input), getPublicCatalog()]);

  return (
    <div className="page-shell py-12 sm:py-16">
      <p className="eyebrow">Stellensuche</p>
      <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">Finde deinen nächsten fairen Job.</h1>
      <p className="mt-4 max-w-3xl text-lg leading-8 text-muted-foreground">Filtere nach überprüfbaren Merkmalen. Personenbezogene Profildaten werden für die öffentliche Suche nicht geladen.</p>
      <div className="mt-8"><JobSearchForm input={input} catalog={catalog} /></div>
      {result.invalidCursor ? (
        <Alert className="mt-6"><AlertTitle>Der Seitenlink war nicht mehr gültig.</AlertTitle><AlertDescription>Wir zeigen dir sicherheitshalber wieder die erste Ergebnisseite.</AlertDescription></Alert>
      ) : null}
      <div className="mt-10 flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Publizierte Treffer</p>
          <h2 className="mt-1 text-2xl font-semibold">
            {result.resultCountIsExact
              ? `${result.totalEligible} Stellen`
              : "Trefferzahl nicht vollständig"}
          </h2>
        </div>
      </div>
      {result.candidateSetTruncated ? (
        <Alert className="mt-6">
          <AlertTitle>Die gefilterte Vorauswahl umfasst mehr als 2.000 Stellen.</AlertTitle>
          <AlertDescription>
            Für Suche und Sortierung werden höchstens 2.000 davon ausgewertet.
            Verfeinere die Filter, damit wir eine vollständige Trefferzahl anzeigen können.
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="mt-6"><JobGrid jobs={result.jobs} /></div>
      {result.nextCursor === null ? null : (
        <div className="mt-8 flex justify-center">
          <Link href={`/jobs${publicJobSearchQuery(input, { cursor: result.nextCursor })}`} className={buttonVariants({ variant: "outline", size: "lg" })}>Nächste Ergebnisse <ChevronRightIcon data-icon="inline-end" /></Link>
        </div>
      )}
    </div>
  );
}

function hasActiveFilters(input: ReturnType<typeof parsePublicJobSearchParams>) {
  return Boolean(
    input.keyword ||
      input.cantonSlugs.length ||
      input.citySlugs.length ||
      input.categorySlugs.length ||
      input.workloadMin !== undefined ||
      input.jobTypes.length ||
      input.remoteTypes.length ||
      input.languages.length ||
      input.efforts.length ||
      input.salaryMin !== undefined ||
      input.salaryDisclosedOnly ||
      input.responseEvidenceOnly ||
      input.companyVerifiedOnly ||
      input.sort !== "relevance" ||
      input.cursor,
  );
}
