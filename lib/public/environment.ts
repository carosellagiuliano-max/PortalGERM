import "server-only";

import { getServerEnvironment } from "@/lib/config/env";

export type PublicDataContext = Readonly<{
  eligibilityEnvironment: "production" | "non-production";
  liveOnly: boolean;
  publicIndexingAllowed: boolean;
  showDemoBanner: boolean;
}>;

/**
 * Public demo data is deliberately limited to local, CI and preview runtimes,
 * and every such public render carries the persistent demo notice.
 * Staging follows the production visibility rule so a pre-production hostname
 * can never become a public demo-data leak by accident.
 */
export function getPublicDataContext(): PublicDataContext {
  const appEnvironment = getServerEnvironment().APP_ENV;
  const liveOnly = appEnvironment === "production" || appEnvironment === "staging";

  return Object.freeze({
    eligibilityEnvironment: liveOnly ? "production" : "non-production",
    liveOnly,
    publicIndexingAllowed: appEnvironment === "production",
    showDemoBanner:
      appEnvironment === "local" ||
      appEnvironment === "preview" ||
      appEnvironment === "ci",
  });
}
