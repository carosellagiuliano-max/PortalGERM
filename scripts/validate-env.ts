import { getSafeEnvironmentSummary, parseEnvironment } from "@/lib/config/env-schema";
import { loadLocalEnvironment } from "@/scripts/load-local-environment";

loadLocalEnvironment();

try {
  const environment = parseEnvironment(process.env);
  const summary = getSafeEnvironmentSummary(environment);
  console.info(
    `Environment valid for ${summary.appEnvironment}; checked schema, key lengths, rotation versions and safe runtime gates.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "Environment validation failed.");
  process.exitCode = 1;
}
