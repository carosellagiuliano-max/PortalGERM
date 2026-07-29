import { randomUUID } from "node:crypto";

import type { AuthRequestContext } from "@/lib/auth/request-context";
import {
  parseEnvironment,
  type ServerEnvironment,
} from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import type { InterviewEmployerAccess } from "@/lib/recruiting/interviews";
import { createValidEnvironment } from "@/tests/fixtures/environment";
import {
  createPhase27PersonaFixture,
  type Phase27PersonaFixture,
} from "@/tests/fixtures/phase27-persona";

const DAY = 86_400_000;

export type Phase28RecruitingFixture = Readonly<{
  base: Phase27PersonaFixture;
  database: DatabaseClient;
  environment: ServerEnvironment;
  now: Date;
  candidateUserId: string;
  foreignCandidateUserId: string;
  candidateProfileId: string;
  foreignCandidateProfileId: string;
  employerUserId: string;
  companyId: string;
  membershipId: string;
  jobId: string;
  revisionId: string;
  applicationId: string;
  access: InterviewEmployerAccess;
  request: () => AuthRequestContext;
  dependencies: () => Readonly<{
    database: DatabaseClient;
    environment: ServerEnvironment;
    request: AuthRequestContext;
    now: Date;
  }>;
  dispose: () => Promise<void>;
}>;

