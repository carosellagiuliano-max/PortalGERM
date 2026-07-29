import { createHash } from "node:crypto";

import type { Prisma } from "@/lib/generated/prisma/client";
import {
  DEMO_ACCOUNTS,
  phase17Database,
} from "@/tests/e2e/fixtures/phase17-test";

const DAY = 86_400_000;

export const PHASE28_EXTERNAL_JOB_SLUG =
  "phase28-external-tracker-browser" as const;
export const PHASE28_EXTERNAL_APPLICATION_URL =
  "https://ats.phase28.example.test/jobs/software-engineer" as const;
export const PHASE28_INTERVIEW_SUBJECT =
  "Phase 28 Browser-Interview" as const;

const PHASE28_SOURCE_JOB_SELECT = {
  id: true,
  companyId: true,
  createdByUserId: true,
  dataProvenance: true,
  company: { select: { name: true, slug: true } },
  publishedRevision: {
    select: {
      id: true,
      contentLanguage: true,
      companyIntro: true,
      description: true,
      tasks: true,
      requirements: true,
      niceToHave: true,
      offer: true,
      applicationProcessSteps: true,
      requiredDocumentKinds: true,
      jobType: true,
      remoteType: true,
      remoteCountryCode: true,
      categoryId: true,
      cantonId: true,
      cityId: true,
      locationLabel: true,
      workloadMin: true,
      workloadMax: true,
      salaryPeriod: true,
      salaryMin: true,
      salaryMax: true,
      startDate: true,
      startByArrangement: true,
      responseTargetDays: true,
      applicationEffort: true,
      inclusionStatement: true,
      applicationContactKind: true,
      applicationContactValue: true,
    },
  },
} as const satisfies Prisma.JobSelect;

type Phase28SourceJob = Prisma.JobGetPayload<{
  select: typeof PHASE28_SOURCE_JOB_SELECT;
}>;

export type Phase28BrowserFixture = Readonly<{
  applicationId: string;
  candidateProfileId: string;
  candidateUserId: string;
  companyId: string;
  employerUserId: string;
  externalJobId: string;
  externalJobRevisionId: string;
  externalJobSlug: typeof PHASE28_EXTERNAL_JOB_SLUG;
}>;

