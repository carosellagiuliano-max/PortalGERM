import { describe, expect, it } from "vitest";

import { isLegacyMockBillingAllowed } from "@/lib/billing/mock-billing-policy";

describe("legacy mock billing environment policy", () => {
  it.each(["local", "ci"] as const)(
    "allows an isolated %s runtime only with the provider disabled",
    (APP_ENV) => {
      expect(
        isLegacyMockBillingAllowed({
          APP_ENV,
          PAYMENT_PROVIDER_MODE: "disabled",
        }),
      ).toBe(true);
    },
  );

  it.each(["preview", "staging", "production"] as const)(
    "denies the historical mock in %s",
    (APP_ENV) => {
      expect(
        isLegacyMockBillingAllowed({
          APP_ENV,
          PAYMENT_PROVIDER_MODE: "disabled",
        }),
      ).toBe(false);
    },
  );

  it.each([
    "stripe_contract",
    "stripe_sandbox",
    "stripe_live",
  ] as const)("denies %s even in CI", (PAYMENT_PROVIDER_MODE) => {
    expect(
      isLegacyMockBillingAllowed({ APP_ENV: "ci", PAYMENT_PROVIDER_MODE }),
    ).toBe(false);
  });
});
