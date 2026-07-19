import { unstable_doesMiddlewareMatch as doesProxyMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import {
  config,
  CORRELATION_ID_HEADER,
  proxy,
} from "@/proxy";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("proxy", () => {
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

  it.each([
    ["/", true],
    ["/health/live", true],
    ["/unknown/path", true],
    ["/_next/static/chunk.js", false],
    ["/_next/image", false],
    ["/favicon.ico", false],
    ["/assets/logo.svg", false],
    ["/fonts/inter.woff2", false],
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
