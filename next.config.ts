import type { NextConfig } from "next";
import {
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from "next/constants";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const localMailboxHeaders = [
  { key: "Cache-Control", value: "no-store" },
  {
    key: "X-Robots-Tag",
    value: "noindex, nofollow, noarchive, nosnippet",
  },
  { key: "Referrer-Policy", value: "no-referrer" },
];

const nextConfig = (phase: string): NextConfig => {
  if (
    process.env.ENABLE_LOCAL_MOCK_MAILBOX === "true" &&
    (phase === PHASE_PRODUCTION_BUILD ||
      phase === PHASE_PRODUCTION_SERVER ||
      process.env.APP_ENV === "staging" ||
      process.env.APP_ENV === "production")
  ) {
    throw new Error(
      "ENABLE_LOCAL_MOCK_MAILBOX must be false for production builds and production-like environments.",
    );
  }

  return {
    outputFileTracingRoot: projectRoot,
    turbopack: {
      root: projectRoot,
    },
    images: {
      remotePatterns: [],
    },
    async headers() {
      return [
        {
          source: "/(.*)",
          headers: securityHeaders,
        },
        {
          source: "/dev/mailbox",
          headers: localMailboxHeaders,
        },
      ];
    },
  };
};

export default nextConfig;
