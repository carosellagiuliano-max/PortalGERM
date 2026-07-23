import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () =>
    new Headers({
      "x-nonce": "0123456789abcdef0123456789abcdef",
    }),
  ),
}));

const publicJobData = vi.hoisted(() => ({
  getPublicJobBySlug: vi.fn(),
  listRelatedPublicJobs: vi.fn(),
}));
const publicEnvironment = vi.hoisted(() => ({
  getPublicDataContext: vi.fn(),
}));

vi.mock("@/lib/jobs/public-read-model", () => ({
  getPublicJobBySlug: publicJobData.getPublicJobBySlug,
  listRelatedPublicJobs: publicJobData.listRelatedPublicJobs,
}));

vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: () => ({
    APP_ENV: "test",
    APP_URL: "https://example.test",
    secrets: { session: "test-session-secret" },
  }),
}));

vi.mock("@/lib/public/environment", () => ({
  getPublicDataContext: publicEnvironment.getPublicDataContext,
}));

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/auth/signed-intent", () => ({
  JOB_INTENT_ACTIONS_V1: ["SAVE", "APPLY"],
  buildJobIntentNextPath: vi.fn(),
  verifyJobIntent: () => null,
}));
vi.mock("@/lib/applications/confirmation", () => ({
  getApplicationConfirmationView: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: vi.fn() }));
vi.mock("@/lib/jobs/job-json-ld", () => ({
  buildPublicJobPostingJsonLd: () => ({}),
  serializeJsonLd: () => "{}",
}));

vi.mock("@/components/public/apply-save-actions", () => ({
  ApplyIntentConfirmation: () => null,
  JobIntentAuthenticationLinks: () => null,
  PublicJobActions: () => null,
  SaveIntentConfirmation: () => null,
}));
vi.mock("@/components/public/candidate-match", () => ({ CandidateMatch: () => null }));
vi.mock("@/components/public/fair-score", () => ({ FairScoreBreakdown: () => null }));
vi.mock("@/components/public/job-card", () => ({
  JobCard: () => null,
}));
vi.mock("@/components/public/report-form", () => ({ ReportForm: () => null }));
vi.mock("@/components/public/response-signal", () => ({ ResponseSignal: () => null }));
vi.mock("@/components/public/share-button", () => ({ ShareButton: () => null }));

import JobDetailPage from "@/app/(public)/jobs/[slug]/page";

const job = {
  id: "job-1",
  slug: "plattform-engineer",
  title: "Plattform Engineer",
  companyIntro: "Wir entwickeln eine sichere Schweizer Plattform.",
  description: "Gemeinsam betreiben wir kritische Dienste zuverlässig.",
  company: { id: "company-1", slug: "example", name: "Example AG", verified: true },
  category: { id: "category-1", name: "Engineering", slug: "engineering" },
  canton: { id: "canton-1", name: "Zürich", slug: "zuerich", code: "ZH" },
  city: { id: "city-1", name: "Zürich", slug: "zuerich" },
  locationLabel: "Zürich-West",
  remoteType: "HYBRID",
  jobType: "PERMANENT",
  workloadMin: 80,
  workloadMax: 100,
  salaryMin: 110_000,
  salaryMax: 130_000,
  salaryPeriod: "YEARLY",
  applicationEffort: "SIMPLE",
  contentLanguage: "DE",
  fairScore: 91,
  response: { known: false, targetDays: 7, onTimeRateBps: null, sampleSizeBucket: null },
  publishedAt: new Date("2026-07-20T10:00:00.000Z"),
  expiresAt: new Date("2026-09-30T00:00:00.000Z"),
  dataProvenance: "LIVE",
  activeBoost: false,
  sponsored: false,
  tasks: ["Wartbare Dienste entwickeln"],
  requirements: ["Fundierte TypeScript-Erfahrung"],
  niceToHave: ["PostgreSQL-Erfahrung"],
  offer: "Klare Arbeitsbedingungen und Weiterbildung.",
  benefits: [{ code: "HOME_OFFICE", description: "Homeoffice an drei Tagen" }],
  skills: [{ id: "skill-1", name: "TypeScript", slug: "typescript", required: true }],
  languages: [{ code: "de", minLevel: "B2" }],
  applicationProcessSteps: ["Online-Bewerbung", "Strukturiertes Gespräch"],
  requiredDocumentKinds: ["CV", "CERTIFICATES"],
  inclusionStatement: "Alle qualifizierten Bewerbungen sind willkommen.",
  startDate: null,
  startByArrangement: true,
  remoteCountryCode: null,
  applicationContactKind: "EMAIL",
  applicationContactValue: "jobs@example.ch",
  fairScoreVersion: "fair-job-v1",
  fairBreakdown: [],
};

describe("public job detail applicant-facing content", () => {
  beforeEach(() => {
    publicJobData.getPublicJobBySlug.mockResolvedValue(job);
    publicJobData.listRelatedPublicJobs.mockResolvedValue([]);
    publicEnvironment.getPublicDataContext.mockReturnValue({
      publicIndexingAllowed: false,
    });
  });

  it("renders the shared content groups with public heading semantics and document labels", async () => {
    render(
      await JobDetailPage({
        params: Promise.resolve({ slug: job.slug }),
        searchParams: Promise.resolve({}),
      }),
    );

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
      expect(screen.getByRole("heading", { name: heading, level: 2 })).toBeInTheDocument();
    }

    for (const text of [
      "Wir entwickeln eine sichere Schweizer Plattform.",
      "Gemeinsam betreiben wir kritische Dienste zuverlässig.",
      "Festanstellung",
      "Zürich · Hybrid",
      "80%–100%",
      "Kurz",
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
    ]) {
      expect(screen.getByText(text, { exact: false })).toBeInTheDocument();
    }
  });

  it("renders JobPosting JSON-LD only for an indexable LIVE job", async () => {
    publicEnvironment.getPublicDataContext.mockReturnValue({
      publicIndexingAllowed: true,
    });
    const { container } = render(
      await JobDetailPage({
        params: Promise.resolve({ slug: job.slug }),
        searchParams: Promise.resolve({}),
      }),
    );

    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    expect(script?.textContent).toBe("{}");
    expect(script?.getAttribute("nonce")).toBe(
      "0123456789abcdef0123456789abcdef",
    );

    publicEnvironment.getPublicDataContext.mockReturnValue({
      publicIndexingAllowed: false,
    });
    const nonIndexable = render(
      await JobDetailPage({
        params: Promise.resolve({ slug: job.slug }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(
      nonIndexable.container.querySelector('script[type="application/ld+json"]'),
    ).toBeNull();
  });

  it("renders angle-bracket job text literally without creating executable elements", async () => {
    publicJobData.getPublicJobBySlug.mockResolvedValue({
      ...job,
      description: "Literal: <script>alert('inert')</script>",
    });

    const { container } = render(
      await JobDetailPage({
        params: Promise.resolve({ slug: job.slug }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(
      screen.getByText("Literal: <script>alert('inert')</script>"),
    ).toBeInTheDocument();
    expect(container.querySelector("script:not([type='application/ld+json'])"))
      .toBeNull();
  });
});
