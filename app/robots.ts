import type { MetadataRoute } from "next";

import { getServerEnvironment } from "@/lib/config/env";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const PRIVATE_ROBOTS_PATHS = Object.freeze([
  "/candidate/",
  "/employer/",
  "/admin/",
  "/api/",
  "/reset-password",
  "/invite/",
  "/support/",
  "/alerts/unsubscribe/",
  "/mock/checkout/",
  "/dev/",
] as const);

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...PRIVATE_ROBOTS_PATHS],
    },
    sitemap: new URL("/sitemap.xml", getServerEnvironment().APP_URL).toString(),
  };
}
