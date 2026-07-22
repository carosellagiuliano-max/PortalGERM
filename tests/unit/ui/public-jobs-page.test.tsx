import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const publicJobsData = vi.hoisted(() => ({
  getPublicCatalog: vi.fn(),
  searchJobs: vi.fn(),
}));
const loadPublicClusterLanding = vi.hoisted(() => vi.fn());
const getPublicDataContext = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() => vi.fn((path: string): never => {
  throw new Error(`NEXT_REDIRECT:${path}`);
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/public/environment", () => ({ getPublicDataContext }));
vi.mock("@/lib/seo/cluster-indexability", () => ({ loadPublicClusterLanding }));

vi.mock("@/lib/jobs/public-read-model", () => ({
  getPublicCatalog: publicJobsData.getPublicCatalog,
}));
vi.mock("@/lib/search/query", () => ({ searchJobs: publicJobsData.searchJobs }));

vi.mock("@/components/public/apply-save-actions", () => ({
  PublicJobActions: () => null,
}));

import JobsPage, { generateMetadata } from "@/app/(public)/jobs/page";

describe("public Jobs result-count disclosure", () => {
  beforeEach(() => {
    redirect.mockClear();
    loadPublicClusterLanding.mockReset();
    loadPublicClusterLanding.mockResolvedValue(null);
    getPublicDataContext.mockReset();
    getPublicDataContext.mockReturnValue({ publicIndexingAllowed: true });
    publicJobsData.getPublicCatalog.mockReset();
    publicJobsData.searchJobs.mockReset();
    publicJobsData.getPublicCatalog.mockResolvedValue({
      cantons: [],
      cities: [],
      categories: [],
    });
    publicJobsData.searchJobs.mockResolvedValue({
      jobs: [],
      nextCursor: null,
      totalEligible: 0,
      resultCountIsExact: true,
      candidateSetTruncated: false,
      invalidCursor: false,
    });
  });

  it("shows the numeric total only when the read model proves it is exact", async () => {
    render(await JobsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "0 Stellen" })).toBeInTheDocument();
    expect(screen.queryByText(/gefilterte Vorauswahl umfasst mehr/iu)).not.toBeInTheDocument();
  });

  it("shows invalid salary state and marks that URL as noindex", async () => {
    const searchParams = { salaryMin: "120000", sort: "salary" };

    render(await JobsPage({ searchParams: Promise.resolve(searchParams) }));
    const metadata = await generateMetadata({
      searchParams: Promise.resolve(searchParams),
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Wähle für Mindestlohn oder Lohnsortierung eine Lohnperiode.",
    );
    expect(metadata.robots).toEqual({
      index: false,
      follow: true,
      noarchive: true,
    });
  });

  it("noindexes every raw query state, including unknown or normalized-empty keys", async () => {
    await expect(generateMetadata({
      searchParams: Promise.resolve({ tracking: "opaque" }),
    })).resolves.toMatchObject({
      alternates: { canonical: "/jobs" },
      robots: { index: false, follow: true, noarchive: true },
    });
    await expect(generateMetadata({
      searchParams: Promise.resolve({ sort: "" }),
    })).resolves.toMatchObject({
      robots: { index: false, follow: true, noarchive: true },
    });
  });

  it("redirects an exact filter only when its reviewed landing is indexable", async () => {
    loadPublicClusterLanding.mockResolvedValue({
      indexable: true,
      canonicalPath: "/jobs/kanton/zuerich/kategorie/engineering-technik",
    });

    await expect(JobsPage({
      searchParams: Promise.resolve({
        canton: "zuerich",
        category: "engineering-technik",
      }),
    })).rejects.toThrow(
      "NEXT_REDIRECT:/jobs/kanton/zuerich/kategorie/engineering-technik",
    );
    expect(loadPublicClusterLanding).toHaveBeenCalledWith({
      kind: "pair",
      cantonSlug: "zuerich",
      categorySlug: "engineering-technik",
    });
    expect(publicJobsData.searchJobs).not.toHaveBeenCalled();
  });

  it("keeps an ungated exact filter on noindexed search results", async () => {
    loadPublicClusterLanding.mockResolvedValue({
      indexable: false,
      canonicalPath: "/jobs/kanton/zuerich",
    });

    render(await JobsPage({
      searchParams: Promise.resolve({ canton: "zuerich" }),
    }));

    expect(redirect).not.toHaveBeenCalled();
    expect(publicJobsData.searchJobs).toHaveBeenCalledTimes(1);
  });

  it("does not redirect gated filters when public indexing is disabled", async () => {
    getPublicDataContext.mockReturnValue({ publicIndexingAllowed: false });

    render(await JobsPage({
      searchParams: Promise.resolve({ canton: "zuerich" }),
    }));

    expect(loadPublicClusterLanding).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("preserves every repeated multi-value filter in the server-rendered form", async () => {
    render(await JobsPage({
      searchParams: Promise.resolve({
        jobType: ["PERMANENT", "TEMPORARY"],
        remoteType: ["HYBRID", "REMOTE"],
        language: ["DE", "FR"],
        applicationEffort: ["SIMPLE", "MEDIUM"],
      }),
    }));

    for (const label of [
      "Festanstellung",
      "Befristet",
      "Hybrid",
      "Remote",
      "Deutsch",
      "Französisch",
      "Kurz",
      "Mittel",
    ]) {
      expect(screen.getByRole("checkbox", { name: label })).toBeChecked();
    }
    expect(screen.getByRole("checkbox", { name: "Freelance" })).not.toBeChecked();
  });
});
