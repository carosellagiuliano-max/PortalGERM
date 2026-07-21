import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { JobPreview } from "@/components/employer/job-wizard/job-wizard";
import type { EmployerJobCatalog, EmployerJobFullDetail } from "@/lib/employer/jobs";

const catalog: EmployerJobCatalog = {
  categories: [{ id: "category-1", name: "Engineering" }],
  cantons: [{ id: "canton-1", code: "ZH", name: "Zürich" }],
  cities: [{ id: "city-1", cantonId: "canton-1", name: "Zürich" }],
  skills: [{ id: "skill-1", name: "TypeScript" }],
  occupations: [],
};

const job: EmployerJobFullDetail = {
  access: "FULL",
  id: "job-1",
  slug: "plattform-engineer",
  status: "DRAFT",
  version: 4,
  currentRevisionId: "revision-1",
  publishedRevisionId: null,
  publishedAt: null,
  expiresAt: null,
  applications: 0,
  views: 0,
  saves: 0,
  boostStatus: null,
  capabilities: { assignmentRole: null, readSummary: true, readFullRevision: true, mutateDraft: true, manageLifecycle: true },
  score: null,
  latestScoreSnapshot: null,
  statusEvents: [],
  auditEvents: [],
  revision: {
    id: "revision-1",
    revisionNumber: 1,
    version: 3,
    contentLanguage: "DE",
    title: "Plattform Engineer",
    companyIntro: "Wir entwickeln eine sichere Schweizer Plattform.",
    description: "Wir entwickeln eine sichere Schweizer Plattform.",
    tasks: ["Wartbare Dienste entwickeln"],
    requirements: ["Fundierte TypeScript-Erfahrung"],
    niceToHave: ["PostgreSQL-Erfahrung"],
    offer: "Klare Arbeitsbedingungen und Weiterbildung.",
    applicationProcessSteps: ["Online-Bewerbung", "Strukturiertes Gespräch"],
    requiredDocumentKinds: ["CV", "CERTIFICATES"],
    jobType: "PERMANENT",
    remoteType: "HYBRID",
    remoteCountryCode: null,
    categoryId: "category-1",
    cantonId: "canton-1",
    cityId: "city-1",
    locationLabel: "Zürich-West",
    workloadMin: 80,
    workloadMax: 100,
    salaryPeriod: "YEARLY",
    salaryMin: 110_000,
    salaryMax: 130_000,
    startDate: null,
    startByArrangement: true,
    validThrough: new Date("2026-09-30T00:00:00.000Z"),
    responseTargetDays: 7,
    applicationEffort: "SIMPLE",
    inclusionStatement: "Alle qualifizierten Bewerbungen sind willkommen.",
    applicationContactKind: "EMAIL",
    applicationContactValue: "jobs@example.ch",
    submittedAt: null,
    approvedAt: null,
    rejectedAt: null,
    languages: [{ code: "de", minLevel: "B2" }],
    skills: [{ id: "skill-1", name: "TypeScript", required: true }],
    benefits: [{ benefitCode: "HOME_OFFICE", description: "Homeoffice an drei Tagen", sortOrder: 0 }],
    reportingCheck: null,
  },
};

describe("employer job step-five preview", () => {
  it("renders every persisted applicant-facing content group without reporting or score evidence", () => {
    render(<JobPreview job={job} catalog={catalog} />);

    for (const heading of [
      "Die Stelle",
      "Deine Aufgaben",
      "Das bringst du mit",
      "Von Vorteil",
      "Das wird geboten",
      "Konkrete Benefits",
      "Fähigkeiten",
      "Sprachen",
      "Zusammenarbeit & Inklusion",
      "Bewerbungsprozess",
    ]) {
      expect(screen.getByRole("heading", { name: heading, level: 3 })).toBeInTheDocument();
    }

    for (const text of [
      "Engineering",
      "Festanstellung",
      "Zürich · Hybrid",
      "80%–100%",
      "Kurz",
      "Wir entwickeln eine sichere Schweizer Plattform.",
      "Wartbare Dienste entwickeln",
      "Fundierte TypeScript-Erfahrung",
      "PostgreSQL-Erfahrung",
      "Klare Arbeitsbedingungen und Weiterbildung.",
      "Homeoffice an drei Tagen",
      "TypeScript · erforderlich",
      "DE ab B2",
      "Alle qualifizierten Bewerbungen sind willkommen.",
      "Online-Bewerbung",
      "Strukturiertes Gespräch",
      "Lebenslauf, Zeugnisse",
      "Inhaltssprache: Deutsch",
      "Öffentlicher Kontakt: E-Mail · jobs@example.ch",
      "Antwortziel: 7 Tage",
    ]) {
      expect(screen.getByText(text, { exact: false })).toBeInTheDocument();
    }
    expect(screen.queryByText(/Meldepflicht/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/Fair-Job-Score:/u)).not.toBeInTheDocument();
  });
});
