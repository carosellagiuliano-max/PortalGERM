import type { ServerEnvironment } from "@/lib/config/env-schema";
import { isIsolatedSandboxEnvironment } from "@/lib/config/application-environment";

export const LEGACY_MOCK_BILLING_POLICY_V1 = Object.freeze({
  allowedProviderMode: "disabled" as const,
  allowedEnvironments: Object.freeze(["local", "ci"] as const),
});

type LegacyMockBillingEnvironment = Pick<
  ServerEnvironment,
  "APP_ENV" | "PAYMENT_PROVIDER_MODE"
>;

/**
 * The historical checkout is an isolated test harness, never a payment
 * fallback. CI may use it only while the real payment composition is disabled.
 */
export function isLegacyMockBillingAllowed(
  environment: LegacyMockBillingEnvironment,
): boolean {
  return (
    isIsolatedSandboxEnvironment(environment.APP_ENV) &&
    environment.PAYMENT_PROVIDER_MODE ===
      LEGACY_MOCK_BILLING_POLICY_V1.allowedProviderMode
  );
}
