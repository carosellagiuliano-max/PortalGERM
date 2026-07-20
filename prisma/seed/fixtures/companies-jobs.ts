import { createHash } from "node:crypto";

import { buildFairJobScoreSnapshotV2 } from "@/lib/scoring/fair-job-snapshot";
import type { FairJobScoreSnapshotRecordV2 } from "@/lib/scoring/fair-job-snapshot";
import type { SeedIdentityRecord } from "@/prisma/seed/contract";
import {
  createSeedIdentity,
  stableSeedId,
} from "@/prisma/seed/ids";
import {
  createSeedRandom,
  deterministicShuffle,
  exactRange,
  expandExactDistribution,
} from "@/prisma/seed/utils";
import { CATEGORY_FIXTURES } from "./categories";
import { CITY_FIXTURES } from "./cities";
import { OCCUPATION_CODES_2026_FIXTURE } from "./occupation-codes";
import type { PlanCode } from "./plans";
import { SKILL_FIXTURES } from "./skills";

export const DEMO_LOGIN_PASSWORD = "Demo12345!" as const;
export const DEMO_COMPANY_SLUG = "novarigi-digital" as const;
export const RADAR_DEMO_COMPANY_SLUG =
  "carevia-quartiergesundheit" as const;

export type DemoRole = "CANDIDATE" | "EMPLOYER" | "RECRUITER" | "ADMIN";
export type DemoJobStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "IN_REVIEW"
  | "CHANGES_REQUESTED"
  | "APPROVED"
  | "PUBLISHED"
  | "PAUSED"
  | "EXPIRED"
  | "REJECTED"
  | "CLOSED";
export type DemoJobType =
  | "PERMANENT"
  | "TEMPORARY"
  | "FREELANCE"
  | "INTERNSHIP"
  | "APPRENTICESHIP"
  | "HOLIDAY_JOB";
export type DemoContentLanguage = "DE" | "FR" | "IT" | "EN";
export type DemoApplicationEffort = "SIMPLE" | "MEDIUM" | "LONG";
export type DemoRemoteType = "ONSITE" | "HYBRID" | "REMOTE";

export interface DemoAccountFixture {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: DemoRole;
  readonly profileId: string | null;
}

export const DEMO_ACCOUNT_FIXTURES: readonly Readonly<DemoAccountFixture>[] =
  Object.freeze(
    ([
      ["candidate@demo.ch", "Demo Kandidatin", "CANDIDATE", "candidate-profile"],
      ["employer@demo.ch", "Demo Arbeitgeber", "EMPLOYER", "employer-profile"],
      ["recruiter@demo.ch", "Demo Recruiterin", "RECRUITER", "employer-profile"],
      ["admin@demo.ch", "Demo Administration", "ADMIN", null],
    ] as const).map(([email, name, role, profileEntity]) =>
      Object.freeze({
        id: stableSeedId("user", email),
        email,
        name,
        role,
        profileId:
          profileEntity === null ? null : stableSeedId(profileEntity, email),
      }),
    ),
  );

interface CompanyDefinition {
  readonly name: string;
  readonly slug: string;
  readonly planCode: PlanCode;
  readonly industry: string;
  readonly size: string;
  readonly citySlug: string;
}

