import type { ServerEnvironment } from "@/lib/config/env-schema";

type AdminRuntimeEnvironment = Pick<
  ServerEnvironment,
  "ADMIN_MFA_REQUIRED" | "APP_ENV"
>;

export type AdminRuntimeDecisionV1 =
  | Readonly<{ allowed: true }>
  | Readonly<{
      allowed: false;
      code: "PUBLIC_INGRESS_REQUIRES_MFA";
    }>;

/**
 * Local/CI can exercise the pre-cutover contract. Any network-reachable
 * environment keeps the whole Admin portal closed until the Phase-25 MFA
 * switch is deliberately activated; a password-only Admin session is never a
 * public fallback.
 */
export function decideAdminRuntimeAccess(
  environment: AdminRuntimeEnvironment,
): AdminRuntimeDecisionV1 {
  if (
    environment.APP_ENV !== "local" &&
    environment.APP_ENV !== "ci" &&
    !environment.ADMIN_MFA_REQUIRED
  ) {
    return Object.freeze({
      allowed: false,
      code: "PUBLIC_INGRESS_REQUIRES_MFA",
    });
  }
  return Object.freeze({ allowed: true });
}
