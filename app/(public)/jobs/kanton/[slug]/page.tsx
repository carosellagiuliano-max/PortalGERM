import type { Metadata } from "next";

import { JobClusterPage } from "@/components/public/job-cluster-page";

export async function generateMetadata({ params }: Readonly<{ params: Promise<{ slug: string }> }>): Promise<Metadata> {
  const { slug } = await params;
  return { title: "Jobs nach Kanton", alternates: { canonical: `/jobs/kanton/${slug}` }, robots: { index: false, follow: true } };
}

export default async function CantonJobsPage({ params }: Readonly<{ params: Promise<{ slug: string }> }>) {
  const { slug } = await params;
  return <JobClusterPage kind="canton" slug={slug} />;
}
