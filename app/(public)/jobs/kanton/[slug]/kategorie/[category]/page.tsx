import type { Metadata } from "next";

import { JobClusterPage } from "@/components/public/job-cluster-page";
import { buildClusterMetadata } from "@/lib/seo/cluster-metadata";

type PairPageProps = Readonly<{
  params: Promise<{ slug: string; category: string }>;
  searchParams: Promise<ClusterSearchParams>;
}>;

export async function generateMetadata({ params, searchParams }: PairPageProps): Promise<Metadata> {
  const [{ slug, category }, query] = await Promise.all([params, searchParams]);
  return buildClusterMetadata(
    { kind: "pair", cantonSlug: slug, categorySlug: category },
    { hasPagination: hasQueryState(query) },
  );
}

export default async function CantonCategoryJobsPage({ params, searchParams }: PairPageProps) {
  const [{ slug, category }, query] = await Promise.all([params, searchParams]);
  return (
    <JobClusterPage
      kind="pair"
      cantonSlug={slug}
      categorySlug={category}
      after={boundedCursor(query.after)}
    />
  );
}

type ClusterSearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

function boundedCursor(value: string | readonly string[] | undefined) {
  return typeof value === "string" && value.length <= 4_096 ? value : undefined;
}

function hasQueryState(value: ClusterSearchParams) {
  return Object.values(value).some((entry) => entry !== undefined);
}