export async function ensurePhase28BrowserFixture(): Promise<Phase28BrowserFixture> {
  const database = phase17Database();
  try {
    await database.rateLimitBucket.deleteMany({
      where: { namespace: { startsWith: "v1:LOGIN:" } },
    });
    const [candidate, employer, sourceJob] = await Promise.all([
      database.user.findUniqueOrThrow({
        where: { emailNormalized: DEMO_ACCOUNTS.candidate },
        select: {
          id: true,
          email: true,
          candidateProfile: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      }),
      database.user.findUniqueOrThrow({
        where: { emailNormalized: DEMO_ACCOUNTS.employer },
        select: { id: true },
      }),
      database.job.findUniqueOrThrow({
        where: { slug: "zh-engineering-demo-024" },
        select: PHASE28_SOURCE_JOB_SELECT,
      }),
    ]);
    if (candidate.candidateProfile === null) {
      throw new Error("Phase 28 requires the seeded candidate profile.");
    }
    if (sourceJob.publishedRevision === null) {
      throw new Error("Phase 28 requires the seeded published job revision.");
    }
    const membership = await database.companyMembership.findFirstOrThrow({
      where: {
        companyId: sourceJob.companyId,
        userId: employer.id,
        role: "OWNER",
        status: "ACTIVE",
        removedAt: null,
      },
      select: { id: true },
    });

    const external = await ensureExternalJob(
      database,
      sourceJob,
      employer.id,
    );
    const existingApplication = await database.application.findUnique({
      where: {
        jobId_candidateProfileId: {
          jobId: sourceJob.id,
          candidateProfileId: candidate.candidateProfile.id,
        },
      },
      select: { id: true },
    });
    const submittedAt = new Date();
    const application =
      existingApplication ??
      (await database.application.create({
        data: {
          jobId: sourceJob.id,
          submittedJobRevisionId: sourceJob.publishedRevision.id,
          candidateProfileId: candidate.candidateProfile.id,
          idempotencyKey: "phase28-browser-application",
          submissionPayloadHash: sha256("phase28-browser-application"),
          status: "SUBMITTED",
          submittedAt,
          events: {
            create: {
              actorUserId: candidate.id,
              kind: "STATUS_CHANGE",
              toStatus: "SUBMITTED",
              idempotencyKey: "phase28-browser-application-event",
              correlationId: "phase28-browser-fixture",
            },
          },
          submissionSnapshot: {
            create: {
              jobRevision: {
                connect: { id: sourceJob.publishedRevision.id },
              },
              candidateFirstName:
                candidate.candidateProfile.firstName ?? "Demo",
              candidateLastName:
                candidate.candidateProfile.lastName ?? "Kandidatin",
              candidateEmail: candidate.email,
              recipientCompanyName: sourceJob.company.name,
              applicationContactKind:
                sourceJob.publishedRevision.applicationContactKind,
              applicationContactValue:
                sourceJob.publishedRevision.applicationContactValue,
              responseTargetDays:
                sourceJob.publishedRevision.responseTargetDays,
              applicationEffort:
                sourceJob.publishedRevision.applicationEffort,
              requiredDocumentKinds:
                sourceJob.publishedRevision.requiredDocumentKinds,
              confirmationNoticeVersion: "phase28-browser-v1",
              confirmationNoticeHash: sha256(
                "phase28-browser-confirmation-notice",
              ),
              confirmationSnapshotHash: sha256(
                "phase28-browser-confirmation-snapshot",
              ),
              submittedAt,
            },
          },
        },
        select: { id: true },
      }));

    void membership;
    return Object.freeze({
      applicationId: application.id,
      candidateProfileId: candidate.candidateProfile.id,
      candidateUserId: candidate.id,
      companyId: sourceJob.companyId,
      employerUserId: employer.id,
      externalJobId: external.id,
      externalJobRevisionId: external.revisionId,
      externalJobSlug: PHASE28_EXTERNAL_JOB_SLUG,
    });
  } finally {
    await database.$disconnect();
  }
}

export async function ensurePhase28QualityRecords(
  fixture: Phase28BrowserFixture,
) {
  const database = phase17Database();
  try {
    const now = new Date();
    const externalJob = await database.job.findUniqueOrThrow({
      where: { id: fixture.externalJobId },
      select: {
        slug: true,
        companyId: true,
        company: { select: { name: true, slug: true } },
        publishedRevision: {
          select: {
            id: true,
            title: true,
            applicationContactValue: true,
          },
        },
      },
    });
    if (externalJob.publishedRevision === null) {
      throw new Error("Phase 28 quality job has no published revision.");
    }
    const qualityFingerprint = sha256("phase28-quality-external-tracker");
    const existingTracker =
      await database.externalApplicationTracker.findUnique({
        where: {
          candidateProfileId_snapshotFingerprint: {
            candidateProfileId: fixture.candidateProfileId,
            snapshotFingerprint: qualityFingerprint,
          },
        },
        select: { id: true },
      });
    const tracker =
      existingTracker ??
      (await database.externalApplicationTracker.create({
        data: {
          candidateProfileId: fixture.candidateProfileId,
          source: "CANDIDATE_CONFIRMED",
          status: "BEGUN",
          snapshotFingerprint: qualityFingerprint,
          version: 1,
          createdAt: now,
          updatedAt: now,
          snapshot: {
            create: {
              sourceJobId: fixture.externalJobId,
              sourceJobRevisionId: externalJob.publishedRevision.id,
              jobSlug: externalJob.slug,
              jobTitle: `${externalJob.publishedRevision.title} – Qualität`,
              companyId: externalJob.companyId,
              companyName: externalJob.company.name,
              companySlug: externalJob.company.slug,
              applicationUrl:
                externalJob.publishedRevision.applicationContactValue,
              applicationUrlHash: sha256(
                externalJob.publishedRevision.applicationContactValue,
              ),
              payloadHash: qualityFingerprint,
              source: "CANDIDATE_CONFIRMED",
              capturedAt: now,
            },
          },
          events: {
            create: {
              kind: "CREATED",
              toStatus: "BEGUN",
              source: "CANDIDATE_CONFIRMED",
              actorUserId: fixture.candidateUserId,
              idempotencyKey: "phase28-quality-external-created",
              correlationId: "phase28-quality-fixture",
              createdAt: now,
            },
          },
        },
        select: { id: true },
      }));

    const existingInterview = await database.interview.findFirst({
      where: {
        applicationId: fixture.applicationId,
        subject: "Phase 28 Qualitätsinterview",
      },
      select: { id: true },
    });
    const start = new Date(now.getTime() + 8 * DAY);
    const end = new Date(start.getTime() + 45 * 60_000);
    const interview =
      existingInterview ??
      (await database.interview.create({
        data: {
          applicationId: fixture.applicationId,
          companyId: fixture.companyId,
          candidateProfileId: fixture.candidateProfileId,
          status: "PROPOSED",
          timeZone: "Europe/Zurich",
          subject: "Phase 28 Qualitätsinterview",
          location: "Video",
          createdByUserId: fixture.employerUserId,
          updatedByUserId: fixture.employerUserId,
          createdAt: now,
          updatedAt: now,
          participants: {
            create: [
              {
                userId: fixture.candidateUserId,
                kind: "CANDIDATE",
                status: "PENDING",
                required: true,
                createdAt: now,
              },
              {
                userId: fixture.employerUserId,
                kind: "COMPANY_MEMBER",
                status: "ACCEPTED",
                required: true,
                respondedAt: now,
                createdAt: now,
              },
            ],
          },
          proposals: {
            create: {
              version: 1,
              slotIndex: 1,
              startsAt: start,
              endsAt: end,
              timeZone: "Europe/Zurich",
              status: "OPEN",
              createdByUserId: fixture.employerUserId,
              expiresAt: new Date(now.getTime() + 7 * DAY),
              createdAt: now,
            },
          },
          events: {
            create: {
              kind: "PROPOSED",
              actorUserId: fixture.employerUserId,
              proposalVersion: 1,
              idempotencyKey: "phase28-quality-interview-proposed",
              correlationId: "phase28-quality-fixture",
              createdAt: now,
            },
          },
        },
        select: { id: true },
      }));
    return Object.freeze({
      interviewId: interview.id,
      trackerId: tracker.id,
    });
  } finally {
    await database.$disconnect();
  }
}

export function phase28LocalSlot(
  daysFromNow: number,
  startHour: number,
  durationMinutes = 45,
) {
  const date = new Date(Date.now() + daysFromNow * DAY);
  const calendar = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Zurich",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
  const startMinutes = startHour * 60;
  const endMinutes = startMinutes + durationMinutes;
  return Object.freeze({
    startsAtLocal: `${calendar.year}-${calendar.month}-${calendar.day}T${clock(startMinutes)}`,
    endsAtLocal: `${calendar.year}-${calendar.month}-${calendar.day}T${clock(endMinutes)}`,
  });
}

async function ensureExternalJob(
  database: ReturnType<typeof phase17Database>,
  sourceJob: Phase28SourceJob,
  employerUserId: string,
) {
  const sourceRevision = sourceJob.publishedRevision;
  if (sourceRevision === null) {
    throw new Error("Phase 28 source job has no published revision.");
  }
  const existing = await database.job.findUnique({
    where: { slug: PHASE28_EXTERNAL_JOB_SLUG },
    select: { id: true, publishedRevisionId: true },
  });
  if (existing?.publishedRevisionId !== null && existing?.publishedRevisionId !== undefined) {
    return Object.freeze({
      id: existing.id,
      revisionId: existing.publishedRevisionId,
    });
  }
  const now = new Date();
  const validThrough = new Date(now.getTime() + 30 * DAY);
  return database.$transaction(async (transaction) => {
    const job =
      existing ??
      (await transaction.job.create({
        data: {
          companyId: sourceJob.companyId,
          slug: PHASE28_EXTERNAL_JOB_SLUG,
          status: "DRAFT",
          origin: "MANUAL",
          sourceReference: "phase28-browser-fixture",
          dataProvenance: "TEST",
          createdByUserId: employerUserId,
          createdAt: now,
          updatedAt: now,
        },
        select: { id: true },
      }));
    const revision = await transaction.jobRevision.create({
      data: {
        jobId: job.id,
        revisionNumber: 1,
        contentLanguage: sourceRevision.contentLanguage,
        title: "Phase 28 External Software Engineer",
        companyIntro: sourceRevision.companyIntro,
        description:
          "Fiktive Stelle für den browserbasierten Nachweis des freiwilligen externen Bewerbungsverlaufs.",
        tasks: sourceRevision.tasks,
        requirements: sourceRevision.requirements,
        niceToHave: sourceRevision.niceToHave,
        offer: sourceRevision.offer,
        applicationProcessSteps: [
          "Bewerbung auf der fiktiven Arbeitgeberseite fortsetzen.",
        ],
        requiredDocumentKinds: sourceRevision.requiredDocumentKinds,
        jobType: sourceRevision.jobType,
        remoteType: sourceRevision.remoteType,
        remoteCountryCode: sourceRevision.remoteCountryCode,
        categoryId: sourceRevision.categoryId,
        cantonId: sourceRevision.cantonId,
        cityId: sourceRevision.cityId,
        locationLabel: sourceRevision.locationLabel,
        workloadMin: sourceRevision.workloadMin,
        workloadMax: sourceRevision.workloadMax,
        salaryPeriod: sourceRevision.salaryPeriod,
        salaryMin: sourceRevision.salaryMin,
        salaryMax: sourceRevision.salaryMax,
        startDate: sourceRevision.startDate,
        startByArrangement: sourceRevision.startByArrangement,
        validThrough,
        responseTargetDays: sourceRevision.responseTargetDays,
        applicationEffort: sourceRevision.applicationEffort,
        inclusionStatement: sourceRevision.inclusionStatement,
        applicationContactKind: "APPLY_URL",
        applicationContactValue: PHASE28_EXTERNAL_APPLICATION_URL,
        authoredByUserId: employerUserId,
        contentChecksum: sha256("phase28-external-job-revision-v1"),
        submittedAt: now,
        approvedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      select: {
        id: true,
        categoryId: true,
        cantonId: true,
        cityId: true,
        salaryPeriod: true,
        salaryMin: true,
        salaryMax: true,
      },
    });
    await transaction.job.update({
      where: { id: job.id },
      data: {
        status: "PUBLISHED",
        currentRevisionId: revision.id,
        publishedRevisionId: revision.id,
        publishedAt: now,
        expiresAt: validThrough,
        publishedCategoryId: revision.categoryId,
        publishedCantonId: revision.cantonId,
        publishedCityId: revision.cityId,
        publishedSalaryPeriod: revision.salaryPeriod,
        publishedSalaryMin: revision.salaryMin,
        publishedSalaryMax: revision.salaryMax,
        updatedAt: now,
      },
    });
    return Object.freeze({ id: job.id, revisionId: revision.id });
  });
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function clock(minutes: number) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
