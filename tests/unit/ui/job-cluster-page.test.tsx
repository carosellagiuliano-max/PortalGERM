import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const readModel = vi.hoisted(() => ({
  listPublicJobs: vi.fn(),
  loadPublicClusterLanding: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (location: string) => {
    throw new Error(`NEXT_REDIRECT:${location}`);
  },
}));
vi.mock("@/components/public/job-grid", () => ({
  JobGrid: () => <div data-testid="job-grid" />,
}));
vi.mock("@/lib/jobs/public-read-model", () => ({
  emptyPublicJobSearchInput: () => ({
    cantonSlugs: [],
    categorySlugs: [],
    citySlugs: [],
    jobTypes: [],
    remoteTypes: [],
    languages: [],
    efforts: [],
    salaryDisclosedOnly: false,
    responseEvidenceOnly: false,
    companyVerifiedOnly: false,
    sort: "relevance",
    pageSize: 20,
    validationIssues: [],
  }),
  listPublicJobs: readModel.listPublicJobs,
}));
vi.mock("@/lib/seo/cluster-indexability", () => ({
  loadPublicClusterLanding: readModel.loadPublicClusterLanding,
}));

import { JobClusterPage } from "@/components/public/job-cluster-page";

describe("public job cluster page", () => {
  beforeEach(() => {
    readModel.listPublicJobs.mockReset();
    readModel.loadPublicClusterLanding.mockReset();
    readModel.listPublicJobs.mockResolvedValue({
      jobs: [],
      nextCursor: null,
      totalEligible: 2,
      resultCountIsExact: true,
      candidateSetTruncated: false,
      invalidCursor: false,
    });
  });

  it("renders reviewed pair content and exact filters", async () => {
    readModel.loadPublicClusterLanding.mockResolvedValue(landing({
      kind: "pair",
      canonicalPath: "/jobs/kanton/zuerich/kategorie/informatik",
      category: { id: "category-1", name: "Informatik", slug: "informatik" },
      content: {
        id: "content-1",
        title: "Informatik-Jobs in Zürich mit Substanz",
        description: "Geprüfte Orientierung für den regionalen Informatikmarkt.",
        paragraphs: ["Ein redaktionell geprüfter Absatz mit hilfreicher Orientierung."],
      },
      indexable: true,
    }));

    const markup = renderToStaticMarkup(await JobClusterPage({
      kind: "pair",
      cantonSlug: "zuerich",
      categorySlug: "informatik",
    }));

    expect(markup).toContain("Informatik-Jobs in Zürich mit Substanz");
    expect(markup).toContain("redaktionell geprüfter Absatz");
    expect(markup).toContain(
      "/jobs?canton=zuerich&amp;category=informatik&amp;sort=newest",
    );
    expect(readModel.listPublicJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        cantonSlugs: ["zuerich"],
        categorySlugs: ["informatik"],
        sort: "relevance",
      }),
      { pageSize: 20 },
    );
  });

  it("keeps a known but ungated Canton useful instead of returning 404", async () => {
    readModel.loadPublicClusterLanding.mockResolvedValue(landing({
      kind: "canton",
      canonicalPath: "/jobs/kanton/zuerich",
      content: null,
      indexable: false,
    }));

    const markup = renderToStaticMarkup(await JobClusterPage({
      kind: "canton",
      cantonSlug: "zuerich",
    }));

    expect(markup).toContain("Jobs im Kanton Zürich");
    expect(markup).toContain("Zurzeit keine passende Stelle");
    expect(markup).toContain("erneuter Liquiditäts- und Inhaltsprüfung");
  });

  it("returns 404 only for an unknown catalog slug", async () => {
    readModel.loadPublicClusterLanding.mockResolvedValue(null);

    await expect(
      JobClusterPage({ kind: "category", categorySlug: "unbekannt" }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("redirects direct UUID references to the clean canonical slug route", async () => {
    readModel.loadPublicClusterLanding.mockResolvedValue(landing({
      kind: "pair",
      canonicalPath: "/jobs/kanton/zuerich/kategorie/informatik",
      category: { id: "category-1", name: "Informatik", slug: "informatik" },
    }));

    await expect(JobClusterPage({
      kind: "pair",
      cantonSlug: "11111111-1111-4111-8111-111111111111",
      categorySlug: "22222222-2222-4222-8222-222222222222",
      after: "opaque-cursor",
    })).rejects.toThrow(
      "NEXT_REDIRECT:/jobs/kanton/zuerich/kategorie/informatik?after=opaque-cursor",
    );
    expect(readModel.listPublicJobs).not.toHaveBeenCalled();
  });
});

function landing(overrides: Record<string, unknown>) {
  return {
    kind: "canton",
    canonicalPath: "/jobs/kanton/zuerich",
    canton: { id: "canton-1", code: "ZH", name: "Zürich", slug: "zuerich" },
    category: null,
    content: null,
    indexable: false,
    activeAssessmentId: null,
    passingChildCount: 0,
    aggregateFacts: { kind: "dimension", passingChildCount: 0 },
    ...overrides,
  };
}
