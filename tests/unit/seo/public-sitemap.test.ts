import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildPublicSitemap,
  PUBLIC_SITEMAP_STATIC_PATHS,
  PublicSitemapCapacityError,
  type PublicSitemapRow,
  type PublicSitemapSources,
} from "@/lib/seo/public-sitemap";

const NOW = new Date("2026-07-22T10:00:00.000Z");
const ORIGIN = "https://swisstalenthub.example";

const sourceMocks = {
  listJobs: vi.fn(),
  listCompanies: vi.fn(),
  listGuides: vi.fn(),
  listClusters: vi.fn(),
};

const sources = sourceMocks as unknown as PublicSitemapSources;
const database = {} as never;

function row(path: string, isoDate: string): PublicSitemapRow {
  return Object.freeze({ path, lastModified: new Date(isoDate) });
}

describe("Phase 15 public sitemap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sourceMocks.listJobs.mockResolvedValue([]);
    sourceMocks.listCompanies.mockResolvedValue([]);
    sourceMocks.listGuides.mockResolvedValue([]);
    sourceMocks.listClusters.mockResolvedValue([]);
  });

  it("publishes the production allowlist and every eligible dynamic type with row timestamps", async () => {
    sourceMocks.listJobs.mockResolvedValue([
      row("/jobs/pflegefachperson-acme-a1b2c3", "2026-07-21T08:00:00.000Z"),
    ]);
    sourceMocks.listCompanies.mockResolvedValue([
      row("/companies/acme-ag", "2026-07-20T08:00:00.000Z"),
    ]);
    sourceMocks.listGuides.mockResolvedValue([
      row("/guide/bewerbung-schweiz", "2026-07-19T08:00:00.000Z"),
    ]);
    sourceMocks.listClusters.mockResolvedValue([
      row(
        "/jobs/kanton/zuerich/kategorie/gesundheit-pflege",
        "2026-07-18T08:00:00.000Z",
      ),
      row("/jobs/kanton/zuerich", "2026-07-18T07:00:00.000Z"),
      row(
        "/jobs/kategorie/gesundheit-pflege",
        "2026-07-18T06:00:00.000Z",
      ),
    ]);

    const sitemap = await buildPublicSitemap({
      origin: ORIGIN,
      now: NOW,
      database,
      sources,
    });
    const paths = sitemap.map(({ url }) => new URL(url).pathname);

    expect(paths.slice(0, PUBLIC_SITEMAP_STATIC_PATHS.length)).toEqual(
      PUBLIC_SITEMAP_STATIC_PATHS,
    );
    expect(paths).toEqual([
      ...PUBLIC_SITEMAP_STATIC_PATHS,
      "/jobs/pflegefachperson-acme-a1b2c3",
      "/companies/acme-ag",
      "/guide/bewerbung-schweiz",
      "/jobs/kanton/zuerich/kategorie/gesundheit-pflege",
      "/jobs/kanton/zuerich",
      "/jobs/kategorie/gesundheit-pflege",
    ]);
    expect(paths).not.toContain("/employers/demo");
    expect(paths.some((path) => /^\/(?:admin|employer|candidate|api)(?:\/|$)/u.test(path))).toBe(false);
    expect(sitemap.at(PUBLIC_SITEMAP_STATIC_PATHS.length)).toMatchObject({
      lastModified: new Date("2026-07-21T08:00:00.000Z"),
      changeFrequency: "daily",
      priority: 0.8,
    });
  });

  it("passes one immutable clock and the exact remaining capacity to every source", async () => {
    await buildPublicSitemap({
      origin: ORIGIN,
      now: NOW,
      database,
      sources,
      maximumUrls: PUBLIC_SITEMAP_STATIC_PATHS.length + 2,
    });

    for (const loader of Object.values(sourceMocks)) {
      expect(loader).toHaveBeenCalledWith(
        expect.objectContaining({ getTime: expect.any(Function) }),
        database,
        2,
      );
      expect(loader.mock.calls[0]?.[0]).not.toBe(NOW);
      expect(loader.mock.calls[0]?.[0].getTime()).toBe(NOW.getTime());
    }
  });

  it("fails closed instead of truncating when a source exceeds the single-sitemap bound", async () => {
    sourceMocks.listJobs.mockImplementation(
      async (_now: Date, _database: never, maximumEntries: number) =>
        Array.from({ length: maximumEntries + 1 }, (_, index) =>
          row(`/jobs/test-company-${index}`, "2026-07-22T09:00:00.000Z")
        ),
    );

    await expect(
      buildPublicSitemap({
        origin: ORIGIN,
        now: NOW,
        database,
        sources,
        maximumUrls: PUBLIC_SITEMAP_STATIC_PATHS.length + 2,
      }),
    ).rejects.toBeInstanceOf(PublicSitemapCapacityError);
    expect(sourceMocks.listCompanies).not.toHaveBeenCalled();
  });

  it.each([
    ["job", "/admin/jobs/secret"],
    ["company", "/employer/company/private"],
    ["guide", "/guide/private?token=secret"],
    ["cluster", "/candidate/dashboard"],
  ] as const)("rejects a non-allowlisted %s path", async (kind, path) => {
    sourceMocks[
      kind === "job"
        ? "listJobs"
        : kind === "company"
        ? "listCompanies"
        : kind === "guide"
        ? "listGuides"
        : "listClusters"
    ].mockResolvedValue([row(path, "2026-07-22T09:00:00.000Z")]);

    await expect(
      buildPublicSitemap({ origin: ORIGIN, now: NOW, database, sources }),
    ).rejects.toThrow(`Invalid ${kind} sitemap path`);
  });

  it("rejects duplicate paths and invalid row timestamps instead of emitting ambiguous XML", async () => {
    sourceMocks.listJobs.mockResolvedValue([
      row("/jobs/duplicate-company-a1", "2026-07-22T09:00:00.000Z"),
      row("/jobs/duplicate-company-a1", "2026-07-22T09:01:00.000Z"),
    ]);

    await expect(
      buildPublicSitemap({ origin: ORIGIN, now: NOW, database, sources }),
    ).rejects.toThrow("Duplicate public sitemap path");

    sourceMocks.listJobs.mockResolvedValue([
      { path: "/jobs/invalid-clock-a1", lastModified: new Date("invalid") },
    ]);
    await expect(
      buildPublicSitemap({ origin: ORIGIN, now: NOW, database, sources }),
    ).rejects.toThrow("Invalid lastModified");
  });
});
