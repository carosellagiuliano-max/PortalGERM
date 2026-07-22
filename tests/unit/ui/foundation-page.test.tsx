import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const homePageData = vi.hoisted(() => ({
  getPublicCatalog: vi.fn(),
  listHomepageJobs: vi.fn(),
  listPublicClusterLinks: vi.fn(),
  listPublicGuides: vi.fn(),
  listPublicCompanies: vi.fn(),
  loadPublicOpenJobCounts: vi.fn(),
  listIndexableClusterLandings: vi.fn(),
}));

vi.mock("@/lib/jobs/public-read-model", () => ({
  getPublicCatalog: homePageData.getPublicCatalog,
  listHomepageJobs: homePageData.listHomepageJobs,
  listPublicClusterLinks: homePageData.listPublicClusterLinks,
  loadPublicOpenJobCounts: homePageData.loadPublicOpenJobCounts,
}));

vi.mock("@/lib/content/public-guides", () => ({
  listPublicGuides: homePageData.listPublicGuides,
}));

vi.mock("@/lib/companies/public-read-model", () => ({
  listPublicCompanies: homePageData.listPublicCompanies,
}));

vi.mock("@/lib/seo/cluster-indexability", () => ({
  listIndexableClusterLandings: homePageData.listIndexableClusterLandings,
}));

vi.mock("@/components/public/apply-save-actions", () => ({
  PublicJobActions: () => null,
}));

import HomePage from "@/app/(public)/page";
import NotFound from "@/app/not-found";

describe("public discovery entry UI", () => {
  beforeEach(() => {
    homePageData.getPublicCatalog.mockResolvedValue({
      cantons: [],
      cities: [],
      categories: [],
    });
    homePageData.listHomepageJobs.mockResolvedValue([]);
    homePageData.listPublicClusterLinks.mockResolvedValue([]);
    homePageData.listPublicGuides.mockResolvedValue([]);
    homePageData.listPublicCompanies.mockResolvedValue([]);
    homePageData.listIndexableClusterLandings.mockResolvedValue([]);
  });

  it("renders acquisition links only for currently indexable cluster landings", async () => {
    homePageData.listPublicClusterLinks.mockResolvedValue([
      { kind: "canton", slug: "zuerich", label: "Zürich", count: 50, launchable: true },
      { kind: "category", slug: "pflege", label: "Pflege", count: 50, launchable: true },
    ]);
    homePageData.listIndexableClusterLandings.mockResolvedValue([
      { path: "/jobs/kanton/zuerich", lastModified: new Date("2026-07-22T12:00:00Z") },
    ]);

    render(await HomePage());

    expect(screen.getByRole("link", { name: "Zürich · 50" })).toHaveAttribute(
      "href",
      "/jobs/kanton/zuerich",
    );
    expect(screen.queryByRole("link", { name: "Pflege · 50" })).not.toBeInTheDocument();
  });

  it("renders the async discovery homepage with honest empty-state copy", async () => {
    render(await HomePage());

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Finde nicht irgendeinen Job. Finde den Job, der wirklich passt.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Öffentliche Stellen stammen ausschliesslich aus geprüften Publikationsständen/),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Stichwort suchen" })).toHaveAttribute(
      "name",
      "keyword",
    );
    expect(screen.getByRole("button", { name: "Jobs suchen" })).toBeInTheDocument();
    expect(screen.getByText("Aktuell sind keine publizierten Stellen verfügbar.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Lohn einschätzen" })).toHaveAttribute(
      "href",
      "/salary-radar",
    );
    expect(screen.getByRole("link", { name: "SwissJobPass erstellen" })).toHaveAttribute(
      "href",
      "/register/candidate",
    );
    expect(screen.getByRole("link", { name: /Arbeitgeberkonto erstellen/ })).toHaveAttribute(
      "href",
      "/register/employer",
    );
    expect(screen.queryByText(/Foundation|noch nicht verfügbar/)).not.toBeInTheDocument();

    expect(homePageData.listHomepageJobs).toHaveBeenCalledWith({
      limit: 6,
      now: expect.any(Date),
    });
    expect(homePageData.listPublicCompanies).toHaveBeenCalledWith(
      { limit: 8, verifiedOnly: true },
      homePageData.loadPublicOpenJobCounts,
    );
  });

  it("provides a useful 404 recovery link", () => {
    render(<NotFound />);

    expect(
      screen.getByRole("heading", { name: "Diese Seite ist nicht verfügbar." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Zur Startseite/ })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: /Jobs durchsuchen/ })).toHaveAttribute(
      "href",
      "/jobs",
    );
    expect(screen.getByText(/öffentlichen Jobsuche/)).toBeInTheDocument();
    expect(screen.queryByText(/Jobsuche folgt/)).not.toBeInTheDocument();
  });
});
