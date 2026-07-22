import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRightIcon } from "lucide-react";

import { JobGrid } from "@/components/public/job-grid";
import { JobSearchForm } from "@/components/public/job-search-form";
import { PublicSearchResultsAnalytics } from "@/components/analytics/public-job-analytics";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { getPublicCatalog } from "@/lib/jobs/public-read-model";
import { getPublicDataContext } from "@/lib/public/environment";
import {
  parsePublicJobSearchParams,
  publicJobSearchQuery,
  type RawPublicSearchParams,
} from "@/lib/public/query-params";
import {
  exactClusterFilterFromSearch,
  hasRawPublicJobQueryState,
} from "@/lib/seo/job-filter-landing";
import { loadPublicClusterLanding } from "@/lib/seo/cluster-indexability";
import { searchJobs } from "@/lib/search/query";

const JOBS_METADATA = Object.freeze({
  title: "Jobs suchen",
  description: "Faire und transparente Stellenangebote in der Schweiz durchsuchen.",
});

export async function generateMetadata({
  searchParams,
}: Readonly<{ searchParams: Promise<RawPublicSearchParams> }>): Promise<Metadata> {
  const raw = await searchParams;
  return {
    ...JOBS_METADATA,
    alternates: { canonical: "/jobs" },
    ...(hasRawPublicJobQueryState(raw)
      ? { robots: { index: false, follow: true, noarchive: true } }
      : {}),
  };
}

export default async function JobsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<RawPublicSearchParams> }>) {
  const raw = await searchParams;
  const input = parsePublicJobSearchParams(raw);
  const exactCluster = exactClusterFilterFromSearch(raw, input);
  if (exactCluster !== null && getPublicDataContext().publicIndexingAllowed) {
    const landing = await loadPublicClusterLanding(exactCluster);
    if (landing?.indexable) redirect(landing.canonicalPath);
  }
  const [result, catalog] = await Promise.all([searchJobs(input), getPublicCatalog()]);
  const formInput = Object.freeze({
    ...input,
    cantonSlugs: normalizeCatalogReferences(input.cantonSlugs, catalog.cantons),
    citySlugs: normalizeCatalogReferences(input.citySlugs, catalog.cities),
    categorySlugs: normalizeCatalogReferences(input.categorySlugs, catalog.categories),
  });
  const cantonCode = catalog.cantons.find(
    (canton) =>
      canton.slug === input.cantonSlugs[0] || canton.id === input.cantonSlugs[0],
  )?.code;
  const categorySlug = catalog.categories.some(
    (category) =>
      category.slug === input.categorySlugs[0] || category.id === input.categorySlugs[0],
  )
    ? formInput.categorySlugs[0]
    : undefined;

  return (
    <div className="page-shell py-12 sm:py-16">
      <PublicSearchResultsAnalytics
        resultCountBucket={resultCountBucket(result.totalEligible)}
        sort={input.sort}
        cantonCode={cantonCode}
        categorySlug={categorySlug}
      />
      <p className="eyebrow">Stellensuche</p>
      <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">Finde deinen nächsten fairen Job.</h1>
      <p className="mt-4 max-w-3xl text-lg leading-8 text-muted-foreground">Filtere nach überprüfbaren Merkmalen. Personenbezogene Profildaten werden für die öffentliche Suche nicht geladen.</p>
      <div className="mt-8"><JobSearchForm input={formInput} catalog={catalog} /></div>
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
      <div className="mt-6"><JobGrid jobs={result.jobs} /></div>
      {result.nextCursor === null ? null : (
        <div className="mt-8 flex justify-center">
          <Link href={`/jobs${publicJobSearchQuery(input, { after: result.nextCursor })}`} className={buttonVariants({ variant: "outline", size: "lg" })}>Nächste Ergebnisse <ChevronRightIcon data-icon="inline-end" /></Link>
        </div>
      )}
    </div>
  );
}

function resultCountBucket(
  count: number,
): "0" | "1-9" | "10-24" | "25-49" | "50+" {
  if (count === 0) return "0";
  if (count < 10) return "1-9";
  if (count < 25) return "10-24";
  if (count < 50) return "25-49";
  return "50+";
}

function normalizeCatalogReferences(
  references: readonly string[],
  entries: readonly Readonly<{ id: string; slug: string }>[],
): readonly string[] {
  return Object.freeze(references.map((reference) =>
    entries.find(({ id, slug }) => id === reference || slug === reference)?.slug ?? reference
  ));
}