const COMPANY_DEFINITIONS = [
  ["Alpenfaden Atelier GmbH", "alpenfaden-atelier", "FREE_BASIC", "Detailhandel und Gestaltung", "1-10", "aarau"],
  ["Seeblick Reparaturwerkstatt GmbH", "seeblick-reparaturwerkstatt", "FREE_BASIC", "Reparatur und Handwerk", "1-10", "uster"],
  ["Mosaik Lernraum GmbH", "mosaik-lernraum", "FREE_BASIC", "Bildung und Soziales", "1-10", "koeniz"],
  ["JuraKorn Genusswerk GmbH", "jurakorn-genusswerk", "FREE_BASIC", "Lebensmittel und Gastronomie", "1-10", "olten"],
  ["Linthlicht Gebäudeservice GmbH", "linthlicht-gebaeudeservice", "FREE_BASIC", "Reinigung und Facility", "1-10", "rapperswil-jona"],
  ["Rheintal Werkbogen AG", "rheintal-werkbogen", "STARTER", "Produktion und Industrie", "11-50", "winterthur"],
  ["Bernbogen Administration GmbH", "bernbogen-administration", "STARTER", "Administration und Dienste", "11-50", "bern"],
  ["Tessin Tavola Servizi SA", "tessin-tavola-servizi", "STARTER", "Gastronomie und Hotellerie", "11-50", "lugano"],
  ["Romandie Clair Conseil Sàrl", "romandie-clair-conseil", "STARTER", "Beratung und Kundendienst", "11-50", "lausanne"],
  ["Zugwerk Kundenservice AG", "zugwerk-kundenservice", "STARTER", "Kundendienst", "11-50", "zug"],
  ["Thurholz Innenausbau GmbH", "thurholz-innenausbau", "STARTER", "Bau und Innenausbau", "11-50", "wil"],
  ["NovaRigi Digital AG", DEMO_COMPANY_SLUG, "PRO", "Informationstechnologie", "51-200", "zuerich"],
  ["Aaretakt Engineering AG", "aaretakt-engineering", "PRO", "Engineering und Technik", "51-200", "baden"],
  ["SäntisWort Kommunikation GmbH", "saentiswort-kommunikation", "PRO", "Marketing und Kommunikation", "51-200", "st-gallen"],
  ["Bieler Kreislauf Logistik AG", "bieler-kreislauf-logistik", "PRO", "Logistik und Transport", "51-200", "biel-bienne"],
  ["Léman Lien Social Sàrl", "leman-lien-social", "PRO", "Soziale Dienste", "51-200", "fribourg"],
  ["Cima Cura Servizi SA", "cima-cura-servizi", "PRO", "Gesundheit und Pflege", "51-200", "bellinzona"],
  ["Carevia Quartiergesundheit AG", RADAR_DEMO_COMPANY_SLUG, "BUSINESS", "Gesundheit und Pflege", "201-500", "basel"],
  ["Cloudkern Systeme AG", "cloudkern-systeme", "BUSINESS", "Informationstechnologie", "201-500", "winterthur"],
  ["Frachtfink Logistik AG", "frachtfink-logistik", "BUSINESS", "Logistik und Transport", "201-500", "dietikon"],
  ["Panorama Gastwerk AG", "panorama-gastwerk", "BUSINESS", "Gastronomie und Hotellerie", "201-500", "luzern"],
  ["Klarwert Bildungsverbund AG", "klarwert-bildungsverbund", "BUSINESS", "Bildung und Soziales", "201-500", "neuchatel"],
  ["Quarzspindel Industriewerke AG", "quarzspindel-industriewerke", "ENTERPRISE_CONTRACT", "Industrie und Produktion", "501+", "chur"],
  ["Bergfuge Bauverbund AG", "bergfuge-bauverbund", "ENTERPRISE_CONTRACT", "Bau und Infrastruktur", "501+", "thun"],
  ["Rappenquell Finanzdienste AG", "rappenquell-finanzdienste", "ENTERPRISE_CONTRACT", "Finanzen und Treuhand", "501+", "zug"],
] as const satisfies readonly (readonly [
  string,
  string,
  PlanCode,
  string,
  string,
  string,
])[];

export interface CompanyFixture extends CompanyDefinition {
  readonly id: string;
  readonly ownerUserId: string;
  readonly ownerEmail: string;
  readonly ownerMembershipId: string;
  readonly cantonCode: string;
  readonly cityId: string;
  readonly cantonId: string;
  readonly locationId: string;
  readonly billingProfileId: string | null;
  readonly responseTargetDays: number | null;
  readonly responseSampleSize: number;
  readonly responseWithinTargetBps: number | null;
}

const RESPONSE_SCENARIOS = Object.freeze([
  { responseTargetDays: 7, responseSampleSize: 64, responseWithinTargetBps: 8_281 },
  { responseTargetDays: 14, responseSampleSize: 8, responseWithinTargetBps: null },
  { responseTargetDays: null, responseSampleSize: 0, responseWithinTargetBps: null },
  { responseTargetDays: 21, responseSampleSize: 35, responseWithinTargetBps: 7_143 },
] as const);

