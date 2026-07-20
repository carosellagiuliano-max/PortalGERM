import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const publicJobsData = vi.hoisted(() => ({
  getPublicCatalog: vi.fn(),
  listPublicJobs: vi.fn(),
}));

vi.mock("@/lib/jobs/public-read-model", () => ({
  getPublicCatalog: publicJobsData.getPublicCatalog,
  listPublicJobs: publicJobsData.listPublicJobs,
}));

import JobsPage from "@/app/(public)/jobs/page";

describe("public Jobs result-count disclosure", () => {
  beforeEach(() => {
    publicJobsData.getPublicCatalog.mockResolvedValue({
      cantons: [],
      cities: [],
      categories: [],
    });
    publicJobsData.listPublicJobs.mockResolvedValue({
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

  it("replaces a capped pseudo-total with an explicit workset warning", async () => {
    publicJobsData.listPublicJobs.mockResolvedValue({
      jobs: [],
      nextCursor: null,
      totalEligible: 2_000,
      resultCountIsExact: false,
      candidateSetTruncated: true,
      invalidCursor: false,
    });

    render(await JobsPage({ searchParams: Promise.resolve({}) }));

    expect(
      screen.getByRole("heading", { name: "Trefferzahl nicht vollständig" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "2000 Stellen" })).not.toBeInTheDocument();
    expect(
      screen.getByText("Die gefilterte Vorauswahl umfasst mehr als 2.000 Stellen."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/höchstens 2.000 davon ausgewertet/iu),
    ).toBeInTheDocument();
  });
});
