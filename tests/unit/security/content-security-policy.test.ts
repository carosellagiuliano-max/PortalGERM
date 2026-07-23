import { describe, expect, it } from "vitest";

import {
  buildContentSecurityPolicy,
  createContentSecurityPolicyNonce,
  isValidContentSecurityPolicyNonce,
} from "@/lib/security/content-security-policy";

describe("content security policy", () => {
  it("creates a fresh cryptographic nonce for every request", () => {
    const first = createContentSecurityPolicyNonce();
    const second = createContentSecurityPolicyNonce();

    expect(isValidContentSecurityPolicyNonce(first)).toBe(true);
    expect(isValidContentSecurityPolicyNonce(second)).toBe(true);
    expect(second).not.toBe(first);
  });

  it("allows only the reviewed production sources", () => {
    const nonce = "0123456789abcdef0123456789abcdef";
    const policy = buildContentSecurityPolicy(nonce);

    expect(policy).toContain(
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    );
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/u);
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).toContain("img-src 'self' data:");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toMatch(/https?:/u);
  });

  it("permits only development evaluation and websocket connections in development", () => {
    const policy = buildContentSecurityPolicy(
      "0123456789abcdef0123456789abcdef",
      { development: true },
    );

    expect(policy).toMatch(/script-src[^;]*'unsafe-eval'/u);
    expect(policy).toContain("connect-src 'self' ws: wss:");
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/u);
  });

  it("fails closed for attacker-controlled or missing nonces", () => {
    expect(() => buildContentSecurityPolicy("bad'; script-src *")).toThrow(
      "A valid per-request CSP nonce is required.",
    );
    expect(isValidContentSecurityPolicyNonce(undefined)).toBe(false);
  });
});