export const COMPANY_FIXTURES: readonly Readonly<CompanyFixture>[] =
  Object.freeze(
    COMPANY_DEFINITIONS.map(
      ([name, slug, planCode, industry, size, citySlug], index) => {
        const city = CITY_FIXTURES.find((entry) => entry.slug === citySlug);
        if (!city) throw new Error(`Unknown company city fixture ${citySlug}.`);
        const ownerEmail =
          slug === DEMO_COMPANY_SLUG
            ? "employer@demo.ch"
            : `owner+${slug}@demo.swisstalenthub.test`;
        const response = RESPONSE_SCENARIOS[index % RESPONSE_SCENARIOS.length];
        if (!response) throw new Error("Missing response scenario.");
        return Object.freeze({
          id: stableSeedId("company", slug),
          name,
          slug,
          planCode,
          industry,
          size,
          citySlug,
          ownerEmail,
          ownerUserId: stableSeedId("user", ownerEmail),
          ownerMembershipId: stableSeedId(
            "company-membership",
            `${slug}:${ownerEmail}`,
          ),
          cantonCode: city.cantonCode,
          cantonId: stableSeedId("canton", city.cantonCode),
          cityId: stableSeedId("city", `${city.cantonCode}:${city.slug}`),
          locationId: stableSeedId("company-location", `${slug}:primary`),
          billingProfileId:
            index === 1
              ? stableSeedId("company-billing-profile", slug)
              : null,
          ...response,
        });
      },
    ),
  );

export const COMPANY_PLAN_DISTRIBUTION = Object.freeze({
  FREE_BASIC: 5,
  STARTER: 6,
  PRO: 6,
  BUSINESS: 5,
  ENTERPRISE_CONTRACT: 3,
} satisfies Readonly<Record<PlanCode, number>>);

export const JOB_STATUS_DISTRIBUTION = Object.freeze({
  PUBLISHED: 100,
  DRAFT: 3,
  SUBMITTED: 3,
  IN_REVIEW: 2,
  CHANGES_REQUESTED: 1,
  APPROVED: 2,
  PAUSED: 1,
  EXPIRED: 1,
  REJECTED: 1,
  CLOSED: 1,
} satisfies Readonly<Record<DemoJobStatus, number>>);

export const JOB_TYPE_DISTRIBUTION = Object.freeze({
  PERMANENT: 75,
  TEMPORARY: 15,
  FREELANCE: 8,
  INTERNSHIP: 6,
  APPRENTICESHIP: 7,
  HOLIDAY_JOB: 4,
} satisfies Readonly<Record<DemoJobType, number>>);

export const JOB_CONTENT_LANGUAGE_DISTRIBUTION = Object.freeze({
  DE: 75,
  FR: 20,
  IT: 8,
  EN: 12,
} satisfies Readonly<Record<DemoContentLanguage, number>>);

export const JOB_EFFORT_DISTRIBUTION = Object.freeze({
  SIMPLE: 35,
  MEDIUM: 57,
  LONG: 23,
} satisfies Readonly<Record<DemoApplicationEffort, number>>);

const JOB_TYPES = deterministicShuffle(
  expandExactDistribution(JOB_TYPE_DISTRIBUTION),
  createSeedRandom("companies-jobs.job-types"),
);
const CONTENT_LANGUAGES = deterministicShuffle(
  expandExactDistribution(JOB_CONTENT_LANGUAGE_DISTRIBUTION),
  createSeedRandom("companies-jobs.content-languages"),
);
const APPLICATION_EFFORTS = deterministicShuffle(
  expandExactDistribution(JOB_EFFORT_DISTRIBUTION),
  createSeedRandom("companies-jobs.application-efforts"),
);

const NON_PUBLISHED_STATUSES: readonly DemoJobStatus[] = Object.freeze([
  "DRAFT",
  "DRAFT",
  "DRAFT",
  "SUBMITTED",
  "SUBMITTED",
  "SUBMITTED",
  "IN_REVIEW",
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "APPROVED",
  "PAUSED",
  "EXPIRED",
  "REJECTED",
  "CLOSED",
]);

const PUBLISHED_CAPACITY_BY_PLAN: Readonly<Record<PlanCode, number>> =
  Object.freeze({
    FREE_BASIC: 1,
    STARTER: 3,
    PRO: 5,
    BUSINESS: 6,
    ENTERPRISE_CONTRACT: 0,
  });
const PUBLISHED_COMPANY_INDEXES = Object.freeze(
  COMPANY_FIXTURES.flatMap((company, index) => {
    const count =
      company.planCode === "ENTERPRISE_CONTRACT"
        ? index === 24
          ? 5
          : 6
        : PUBLISHED_CAPACITY_BY_PLAN[company.planCode];
    return Array.from({ length: count }, () => index);
  }),
);

