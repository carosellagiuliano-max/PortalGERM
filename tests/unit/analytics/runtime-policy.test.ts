// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  getAnonymousOperationalRuntimeProvenanceV1,
  getProductAnalyticsRuntimeProvenanceV1,
  isProductAnalyticsEnabledV1,
} from "@/lib/analytics/runtime-policy";

describe("product analytics runtime policy V1", () => {
  it.each(["local", "preview", "ci"] as const)(
    "enables product analytics in %s",
    (appEnvironment) => {
      expect(isProductAnalyticsEnabledV1(appEnvironment)).toBe(true);
    },
  );

  it.each(["staging", "production"] as const)(
    "fails closed in %s until the privacy launch decision",
    (appEnvironment) => {
      expect(isProductAnalyticsEnabledV1(appEnvironment)).toBe(false);
    },
  );

  it.each([
    ["local", "DEMO"],
    ["preview", "DEMO"],
    ["ci", "TEST"],
    ["staging", null],
    ["production", null],
  ] as const)(
    "classifies anonymous %s events as %s",
    (appEnvironment, expected) => {
      expect(getProductAnalyticsRuntimeProvenanceV1(appEnvironment)).toBe(
        expected,
      );
    },
  );

  it.each([
    ["local", "DEMO"],
    ["preview", "DEMO"],
    ["ci", "TEST"],
    ["staging", "TEST"],
    ["production", "LIVE"],
  ] as const)(
    "classifies anonymous operational intake in %s as %s",
    (appEnvironment, expected) => {
      expect(getAnonymousOperationalRuntimeProvenanceV1(appEnvironment)).toBe(
        expected,
      );
    },
  );
});
