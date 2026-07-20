import type { MetadataRoute } from "next";

import { getServerEnvironment } from "@/lib/config/env";
import { getPublicDataContext } from "@/lib/public/environment";

/** Phase-07 stub: dynamic/cluster URLs enter only after the Phase-15 SEO gate. */
export default function sitemap(): MetadataRoute.Sitemap {
  if (!getPublicDataContext().publicIndexingAllowed) return [];
  const origin = getServerEnvironment().APP_URL;
  return [
    { url: new URL("/", origin).toString(), changeFrequency: "daily", priority: 1 },
    { url: new URL("/jobs", origin).toString(), changeFrequency: "daily", priority: 0.9 },
  ];
}