export interface JobStatusEventFixture {
  readonly id: string;
  readonly kind: string;
  readonly fromStatus: DemoJobStatus | null;
  readonly toStatus: DemoJobStatus;
  readonly createdAt: string;
  readonly idempotencyKey: string;
}

export interface JobFixture {
  readonly id: string;
  readonly slug: string;
  readonly companyId: string;
  readonly companySlug: string;
  readonly status: DemoJobStatus;
  readonly revisionId: string;
  readonly title: string;
  readonly description: string;
  readonly contentLanguage: DemoContentLanguage;
  readonly jobType: DemoJobType;
  readonly applicationEffort: DemoApplicationEffort;
  readonly remoteType: DemoRemoteType;
  readonly remoteCountryCode: "CH" | null;
  readonly categorySlug: string;
  readonly categoryId: string;
  readonly cantonCode: string | null;
  readonly cantonId: string | null;
  readonly citySlug: string | null;
  readonly cityId: string | null;
  readonly locationLabel: string;
  readonly salaryPeriod: "YEARLY" | null;
  readonly salaryMin: number | null;
  readonly salaryMax: number | null;
  readonly workloadMin: number;
  readonly workloadMax: number;
  readonly tasks: readonly string[];
  readonly requirements: readonly string[];
  readonly applicationProcessSteps: readonly string[];
  readonly requiredDocumentKinds: readonly ("NONE" | "CV" | "COVER_LETTER")[];
  readonly startDate: string;
  readonly responseTargetDays: number;
  readonly inclusionStatement: string;
  readonly applicationContactValue: string;
  readonly benefits: readonly Readonly<{
    id: string;
    benefitCode: "FLEXIBLE_WORK" | "PAID_TRAINING";
    description: string;
    sortOrder: number;
  }>[];
  readonly skillIds: readonly string[];
  readonly skillSlugs: readonly string[];
  readonly languageCodes: readonly string[];
  readonly occupationCode: string;
  readonly contentChecksum: string;
  readonly createdAt: string;
  readonly submittedAt: string | null;
  readonly approvedAt: string | null;
  readonly rejectedAt: string | null;
  readonly publishedAt: string | null;
  readonly validThrough: string;
  readonly statusEvents: readonly JobStatusEventFixture[];
  readonly scoreSnapshot: FairJobScoreSnapshotRecordV2 | null;
}

