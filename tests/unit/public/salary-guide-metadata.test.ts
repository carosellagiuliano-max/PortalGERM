// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  publicIndexingAllowed: false,
  liveOnly: false,
  getPublicCatalog: vi.fn(),
  getPublicGuideBySlug: vi.fn(),
  listRelatedPublicGuides: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/jobs/public-read-model", () => ({
  getPublicCatalog: mocks.getPublicCatalog,
}));
vi.mock("@/components/public/salary-radar-form", () => ({
  SalaryRadarForm: () => "SALARY_RADAR_FORM",
}));
vi.mock("@/lib/content/public-guides", () => ({
  getPublicGuideBySlug: mocks.getPublicGuideBySlug,
  listPublicGuides: vi.fn(),
  listRelatedPublicGuides: mocks.listRelatedPublicGuides,
}));
vi.mock("@/lib/public/environment", () => ({
  getPublicDataContext: () => ({
    publicIndexingAllowed: mocks.publicIndexingAllowed,
    liveOnly: mocks.liveOnly,
  }),
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

import {
  generateMetadata as generateGuideDetailMetadata,
  default as GuideDetailPage,
} from "@/app/(public)/guide/[slug]/page";
import { generateMetadata as generateGuideIndexMetadata } from "@/app/(public)/guide/page";
import SalaryRadarPage, {
  generateMetadata as generateSalaryRadarMetadata,
} from "@/app/(public)/salary-radar/page";

describe("Salary Radar and Guide indexing policy", () => {
  beforeEach(() => {
    mocks.publicIndexingAllowed = false;
    mocks.liveOnly = false;
    mocks.getPublicCatalog.mockReset().mockResolvedValue({});
    mocks.getPublicGuideBySlug.mockReset();
    mocks.listRelatedPublicGuides.mockReset();
    mocks.notFound.mockClear();
  });

  it("keeps the mock-only Salary Radar noindex while the Guide follows production indexing", () => {
    mocks.publicIndexingAllowed = true;

    expect(generateSalaryRadarMetadata()).toMatchObject({
      alternates: { canonical: "/salary-radar" },
      robots: {
        index: false,
        follow: true,
        noarchive: true,
        nosnippet: true,
      },
    });
    expect(generateGuideIndexMetadata()).toMatchObject({
      alternates: { canonical: "/guide" },
      robots: { index: true, follow: true },
    });

    mocks.publicIndexingAllowed = false;
    expect(generateSalaryRadarMetadata().robots).toEqual({
      index: false,
      follow: true,
      noarchive: true,
      nosnippet: true,
    });
    expect(generateGuideIndexMetadata().robots).toEqual({
      index: false,
      follow: false,
      noarchive: true,
      nosnippet: true,
    });
  });

  it("shows a fail-closed LIVE state without loading the fictional salary catalog", async () => {
    mocks.liveOnly = true;

    const html = renderToStaticMarkup(await SalaryRadarPage());

    expect(generateSalaryRadarMetadata()).toMatchObject({
      title: "Lohn-Radar in Vorbereitung",
      description: expect.stringContaining("ohne Werte"),
    });
    expect(html).toContain("noch kein fachlich freigegebener");
    expect(html).not.toContain("SALARY_RADAR_FORM");
    expect(mocks.getPublicCatalog).not.toHaveBeenCalled();
  });

  it("keeps the reviewed fictional form available in the labelled demo environment", async () => {
    const html = renderToStaticMarkup(await SalaryRadarPage());

    expect(html).toContain("SALARY_RADAR_FORM");
    expect(mocks.getPublicCatalog).toHaveBeenCalledOnce();
  });

  it("indexes only a canonical LIVE Guide returned by the reviewed public read path", async () => {
    mocks.publicIndexingAllowed = true;
    mocks.getPublicGuideBySlug.mockImplementation(async (slug: string) =>
      slug === "live-guide" ? guide("live-guide", "LIVE") :
      slug === "demo-guide" ? guide("demo-guide", "DEMO") : null);

    await expect(generateGuideDetailMetadata({
      params: Promise.resolve({ slug: "live-guide" }),
    })).resolves.toMatchObject({
      title: "Guide live-guide",
      alternates: { canonical: "/guide/live-guide" },
      robots: { index: true, follow: true },
    });
    await expect(generateGuideDetailMetadata({
      params: Promise.resolve({ slug: "demo-guide" }),
    })).resolves.toMatchObject({
      robots: {
        index: false,
        follow: false,
        noarchive: true,
        nosnippet: true,
      },
    });
  });

  it("keeps valid Guide content noindex outside production", async () => {
    mocks.publicIndexingAllowed = false;
    mocks.getPublicGuideBySlug.mockResolvedValue(guide("preview-guide", "LIVE"));

    await expect(generateGuideDetailMetadata({
      params: Promise.resolve({ slug: "preview-guide" }),
    })).resolves.toMatchObject({
      alternates: { canonical: "/guide/preview-guide" },
      robots: {
        index: false,
        follow: false,
        noarchive: true,
        nosnippet: true,
      },
    });
  });

  it("returns noindex metadata and the canonical page 404 for an ineligible Guide", async () => {
    mocks.publicIndexingAllowed = true;
    mocks.getPublicGuideBySlug.mockResolvedValue(null);
    const props = { params: Promise.resolve({ slug: "missing-guide" }) };

    await expect(generateGuideDetailMetadata(props)).resolves.toMatchObject({
      title: "Ratgeber nicht gefunden",
      robots: {
        index: false,
        follow: false,
        noarchive: true,
        nosnippet: true,
      },
    });
    await expect(GuideDetailPage(props)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.listRelatedPublicGuides).not.toHaveBeenCalled();
  });
});

function guide(slug: string, dataProvenance: "LIVE" | "DEMO") {
  return Object.freeze({
    id: `id-${slug}`,
    slug,
    canonicalPath: `/guide/${slug}`,
    title: `Guide ${slug}`,
    excerpt: "Geprüfter Ratgeber",
    body: "Erster Absatz.\n\nZweiter Absatz.",
    publishedAt: new Date("2026-07-20T12:00:00.000Z"),
    dataProvenance,
  });
}
