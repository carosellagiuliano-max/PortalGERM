import { describe, expect, it } from "vitest";

import {
  abuseStatusUpdateSchema,
  categorySchema,
  planSchema,
  productSchema,
} from "@/lib/validation/admin";
import {
  forgotPasswordSchema,
  loginSchema,
  passwordSchema,
  registerSchema,
} from "@/lib/validation/auth";
import {
  billingAddressSchema,
  checkoutSchema,
  leadFormSchema,
} from "@/lib/validation/billing";
import {
  applicationSchema,
  swissJobPassSchema,
} from "@/lib/validation/candidate";
import {
  companyProfileSchema,
  jobPostingApplicationSchema,
  jobPostingBasicsSchema,
  jobPostingConditionsSchema,
  jobPostingContentSchema,
  jobPostingFinalSchema,
  jobPostingLocationSchema,
} from "@/lib/validation/employer";

const ID = "11111111-1111-4111-8111-111111111111";
const ITEM = "Dieser strukturierte Text ist lang genug für die Validierung.";

const billingAddress = {
  legalName: "Talent AG",
  billingContactEmail: "billing@example.ch",
  street: "Bundesplatz 1",
  postalCode: "3000",
  city: "Bern",
  countryCode: "CH" as const,
};

const validJob = {
  title: "Senior Entwickler",
  description: "Eine transparente und ausführliche Stellenbeschreibung.",
  categoryId: ID,
  jobType: "PERMANENT" as const,
  tasks: [ITEM, `${ITEM} Zwei`, `${ITEM} Drei`],
  requirements: [ITEM, `${ITEM} Zwei`, `${ITEM} Drei`],
  benefits: [
    { benefitCode: "HOME_OFFICE" as const, description: ITEM },
    { benefitCode: "PAID_TRAINING" as const, description: ITEM },
  ],
  inclusionStatement:
    "Wir begrüssen qualifizierte Bewerbungen von allen Menschen ausdrücklich.",
  workloadMin: 60,
  workloadMax: 100,
  salaryMin: 90_000,
  salaryMax: 120_000,
  salaryPeriod: "YEARLY" as const,
  startByArrangement: true,
  validThrough: new Date("2026-10-01T00:00:00.000Z"),
  responseTargetDays: 14,
  remoteType: "REMOTE" as const,
  remoteCountryCode: "CH" as const,
  applicationEffort: "SIMPLE" as const,
  applicationProcessSteps: [ITEM],
  requiredDocumentKinds: ["CV" as const],
  applicationContactKind: "EMAIL" as const,
  applicationContactValue: "jobs@example.ch",
};

describe("auth validation", () => {
  it.each([
    "short",
    "onlylowercase1!",
    "ONLYUPPERCASE1!",
    "NoDigitsHere!",
    "NoSymbol123A",
  ])("rejects weak password %s", (password) =>
    expect(passwordSchema.safeParse(password).success).toBe(false),
  );

  it("normalizes auth emails and rejects mismatched registration confirmation", () => {
    expect(
      loginSchema.parse({ email: " User@Example.CH ", password: "x" }).email,
    ).toBe("user@example.ch");
    expect(forgotPasswordSchema.parse({ email: "A@B.CH" }).email).toBe(
      "a@b.ch",
    );
    expect(
      registerSchema.safeParse({
        email: "a@b.ch",
        password: "LongEnough1!",
        passwordConfirmation: "Different1!",
        name: "Ada Example",
        role: "CANDIDATE",
        acceptedTermsNoticeVersion: "v1",
      }).success,
    ).toBe(false);
  });
});

describe("candidate validation", () => {
  it("accepts a coherent SwissJobPass and rejects split salary fields", () => {
    const base = {
      publicDisplayName: "Ada E.",
      cantonId: ID,
      summary: "Erfahrene Fachperson mit einem transparenten Kompetenzprofil.",
      skillIds: [ID],
      languages: [{ code: "DE", level: "C1" }],
      acceptableCantonIds: [ID],
      workloadMin: 60,
      workloadMax: 80,
      jobTypes: ["PERMANENT"],
      remotePreference: "HYBRID",
    };
    expect(swissJobPassSchema.safeParse(base).success).toBe(true);
    expect(swissJobPassSchema.parse(base).languages[0]?.code).toBe("de");
    for (const code of ["12", "<>", "d1", "éé"]) {
      expect(
        swissJobPassSchema.safeParse({
          ...base,
          languages: [{ code, level: "C1" }],
        }).success,
      ).toBe(false);
    }
    expect(
      swissJobPassSchema.safeParse({ ...base, desiredSalaryMin: 80_000 })
        .success,
    ).toBe(false);
  });

  it("validates bounded application input and defaults document ids", () => {
    expect(
      applicationSchema.parse({
        jobId: ID,
        coverLetter:
          "Ich passe aufgrund meiner Erfahrung sehr gut zu dieser Stelle.",
        idempotencyKey: "application-1",
      }).documentMetadataIds,
    ).toEqual([]);
    expect(
      applicationSchema.safeParse({
        jobId: ID,
        candidateProfileId: ID,
        idempotencyKey: "application-2",
      }).success,
    ).toBe(false);
  });

  it.each(["\u0000", "\u0007", "\u202e", "\u2066"])(
    "rejects unsafe text control U+%s before persistence",
    (control) => {
      expect(
        applicationSchema.safeParse({
          jobId: ID,
          coverLetter: `Ich passe aufgrund meiner Erfahrung${control} sehr gut zu dieser Stelle.`,
          idempotencyKey: "application-safe-text",
        }).success,
      ).toBe(false);
      expect(
        loginSchema.safeParse({
          email: `user${control}@example.ch`,
          password: "LongEnough1!",
        }).success,
      ).toBe(false);
    },
  );
});

