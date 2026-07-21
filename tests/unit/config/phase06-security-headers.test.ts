import { afterEach, describe, expect, it, vi } from "vitest";

import nextConfigFactory from "@/next.config";

describe("Phase 06 security headers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("enables auth interrupts and keeps private/reset responses non-indexable", async () => {
    vi.stubEnv("APP_ENV", "local");
    const config = nextConfigFactory("test");
    const headers = await config.headers?.();

    expect(config.experimental?.authInterrupts).toBe(true);
    expect(headers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "/reset-password" }),
        expect.objectContaining({ source: "/invite/:path*" }),
        expect.objectContaining({ source: "/alerts/unsubscribe/:path*" }),
        expect.objectContaining({ source: "/candidate/:path*" }),
        expect.objectContaining({ source: "/employer/:path*" }),
        expect.objectContaining({ source: "/admin/:path*" }),
      ]),
    );
    const reset = headers?.find(({ source }) => source === "/reset-password");
    expect(reset?.headers).toEqual(
      expect.arrayContaining([
        { key: "Cache-Control", value: "no-store, max-age=0" },
        { key: "Referrer-Policy", value: "no-referrer" },
      ]),
    );
    const invite = headers?.find(({ source }) => source === "/invite/:path*");
    expect(invite?.headers).toEqual(
      expect.arrayContaining([
        { key: "Cache-Control", value: "private, no-store, max-age=0" },
        { key: "Referrer-Policy", value: "no-referrer" },
        {
          key: "X-Robots-Tag",
          value: "noindex, nofollow, noarchive, nosnippet",
        },
      ]),
    );
    const unsubscribe = headers?.find(
      ({ source }) => source === "/alerts/unsubscribe/:path*",
    );
    expect(unsubscribe?.headers).toEqual(
      expect.arrayContaining([
        { key: "Cache-Control", value: "no-store, max-age=0" },
        { key: "Referrer-Policy", value: "no-referrer" },
        {
          key: "X-Robots-Tag",
          value: "noindex, nofollow, noarchive, nosnippet",
        },
      ]),
    );
  });

  it("emits HSTS only when APP_ENV is production", async () => {
    vi.stubEnv("APP_ENV", "local");
    const localHeaders = await nextConfigFactory("test").headers?.();
    expect(globalSecurityHeaders(localHeaders)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "Strict-Transport-Security" }),
      ]),
    );

    vi.stubEnv("APP_ENV", "production");
    const productionHeaders = await nextConfigFactory("test").headers?.();
    expect(globalSecurityHeaders(productionHeaders)).toEqual(
      expect.arrayContaining([
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]),
    );
  });
});

function globalSecurityHeaders(
  entries: Awaited<ReturnType<NonNullable<ReturnType<typeof nextConfigFactory>["headers"]>>> | undefined,
) {
  return entries?.find(({ source }) => source === "/(.*)")?.headers ?? [];
}
