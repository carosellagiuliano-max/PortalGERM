// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  EnvironmentValidationError,
  parseEnvironment,
} from "@/lib/config/env-schema";
import {
  createHostedPaymentProvider,
  getHostedPaymentRuntime,
} from "@/lib/providers/payments/payment-composition";
import { createValidEnvironment } from "@/tests/fixtures/environment";

const STRIPE_COMMON = Object.freeze({
  STRIPE_ACCOUNT_ID: "acct_phase33merchant",
  STRIPE_SECRET_VERSION: "phase33-stripe-v1",
  STRIPE_WEBHOOK_SECRET: "whsec_phase33webhook",
});

describe("Phase-33 payment provider mode matrix", () => {
  it("accepts stripe_contract only in the isolated production-built CI runtime", () => {
    const environment = parseEnvironment(
      createValidEnvironment({
        APP_ENV: "ci",
        NODE_ENV: "production",
        DATABASE_URL:
          "postgresql://ci:ci-only@127.0.0.1:5435/swisstalenthub_ci?schema=public",
        TEST_DATABASE_URL:
          "postgresql://test:test-only@127.0.0.1:5435/swisstalenthub_test?schema=public",
        PAYMENT_PROVIDER_MODE: "stripe_contract",
        PAYMENT_SANDBOX_COHORT: "test",
        STRIPE_CONTRACT_ENDPOINT: "http://provider-contract:8080",
        STRIPE_SECRET_KEY: "sk_test_phase33contract",
        ...STRIPE_COMMON,
      }),
    );

    expect(getHostedPaymentRuntime(environment)).toMatchObject({
      adapterKey: "stripe_contract",
      activationMode: "ALLOWLIST",
      expectedLiveMode: false,
    });
    expect(createHostedPaymentProvider(environment).adapterKey).toBe(
      "stripe_contract",
    );
    expect(() =>
      parseEnvironment(
        createValidEnvironment({
          PAYMENT_PROVIDER_MODE: "stripe_contract",
          STRIPE_CONTRACT_ENDPOINT: "https://api.stripe.com",
          STRIPE_SECRET_KEY: "sk_test_phase33contract",
          ...STRIPE_COMMON,
        }),
      ),
    ).toThrow(EnvironmentValidationError);
  });

  it("accepts live only in production with live credentials and no contract endpoint", () => {
    const live = parseEnvironment(
      createValidEnvironment({
        APP_ENV: "production",
        NODE_ENV: "production",
        APP_URL: "https://swisstalenthub.example",
        TRUSTED_PROXY_HOPS: "2",
        TEST_DATABASE_URL: undefined,
        PAYMENT_PROVIDER_MODE: "stripe_live",
        STRIPE_SECRET_KEY: "sk_live_phase33production",
        ...STRIPE_COMMON,
      }),
    );
    expect(getHostedPaymentRuntime(live)).toMatchObject({
      adapterKey: "stripe_live",
      activationMode: "LIVE",
      expectedLiveMode: true,
    });

    expect(() =>
      parseEnvironment(
        createValidEnvironment({
          APP_ENV: "production",
          NODE_ENV: "production",
          APP_URL: "https://swisstalenthub.example",
          TRUSTED_PROXY_HOPS: "2",
          TEST_DATABASE_URL: undefined,
          PAYMENT_PROVIDER_MODE: "stripe_sandbox",
          STRIPE_SECRET_KEY: "sk_test_phase33sandbox",
          ...STRIPE_COMMON,
        }),
      ),
    ).toThrow(EnvironmentValidationError);
  });

  it("allows the full contract capability chain but never a secret-only activation", () => {
    expect(() =>
      parseEnvironment(
        createValidEnvironment({
          STRIPE_SECRET_KEY: "sk_test_phase33orphan",
          ...STRIPE_COMMON,
        }),
      ),
    ).toThrow(EnvironmentValidationError);

    expect(() =>
      parseEnvironment(
        createValidEnvironment({
          REAL_PAYMENT_INGESTION: "true",
        }),
      ),
    ).toThrow(EnvironmentValidationError);

    expect(() =>
      parseEnvironment(
        createValidEnvironment({
          APP_ENV: "ci",
          NODE_ENV: "production",
          DATABASE_URL:
            "postgresql://ci:ci-only@127.0.0.1:5435/swisstalenthub_ci?schema=public",
          TEST_DATABASE_URL:
            "postgresql://test:test-only@127.0.0.1:5435/swisstalenthub_test?schema=public",
          PAYMENT_PROVIDER_MODE: "stripe_contract",
          PAYMENT_SANDBOX_COHORT: "test",
          REAL_PAYMENT_INGESTION: "true",
          REAL_PAYMENT_PROJECTION: "true",
          PAID_SELF_SERVICE: "true",
          STRIPE_CONTRACT_ENDPOINT: "http://provider-contract:8080",
          STRIPE_SECRET_KEY: "sk_test_phase33contract",
          ...STRIPE_COMMON,
        }),
      ),
    ).not.toThrow();
  });
});
