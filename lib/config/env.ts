import "server-only";

import {
  getSafeEnvironmentSummary,
  parseEnvironment,
  type ServerEnvironment,
} from "@/lib/config/env-schema";

let cachedEnvironment: ServerEnvironment | undefined;

export function getServerEnvironment() {
  cachedEnvironment ??= parseEnvironment(process.env);
  return cachedEnvironment;
}

export function getPublicEnvironment() {
  return getSafeEnvironmentSummary(getServerEnvironment());
}
