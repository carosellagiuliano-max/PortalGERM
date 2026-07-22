import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronRightIcon } from "lucide-react";

import { JobGrid } from "@/components/public/job-grid";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import {
  emptyPublicJobSearchInput,
  listPublicJobs,
} from "@/lib/jobs/public-read-model";
import {
  loadPublicClusterLanding,
  type PublicClusterLanding,
} from "@/lib/seo/cluster-indexability";

type JobClusterPageProps =
  | Readonly<{ kind: "canton"; cantonSlug: string; after?: string }>
  | Readonly<{ kind: "category"; categorySlug: string; after?: string }>
  | Readonly<{
      kind: "pair";
      cantonSlug: string;
      categorySlug: string;
      after?: string;
    }>;

export async function JobClusterPage(props: JobClusterPageProps) {
  const landing = await loadPublicClusterLanding(toLandingInput(props));
  if (landing === null) notFound();
  if (requestedClusterPath(props) !== landing.canonicalPath) {
    const cursor = props.after === undefined
      ? ""
      : `?after=${encodeURIComponent(props.after)}`;
    redirect(`${landing.canonicalPath}${cursor}`);
  }
  const input = Object.freeze({
    ...emptyPublicJobSearchInput(),
    ...(landing.canton === null
      ? {}
      : { cantonSlugs: Object.freeze([landing.canton.slug]) }),
    ...(landing.category === null
      ? {}
      : { categorySlugs: Object.freeze([landing.category.slug]) }),
    ...(props.after === undefined ? {} : { after: props.after }),
    sort: "relevance" as const,
  });
  const result = await listPublicJobs(input, { pageSize: 20 });
  const fallback = fallbackCopy(landing);
  const title = landing.content?.title ?? fallback.title;
  const description = landing.content?.description ?? fallback.description;

  return (
    <div className="page-shell py-12 sm:py-16">
      <p className="eyebrow">Stellen entdecken</p>
      <h1 className="mt-3 max-w-4xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
        {title}
      </h1>
      <p className="mt-4 max-w-3xl text-lg leading-8 text-muted-foreground">
        {description}
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        {result.resultCountIsExact ? result.totalEligible : `Mindestens ${result.totalEligible}`} aktuell öffentlich berechtigte Stellen
      </p>
      <div className="mt-6">
        <Link href={filteredSearchHref(landing)} className={buttonVariants({ variant: "outline" })}>
          In der vollständigen Suche filtern
        </Link>
      </div>
      {result.invalidCursor ? (
        <Alert className="mt-6">
          <AlertTitle>Der Seitenlink war nicht mehr gültig.</AlertTitle>
          <AlertDescription>Die Liste wurde sicher auf der ersten Seite neu gestartet.</AlertDescription>
        </Alert>
      ) : null}
      <div className="mt-10"><JobGrid jobs={result.jobs} /></div>
      {result.jobs.length === 0 ? (
        <Alert className="mt-6">
          <AlertTitle>Zurzeit keine passende Stelle</AlertTitle>
          <AlertDescription>Die Seite bleibt hilfreich, wird aber erst nach erneuter Liquiditäts- und Inhaltsprüfung für Akquisition freigegeben.</AlertDescription>
        </Alert>
      ) : null}
      {result.nextCursor === null ? null : (
        <div className="mt-8 flex justify-center">
          <Link
            href={`${landing.canonicalPath}?after=${encodeURIComponent(result.nextCursor)}`}
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            Nächste Ergebnisse <ChevronRightIcon data-icon="inline-end" />
          </Link>
        </div>
      )}
      {landing.content === null ? null : (
        <section className="mt-14 max-w-4xl border-t pt-10" aria-labelledby="cluster-guide-heading">
          <h2 id="cluster-guide-heading" className="text-2xl font-semibold">Orientierung für deine Suche</h2>
          <div className="mt-5 grid gap-5 text-base leading-7 text-muted-foreground">
            {landing.content.paragraphs.map((paragraph, index) => (
              <p key={`${landing.content!.id}-${index}`}>{paragraph}</p>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function requestedClusterPath(props: JobClusterPageProps): string {
  if (props.kind === "canton") return `/jobs/kanton/${props.cantonSlug}`;
  if (props.kind === "category") return `/jobs/kategorie/${props.categorySlug}`;
  return `/jobs/kanton/${props.cantonSlug}/kategorie/${props.categorySlug}`;
}

function toLandingInput(props: JobClusterPageProps) {
  if (props.kind === "canton") {
    return { kind: props.kind, cantonSlug: props.cantonSlug } as const;
  }
  if (props.kind === "category") {
    return { kind: props.kind, categorySlug: props.categorySlug } as const;
  }
  return {
    kind: props.kind,
    cantonSlug: props.cantonSlug,
    categorySlug: props.categorySlug,
  } as const;
}

function filteredSearchHref(landing: PublicClusterLanding): string {
  const query = new URLSearchParams();
  if (landing.canton !== null) query.set("canton", landing.canton.slug);
  if (landing.category !== null) query.set("category", landing.category.slug);
  // Exact cluster-only state redirects back to an indexable clean landing.
  // An explicit organic sort makes this a genuine search view instead.
  query.set("sort", "newest");
  return `/jobs?${query.toString()}`;
}

function fallbackCopy(landing: PublicClusterLanding) {
  if (landing.kind === "pair") {
    return {
      title: `${landing.category!.name}-Jobs im Kanton ${landing.canton!.name}`,
      description: `Entdecke aktuell öffentlich berechtigte Stellen für ${landing.category!.name} im Kanton ${landing.canton!.name}. Diese Seite bleibt bis zur geprüften Content- und Liquiditätsfreigabe von der Indexierung ausgeschlossen.`,
    };
  }
  if (landing.kind === "canton") {
    return {
      title: `Jobs im Kanton ${landing.canton!.name}`,
      description: `Entdecke aktuell öffentlich berechtigte Stellen im Kanton ${landing.canton!.name}. Eine organische Freigabe erfolgt erst mit eigenem geprüftem Inhalt und mindestens einem freigegebenen Fachcluster.`,
    };
  }
  return {
    title: `Jobs in ${landing.category!.name}`,
    description: `Entdecke aktuell öffentlich berechtigte Stellen in ${landing.category!.name}. Eine organische Freigabe erfolgt erst mit eigenem geprüftem Inhalt und mindestens einem freigegebenen Kantonscluster.`,
  };
}
