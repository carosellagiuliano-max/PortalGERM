import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerEnvironment = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config/env", () => ({ getServerEnvironment }));

import robots, { PRIVATE_ROBOTS_PATHS } from "@/app/robots";

describe("robots metadata route", () => {
  beforeEach(() => {
    getServerEnvironment.mockReturnValue({
      APP_URL: "https://swisstalenthub.example",
    });
  });

  it("allows public crawling while excluding every private and API namespace", () => {
    expect(robots()).toEqual({
      rules: {
        userAgent: "*",
        allow: "/",
        disallow: PRIVATE_ROBOTS_PATHS,
      },
      sitemap: "https://swisstalenthub.example/sitemap.xml",
    });
  });
});
