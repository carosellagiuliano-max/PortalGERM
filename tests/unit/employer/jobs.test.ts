import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildEmployerJobScopeWhere,
  getEmployerJobAiSuggestion,
  jobWizardStepOneSchema,
  jobWizardStepThreeSchema,
  jobWizardStepTwoSchema,
  resolveEmployerJobCapabilities,
  type EmployerJobAiOperation,
  type EmployerJobActor,
} from "@/lib/employer/jobs";

const NOW = new Date("2026-07-21T12:00:00.000Z");
const actor = (membershipRole: EmployerJobActor["membershipRole"]): EmployerJobActor => ({
  userId: "10000000-0000-4000-8000-000000000001",
  email: "employer@example.ch",
  membershipId: "10000000-0000-4000-8000-000000000002",
  companyId: "10000000-0000-4000-8000-000000000003",
  membershipRole,
});

describe("employer job capability matrix", () => {
  it.each(["OWNER", "ADMIN"] as const)("gives %s full company-job lifecycle access", (role) => {
    expect(resolveEmployerJobCapabilities(role, null)).toEqual({
      assignmentRole: null,
      readSummary: true,
      readFullRevision: true,
      mutateDraft: true,
      manageLifecycle: true,
    });
  });

  it("keeps Viewer on a closed summary DTO", () => {
    expect(resolveEmployerJobCapabilities("VIEWER", null)).toEqual({
      assignmentRole: null,
      readSummary: true,
      readFullRevision: false,
      mutateDraft: false,
      manageLifecycle: false,
    });
  });

  it.each([
    ["EDITOR", true, true],
    ["REVIEWER", true, false],
    ["PIPELINE", false, false],
  ] as const)("maps Recruiter %s without granting company lifecycle", (assignmentRole, fullRevision, mutation) => {
    expect(resolveEmployerJobCapabilities("RECRUITER", assignmentRole)).toEqual({
      assignmentRole,
      readSummary: true,
      readFullRevision: fullRevision,
      mutateDraft: mutation,
      manageLifecycle: false,
    });
  });

  it("denies an unassigned Recruiter", () => {
    expect(resolveEmployerJobCapabilities("RECRUITER", null).readSummary).toBe(false);
  });
});

describe("first resource-scoped job query", () => {
  it("binds recruiter access to the selected active membership and a current, non-revoked assignment", () => {
    const scope = buildEmployerJobScopeWhere(actor("RECRUITER"), NOW, { assignmentRoles: ["EDITOR"] });
    expect(scope).toMatchObject({
      companyId: actor("RECRUITER").companyId,
      company: {
        memberships: {
          some: {
            id: actor("RECRUITER").membershipId,
            userId: actor("RECRUITER").userId,
            role: "RECRUITER",
            status: "ACTIVE",
            removedAt: null,
          },
        },
      },
      assignments: {
        some: {
          companyId: actor("RECRUITER").companyId,
          membershipId: actor("RECRUITER").membershipId,
          userId: actor("RECRUITER").userId,
          role: { in: ["EDITOR"] },
          status: "ACTIVE",
          revokedAt: null,
          validFrom: { lte: NOW },
          OR: [{ expiresAt: null }, { expiresAt: { gt: NOW } }],
        },
      },
    });
  });

  it("does not require a job assignment for an active Owner membership", () => {
    expect(buildEmployerJobScopeWhere(actor("OWNER"), NOW)).not.toHaveProperty("assignments");
  });
});

