import { describe, expect, it } from "vitest";

import {
  buildPublicJobPostingJsonLd,
  publicApplicationHref,
  serializeJsonLd,
} from "@/lib/jobs/job-json-ld";
import type { PublicJobDetailModel } from "@/lib/public/types";

describe("public job structured data", () => {
  it.each([
    [{ applicationContactKind: "APPLY_URL", applicationContactValue: " https://jobs.example/apply " }, "https://jobs.example/apply"],
    [{ applicationContactKind: "EMAIL", applicationContactValue: " jobs@example.ch " }, "mailto:jobs@example.ch"],
    [{ applicationContactKind: "PHONE", applicationContactValue: "+41445551234" }, "tel:+41445551234"],
  ] as const)("creates a safe external application href", (contact, expected) => {
    expect(publicApplicationHref(contact)).toBe(expected);
  });

  it.each([
    { applicationContactKind: "APPLY_URL", applicationContactValue: "javascript:alert(1)" },
    { applicationContactKind: "APPLY_URL", applicationContactValue: "https://user:secret@example.ch/apply" },
    { applicationContactKind: "EMAIL", applicationContactValue: "not-an-email" },
    { applicationContactKind: "PHONE", applicationContactValue: "044 555 12 34" },
  ] as const)("rejects an unsafe or malformed application destination", (contact) => {
    expect(publicApplicationHref(contact)).toBeNull();
  });

  it("builds sanitized Swiss JobPosting data without leaking the application contact", () => {
    const result = buildPublicJobPostingJsonLd(jobFixture(), "https://talent.example/");

    expect(result).toMatchObject({
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: "Senior Engineer",
      description: "Build & ship",
      datePosted: "2026-07-01T08:00:00.000Z",
      validThrough: "2026-08-31T22:00:00.000Z",
      employmentType: ["FULL_TIME", "PART_TIME"],
      hiringOrganization: {
        "@type": "Organization",
        name: "Acme & Partner",
        sameAs: "https://talent.example/companies/acme",
      },
      jobLocation: {
        "@type": "Place",
        address: {
          "@type": "PostalAddress",
          addressCountry: "CH",
          addressRegion: "ZH",
          addressLocality: "Zürich",
        },
      },
      baseSalary: {
        "@type": "MonetaryAmount",
        currency: "CHF",
        value: {
          "@type": "QuantitativeValue",
          minValue: 120_000,
          maxValue: 145_000,
          unitText: "YEAR",
        },
      },
      directApply: false,
      url: "https://talent.example/jobs/senior-engineer",
    });
    expect(result).not.toHaveProperty("applicationContactValue");
    expect(result).not.toHaveProperty("applicationContactKind");
  });

  it("uses the remote-only schema fields and omits incomplete salary data", () => {
    const result = buildPublicJobPostingJsonLd(
      jobFixture({
        remoteType: "REMOTE",
        salaryMax: null,
        salaryPeriod: null,
        canton: null,
        city: null,
      }),
      "https://talent.example",
    );

    expect(result).toMatchObject({
      jobLocationType: "TELECOMMUTE",
      applicantLocationRequirements: {
        "@type": "Country",
        name: "Switzerland",
      },
    });
    expect(result).not.toHaveProperty("jobLocation");
    expect(result).not.toHaveProperty("baseSalary");
  });

  it.each([
    [60, 80, "PART_TIME"],
    [80, 100, ["FULL_TIME", "PART_TIME"]],
    [100, 100, "FULL_TIME"],
  ] as const)(
    "maps a permanent %s–%s%% workload to truthful employment types",
    (workloadMin, workloadMax, expected) => {
      const result = buildPublicJobPostingJsonLd(
        jobFixture({ workloadMin, workloadMax }),
        "https://talent.example",
      );

      expect(result.employmentType).toEqual(expected);
    },
  );

  it("escapes script delimiters and JavaScript line separators", () => {
    const value = { text: "</script>&>\u2028\u2029" };
    const serialized = serializeJsonLd(value);

    expect(serialized).not.toContain("<");
    expect(serialized).not.toContain(">");
    expect(serialized).not.toContain("&");
    expect(serialized).toContain("\\u003c/script\\u003e\\u0026\\u003e");
    expect(serialized).toContain("\\u2028\\u2029");
    expect(JSON.parse(serialized)).toEqual(value);
  });
});

function jobFixture(
  overrides: Partial<PublicJobDetailModel> = {},
): PublicJobDetailModel {
  return {
    id: "job-1",
    slug: "senior-engineer",
    title: "<strong>Senior</strong> Engineer",
    description: "<p>Build &amp; ship</p><script>secret()</script>",
    company: {
      id: "company-1",
      slug: "acme",
      name: "Acme &amp; Partner",
      verified: true,
    },
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
    activeBoost: false,
    sponsored: false,
    companyIntro: null,
    tasks: ["Build"],
    requirements: ["TypeScript"],
    niceToHave: [],
    offer: null,
    benefits: [],
    skills: [],
    languages: [{ code: "DE", minLevel: "B2" }],
    applicationProcessSteps: ["CV prüfen"],
    requiredDocumentKinds: ["CV"],
    inclusionStatement: null,
    startDate: null,
    startByArrangement: true,
    remoteCountryCode: "CH",
    applicationContactKind: "APPLY_URL",
    applicationContactValue: "https://jobs.example/apply",
    fairScoreVersion: "v2",
    fairBreakdown: [],
    ...overrides,
  };
}
