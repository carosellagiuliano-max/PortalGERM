import { unstable_doesMiddlewareMatch as doesProxyMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  config,
  CORRELATION_ID_HEADER,
  proxy,
  TRUSTED_PATHNAME_HEADER,
  TRUSTED_SOURCE_IP_HEADER,
} from "@/proxy";
import {
  CONTENT_SECURITY_POLICY_HEADER,
  CONTENT_SECURITY_POLICY_NONCE_HEADER,
  isValidContentSecurityPolicyNonce,
} from "@/lib/security/content-security-policy";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("preserves a valid correlation ID on the request and response", () => {
    const correlationId = "0196f82d-3fb4-7f1a-8c9d-123456789abc";
    const request = new NextRequest("https://swisstalenthub.test/health/live", {
      headers: { [CORRELATION_ID_HEADER]: correlationId },
    });

    const response = proxy(request);

    expect(response.headers.get(CORRELATION_ID_HEADER)).toBe(correlationId);
    expect(
      response.headers.get(`x-middleware-request-${CORRELATION_ID_HEADER}`),
    ).toBe(correlationId);
    expect(response.headers.get("x-middleware-override-headers")).toContain(
      CORRELATION_ID_HEADER,
    );
    expect(
      response.headers.get(`x-middleware-request-${TRUSTED_PATHNAME_HEADER}`),
    ).toBe("/health/live");
    expect(
      response.headers.get(`x-middleware-request-${TRUSTED_SOURCE_IP_HEADER}`),
    ).toBe("127.0.0.1");
  });

  it("replaces an untrusted incoming value with a generated ID", () => {
    const attackerValue = "not-a-valid-correlation-id";
    const request = new NextRequest("https://swisstalenthub.test/", {
      headers: { [CORRELATION_ID_HEADER]: attackerValue },
    });

    const response = proxy(request);
    const correlationId = response.headers.get(CORRELATION_ID_HEADER);

    expect(correlationId).toMatch(UUID_PATTERN);
    expect(correlationId).not.toContain(attackerValue);
  });

  it("sets one matching nonce policy on the request and response", () => {
    const first = proxy(
      new NextRequest("https://swisstalenthub.test/jobs/example"),
    );
    const second = proxy(
      new NextRequest("https://swisstalenthub.test/jobs/example"),
    );
    const nonce = first.headers.get(
      `x-middleware-request-${CONTENT_SECURITY_POLICY_NONCE_HEADER}`,
    );
    const requestPolicy = first.headers.get(
      `x-middleware-request-${CONTENT_SECURITY_POLICY_HEADER}`,
    );
    const responsePolicy = first.headers.get(
      CONTENT_SECURITY_POLICY_HEADER,
    );
    const secondNonce = second.headers.get(
      `x-middleware-request-${CONTENT_SECURITY_POLICY_NONCE_HEADER}`,
    );

    expect(isValidContentSecurityPolicyNonce(nonce)).toBe(true);
    expect(requestPolicy).toBe(responsePolicy);
    expect(responsePolicy).toContain(`'nonce-${nonce}'`);
    expect(responsePolicy).toContain("'strict-dynamic'");
    expect(responsePolicy).not.toMatch(/script-src[^;]*'unsafe-inline'/u);
    expect(secondNonce).not.toBe(nonce);
  });

  it("overwrites attacker-supplied nonce and policy headers", () => {
    const response = proxy(
      new NextRequest("https://swisstalenthub.test/", {
        headers: {
          [CONTENT_SECURITY_POLICY_NONCE_HEADER]: "attacker-nonce",
          [CONTENT_SECURITY_POLICY_HEADER]: "script-src *",
        },
      }),
    );
    const nonce = response.headers.get(
      `x-middleware-request-${CONTENT_SECURITY_POLICY_NONCE_HEADER}`,
    );
    const requestPolicy = response.headers.get(
      `x-middleware-request-${CONTENT_SECURITY_POLICY_HEADER}`,
    );

    expect(isValidContentSecurityPolicyNonce(nonce)).toBe(true);
    expect(nonce).not.toBe("attacker-nonce");
    expect(requestPolicy).toContain(`'nonce-${nonce}'`);
    expect(requestPolicy).not.toContain("script-src *");
  });

  it("redirects anonymous private requests and preserves the intended local path", () => {
    const request = new NextRequest(
      "https://swisstalenthub.test/employer/dashboard?tab=team",
    );

    const response = proxy(request);

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe("https://swisstalenthub.test");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe(
      "/employer/dashboard?tab=team",
    );
    expect(response.headers.get(CONTENT_SECURITY_POLICY_HEADER)).toContain(
      "'strict-dynamic'",
    );
  });

  it("uses cookie shape only as an optimistic private-route check", () => {
    const request = new NextRequest(
      "https://swisstalenthub.test/candidate/dashboard?tab=profile",
      { headers: { cookie: `session=${"A".repeat(43)}` } },
    );

    const response = proxy(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(
      response.headers.get(`x-middleware-request-${TRUSTED_PATHNAME_HEADER}`),
    ).toBe("/candidate/dashboard?tab=profile");
  });

  it("clears a malformed private-route session cookie before redirecting", () => {
    const request = new NextRequest("https://swisstalenthub.test/admin", {
      headers: { cookie: "session=attacker-controlled" },
    });

    const response = proxy(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("set-cookie")).toContain("session=");
    expect(response.headers.get("set-cookie")).toContain(
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    );
  });

  it("overwrites spoofed internal headers and resolves only the configured proxy hop", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    const request = new NextRequest("https://swisstalenthub.test/", {
      headers: {
        [TRUSTED_PATHNAME_HEADER]: "/admin",
        [TRUSTED_SOURCE_IP_HEADER]: "192.0.2.250",
        "x-forwarded-for": "198.51.100.10, 203.0.113.5",
      },
    });

    const response = proxy(request);

    expect(
      response.headers.get(`x-middleware-request-${TRUSTED_PATHNAME_HEADER}`),
    ).toBe("/");
    expect(
      response.headers.get(`x-middleware-request-${TRUSTED_SOURCE_IP_HEADER}`),
    ).toBe("203.0.113.5");
  });

  it("falls back safely for invalid or insufficient forwarded IP chains", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "3");
    const request = new NextRequest("https://swisstalenthub.test/", {
      headers: { "x-forwarded-for": "not-an-ip, 203.0.113.5" },
    });

    const response = proxy(request);

    expect(
      response.headers.get(`x-middleware-request-${TRUSTED_SOURCE_IP_HEADER}`),
    ).toBe("127.0.0.1");
  });

  it.each([
    ["/", true],
    ["/health/live", true],
    ["/unknown/path", true],
    ["/_next/static/chunk.js", false],
    ["/_next/image", false],
    ["/favicon.ico", false],
    ["/assets/logo.svg", true],
    ["/fonts/inter.woff2", true],
    ["/unknown.js", true],
  ] as const)("matches %s: %s", (url: string, expected: boolean) => {
    expect(
      doesProxyMatch({
        config,
        nextConfig: {},
        url,
      }),
    ).toBe(expected);
  });
});
