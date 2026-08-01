import { describe, expect, it } from "vitest";

import { decideAdminRuntimeAccess } from "@/lib/auth/admin-runtime-policy";

describe("Admin runtime activation policy", () => {
  it.each(["local", "ci"] as const)(
    "keeps the isolated %s verification contract available before cutover",
    (appEnvironment) => {
      expect(
        decideAdminRuntimeAccess({
          APP_ENV: appEnvironment,
          ADMIN_MFA_REQUIRED: false,
        } as never),
      ).toEqual({ allowed: true });
    },
  );

  it.each(["preview", "staging", "production"] as const)(
    "denies the entire Admin portal in %s while MFA is disabled",
    (appEnvironment) => {
      expect(
        decideAdminRuntimeAccess({
          APP_ENV: appEnvironment,
          ADMIN_MFA_REQUIRED: false,
        } as never),
      ).toEqual({
        allowed: false,
        code: "PUBLIC_INGRESS_REQUIRES_MFA",
      });
    },
  );

  it.each(["preview", "staging", "production"] as const)(
    "allows the existing AAL2 guard to take over in %s after explicit activation",
    (appEnvironment) => {
      expect(
        decideAdminRuntimeAccess({
          APP_ENV: appEnvironment,
          ADMIN_MFA_REQUIRED: true,
        } as never),
      ).toEqual({ allowed: true });
    },
  );
});