export function buildJobFixtures(anchorAt: Date): readonly Readonly<JobFixture>[] {
  assertValidAnchor(anchorAt);
  const categoriesExceptEngineering = CATEGORY_FIXTURES.filter(
    (category) => category.slug !== "engineering-technik",
  );
  const zhCity = CITY_FIXTURES.find((city) => city.slug === "zuerich");
  if (!zhCity) throw new Error("Zürich city fixture is missing.");

  return Object.freeze(
    exactRange(115).map((index) => {
      const ordinal = index + 1;
      const status: DemoJobStatus =
        index < 100 ? "PUBLISHED" : (NON_PUBLISHED_STATUSES[index - 100] as DemoJobStatus);
      const companyIndex =
        index < 100
          ? (PUBLISHED_COMPANY_INDEXES[index] as number)
          : (index - 100) % COMPANY_FIXTURES.length;
      const company = COMPANY_FIXTURES[companyIndex];
      if (!company) throw new Error(`Missing company for job ${ordinal}.`);
      const category =
        index < 50
          ? CATEGORY_FIXTURES.find((entry) => entry.slug === "engineering-technik")
          : categoriesExceptEngineering[(index - 50) % categoriesExceptEngineering.length];
      if (!category) throw new Error(`Missing category for job ${ordinal}.`);
      const remoteType: DemoRemoteType =
        index < 15
          ? "HYBRID"
          : index >= 50 && index < 64
            ? "REMOTE"
            : "ONSITE";
      const city =
        remoteType === "REMOTE"
          ? null
          : index < 50
            ? zhCity
            : CITY_FIXTURES[(index * 7) % CITY_FIXTURES.length];
      if (remoteType !== "REMOTE" && !city) {
        throw new Error(`Missing city for job ${ordinal}.`);
      }
      const contentLanguage = CONTENT_LANGUAGES[index] as DemoContentLanguage;
      const applicationEffort = APPLICATION_EFFORTS[index] as DemoApplicationEffort;
      const jobType = JOB_TYPES[index] as DemoJobType;
      const slug = `${index < 50 ? "zh-engineering" : category.slug}-demo-${String(ordinal).padStart(3, "0")}`;
      const id = stableSeedId("job", slug);
      const revisionId = stableSeedId("job-revision", `${slug}:1`);
      const createdAt = addDays(anchorAt, -70 - (index % 10));
      const submittedAt = status === "DRAFT" ? null : addDays(createdAt, 5);
      const isApproved = isApprovedStatus(status);
      const approvedAt = isApproved ? addDays(createdAt, 8) : null;
      const rejectedAt = status === "REJECTED" ? addDays(createdAt, 9) : null;
      const publishedAt = wasPublished(status)
        ? addDays(anchorAt, -1 - (index % 20))
        : null;
      const validThrough =
        status === "EXPIRED"
          ? addDays(anchorAt, -1)
          : addDays(anchorAt, 45 + (index % 20));
      const salaryDisclosed = index % 2 === 0;
      const categorySkills = SKILL_FIXTURES.filter(
        (skill) => skill.categorySlug === category.slug,
      );
      const skills = [
        categorySkills[index % categorySkills.length],
        categorySkills[(index + 1) % categorySkills.length],
      ].filter((skill): skill is (typeof SKILL_FIXTURES)[number] => Boolean(skill));
      if (skills.length !== 2) throw new Error(`Missing job skills for ${slug}.`);
      const languageCodes = Object.freeze(
        contentLanguage === "DE"
          ? ["de"]
          : [contentLanguage.toLowerCase(), "de"],
      );
      const title = localizedTitle(contentLanguage, category.name, ordinal);
      const description = localizedDescription(contentLanguage, company.name, category.name);
      const tasks = Object.freeze([
        `Du planst nachvollziehbare Arbeitspakete im Bereich ${category.name}.`,
        "Du dokumentierst Ergebnisse verständlich und stimmst Prioritäten im Team ab.",
        "Du verbesserst Abläufe anhand klarer Rückmeldungen aus dem Arbeitsalltag.",
      ]);
      const requirements = Object.freeze([
        `Du bringst praktische Erfahrung oder eine passende Ausbildung für ${category.name} mit.`,
        "Du arbeitest verlässlich, sorgfältig und kommunizierst offen mit verschiedenen Fachpersonen.",
        "Du kannst Entscheidungen begründen und gehst respektvoll mit Rückmeldungen um.",
      ]);
      const applicationProcessSteps = Object.freeze(
        applicationEffort === "SIMPLE"
          ? ["Kurzbewerbung einreichen und innerhalb von sieben Tagen eine Rückmeldung erhalten."]
          : applicationEffort === "MEDIUM"
            ? [
                "Lebenslauf einreichen und ein strukturiertes Erstgespräch führen.",
                "Im zweiten Schritt das künftige Team und die Aufgaben kennenlernen.",
              ]
            : [
                "Lebenslauf und kurzes Motivationsschreiben einreichen.",
                "Ein strukturiertes Fachgespräch mit transparenter Bewertung führen.",
                "Die Zusammenarbeit in einer kleinen praxisnahen Aufgabe kennenlernen.",
              ],
      );
      // Phase-05 applications link the single candidate-owned CV fixture only
      // for candidate-01 (published job slots 0, 29 and 58). Every other
      // application deliberately exercises the no-required-document path.
      // Keeping this aligned with APPLICATION_FIXTURES prevents a submitted
      // application from claiming a required document that is not linked.
      const requiredDocumentKinds = Object.freeze(
        index === 0 || index === 29 || index === 58
          ? (["CV"] as const)
          : (["NONE"] as const),
      );
      const benefits = Object.freeze([
        Object.freeze({
          id: stableSeedId("job-revision-benefit", `${slug}:flexible-work`),
          benefitCode: "FLEXIBLE_WORK" as const,
          description: "Planbare Arbeitszeiten mit gemeinsam vereinbarten Präsenzfenstern.",
          sortOrder: 0,
        }),
        Object.freeze({
          id: stableSeedId("job-revision-benefit", `${slug}:paid-training`),
          benefitCode: "PAID_TRAINING" as const,
          description: "Bezahlte Weiterbildungstage mit einem persönlichen Lernbudget.",
          sortOrder: 1,
        }),
      ]);
      const cantonId = city ? stableSeedId("canton", city.cantonCode) : null;
      const cityId = city
        ? stableSeedId("city", `${city.cantonCode}:${city.slug}`)
        : null;
      const responseTargetDays = [5, 7, 10, 14, 21, 30][index % 6] as number;
      const salaryMin = salaryDisclosed ? 68_000 + (index % 8) * 4_000 : null;
      const salaryMax = salaryMin === null ? null : salaryMin + 18_000;
      const startDate = startOfUtcDay(addDays(anchorAt, 14 + (index % 20)));
      const inclusionStatement =
        "Wir beurteilen Bewerbungen nach transparenten fachlichen Kriterien und begrüssen unterschiedliche Perspektiven.";
      const applicationContactValue = `jobs+${String(ordinal).padStart(3, "0")}@demo.swisstalenthub.test`;
      const raw = {
        id,
        slug,
        companyId: company.id,
        companySlug: company.slug,
        status,
        revisionId,
        title,
        description,
        contentLanguage,
        jobType,
        applicationEffort,
        remoteType,
        remoteCountryCode: remoteType === "REMOTE" ? ("CH" as const) : null,
        categorySlug: category.slug,
        categoryId: stableSeedId("category", category.slug),
        cantonCode: city?.cantonCode ?? null,
        cantonId,
        citySlug: city?.slug ?? null,
        cityId,
        locationLabel: remoteType === "REMOTE" ? "Remote innerhalb der Schweiz" : city?.name ?? "Schweiz",
        salaryPeriod: salaryDisclosed ? ("YEARLY" as const) : null,
        salaryMin,
        salaryMax,
        workloadMin: index % 3 === 0 ? 80 : 60,
        workloadMax: 100,
        tasks,
        requirements,
        applicationProcessSteps,
        requiredDocumentKinds,
        startDate: startDate.toISOString(),
        responseTargetDays,
        inclusionStatement,
        applicationContactValue,
        benefits,
        skillIds: Object.freeze(skills.map((skill) => stableSeedId("skill", skill.slug))),
        skillSlugs: Object.freeze(skills.map((skill) => skill.slug)),
        languageCodes,
        occupationCode:
          OCCUPATION_CODES_2026_FIXTURE.occupationCodes[
            index % OCCUPATION_CODES_2026_FIXTURE.occupationCodes.length
          ]?.code ?? "MOCK-CHISCO-0001",
        contentChecksum: hashText(`${slug}:revision:1`),
        createdAt: createdAt.toISOString(),
        submittedAt: submittedAt?.toISOString() ?? null,
        approvedAt: approvedAt?.toISOString() ?? null,
        rejectedAt: rejectedAt?.toISOString() ?? null,
        publishedAt: publishedAt?.toISOString() ?? null,
        validThrough: validThrough.toISOString(),
      };
      const statusEvents = buildJobStatusEvents(raw);
      const scoreSnapshot = isApproved
        ? buildFairJobScoreSnapshotV2({
            job: { id },
            revision: {
              id: revisionId,
              jobId: id,
              salaryPeriod: raw.salaryPeriod,
              salaryMin,
              salaryMax,
              tasks,
              requirements,
              workloadMin: raw.workloadMin,
              workloadMax: raw.workloadMax,
              jobType,
              startDate,
              startByArrangement: false,
              remoteType,
              cantonId,
              cityId,
              remoteCountryCode: raw.remoteCountryCode,
              applicationEffort,
              applicationProcessSteps,
              requiredDocumentKinds,
              responseTargetDays,
              benefits,
              inclusionStatement,
              applicationContactKind: "EMAIL",
              applicationContactValue,
              validThrough,
            },
            clock: { now: anchorAt },
          })
        : null;
      return Object.freeze({ ...raw, statusEvents, scoreSnapshot });
    }),
  );
}

