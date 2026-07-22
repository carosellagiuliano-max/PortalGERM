import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/components/public/apply-save-actions", () => ({
  PublicJobActions: () => null,
}));

import { CompanyCard } from "@/components/public/company-card";
import { JobCard } from "@/components/public/job-card";
import type { PublicCompanyCardModel, PublicJobCardModel } from "@/lib/public/types";

describe("public discovery cards", () => {
  it("labels paid ranking honestly and links only to public detail routes", () => {
    render(<JobCard job={jobFixture()} />);

    expect(screen.getByText("Geboostet")).toBeInTheDocument();
    expect(screen.getByLabelText("Geboostet. Dieser Job wird vom Arbeitgeber für mehr Sichtbarkeit hervorgehoben.")).toBeInTheDocument();
    expect(screen.queryByText("Gesponsert")).not.toBeInTheDocument();
    expect(screen.getByText("Fair-Job-Score 88/100")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Senior Engineer" })).toHaveAttribute(
      "href",
      "/jobs/senior-engineer",
    );
    expect(screen.getByRole("link", { name: /Acme/ })).toHaveAttribute(
      "href",
      "/companies/acme",
    );
    expect(screen.getByLabelText("Verifiziertes Unternehmen")).toBeInTheDocument();
    expect(screen.getByText(/CHF/)).toBeInTheDocument();
    expect(screen.getByText("84% antworten innert 10 Tagen")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /bewerben/i })).not.toBeInTheDocument();
  });

  it("does not invent salary or response evidence", () => {
    render(
      <JobCard
        job={jobFixture({
          salaryMin: null,
          salaryMax: null,
          salaryPeriod: null,
          fairScore: null,
          sponsored: false,
          response: {
            known: false,
            targetDays: null,
            onTimeRateBps: null,
            sampleSizeBucket: null,
          },
        })}
      />,
    );

    expect(screen.queryByText(/Fair-Job-Score/)).not.toBeInTheDocument();
    expect(screen.queryByText(/CHF/)).not.toBeInTheDocument();
    expect(screen.getByText("Antwortverhalten noch nicht belastbar")).toBeInTheDocument();
  });

  it("distinguishes verified and unverified company profiles", () => {
    const { rerender } = render(<CompanyCard company={companyFixture()} />);

    expect(screen.getByText("Verifiziert")).toBeInTheDocument();
    expect(screen.getByText("1 offene Stelle")).toBeInTheDocument();
    expect(screen.getByText("ÖV-Beitrag")).toBeInTheDocument();
    expect(screen.getByText("84% antworten innert 10 Tagen")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Acme" })).toHaveAttribute(
      "href",
      "/companies/acme",
    );

    rerender(
      <CompanyCard
        company={companyFixture({
          verified: false,
          openJobCount: 2,
          response: {
            known: false,
            targetDays: null,
            onTimeRateBps: null,
            sampleSizeBucket: null,
          },
          benefitsPreview: [],
        })}
      />,
    );

    expect(screen.getByText("Öffentliches Profil")).toBeInTheDocument();
    expect(screen.getByText("2 offene Stellen")).toBeInTheDocument();
    expect(screen.queryByText(/Antwortverhalten|antworten innert/u)).not.toBeInTheDocument();
    expect(screen.queryByText("ÖV-Beitrag")).not.toBeInTheDocument();
  });
});

function jobFixture(
  overrides: Partial<PublicJobCardModel> = {},
): PublicJobCardModel {
  return {
    id: "job-1",
    slug: "senior-engineer",
    title: "Senior Engineer",
    description: "Baue zugängliche und sichere Produkte.",
    company: { id: "company-1", slug: "acme", name: "Acme", verified: true },
    category: { id: "category-1", name: "IT", slug: "it" },
    canton: { id: "canton-zh", name: "Zürich", slug: "zuerich", code: "ZH" },
    city: { id: "city-zuerich", name: "Zürich", slug: "zuerich" },
    locationLabel: null,
    remoteType: "HYBRID",
    jobType: "PERMANENT",
    workloadMin: 80,
    workloadMax: 100,
    salaryMin: 120_000,
    salaryMax: 145_000,
    salaryPeriod: "YEARLY",
    applicationEffort: "SIMPLE",
    contentLanguage: "DE",
    fairScore: 88,
    response: {
      known: true,
      targetDays: 10,
      onTimeRateBps: 8_400,
      sampleSizeBucket: "50+",
    },
    publishedAt: new Date("2026-07-01T08:00:00.000Z"),
    expiresAt: new Date("2026-08-31T22:00:00.000Z"),
    dataProvenance: "LIVE",
    activeBoost: true,
    sponsored: true,
    ...overrides,
  };
}

function companyFixture(
  overrides: Partial<PublicCompanyCardModel> = {},
): PublicCompanyCardModel {
  return {
    id: "company-1",
    slug: "acme",
    name: "Acme",
    industry: "Software",
    size: "51–200",
    city: "Zürich",
    canton: "ZH",
    verified: true,
    openJobCount: 1,
    benefitsPreview: ["ÖV-Beitrag", "Weiterbildung"],
    response: {
      known: true,
      targetDays: 10,
      onTimeRateBps: 8_400,
      sampleSizeBucket: "50+",
    },
    dataProvenance: "LIVE",
    ...overrides,
  };
}
