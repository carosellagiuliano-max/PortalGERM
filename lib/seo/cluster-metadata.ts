import "server-only";

import type { Metadata } from "next";

import { getPublicDataContext } from "@/lib/public/environment";
import { loadPublicClusterLanding } from "@/lib/seo/cluster-indexability";

type ClusterMetadataInput =
  | Readonly<{ kind: "canton"; cantonSlug: string }>
  | Readonly<{ kind: "category"; categorySlug: string }>
  | Readonly<{ kind: "pair"; cantonSlug: string; categorySlug: string }>;

export async function buildClusterMetadata(
  input: ClusterMetadataInput,
  options: Readonly<{ hasPagination?: boolean }> = {},
): Promise<Metadata> {
  const landing = await loadPublicClusterLanding(input);
  const canonical = landing?.canonicalPath ?? fallbackCanonical(input);
  const fallback = fallbackMetadata(input, landing);
  const title = landing?.content?.title ?? fallback.title;
  const baseDescription = landing?.content?.description ?? fallback.description;
  const factSummary = landing?.indexable
    ? aggregateFactSummary(landing)
    : null;
  const description = factSummary === null
    ? baseDescription
    : `${baseDescription} ${factSummary}`;
  const index = Boolean(
    getPublicDataContext().publicIndexingAllowed &&
    landing?.indexable &&
    !options.hasPagination,
  );
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: "website" },
    robots: index
      ? { index: true, follow: true }
      : { index: false, follow: true, noarchive: true },
  };
}

function aggregateFactSummary(
  landing: NonNullable<Awaited<ReturnType<typeof loadPublicClusterLanding>>>,
): string | null {
  const facts = landing.aggregateFacts;
  if (facts === null) return null;
  if (facts.kind === "dimension") {
    const noun = facts.passingChildCount === 1
      ? "freigegebener Fachcluster"
      : "freigegebene Fachcluster";
    return `Geprüfter Stand: ${facts.passingChildCount} ${noun}.`;
  }
  const responseRate = new Intl.NumberFormat("de-CH", {
    maximumFractionDigits: 1,
  }).format(facts.responseRateBasisPoints / 100);
  const evaluatedAt = new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Zurich",
  }).format(facts.evaluatedAt);
  return `Geprüfter Stand vom ${evaluatedAt}: ${facts.eligibleJobCount} Stellen, ${facts.activeEmployerCount} Arbeitgeber, ${facts.activeCandidateCount} aktive Kandidierende und ${responseRate}% fristgerechte Antworten.`;
}

function fallbackCanonical(input: ClusterMetadataInput): string {
  if (input.kind === "canton") return `/jobs/kanton/${input.cantonSlug}`;
  if (input.kind === "category") return `/jobs/kategorie/${input.categorySlug}`;
  return `/jobs/kanton/${input.cantonSlug}/kategorie/${input.categorySlug}`;
}

function fallbackMetadata(
  input: ClusterMetadataInput,
  landing: Awaited<ReturnType<typeof loadPublicClusterLanding>>,
) {
  if (input.kind === "pair") {
    const canton = landing?.canton?.name ?? "Kanton";
    const category = landing?.category?.name ?? "Kategorie";
    return {
      title: `${category}-Jobs im Kanton ${canton}`,
      description: `Öffentlich berechtigte Stellen für ${category} im Kanton ${canton}.`,
    };
  }
  if (input.kind === "canton") {
    const canton = landing?.canton?.name ?? "Kanton";
    return {
      title: `Jobs im Kanton ${canton}`,
      description: `Öffentlich berechtigte Stellen im Kanton ${canton}.`,
    };
  }
  const category = landing?.category?.name ?? "Kategorie";
  return {
    title: `Jobs in ${category}`,
    description: `Öffentlich berechtigte Stellen in ${category}.`,
  };
}