export const COMPANIES_JOBS_SEED_IDENTITIES: readonly SeedIdentityRecord[] =
  Object.freeze(buildCompaniesJobsSeedIdentities());

function buildCompaniesJobsSeedIdentities(): SeedIdentityRecord[] {
  const identities: SeedIdentityRecord[] = [];
  const register = (entity: string, naturalKey: string) =>
    identities.push(createSeedIdentity(entity, naturalKey));

  for (const account of DEMO_ACCOUNT_FIXTURES) {
    register("user", account.email);
    register("credential", account.email);
    if (account.role === "EMPLOYER" || account.role === "RECRUITER") {
      register("employer-profile", account.email);
    }
  }
  for (const company of COMPANY_FIXTURES) {
    if (company.ownerEmail !== "employer@demo.ch") {
      register("user", company.ownerEmail);
      register("employer-profile", company.ownerEmail);
    }
    register("company", company.slug);
    register("company-location", `${company.slug}:primary`);
    register("company-membership", `${company.slug}:${company.ownerEmail}`);
    if (company.slug === DEMO_COMPANY_SLUG) {
      register("company-membership", `${company.slug}:recruiter@demo.ch`);
    }
    if (company.billingProfileId) register("company-billing-profile", company.slug);
    for (const suffix of ["draft-created", "onboarding-completed"]) {
      register("company-status-event", `${company.slug}:${suffix}`);
    }
    if (COMPANY_FIXTURES.indexOf(company) % 8 === 0) {
      register("company-status-event", `${company.slug}:suspended-history`);
      register("company-status-event", `${company.slug}:reactivated-history`);
    }
    if (company.slug === DEMO_COMPANY_SLUG) {
      register("company-verification-request", `${company.slug}:rejected-v1`);
      for (const suffix of ["draft", "submitted", "rejected"]) {
        register("company-verification-event", `${company.slug}:rejected-v1:${suffix}`);
      }
    }
    register("company-verification-request", `${company.slug}:current`);
    for (const suffix of ["draft", "submitted", "verified"]) {
      register("company-verification-event", `${company.slug}:current:${suffix}`);
    }
  }
  register("company-claim-request", "pending-duplicate-demo");
  register("company-claim-event", "pending-duplicate-demo:created");
  register("company-claim-request", "rejected-domain-mismatch-demo");
  register("company-claim-event", "rejected-domain-mismatch-demo:created");
  register("company-claim-event", "rejected-domain-mismatch-demo:rejected");

  for (const index of exactRange(115)) {
    const slug = jobSlugAt(index);
    register("job", slug);
    register("job-revision", `${slug}:1`);
    register("job-revision-benefit", `${slug}:flexible-work`);
    register("job-revision-benefit", `${slug}:paid-training`);
    register("job-revision-skill", `${slug}:skill:1`);
    register("job-revision-skill", `${slug}:skill:2`);
    register("job-revision-language", `${slug}:language:primary`);
    if (CONTENT_LANGUAGES[index] !== "DE") {
      register("job-revision-language", `${slug}:language:secondary`);
    }
    register("job-reporting-check", `${slug}:jobroom-2026`);
    if (isApprovedStatus(jobStatusAt(index))) register("job-score-snapshot", `${slug}:v2`);
    for (const step of lifecycleForStatus(jobStatusAt(index))) {
      register("job-status-event", `${slug}:${step.kind.toLowerCase()}`);
    }
  }
  return identities;
}

