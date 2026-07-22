import type { MetadataRoute } from "next";

import { getServerEnvironment } from "@/lib/config/env";
import { getPublicDataContext } from "@/lib/public/environment";
import { buildPublicSitemap } from "@/lib/seo/public-sitemap";

// Eligibility, launch approvals, revocations and expiries are time-sensitive.
// Never freeze this projection at build time or serve a stale cached sitemap.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Production-only sitemap assembled exclusively from canonical public gates. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!getPublicDataContext().publicIndexingAllowed) return [];
  return buildPublicSitemap({
    origin: getServerEnvironment().APP_URL,
    now: new Date(),
  });
}
