import type { ServerEnvironment } from "@/lib/config/env-schema";

export type ApplicationEnvironment = ServerEnvironment["APP_ENV"];

/**
 * Deployment identity, deliberately kept separate from feature semantics.
 *
 * In particular, PUBLIC_PREVIEW may render labelled demo data but is not an
 * isolated sandbox and therefore must never inherit Local/CI provider rights.
 * The exhaustive switch makes a future APP_ENV addition a compile-time change
 * instead of silently assigning it an existing trust level.
 */
export type ApplicationEnvironmentClass =
  | "LOCAL_DEVELOPMENT"
  | "CI_VERIFICATION"
  | "PUBLIC_PREVIEW"
  | "CONTROLLED_STAGING"
  | "LIVE_PRODUCTION";

export function environmentClass(
  environment: ApplicationEnvironment,
): ApplicationEnvironmentClass {
  switch (environment) {
    case "local":
      return "LOCAL_DEVELOPMENT";
    case "ci":
      return "CI_VERIFICATION";
    case "preview":
      return "PUBLIC_PREVIEW";
    case "staging":
      return "CONTROLLED_STAGING";
    case "production":
      return "LIVE_PRODUCTION";
    default:
      return unsupportedApplicationEnvironment(environment);
  }
}

export function isIsolatedSandboxEnvironment(
  environment: ApplicationEnvironment,
): boolean {
  const classification = environmentClass(environment);
  return (
    classification === "LOCAL_DEVELOPMENT" ||
    classification === "CI_VERIFICATION"
  );
}

function unsupportedApplicationEnvironment(environment: never): never {
  throw new Error(
    `Unsupported application environment: ${String(environment)}`,
  );
}