function jobStatusAt(index: number): DemoJobStatus {
  return index < 100
    ? "PUBLISHED"
    : (NON_PUBLISHED_STATUSES[index - 100] as DemoJobStatus);
}

function jobSlugAt(index: number): string {
  const category =
    index < 50
      ? "engineering-technik"
      : CATEGORY_FIXTURES.filter((entry) => entry.slug !== "engineering-technik")[
          (index - 50) % 17
        ]?.slug;
  if (!category) throw new Error(`Missing category for job identity ${index}.`);
  return `${index < 50 ? "zh-engineering" : category}-demo-${String(index + 1).padStart(3, "0")}`;
}

function lifecycleForStatus(status: DemoJobStatus): readonly Readonly<{
  kind: string;
  fromStatus: DemoJobStatus | null;
  toStatus: DemoJobStatus;
}>[] {
  const steps: Array<{ kind: string; fromStatus: DemoJobStatus | null; toStatus: DemoJobStatus }> = [
    { kind: "DRAFT_CREATED", fromStatus: null, toStatus: "DRAFT" },
  ];
  if (status === "DRAFT") return steps;
  steps.push({ kind: "SUBMITTED", fromStatus: "DRAFT", toStatus: "SUBMITTED" });
  if (status === "SUBMITTED") return steps;
  steps.push({ kind: "REVIEW_STARTED", fromStatus: "SUBMITTED", toStatus: "IN_REVIEW" });
  if (status === "IN_REVIEW") return steps;
  if (status === "CHANGES_REQUESTED") {
    steps.push({ kind: "CHANGES_REQUESTED", fromStatus: "IN_REVIEW", toStatus: "CHANGES_REQUESTED" });
    return steps;
  }
  if (status === "REJECTED") {
    steps.push({ kind: "REJECTED", fromStatus: "IN_REVIEW", toStatus: "REJECTED" });
    return steps;
  }
  steps.push({ kind: "APPROVED", fromStatus: "IN_REVIEW", toStatus: "APPROVED" });
  if (status === "APPROVED") return steps;
  steps.push({ kind: "PUBLISHED", fromStatus: "APPROVED", toStatus: "PUBLISHED" });
  if (status === "PUBLISHED") return steps;
  const terminalKind = status === "PAUSED" ? "PAUSED" : status === "EXPIRED" ? "EXPIRED" : "CLOSED";
  steps.push({ kind: terminalKind, fromStatus: "PUBLISHED", toStatus: status });
  return steps;
}

