import type { Metadata } from "next";

import { JobClusterPage } from "@/components/public/job-cluster-page";

export async function generateMetadata({ params }: Readonly<{ params: Promise<{ slug: string }> }>): Promise<Metadata> {
  const { slug } = await params;
  return { title: "Jobs nach Kategorie", alternates: { canonical: `/jobs/kategorie/${slug}` }, robots: { index: false, follow: true } };
}

export default async function CategoryJobsPage({ params }: Readonly<{ params: Promise<{ slug: string }> }>) {
  const { slug } = await params;
  return <JobClusterPage kind="category" slug={slug} />;
}