describe("job wizard validation", () => {
  const stepOne = {
    title: "Senior Software Engineer",
    categoryId: "10000000-0000-4000-8000-000000000010",
    jobType: "PERMANENT",
    workloadMin: 80,
    workloadMax: 100,
    cantonId: "10000000-0000-4000-8000-000000000011",
    cityId: "10000000-0000-4000-8000-000000000012",
    locationLabel: "Zürich",
    remoteType: "HYBRID",
    remoteCountryCode: null,
    languages: [{ code: "de", minLevel: "B2" }],
    validThrough: new Date("2026-08-20T12:00:00.000Z"),
    startDate: null,
    startByArrangement: true,
  };

  it("enforces start-date XOR, workload order and unique language codes", () => {
    expect(jobWizardStepOneSchema.safeParse(stepOne).success).toBe(true);
    expect(jobWizardStepOneSchema.safeParse({ ...stepOne, startDate: new Date(), startByArrangement: true }).success).toBe(false);
    expect(jobWizardStepOneSchema.safeParse({ ...stepOne, workloadMin: 100, workloadMax: 80 }).success).toBe(false);
    expect(jobWizardStepOneSchema.safeParse({ ...stepOne, languages: [{ code: "de", minLevel: "B2" }, { code: "de", minLevel: "C1" }] }).success).toBe(false);
    expect(jobWizardStepOneSchema.safeParse({ ...stepOne, cityId: null }).success).toBe(false);
    expect(jobWizardStepOneSchema.safeParse({ ...stepOne, remoteCountryCode: "CH" }).success).toBe(false);
    expect(jobWizardStepOneSchema.safeParse({ ...stepOne, remoteType: "REMOTE", cantonId: null, cityId: null, remoteCountryCode: "CH" }).success).toBe(true);
    expect(jobWizardStepOneSchema.safeParse({ ...stepOne, languages: [] }).success).toBe(false);
  });

  it("preserves structured tasks, skills and versioned benefits", () => {
    expect(jobWizardStepTwoSchema.safeParse({
      companyIntro: "Wir entwickeln sichere digitale Dienste für Schweizer Unternehmen.",
      tasks: ["Sie planen wartbare Services für unsere zentrale Plattform."],
      requirements: ["Sie bringen fundierte Erfahrung mit TypeScript und Tests mit."],
      niceToHave: ["Erfahrung mit PostgreSQL ist für die Zusammenarbeit von Vorteil."],
      offer: "Wir bieten klare Arbeitsbedingungen und ein dokumentiertes Weiterbildungsbudget.",
      skillIds: ["10000000-0000-4000-8000-000000000020"],
      benefits: [{ benefitCode: "PAID_TRAINING", description: "Jährliches Weiterbildungsbudget von zweitausend Franken." }],
    }).success).toBe(true);
  });

  it("requires all-or-none salary data, exclusive NONE and a valid public contact", () => {
    const valid = {
      salaryPeriod: "YEARLY",
      salaryMin: 110_000,
      salaryMax: 130_000,
      responseTargetDays: 10,
      applicationProcessSteps: ["Online-Bewerbung und strukturierte Erstprüfung."],
      applicationEffort: "SIMPLE",
      requiredDocumentKinds: ["CV"],
      inclusionStatement: "Wir begrüssen Bewerbungen unabhängig von persönlichen Merkmalen.",
      applicationContactKind: "EMAIL",
      applicationContactValue: "jobs@example.ch",
    };
    expect(jobWizardStepThreeSchema.safeParse(valid).success).toBe(true);
    expect(jobWizardStepThreeSchema.safeParse({ ...valid, salaryMax: null }).success).toBe(false);
    expect(jobWizardStepThreeSchema.safeParse({ ...valid, requiredDocumentKinds: ["NONE", "CV"] }).success).toBe(false);
    expect(jobWizardStepThreeSchema.safeParse({ ...valid, applicationContactValue: "not-an-email" }).success).toBe(false);
  });

  it("rejects forged AI operations before any database or provider call", async () => {
    const result = await getEmployerJobAiSuggestion({
      jobId: "10000000-0000-4000-8000-000000000099",
      operation: "FORGED_OPERATION" as EmployerJobAiOperation,
      text: "Untrusted input",
    }, {
      actor: actor("OWNER"),
      correlationId: "10000000-0000-4000-8000-000000000098",
      database: {} as never,
      aiProvider: {} as never,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, code: "INVALID_INPUT" });
  });
});