function buildJobStatusEvents(
  job: Readonly<{
    slug: string;
    status: DemoJobStatus;
    createdAt: string;
    submittedAt: string | null;
    approvedAt: string | null;
    rejectedAt: string | null;
    publishedAt: string | null;
    validThrough: string;
  }>,
): readonly JobStatusEventFixture[] {
  return Object.freeze(
    lifecycleForStatus(job.status).map((step) => {
      const submittedAt = dateOrFallback(job.submittedAt, job.createdAt);
      const publishedAt = dateOrFallback(job.publishedAt, job.createdAt);
      const createdAt =
        step.kind === "DRAFT_CREATED"
          ? new Date(job.createdAt)
          : step.kind === "SUBMITTED"
            ? submittedAt
            : step.kind === "REVIEW_STARTED"
              ? addDays(submittedAt, 1)
              : step.kind === "APPROVED"
                ? dateOrFallback(job.approvedAt, job.createdAt)
                : step.kind === "REJECTED"
                  ? dateOrFallback(job.rejectedAt, job.createdAt)
                  : step.kind === "PUBLISHED"
                    ? publishedAt
                    : step.kind === "EXPIRED"
                      ? new Date(job.validThrough)
                      : addDays(publishedAt, step.kind === "PAUSED" ? 3 : 7);
      return Object.freeze({
        id: stableSeedId("job-status-event", `${job.slug}:${step.kind.toLowerCase()}`),
        ...step,
        idempotencyKey: `seed:${job.slug}:${step.kind.toLowerCase()}`,
        createdAt: createdAt.toISOString(),
      });
    }),
  );
}

function isApprovedStatus(status: DemoJobStatus): boolean {
  return ["APPROVED", "PUBLISHED", "PAUSED", "EXPIRED", "CLOSED"].includes(status);
}

function wasPublished(status: DemoJobStatus): boolean {
  return ["PUBLISHED", "PAUSED", "EXPIRED", "CLOSED"].includes(status);
}

function localizedTitle(language: DemoContentLanguage, category: string, ordinal: number): string {
  if (language === "FR") return `Spécialiste démo ${category} ${ordinal}`;
  if (language === "IT") return `Specialista demo ${category} ${ordinal}`;
  if (language === "EN") return `Demo specialist ${category} ${ordinal}`;
  return `Fachperson ${category} ${ordinal}`;
}

function localizedDescription(language: DemoContentLanguage, company: string, category: string): string {
  const suffix = ` Die Stelle gehört zu einem klar gekennzeichneten, vollständig fiktiven Demo-Datensatz von SwissTalentHub.`;
  if (language === "FR") return `${company} propose un rôle structuré dans le domaine ${category}, avec des responsabilités, un processus et des critères transparents.${suffix}`;
  if (language === "IT") return `${company} propone un ruolo strutturato nell'ambito ${category}, con responsabilità, processo e criteri trasparenti.${suffix}`;
  if (language === "EN") return `${company} offers a structured ${category} role with transparent responsibilities, process steps and review criteria.${suffix}`;
  return `${company} bietet eine klar strukturierte Aufgabe im Bereich ${category} mit transparenten Verantwortlichkeiten, Prozessschritten und Auswahlkriterien.${suffix}`;
}

function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function dateOrFallback(value: string | null, fallback: string): Date {
  return new Date(value ?? fallback);
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function assertValidAnchor(anchorAt: Date): void {
  if (!(anchorAt instanceof Date) || !Number.isFinite(anchorAt.getTime())) {
    throw new TypeError("The companies/jobs seed requires a valid anchorAt date.");
  }
}