describe("employer validation", () => {
  it("exports working schemas for every wizard step and the final payload", () => {
    expect(
      companyProfileSchema.safeParse({
        name: "Talent AG",
        industry: "IT",
        size: "20-49",
        about: ITEM,
        values: ["Fairness"],
        benefits: ["Weiterbildung"],
      }).success,
    ).toBe(true);
    expect(
      jobPostingBasicsSchema.safeParse({
        title: validJob.title,
        description: validJob.description,
        categoryId: validJob.categoryId,
        jobType: validJob.jobType,
      }).success,
    ).toBe(true);
    expect(
      jobPostingContentSchema.safeParse({
        tasks: validJob.tasks,
        requirements: validJob.requirements,
        benefits: validJob.benefits,
        inclusionStatement: validJob.inclusionStatement,
      }).success,
    ).toBe(true);
    expect(
      jobPostingConditionsSchema.safeParse({
        workloadMin: validJob.workloadMin,
        workloadMax: validJob.workloadMax,
        salaryMin: validJob.salaryMin,
        salaryMax: validJob.salaryMax,
        salaryPeriod: validJob.salaryPeriod,
        startByArrangement: validJob.startByArrangement,
        validThrough: validJob.validThrough,
        responseTargetDays: validJob.responseTargetDays,
      }).success,
    ).toBe(true);
    expect(
      jobPostingLocationSchema.safeParse({
        remoteType: validJob.remoteType,
        remoteCountryCode: validJob.remoteCountryCode,
      }).success,
    ).toBe(true);
    expect(
      jobPostingApplicationSchema.safeParse({
        applicationEffort: validJob.applicationEffort,
        applicationProcessSteps: validJob.applicationProcessSteps,
        requiredDocumentKinds: validJob.requiredDocumentKinds,
        applicationContactKind: validJob.applicationContactKind,
        applicationContactValue: validJob.applicationContactValue,
      }).success,
    ).toBe(true);
    expect(jobPostingFinalSchema.safeParse(validJob).success).toBe(true);
    expect(
      jobPostingFinalSchema.safeParse({
        ...validJob,
        salaryMin: undefined,
        salaryMax: undefined,
        salaryPeriod: undefined,
        inclusionStatement: undefined,
      }).success,
    ).toBe(true);
  });

  it("rejects oversized raw text before normalization", () => {
    expect(
      jobPostingBasicsSchema.safeParse({
        title: ` ${"x".repeat(200)} `,
        description: validJob.description,
        categoryId: validJob.categoryId,
        jobType: validJob.jobType,
      }).success,
    ).toBe(false);
  });

  it.each([
    ["https://company.example.ch", true],
    ["http://company.example.ch/about", true],
    ["javascript:alert(document.domain)", false],
    ["data:text/html,<script>alert(1)</script>", false],
    ["ftp://company.example.ch", false],
    ["https://user:secret@company.example.ch", false],
  ] as const)(
    "accepts only safe absolute HTTP(S) company websites: %s",
    (website, expected) => {
      expect(
        companyProfileSchema.safeParse({
          name: "Talent AG",
          industry: "IT",
          size: "20-49",
          website,
          about: ITEM,
          values: ["Fairness"],
          benefits: ["Weiterbildung"],
        }).success,
      ).toBe(expected);
    },
  );

  it("enforces start XOR, remote CH, P0 documents and declared contact kind", () => {
    expect(
      jobPostingConditionsSchema.safeParse({
        workloadMin: 60,
        workloadMax: 100,
        salaryMin: 90_000,
        salaryMax: 120_000,
        salaryPeriod: "YEARLY",
        startDate: new Date(),
        startByArrangement: true,
        validThrough: new Date(),
        responseTargetDays: 14,
      }).success,
    ).toBe(false);
    expect(
      jobPostingLocationSchema.safeParse({ remoteType: "REMOTE" }).success,
    ).toBe(false);
    expect(
      jobPostingLocationSchema.safeParse({
        remoteType: "REMOTE",
        remoteCountryCode: "CH",
        cantonId: ID,
        cityId: ID,
      }).success,
    ).toBe(false);
    expect(
      jobPostingLocationSchema.safeParse({
        remoteType: "HYBRID",
        remoteCountryCode: "CH",
        cantonId: ID,
        cityId: ID,
      }).success,
    ).toBe(false);
    expect(
      jobPostingApplicationSchema.safeParse({
        applicationEffort: validJob.applicationEffort,
        applicationProcessSteps: validJob.applicationProcessSteps,
        requiredDocumentKinds: ["NONE", "CV"],
        applicationContactKind: validJob.applicationContactKind,
        applicationContactValue: validJob.applicationContactValue,
      }).success,
    ).toBe(false);
    expect(
      jobPostingApplicationSchema.safeParse({
        applicationEffort: validJob.applicationEffort,
        applicationProcessSteps: validJob.applicationProcessSteps,
        requiredDocumentKinds: validJob.requiredDocumentKinds,
        applicationContactKind: "PHONE",
        applicationContactValue: validJob.applicationContactValue,
      }).success,
    ).toBe(false);
  });

  it.each([
    ["https://jobs.example.ch/apply", true],
    ["http://jobs.example.ch/apply", true],
    ["javascript:alert(document.domain)", false],
    ["data:text/html,<script>alert(1)</script>", false],
    ["ftp://jobs.example.ch/apply", false],
    ["/relative/apply", false],
    ["https://user:secret@jobs.example.ch/apply", false],
  ] as const)(
    "accepts only safe absolute HTTP(S) APPLY_URL values: %s",
    (url, expected) => {
      const application = {
        applicationEffort: validJob.applicationEffort,
        applicationProcessSteps: validJob.applicationProcessSteps,
        requiredDocumentKinds: validJob.requiredDocumentKinds,
        applicationContactKind: "APPLY_URL" as const,
        applicationContactValue: url,
      };

      expect(jobPostingApplicationSchema.safeParse(application).success).toBe(
        expected,
      );
      expect(
        jobPostingFinalSchema.safeParse({
          ...validJob,
          applicationContactKind: application.applicationContactKind,
          applicationContactValue: application.applicationContactValue,
        }).success,
      ).toBe(expected);
    },
  );
});

