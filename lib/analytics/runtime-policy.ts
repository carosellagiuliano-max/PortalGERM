import type { ServerEnvironment } from "@/lib/config/env-schema";

export type ProductAnalyticsRuntimeProvenanceV1 = "DEMO" | "TEST";
export type AnonymousOperationalRuntimeProvenanceV1 =
  | ProductAnalyticsRuntimeProvenanceV1
  | "LIVE";

/**
 * Product-usage telemetry is available for local/preview verification only.
 * Production and staging stay fail-closed until the Phase-16 Privacy/Legal
 * launch decision provides a user-facing consent mechanism.
 */
export function isProductAnalyticsEnabledV1(
  appEnvironment: ServerEnvironment["APP_ENV"],
): boolean {
  return getProductAnalyticsRuntimeProvenanceV1(appEnvironment) !== null;
}

/**
 * Anonymous product events have no domain entity from which provenance can be
 * copied. Classify them conservatively by runtime so verification traffic can
 * never become LIVE data by omission.
 */
export function getProductAnalyticsRuntimeProvenanceV1(
  appEnvironment: ServerEnvironment["APP_ENV"],
): ProductAnalyticsRuntimeProvenanceV1 | null {
  switch (appEnvironment) {
    case "local":
    case "preview":
      return "DEMO";
    case "ci":
      return "TEST";
    case "staging":
    case "production":
      return null;
  }
}

/**
 * Essential events created without an authenticated/domain actor still need a
 * truthful provenance snapshot. Staging is verification traffic, while only
 * the production intake is classified as LIVE.
 */
export function getAnonymousOperationalRuntimeProvenanceV1(
  appEnvironment: ServerEnvironment["APP_ENV"],
): AnonymousOperationalRuntimeProvenanceV1 {
  switch (appEnvironment) {
    case "local":
    case "preview":
      return "DEMO";
    case "ci":
    case "staging":
      return "TEST";
    case "production":
      return "LIVE";
  }
}
