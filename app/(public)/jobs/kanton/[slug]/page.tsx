import type { Metadata } from "next";

import { JobClusterPage } from "@/components/public/job-cluster-page";
import { buildClusterMetadata } from "@/lib/seo/cluster-metadata";

export async function generateMetadata({ params, searchParams }: Readonly<{ params: Promise<{ slug: string }>; searchParams: Promise<ClusterSearchParams> }>): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  return buildClusterMetadata({ kind: "canton", cantonSlug: slug }, { hasPagination: hasQueryState(query) });
}

export default async function CantonJobsPage({ params, searchParams }: Readonly<{ params: Promise<{ slug: string }>; searchParams: Promise<ClusterSearchParams> }>) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  return <JobClusterPage kind="canton" cantonSlug={slug} after={boundedCursor(query.after)} />;
}

type ClusterSearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;

function boundedCursor(value: string | readonly string[] | undefined) { return typeof value === "string" && value.length <= 4_096 ? value : undefined; }
function hasQueryState(value: ClusterSearchParams) { return Object.values(value).some((entry) => entry !== undefined); }
