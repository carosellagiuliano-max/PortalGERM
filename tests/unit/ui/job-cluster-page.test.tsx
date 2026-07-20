import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const readModel = vi.hoisted(() => ({
  listPublicJobs: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/components/public/job-grid", () => ({
  JobGrid: () => <div data-testid="job-grid" />,
}));
vi.mock("@/lib/jobs/public-read-model", () => ({
  PUBLIC_CLUSTER_DISCOVERY_POLICY_V1: { minimumEligibleJobs: 3 },
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
  }),
  getPublicCatalog: () => Promise.resolve({
    cantons: [{ id: "canton-1", code: "ZH", name: "Zürich", slug: "zuerich" }],
    cities: [],
    categories: [{ id: "category-1", name: "Informatik", slug: "informatik" }],
  }),
  listPublicJobs: readModel.listPublicJobs,
}));

import { JobClusterPage } from "@/components/public/job-cluster-page";

describe("public job cluster page", () => {
  it.each([
    ["canton" as const, "zuerich", "Jobs in Zürich"],
    ["category" as const, "informatik", "Jobs in Informatik"],
  ])("explains the transparency signals for a %s cluster", async (kind, slug, title) => {
    readModel.listPublicJobs.mockResolvedValue({
      jobs: [],
      nextCursor: null,
      totalEligible: 7,
      resultCountIsExact: true,
      candidateSetTruncated: false,
      invalidCursor: false,
    });

    const markup = renderToStaticMarkup(await JobClusterPage({ kind, slug }));

    expect(markup).toContain(title);
    expect(markup).toContain("Fair-Job-Score");
    expect(markup).toContain("transparente Lohnangaben");
    expect(markup).toContain("späteren SEO-Freigabe");
  });

  it("fails closed below the discovery threshold", async () => {
    readModel.listPublicJobs.mockResolvedValue({
      jobs: [],
      nextCursor: null,
      totalEligible: 2,
      resultCountIsExact: true,
      candidateSetTruncated: false,
      invalidCursor: false,
    });

    await expect(
      JobClusterPage({ kind: "canton", slug: "zuerich" }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
