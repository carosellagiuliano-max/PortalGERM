import { afterEach, describe, expect, it, vi } from "vitest";

import nextConfigFactory from "@/next.config";

describe("mock checkout response headers", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is private, non-indexable and sends no referrer", async () => {
    vi.stubEnv("APP_ENV", "local");
    const entries = await nextConfigFactory("test").headers?.();
    const checkout = entries?.find(({ source }) => source === "/mock/checkout/:path*");

    expect(checkout?.headers).toEqual(
      expect.arrayContaining([
        { key: "Cache-Control", value: "private, no-store, max-age=0" },
        { key: "Referrer-Policy", value: "no-referrer" },
        {
          key: "X-Robots-Tag",
          value: "noindex, nofollow, noarchive, nosnippet",
        },
      ]),
    );
  });
});
