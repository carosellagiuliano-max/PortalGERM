import Link from "next/link";
import { notFound } from "next/navigation";

import { JobGrid } from "@/components/public/job-grid";
import { buttonVariants } from "@/components/ui/button";
import {
  emptyPublicJobSearchInput,
  getPublicCatalog,
  listPublicJobs,
  PUBLIC_CLUSTER_DISCOVERY_POLICY_V1,
} from "@/lib/jobs/public-read-model";

export async function JobClusterPage({
  kind,
  slug,
}: Readonly<{ kind: "canton" | "category"; slug: string }>) {
  const catalog = await getPublicCatalog();
  const item = kind === "canton"
    ? catalog.cantons.find((candidate) => candidate.slug === slug)
    : catalog.categories.find((candidate) => candidate.slug === slug);
  if (item === undefined) notFound();
  const input = Object.freeze({
    ...emptyPublicJobSearchInput(),
    ...(kind === "canton"
      ? { cantonSlugs: Object.freeze([slug]) }
      : { categorySlugs: Object.freeze([slug]) }),
    sort: "newest" as const,
  });
  const result = await listPublicJobs(input, { pageSize: 20 });
  if (
    result.totalEligible <
    PUBLIC_CLUSTER_DISCOVERY_POLICY_V1.minimumEligibleJobs
  ) notFound();

  const label = `Jobs in ${item.name}`;
  const query = kind === "canton" ? `canton=${encodeURIComponent(slug)}` : `category=${encodeURIComponent(slug)}`;
  return (
    <div className="page-shell py-12 sm:py-16">
      <p className="eyebrow">Stellen entdecken</p>
      <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">{label}</h1>
      <p className="mt-4 max-w-3xl text-lg leading-8 text-muted-foreground">
        {result.resultCountIsExact ? result.totalEligible : `Mindestens ${result.totalEligible}`} aktuell
        publizierte und öffentlich geprüfte Stellen. Vergleiche den
        nachvollziehbaren Fair-Job-Score und – wo belegt – transparente
        Lohnangaben, bevor du eine Stelle öffnest. Diese Übersichtsseite bleibt
        bis zur späteren SEO-Freigabe von Suchmaschinen ausgeschlossen.
      </p>
      <div className="mt-6"><Link href={`/jobs?${query}`} className={buttonVariants({ variant: "outline" })}>In der vollständigen Suche filtern</Link></div>
      <div className="mt-10"><JobGrid jobs={result.jobs} /></div>
    </div>
  );
}
