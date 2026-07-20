// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  isValidAuthMutationOrigin,
  shouldUseSecureAuthCookies,
} from "@/lib/auth/request-context";

describe("auth mutation origin policy", () => {
  it("accepts the configured origin and the explicit local loopback alias", () => {
    expect(
      isValidAuthMutationOrigin({
        expectedOrigin: "https://swisstalenthub.test",
        origin: "https://swisstalenthub.test",
      }),
    ).toBe(true);
    expect(
      isValidAuthMutationOrigin({
        expectedOrigin: "http://127.0.0.1:3000",
        origin: "http://localhost:3000",
      }),
    ).toBe(true);
  });

  it("rejects missing, foreign, credentialed and wrong-port origins", () => {
    for (const origin of [
      null,
      "https://evil.example",
      "https://user:secret@swisstalenthub.test",
      "http://localhost:3001",
    ]) {
      expect(
        isValidAuthMutationOrigin({
          expectedOrigin: "http://127.0.0.1:3000",
          origin,
        }),
      ).toBe(false);
    }
  });

  it("keeps auth cookies insecure only for explicit local development", () => {
    expect(shouldUseSecureAuthCookies("local")).toBe(false);
    for (const appEnvironment of [
      "ci",
      "preview",
      "staging",
      "production",
    ] as const) {
      expect(shouldUseSecureAuthCookies(appEnvironment)).toBe(true);
    }
  });
});
