import type { NextConfig } from "next";
import {
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from "next/constants";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const baseSecurityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const noStorePrivateHeaders = [
  { key: "Cache-Control", value: "private, no-store, max-age=0" },
  {
    key: "X-Robots-Tag",
    value: "noindex, nofollow, noarchive, nosnippet",
  },
];

const resetPasswordHeaders = [
  { key: "Cache-Control", value: "no-store, max-age=0" },
  {
    key: "X-Robots-Tag",
    value: "noindex, nofollow, noarchive, nosnippet",
  },
  { key: "Referrer-Policy", value: "no-referrer" },
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

  const securityHeaders =
    process.env.APP_ENV === "production"
      ? [
          ...baseSecurityHeaders,
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ]
      : baseSecurityHeaders;

  return {
    outputFileTracingRoot: projectRoot,
    experimental: {
      authInterrupts: true,
    },
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
        {
          source: "/reset-password",
          headers: resetPasswordHeaders,
        },
        ...["candidate", "employer", "admin"].map((area) => ({
          source: `/${area}/:path*`,
          headers: noStorePrivateHeaders,
        })),
        {
          source: "/forbidden",
          headers: noStorePrivateHeaders,
        },
      ];
    },
  };
};

export default nextConfig;
