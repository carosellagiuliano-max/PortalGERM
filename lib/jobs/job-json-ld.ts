import type { PublicJobDetailModel } from "@/lib/public/types";
import { stripUnsafeHtml } from "@/lib/security/sanitize";
import { isSafeAbsoluteHttpUrl } from "@/lib/validation/common";

export function publicApplicationHref(
  job: Pick<
    PublicJobDetailModel,
    "applicationContactKind" | "applicationContactValue"
  >,
): string | null {
  const value = job.applicationContactValue.trim();
  if (job.applicationContactKind === "APPLY_URL") {
    return isSafeAbsoluteHttpUrl(value) ? value : null;
  }
  if (job.applicationContactKind === "EMAIL") {
    return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)
      ? `mailto:${value}`
      : null;
  }
  return /^\+[1-9][0-9]{7,14}$/u.test(value) ? `tel:${value}` : null;
}

export function buildPublicJobPostingJsonLd(
  job: PublicJobDetailModel,
  appUrl: string,
): Readonly<Record<string, unknown>> {
  const canonical = new URL(`/jobs/${job.slug}`, appUrl).toString();
  const companyWebsite = safeOrganizationWebsite(job.company.website);
  const location = job.canton === null
    ? undefined
    : {
        "@type": "Place",
        address: {
          "@type": "PostalAddress",
          addressCountry: "CH",
          addressRegion: job.canton.name,
          ...(job.city === null ? {} : { addressLocality: job.city.name }),
        },
      };
  const baseSalary =
    job.salaryMin === null || job.salaryMax === null || job.salaryPeriod === null
      ? undefined
      : {
          "@type": "MonetaryAmount",
          currency: "CHF",
          value: {
            "@type": "QuantitativeValue",
            minValue: job.salaryMin,
            maxValue: job.salaryMax,
            unitText: salaryUnitText(job.salaryPeriod),
          },
        };

  return Object.freeze({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: stripUnsafeHtml(job.title),
    description: structuredJobDescription(job),
    identifier: { "@type": "PropertyValue", name: "SwissTalentHub", value: job.id },
    datePosted: job.publishedAt.toISOString(),
    validThrough: job.expiresAt.toISOString(),
    employmentType: employmentType(
      job.jobType,
      job.workloadMin,
      job.workloadMax,
    ),
    hiringOrganization: {
      "@type": "Organization",
      name: stripUnsafeHtml(job.company.name),
      ...(companyWebsite === null ? {} : { sameAs: companyWebsite }),
    },
    ...(location === undefined ? {} : { jobLocation: location }),
    ...(job.remoteType === "REMOTE"
      ? {
          jobLocationType: "TELECOMMUTE",
          applicantLocationRequirements: { "@type": "Country", name: "Switzerland" },
        }
      : {}),
    ...(baseSalary === undefined ? {} : { baseSalary }),
    directApply: false,
    url: canonical,
  });
}

/** Safe for a native JSON-LD script element; also handles JS line separators. */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</gu, "\\u003c")
    .replace(/>/gu, "\\u003e")
    .replace(/&/gu, "\\u0026")
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");
}

function employmentType(
  jobType: PublicJobDetailModel["jobType"],
  workloadMin: number,
  workloadMax: number,
): string | readonly string[] {
  switch (jobType) {
    case "TEMPORARY":
      return "TEMPORARY";
    case "FREELANCE":
      return "CONTRACTOR";
    case "INTERNSHIP":
      return "INTERN";
    case "APPRENTICESHIP":
      return "INTERN";
    case "HOLIDAY_JOB":
      return "TEMPORARY";
    default:
      if (workloadMin === 100 && workloadMax === 100) return "FULL_TIME";
      if (workloadMax < 100) return "PART_TIME";
      return Object.freeze(["FULL_TIME", "PART_TIME"]);
  }
}

function safeOrganizationWebsite(value: string | null): string | null {
  if (value === null || !isSafeAbsoluteHttpUrl(value)) return null;
  return new URL(value).toString();
}

function salaryUnitText(
  period: NonNullable<PublicJobDetailModel["salaryPeriod"]>,
): "HOUR" | "MONTH" | "YEAR" {
  switch (period) {
    case "HOURLY":
      return "HOUR";
    case "MONTHLY":
      return "MONTH";
    case "YEARLY":
      return "YEAR";
  }
}

function structuredJobDescription(job: PublicJobDetailModel): string {
  const sections: string[] = [];
  appendText(sections, job.companyIntro);
  if (job.description !== job.companyIntro) appendText(sections, job.description);
  appendList(sections, "Aufgaben", job.tasks);
  appendList(sections, "Anforderungen", job.requirements);
  appendList(sections, "Von Vorteil", job.niceToHave);
  if (job.offer !== null) {
    const offer = stripUnsafeHtml(job.offer).trim();
    if (offer !== "") sections.push(`Angebot\n${offer}`);
  }
  appendList(
    sections,
    "Benefits",
    job.benefits.map(({ description }) => description),
  );
  appendList(sections, "Bewerbungsprozess", job.applicationProcessSteps);
  appendText(sections, job.inclusionStatement);
  return sections.join("\n\n");
}

function appendText(sections: string[], value: string | null) {
  if (value === null) return;
  const text = stripUnsafeHtml(value).trim();
  if (text !== "") sections.push(text);
}

function appendList(
  sections: string[],
  heading: string,
  values: readonly string[],
) {
  const items = values.map(stripUnsafeHtml).map((value) => value.trim()).filter(Boolean);
  if (items.length > 0) sections.push(`${heading}\n${items.join("\n")}`);
}