describe("billing and admin validation", () => {
  it("validates billing address, exactly one checkout item and lead consent", () => {
    expect(billingAddressSchema.safeParse(billingAddress).success).toBe(true);
    expect(
      checkoutSchema.safeParse({
        companyId: ID,
        planVersionId: ID,
        clientIdempotencyKey: "checkout-1",
        billingAddress,
      }).success,
    ).toBe(true);
    expect(
      checkoutSchema.safeParse({
        companyId: ID,
        planVersionId: ID,
        productVersionId: ID,
        clientIdempotencyKey: "checkout-2",
        billingAddress,
      }).success,
    ).toBe(false);
    expect(
      leadFormSchema.safeParse({
        email: "sales@example.ch",
        companyName: "Talent AG",
        contactName: "Ada Example",
        phone: "+41 79 123 45 67",
        companySizeCode: "10_49",
        hiringNeedCode: "TWO_TO_FIVE",
        interestCode: "GENERAL",
        message:
          "Wir interessieren uns für das transparente Arbeitgeberangebot.",
        callbackWindowCode: "AFTERNOON",
        acceptedContactPurpose: "yes",
        idempotencyKey: "lead-intake-123",
        websiteConfirmation: "",
      }).success,
    ).toBe(true);
  });

  it("keeps all admin objects strict", () => {
    expect(
      planSchema.safeParse({
        code: "pro",
        name: "Pro",
        priceMode: "FIXED",
        billingInterval: "ANNUAL",
        termMonths: 12,
        netPriceRappen: 100_000,
        validFrom: new Date(),
      }).success,
    ).toBe(true);
    expect(
      productSchema.safeParse({
        code: "boost",
        name: "Boost",
        type: "JOB_BOOST",
        netPriceRappen: 2_000,
        validFrom: new Date(),
      }).success,
    ).toBe(true);
    expect(
      categorySchema.safeParse({
        name: "Engineering",
        slug: "engineering",
        sortOrder: 1,
      }).success,
    ).toBe(true);
    expect(
      abuseStatusUpdateSchema.safeParse({
        reportId: ID,
        status: "IN_REVIEW",
        severity: "HIGH",
        reasonCode: "TRIAGED",
        idempotencyKey: "abuse-review-1",
      }).success,
    ).toBe(true);
    expect(
      categorySchema.safeParse({
        name: "Engineering",
        slug: "Engineering",
        sortOrder: 1,
        unexpected: true,
      }).success,
    ).toBe(false);
  });
});