export async function createPhase28RecruitingFixture(
  purpose: string,
): Promise<Phase28RecruitingFixture> {
  const base = await createPhase27PersonaFixture(`phase28_${purpose}`);
  try {
    const database = base.database;
    const environment = parseEnvironment(
      createValidEnvironment({
        DATABASE_URL: base.migrated.connectionString,
        APP_URL: "http://phase28-recruiting.test",
        EXTERNAL_APPLICATION_TRACKER: "test",
        INTERVIEW_SCHEDULER: "test",
        NOTIFICATION_OUTBOX_PRODUCERS: "false",
      }),
    );
    const foreignCandidateEmail =
      `phase28-foreign-${randomUUID()}@example.test`;
    const foreignCandidate = await database.user.create({
      data: {
        email: foreignCandidateEmail,
        emailNormalized: foreignCandidateEmail,
        name: "Phase 28 Foreign Candidate",
        role: "CANDIDATE",
        status: "ACTIVE",
        identityAssurance: "VERIFIED_EMAIL",
        emailVerifiedAt: base.now,
        dataProvenance: "TEST",
      },
    });
    await database.personaAssignment.create({
      data: {
        userId: foreignCandidate.id,
        kind: "CANDIDATE",
        source: "SELF_SERVICE",
        status: "ACTIVE",
        version: 1,
        activatedAt: base.now,
        createdAt: base.now,
        updatedAt: base.now,
        events: {
          create: {
            kind: "CREATED",
            toStatus: "ACTIVE",
            source: "SELF_SERVICE",
            reasonCode: "PHASE28_TEST",
            correlationId: randomUUID(),
            createdAt: base.now,
          },
        },
      },
    });
    const foreignCandidateProfile = await database.candidateProfile.create({
      data: {
        userId: foreignCandidate.id,
        onboardingStatus: "DRAFT",
        createdAt: base.now,
        updatedAt: base.now,
      },
    });
    const [candidateProfile, membership, canton, city] = await Promise.all([
      database.candidateProfile.findUniqueOrThrow({
        where: { userId: base.candidate.userId },
        select: { id: true },
      }),
      database.companyMembership.findFirstOrThrow({
        where: {
          companyId: base.companyAId,
          userId: base.employer.userId,
          status: "ACTIVE",
        },
        select: { id: true },
      }),
      database.canton.findFirstOrThrow({
        orderBy: { createdAt: "asc" },
        select: { id: true },
      }),
      database.city.findFirstOrThrow({
        orderBy: { createdAt: "asc" },
        select: { id: true },
      }),
    ]);
    const category = await database.category.create({
      data: {
        name: `Phase 28 Recruiting ${randomUUID().slice(0, 8)}`,
        slug: `phase28-recruiting-${randomUUID()}`,
      },
    });
    const job = await database.job.create({
      data: {
        companyId: base.companyAId,
        slug: `phase28-external-job-${randomUUID()}`,
        status: "DRAFT",
        origin: "MANUAL",
        sourceReference: "phase28-test",
        dataProvenance: "TEST",
        createdByUserId: base.employer.userId,
        createdAt: base.now,
        updatedAt: base.now,
      },
    });
    const validThrough = new Date(base.now.getTime() + 30 * DAY);
    const revision = await database.jobRevision.create({
      data: {
        jobId: job.id,
        revisionNumber: 1,
        title: "Phase 28 Software Engineer",
        description:
          "Isolierte Teststelle für externe Verläufe und Interviewtermine.",
        tasks: ["Sichere Recruiting-Abläufe testen."],
        requirements: ["Nachvollziehbare Arbeitsweise."],
        applicationProcessSteps: ["Auf Arbeitgeberseite bewerben."],
        requiredDocumentKinds: ["CV"],
        jobType: "PERMANENT",
        remoteType: "HYBRID",
        categoryId: category.id,
        cantonId: canton.id,
        cityId: city.id,
        locationLabel: "Zürich",
        workloadMin: 80,
        workloadMax: 100,
        validThrough,
        responseTargetDays: 7,
        applicationEffort: "SIMPLE",
        applicationContactKind: "APPLY_URL",
        applicationContactValue: "https://ats.example.test/jobs/phase-28",
        authoredByUserId: base.employer.userId,
        contentChecksum: randomUUID().replaceAll("-", "").padEnd(64, "0"),
        createdAt: base.now,
        updatedAt: base.now,
      },
    });
    await database.job.update({
      where: { id: job.id },
      data: {
        status: "PUBLISHED",
        currentRevisionId: revision.id,
        publishedRevisionId: revision.id,
        publishedAt: base.now,
        expiresAt: revision.validThrough,
        publishedCategoryId: revision.categoryId,
        publishedCantonId: revision.cantonId,
        publishedCityId: revision.cityId,
        publishedSalaryPeriod: revision.salaryPeriod,
        publishedSalaryMin: revision.salaryMin,
        publishedSalaryMax: revision.salaryMax,
        updatedAt: base.now,
      },
    });
    const application = await database.application.create({
      data: {
        jobId: job.id,
        submittedJobRevisionId: revision.id,
        candidateProfileId: candidateProfile.id,
        idempotencyKey: `phase28-application-${randomUUID()}`,
        submissionPayloadHash: "8".repeat(64),
        status: "SUBMITTED",
        submittedAt: base.now,
        updatedAt: base.now,
      },
    });
    const access = Object.freeze({
      companyId: base.companyAId,
      membershipId: membership.id,
      userId: base.employer.userId,
      membershipRole: "OWNER" as const,
    });
    const request = (): AuthRequestContext =>
      Object.freeze({
        correlationId: randomUUID(),
        expectedOrigin: environment.APP_URL,
        origin: environment.APP_URL,
        production: false,
        sourceIp: "127.0.0.1",
        userAgent: "SwissTalentHub Phase 28 integration test",
      });
    return Object.freeze({
      base,
      database,
      environment,
      now: base.now,
      candidateUserId: base.candidate.userId,
      foreignCandidateUserId: foreignCandidate.id,
      candidateProfileId: candidateProfile.id,
      foreignCandidateProfileId: foreignCandidateProfile.id,
      employerUserId: base.employer.userId,
      companyId: base.companyAId,
      membershipId: membership.id,
      jobId: job.id,
      revisionId: revision.id,
      applicationId: application.id,
      access,
      request,
      dependencies: () =>
        Object.freeze({
          database,
          environment,
          request: request(),
          now: base.now,
        }),
      dispose: () => base.dispose(),
    });
  } catch (error) {
    await base.dispose();
    throw error;
  }
}
