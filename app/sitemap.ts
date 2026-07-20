import type { MetadataRoute } from "next";

import { getServerEnvironment } from "@/lib/config/env";
import { getPublicDataContext } from "@/lib/public/environment";

const PHASE_08_STATIC_PATHS = [
  "/",
  "/jobs",
  "/pricing",
  "/employers",
  "/employers/post-job",
  "/employers/talent-radar",
  "/employers/employer-branding",
  "/employers/xml-import",
  "/employers/demo",
] as const;

/** Stable static routes only; dynamic cluster URLs remain behind the Phase-15 SEO gate. */
export default function sitemap(): MetadataRoute.Sitemap {
  if (!getPublicDataContext().publicIndexingAllowed) return [];
  const origin = getServerEnvironment().APP_URL;
  return PHASE_08_STATIC_PATHS.map((path) => ({
    url: new URL(path, origin).toString(),
    changeFrequency: path === "/" || path === "/jobs" ? "daily" as const : "weekly" as const,
    priority: path === "/" ? 1 : path === "/jobs" ? 0.9 : path === "/pricing" ? 0.8 : 0.7,
  }));
}
