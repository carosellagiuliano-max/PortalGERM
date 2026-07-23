import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  rejectAdminJob,
  requestAdminJobChanges,
  startAdminJobReview,
} from "@/lib/admin/jobs";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import {
  closeEmployerJob,
  createEmployerJobDraft,
  createEmployerJobRevisionFromPaused,
  createEmployerJobRevisionFromRejected,
  duplicateEmployerJob,
  getEmployerJobDetail,
  listEmployerJobs,
  pauseAndCreateEmployerJobRevision,
  pauseEmployerJob,
  reactivateEmployerJob,
  runEmployerJobReportingCheck,
  saveEmployerJobStep,
  submitEmployerJobForReview,
  type EmployerJobCommandResult,
  type EmployerJobActor,
  type JobCommandEnvelope,
  type JobWizardStepOne,
  type JobWizardStepThree,
  type JobWizardStepTwo,
} from "@/lib/employer/jobs";
import { createJobSlug } from "@/lib/jobs/slug";
import { MockJobroomProvider } from "@/lib/providers/jobroom";
import {
  JOBROOM_FIXTURE_IDS,
  JOBROOM_LEGAL_DISCLAIMER,
  OCCUPATION_CODES_2026_FIXTURE,
} from "@/lib/providers/jobroom/fixtures/occupation-codes-2026";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

type MigratedDatabase = Awaited<ReturnType<typeof createMigratedTestDatabase>>;
let migrated: MigratedDatabase | undefined;
let database: DatabaseClient | undefined;

const id = (sequence: number) => `a1000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
const IDS = {
  recruiter: id(1),
  ownerOther: id(2),
  company: id(3),
  otherCompany: id(4),
  recruiterMembership: id(5),
  ownerOtherMembership: id(6),
  category: id(7),
  canton: id(8),
  city: id(9),
  primaryOwner: id(10),
  primaryOwnerMembership: id(11),
  skill: id(12),
  occupationVersion: id(13),
  freePlan: id(14),
  freePlanVersion: id(15),
  verification: id(16),
  materialEditJob: id(17),
  materialEditRevision: id(18),
  pausedCloneJob: id(19),
  pausedCloneRevision: id(20),
  rejectedCloneJob: id(21),
  rejectedCloneRevision: id(22),
  closeJob: id(23),
  closeRevision: id(24),
  admin: id(25),
};
const NOW = new Date("2026-07-21T12:00:00.000Z");
const recruiterActor: EmployerJobActor = {
  userId: IDS.recruiter,
  email: "recruiter-job-test@example.ch",
  membershipId: IDS.recruiterMembership,
  membershipRole: "RECRUITER",
  companyId: IDS.company,
};
const ownerActor: EmployerJobActor = {
  userId: IDS.primaryOwner,
  email: "primary-owner@example.ch",
  membershipId: IDS.primaryOwnerMembership,
  membershipRole: "OWNER",
  companyId: IDS.company,
};

beforeAll(async () => {
  migrated = await createMigratedTestDatabase("phase10_employer_jobs");
  database = createDatabaseClient(migrated.connectionString);
  await seed(database);
});

afterAll(async () => {
  await database?.$disconnect();
  await migrated?.dispose();
});

describe("Phase 10 employer jobs PostgreSQL boundary", () => {
  it("creates a Recruiter draft and EDITOR self-assignment atomically and replays once", async () => {
    const client = getDatabase();
    const input = {
      title: "Sichere Plattform Engineer Position",
      categoryId: IDS.category,
      jobType: "PERMANENT" as const,
      workloadMin: 80,
      workloadMax: 100,
      cantonId: IDS.canton,
      cityId: IDS.city,
      locationLabel: "Zürich",
      remoteType: "HYBRID" as const,
      remoteCountryCode: null,
      languages: [{ code: "de", minLevel: "B2" as const }],
      validThrough: new Date(NOW.getTime() + 30 * 86_400_000),
      startDate: null,
      startByArrangement: true,
      idempotencyKey: "phase10-recruiter-draft-once",
    };
    const dependencies = { actor: recruiterActor, correlationId: id(100), database: client, now: NOW };
    const first = await createEmployerJobDraft(input, dependencies);
    const replay = await createEmployerJobDraft(input, dependencies);
    if (!first.ok) throw new Error(`Initial draft creation failed with ${first.code}: ${first.issues?.join(", ") ?? "no details"}.`);
    expect(first.ok).toBe(true);
    expect(replay).toEqual({ ok: true, value: first.value, replay: true });

    const [job, assignments, assignmentEvents, draftEvents, audits] = await Promise.all([
      client.job.findUnique({ where: { id: first.value.jobId }, select: { companyId: true, slug: true, status: true, version: true, currentRevisionId: true } }),
      client.jobAssignment.findMany({ where: { jobId: first.value.jobId }, select: { membershipId: true, userId: true, role: true, status: true, revokedAt: true } }),
      client.jobAssignmentEvent.count({ where: { jobAssignment: { jobId: first.value.jobId }, kind: "ASSIGNED" } }),
      client.jobStatusEvent.count({ where: { jobId: first.value.jobId, kind: "DRAFT_CREATED" } }),
      client.auditLog.count({ where: { companyId: IDS.company, action: { in: ["JOB_DRAFT_UPDATED", "JOB_ASSIGNMENT_CREATED"] } } }),
    ]);
    expect(job).toMatchObject({
      companyId: IDS.company,
      slug: createJobSlug({
        title: input.title,
        companyShortRef: "job-test-ag",
        jobId: first.value.jobId,
      }),
      status: "DRAFT",
      version: 1,
      currentRevisionId: first.value.revisionId,
    });
    expect(assignments).toEqual([{ membershipId: IDS.recruiterMembership, userId: IDS.recruiter, role: "EDITOR", status: "ACTIVE", revokedAt: null }]);
    expect(assignmentEvents).toBe(1);
    expect(draftEvents).toBe(1);
    expect(audits).toBe(2);

    const duplicateInput = {
      jobId: first.value.jobId,
      expectedJobVersion: first.value.jobVersion,
      expectedRevisionVersion: first.value.revisionVersion,
      idempotencyKey: "phase10-recruiter-duplicate-once",
    };
    const duplicated = await duplicateEmployerJob(duplicateInput, dependencies);
    const duplicatedReplay = await duplicateEmployerJob(duplicateInput, dependencies);
    if (!duplicated.ok) throw new Error(`Job duplication failed with ${duplicated.code}.`);
    expect(duplicated.value.jobId).not.toBe(first.value.jobId);
    expect(duplicatedReplay).toEqual({ ok: true, value: duplicated.value, replay: true });
    const duplicatedJob = await client.job.findUniqueOrThrow({
      where: { id: duplicated.value.jobId },
      select: {
        slug: true,
        status: true,
        version: true,
        sourceReference: true,
        publishedRevisionId: true,
        currentRevision: {
          select: {
            revisionNumber: true,
            version: true,
            title: true,
            submittedAt: true,
            approvedAt: true,
            rejectedAt: true,
            languages: { select: { code: true, minLevel: true } },
          },
        },
        assignments: { select: { membershipId: true, userId: true, role: true, status: true } },
        statusEvents: { select: { kind: true, reasonCode: true } },
        _count: { select: { additionalPermits: true, boosts: true } },
      },
    });
    expect(duplicatedJob).toMatchObject({
      slug: createJobSlug({
        title: input.title,
        companyShortRef: "job-test-ag",
        jobId: duplicated.value.jobId,
      }),
      status: "DRAFT",
      version: 1,
      sourceReference: `duplicate:${first.value.jobId}`,
      publishedRevisionId: null,
      currentRevision: {
        revisionNumber: 1,
        version: 1,
        title: input.title,
        submittedAt: null,
        approvedAt: null,
        rejectedAt: null,
        languages: [{ code: "de", minLevel: "B2" }],
      },
      assignments: [{ membershipId: IDS.recruiterMembership, userId: IDS.recruiter, role: "EDITOR", status: "ACTIVE" }],
      statusEvents: [{ kind: "DRAFT_CREATED", reasonCode: "DUPLICATED" }],
      _count: { additionalPermits: 0, boosts: 0 },
    });
    expect(await client.job.count({ where: { sourceReference: `duplicate:${first.value.jobId}` } })).toBe(1);

    const stableSlug = duplicatedJob.slug;
    const renamed = requireSuccess(
      await saveEmployerJobStep(
        {
          ...jobEnvelope(duplicated.value, "phase10-duplicate-title-edit"),
          step: 1,
          data: validStepOne("Umbenannte sichere Plattform-Position"),
        },
        dependencies,
      ),
      "duplicate title edit",
    );
    expect(renamed.value.jobId).toBe(duplicated.value.jobId);
    await expect(client.job.findUniqueOrThrow({
      where: { id: duplicated.value.jobId },
      select: { slug: true },
    })).resolves.toEqual({ slug: stableSlug });
  });

  it("persists every wizard step, reporting evidence and one concurrent submission", async () => {
    const client = getDatabase();
    const dependencies = ownerDependencies(client, id(101));
    const created = requireSuccess(
      await createEmployerJobDraft(
        {
          ...validStepOne("Senior Platform Engineer Integration"),
          idempotencyKey: "phase10-owner-complete-draft",
        },
        dependencies,
      ),
      "owner draft creation",
    );

    const incomplete = await submitEmployerJobForReview(
      jobEnvelope(created.value, "phase10-incomplete-submit"),
      dependencies,
    );
    expect(incomplete).toMatchObject({ ok: false, code: "INCOMPLETE" });
    if (!incomplete.ok) {
      expect(incomplete.issues).toEqual(
        expect.arrayContaining(["companyIntro", "reportingCheck"]),
      );
    }

    const stepTwoInput = {
      ...jobEnvelope(created.value, "phase10-save-step-two"),
      step: 2 as const,
      data: validStepTwo(),
    };
    const savedStepTwo = requireSuccess(
      await saveEmployerJobStep(stepTwoInput, dependencies),
      "step two save",
    );
    const stepTwoReplay = requireSuccess(
      await saveEmployerJobStep(stepTwoInput, dependencies),
      "step two replay",
    );
    expect(stepTwoReplay).toEqual({
      ok: true,
      value: savedStepTwo.value,
      replay: true,
    });

    await expect(
      saveEmployerJobStep(
        {
          ...jobEnvelope(created.value, "phase10-stale-step-two"),
          step: 2,
          data: {
            ...validStepTwo(),
            offer:
              "Dieser veraltete Tab darf die neuere Job-Revision nicht überschreiben.",
          },
        },
        dependencies,
      ),
    ).resolves.toEqual({ ok: false, code: "CONFLICT" });

    const savedStepThree = requireSuccess(
      await saveEmployerJobStep(
        {
          ...jobEnvelope(savedStepTwo.value, "phase10-save-step-three"),
          step: 3,
          data: validStepThree(),
        },
        dependencies,
      ),
      "step three save",
    );

    const reportingInput = {
      ...jobEnvelope(savedStepThree.value, "phase10-reporting-check"),
      occupationCodeId: JOBROOM_FIXTURE_IDS.notRequired,
    };
    const reportingDependencies = {
      ...dependencies,
      jobroomProvider: new MockJobroomProvider({ now: () => NOW }),
    };
    const checked = requireSuccess(
      await runEmployerJobReportingCheck(
        reportingInput,
        reportingDependencies,
      ),
      "reporting check",
    );
    const checkReplay = requireSuccess(
      await runEmployerJobReportingCheck(
        reportingInput,
        reportingDependencies,
      ),
      "reporting check replay",
    );
    expect(checkReplay).toEqual({
      ok: true,
      value: checked.value,
      replay: true,
    });

    const submitInput = jobEnvelope(
      checked.value,
      "phase10-concurrent-submit",
    );
    const [firstSubmitResult, secondSubmitResult] = await Promise.all([
      submitEmployerJobForReview(submitInput, dependencies),
      submitEmployerJobForReview(submitInput, dependencies),
    ]);
    const firstSubmit = requireSuccess(
      firstSubmitResult,
      "first concurrent submit",
    );
    const secondSubmit = requireSuccess(
      secondSubmitResult,
      "second concurrent submit",
    );
    expect(firstSubmit.value).toEqual(secondSubmit.value);
    expect(
      Number(Boolean(firstSubmit.replay)) +
        Number(Boolean(secondSubmit.replay)),
    ).toBe(1);
    await expect(
      submitEmployerJobForReview(submitInput, dependencies),
    ).resolves.toEqual({
      ok: true,
      value: firstSubmit.value,
      replay: true,
    });

    const [job, reportingCheck, scoreCount, events, audits] =
      await Promise.all([
        client.job.findUniqueOrThrow({
          where: { id: created.value.jobId },
          select: {
            status: true,
            version: true,
            currentRevisionId: true,
            currentRevision: {
              select: {
                version: true,
                submittedAt: true,
                tasks: true,
                requirements: true,
                niceToHave: true,
                offer: true,
                salaryMin: true,
                salaryMax: true,
                applicationProcessSteps: true,
                requiredDocumentKinds: true,
                languages: {
                  orderBy: { code: "asc" },
                  select: { code: true, minLevel: true },
                },
                skills: { select: { skillId: true, required: true } },
                benefits: {
                  select: {
                    benefitCode: true,
                    description: true,
                    sortOrder: true,
                  },
                },
              },
            },
          },
        }),
        client.jobReportingCheck.findUniqueOrThrow({
          where: { id: checked.value.checkId },
          select: {
            jobRevisionId: true,
            result: true,
            disclaimerSnapshot: true,
            sourceSnapshot: true,
            datasetVersionSnapshot: true,
            dataYearSnapshot: true,
            referenceUrlSnapshot: true,
            occupationCodeSnapshot: true,
          },
        }),
        client.jobScoreSnapshot.count({
          where: { jobRevisionId: created.value.revisionId },
        }),
        client.jobStatusEvent.findMany({
          where: { jobId: created.value.jobId },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { kind: true, reasonCode: true, idempotencyKey: true },
        }),
        client.auditLog.findMany({
          where: {
            companyId: IDS.company,
            targetId: { in: [created.value.jobId, created.value.revisionId] },
          },
          select: { action: true },
        }),
      ]);

    expect(job).toMatchObject({
      status: "SUBMITTED",
      version: 5,
      currentRevisionId: created.value.revisionId,
      currentRevision: {
        version: 5,
        submittedAt: NOW,
        tasks: validStepTwo().tasks,
        requirements: validStepTwo().requirements,
        niceToHave: validStepTwo().niceToHave,
        offer: validStepTwo().offer,
        salaryMin: validStepThree().salaryMin,
        salaryMax: validStepThree().salaryMax,
        applicationProcessSteps: validStepThree().applicationProcessSteps,
        requiredDocumentKinds: validStepThree().requiredDocumentKinds,
        languages: [{ code: "de", minLevel: "B2" }],
        skills: [{ skillId: IDS.skill, required: true }],
        benefits: [
          {
            benefitCode: "PAID_TRAINING",
            description:
              "Ein dokumentiertes jährliches Weiterbildungsbudget steht zur Verfügung.",
            sortOrder: 0,
          },
        ],
      },
    });
    expect(reportingCheck).toEqual({
      jobRevisionId: created.value.revisionId,
      result: "NOT_REQUIRED",
      disclaimerSnapshot: JOBROOM_LEGAL_DISCLAIMER,
      sourceSnapshot: OCCUPATION_CODES_2026_FIXTURE.source,
      datasetVersionSnapshot: OCCUPATION_CODES_2026_FIXTURE.datasetVersion,
      dataYearSnapshot: OCCUPATION_CODES_2026_FIXTURE.dataYear,
      referenceUrlSnapshot: OCCUPATION_CODES_2026_FIXTURE.sourceUrl,
      occupationCodeSnapshot: "MOCK-CHISCO-0002",
    });
    expect(scoreCount).toBe(1);
    expect(events.map(({ kind }) => kind)).toEqual([
      "DRAFT_CREATED",
      "DRAFT_UPDATED",
      "DRAFT_UPDATED",
      "DRAFT_UPDATED",
      "SUBMITTED",
    ]);
    expect(
      events.filter(({ idempotencyKey }) =>
        idempotencyKey.includes("phase10-concurrent-submit"),
      ),
    ).toHaveLength(1);
    expect(audits.map(({ action }) => action).sort()).toEqual(
      [
        "JOB_DRAFT_UPDATED",
        "JOB_DRAFT_UPDATED",
        "JOB_DRAFT_UPDATED",
        "JOB_REPORTING_CHECKED",
        "JOB_SUBMITTED",
      ].sort(),
    );

    const adminDependencies = {
      actor: {
        userId: IDS.admin,
        email: "admin-job-test@example.ch",
        role: "ADMIN" as const,
        status: "ACTIVE" as const,
      },
      correlationId: id(201),
      database: client,
      now: new Date(NOW.getTime() + 1_000),
    };
    const firstReview = await startAdminJobReview(
      {
        jobId: firstSubmit.value.jobId,
        expectedJobVersion: firstSubmit.value.jobVersion,
        expectedRevisionVersion: firstSubmit.value.revisionVersion,
        idempotencyKey: id(202),
      },
      adminDependencies,
    );
    if (!firstReview.ok) {
      throw new Error(`Admin review start failed with ${firstReview.code}.`);
    }
    const changes = await requestAdminJobChanges(
      {
        jobId: firstReview.value.jobId,
        expectedJobVersion: firstReview.value.jobVersion,
        expectedRevisionVersion: firstReview.value.revisionVersion,
        reasonCode: "CONTENT_CLARIFICATION_REQUIRED",
        idempotencyKey: id(203),
      },
      { ...adminDependencies, correlationId: id(204) },
    );
    if (!changes.ok) {
      throw new Error(`Admin changes request failed with ${changes.code}.`);
    }
    const editedAfterChanges = requireSuccess(
      await saveEmployerJobStep(
        {
          ...jobEnvelope(changes.value, id(205)),
          step: 2,
          data: {
            ...validStepTwo(),
            offer:
              "Wir bieten klare Arbeitsbedingungen, sichere Ausgabekodierung und ein festes Weiterbildungsbudget.",
          },
        },
        {
          ...dependencies,
          correlationId: id(206),
          now: new Date(NOW.getTime() + 2_000),
        },
      ),
      "edit after requested changes",
    );
    const recheckedAfterChanges = requireSuccess(
      await runEmployerJobReportingCheck(
        {
          ...jobEnvelope(editedAfterChanges.value, id(207)),
          occupationCodeId: JOBROOM_FIXTURE_IDS.notRequired,
        },
        {
          ...reportingDependencies,
          correlationId: id(208),
          now: new Date(NOW.getTime() + 3_000),
        },
      ),
      "reporting check after requested changes",
    );
    const resubmitted = requireSuccess(
      await submitEmployerJobForReview(
        jobEnvelope(recheckedAfterChanges.value, id(209)),
        {
          ...dependencies,
          correlationId: id(210),
          now: new Date(NOW.getTime() + 4_000),
        },
      ),
      "resubmit after requested changes",
    );
    const secondReview = await startAdminJobReview(
      {
        ...jobEnvelope(resubmitted.value, id(211)),
      },
      {
        ...adminDependencies,
        correlationId: id(212),
        now: new Date(NOW.getTime() + 5_000),
      },
    );
    if (!secondReview.ok) {
      throw new Error(`Second admin review start failed with ${secondReview.code}.`);
    }
    const rejected = await rejectAdminJob(
      {
        ...jobEnvelope(secondReview.value, id(213)),
        reasonCode: "QUALITY_REQUIREMENTS_NOT_MET",
      },
      {
        ...adminDependencies,
        correlationId: id(214),
        now: new Date(NOW.getTime() + 6_000),
      },
    );
    if (!rejected.ok) {
      throw new Error(`Admin rejection failed with ${rejected.code}.`);
    }
    const reviewAuditActions = await client.auditLog.findMany({
      where: {
        targetId: created.value.jobId,
        action: { in: ["JOB_CHANGES_REQUESTED", "JOB_REJECTED"] },
      },
      select: { action: true, targetType: true },
    });
    expect(reviewAuditActions).toEqual(
      expect.arrayContaining([
        { action: "JOB_CHANGES_REQUESTED", targetType: "JOB" },
        { action: "JOB_REJECTED", targetType: "JOB" },
      ]),
    );
  });

  it("serializes pause, unchanged reactivation and material-edit revision creation", async () => {
    const client = getDatabase();
    const dependencies = ownerDependencies(client, id(102));
    const initial = fixtureVersion(IDS.materialEditJob);

    await expect(
      pauseEmployerJob(
        {
          ...initial,
          expectedJobVersion: initial.expectedJobVersion + 1,
          idempotencyKey: "phase10-stale-pause",
        },
        dependencies,
      ),
    ).resolves.toEqual({ ok: false, code: "CONFLICT" });

    const pauseInput = {
      ...initial,
      idempotencyKey: "phase10-pause-unchanged",
    };
    const paused = requireSuccess(
      await pauseEmployerJob(pauseInput, dependencies),
      "pause unchanged",
    );
    await expect(pauseEmployerJob(pauseInput, dependencies)).resolves.toEqual({
      ok: true,
      value: paused.value,
      replay: true,
    });

    const reactivateInput = jobEnvelope(
      paused.value,
      "phase10-reactivate-concurrent",
    );
    const [firstReactivateResult, secondReactivateResult] = await Promise.all([
      reactivateEmployerJob(reactivateInput, dependencies),
      reactivateEmployerJob(reactivateInput, dependencies),
    ]);
    const firstReactivate = requireSuccess(
      firstReactivateResult,
      "first concurrent reactivation",
    );
    const secondReactivate = requireSuccess(
      secondReactivateResult,
      "second concurrent reactivation",
    );
    expect(firstReactivate.value).toEqual(secondReactivate.value);
    expect(
      Number(Boolean(firstReactivate.replay)) +
        Number(Boolean(secondReactivate.replay)),
    ).toBe(1);

    const materialEditInput = jobEnvelope(
      firstReactivate.value,
      "phase10-material-edit-concurrent",
    );
    const [firstEditResult, secondEditResult] = await Promise.all([
      pauseAndCreateEmployerJobRevision(materialEditInput, dependencies),
      pauseAndCreateEmployerJobRevision(materialEditInput, dependencies),
    ]);
    const firstEdit = requireSuccess(
      firstEditResult,
      "first concurrent material-edit clone",
    );
    const secondEdit = requireSuccess(
      secondEditResult,
      "second concurrent material-edit clone",
    );
    expect(firstEdit.value).toEqual(secondEdit.value);
    expect(
      Number(Boolean(firstEdit.replay)) +
        Number(Boolean(secondEdit.replay)),
    ).toBe(1);
    expect(firstEdit.value.revisionId).not.toBe(IDS.materialEditRevision);

    const [job, revisions, events] = await Promise.all([
      client.job.findUniqueOrThrow({
        where: { id: IDS.materialEditJob },
        select: {
          status: true,
          version: true,
          currentRevisionId: true,
          publishedRevisionId: true,
          publishedAt: true,
        },
      }),
      client.jobRevision.findMany({
        where: { jobId: IDS.materialEditJob },
        orderBy: { revisionNumber: "asc" },
        select: {
          id: true,
          revisionNumber: true,
          version: true,
          title: true,
          submittedAt: true,
          approvedAt: true,
          rejectedAt: true,
        },
      }),
      client.jobStatusEvent.findMany({
        where: { jobId: IDS.materialEditJob },
        select: { kind: true, reasonCode: true, idempotencyKey: true },
      }),
    ]);

    expect(job).toMatchObject({
      status: "DRAFT",
      version: 4,
      currentRevisionId: firstEdit.value.revisionId,
      publishedRevisionId: IDS.materialEditRevision,
    });
    expect(job.publishedAt).not.toBeNull();
    expect(revisions).toHaveLength(2);
    expect(revisions[0]).toMatchObject({
      id: IDS.materialEditRevision,
      revisionNumber: 1,
      version: 1,
      submittedAt: expect.any(Date),
      approvedAt: expect.any(Date),
      rejectedAt: null,
    });
    expect(revisions[1]).toMatchObject({
      id: firstEdit.value.revisionId,
      revisionNumber: 2,
      version: 1,
      title: revisions[0]?.title,
      submittedAt: null,
      approvedAt: null,
      rejectedAt: null,
    });
    expect(events.filter(({ kind }) => kind === "PAUSED")).toHaveLength(2);
    expect(events.filter(({ kind }) => kind === "REACTIVATED")).toHaveLength(1);
    expect(
      events.filter(({ kind }) => kind === "REVISION_REOPENED"),
    ).toHaveLength(1);
    expect(
      events.filter(({ idempotencyKey }) =>
        idempotencyKey.includes("phase10-reactivate-concurrent"),
      ),
    ).toHaveLength(1);
    const lifecycleAudits = await client.auditLog.findMany({
      where: {
        targetId: IDS.materialEditJob,
        action: { in: ["JOB_PAUSED", "JOB_REACTIVATED"] },
      },
      select: { action: true, targetType: true },
    });
    expect(lifecycleAudits).toEqual(
      expect.arrayContaining([
        { action: "JOB_PAUSED", targetType: "JOB" },
        { action: "JOB_REACTIVATED", targetType: "JOB" },
      ]),
    );
  });

  it("closes once and clones paused or rejected evidence exactly once", async () => {
    const client = getDatabase();
    const dependencies = ownerDependencies(client, id(103));

    const closeInput = {
      ...fixtureVersion(IDS.closeJob),
      idempotencyKey: "phase10-close-once",
    };
    const closed = requireSuccess(
      await closeEmployerJob(closeInput, dependencies),
      "close published job",
    );
    await expect(closeEmployerJob(closeInput, dependencies)).resolves.toEqual({
      ok: true,
      value: closed.value,
      replay: true,
    });
    await expect(
      closeEmployerJob(
        { ...closeInput, idempotencyKey: "phase10-close-stale" },
        dependencies,
      ),
    ).resolves.toEqual({ ok: false, code: "CONFLICT" });

    const paused = requireSuccess(
      await pauseEmployerJob(
        {
          ...fixtureVersion(IDS.pausedCloneJob),
          idempotencyKey: "phase10-pause-before-clone",
        },
        dependencies,
      ),
      "pause before clone",
    );
    await expect(
      createEmployerJobRevisionFromPaused(
        {
          ...fixtureVersion(IDS.pausedCloneJob),
          idempotencyKey: "phase10-paused-clone-stale",
        },
        dependencies,
      ),
    ).resolves.toEqual({ ok: false, code: "CONFLICT" });

    const pausedCloneInput = jobEnvelope(
      paused.value,
      "phase10-paused-clone-concurrent",
    );
    const [firstPausedResult, secondPausedResult] = await Promise.all([
      createEmployerJobRevisionFromPaused(pausedCloneInput, dependencies),
      createEmployerJobRevisionFromPaused(pausedCloneInput, dependencies),
    ]);
    const firstPausedClone = requireSuccess(
      firstPausedResult,
      "first paused clone",
    );
    const secondPausedClone = requireSuccess(
      secondPausedResult,
      "second paused clone",
    );
    expect(firstPausedClone.value).toEqual(secondPausedClone.value);
    expect(
      Number(Boolean(firstPausedClone.replay)) +
        Number(Boolean(secondPausedClone.replay)),
    ).toBe(1);

    const rejectedCloneInput = {
      ...fixtureVersion(IDS.rejectedCloneJob),
      idempotencyKey: "phase10-rejected-clone-concurrent",
    };
    const [firstRejectedResult, secondRejectedResult] = await Promise.all([
      createEmployerJobRevisionFromRejected(rejectedCloneInput, dependencies),
      createEmployerJobRevisionFromRejected(rejectedCloneInput, dependencies),
    ]);
    const firstRejectedClone = requireSuccess(
      firstRejectedResult,
      "first rejected clone",
    );
    const secondRejectedClone = requireSuccess(
      secondRejectedResult,
      "second rejected clone",
    );
    expect(firstRejectedClone.value).toEqual(secondRejectedClone.value);
    expect(
      Number(Boolean(firstRejectedClone.replay)) +
        Number(Boolean(secondRejectedClone.replay)),
    ).toBe(1);

    const [closedJob, pausedJob, rejectedJob, reopenedEvents] =
      await Promise.all([
        client.job.findUniqueOrThrow({
          where: { id: IDS.closeJob },
          select: { status: true, version: true },
        }),
        client.job.findUniqueOrThrow({
          where: { id: IDS.pausedCloneJob },
          select: {
            status: true,
            version: true,
            currentRevisionId: true,
            publishedRevisionId: true,
            revisions: {
              orderBy: { revisionNumber: "asc" },
              select: {
                id: true,
                submittedAt: true,
                approvedAt: true,
                rejectedAt: true,
              },
            },
          },
        }),
        client.job.findUniqueOrThrow({
          where: { id: IDS.rejectedCloneJob },
          select: {
            status: true,
            version: true,
            currentRevisionId: true,
            publishedRevisionId: true,
            revisions: {
              orderBy: { revisionNumber: "asc" },
              select: {
                id: true,
                submittedAt: true,
                approvedAt: true,
                rejectedAt: true,
              },
            },
          },
        }),
        client.jobStatusEvent.findMany({
          where: {
            jobId: { in: [IDS.pausedCloneJob, IDS.rejectedCloneJob] },
            kind: "REVISION_REOPENED",
          },
          select: { jobId: true, reasonCode: true },
        }),
      ]);

    expect(closedJob).toEqual({ status: "CLOSED", version: 2 });
    expect(pausedJob).toMatchObject({
      status: "DRAFT",
      version: 3,
      currentRevisionId: firstPausedClone.value.revisionId,
      publishedRevisionId: IDS.pausedCloneRevision,
    });
    expect(pausedJob.revisions).toHaveLength(2);
    expect(pausedJob.revisions[0]).toMatchObject({
      id: IDS.pausedCloneRevision,
      submittedAt: expect.any(Date),
      approvedAt: expect.any(Date),
      rejectedAt: null,
    });
    expect(pausedJob.revisions[1]).toMatchObject({
      id: firstPausedClone.value.revisionId,
      submittedAt: null,
      approvedAt: null,
      rejectedAt: null,
    });
    expect(rejectedJob).toMatchObject({
      status: "DRAFT",
      version: 2,
      currentRevisionId: firstRejectedClone.value.revisionId,
      publishedRevisionId: null,
    });
    expect(rejectedJob.revisions).toHaveLength(2);
    expect(rejectedJob.revisions[0]).toMatchObject({
      id: IDS.rejectedCloneRevision,
      submittedAt: expect.any(Date),
      approvedAt: null,
      rejectedAt: expect.any(Date),
    });
    expect(rejectedJob.revisions[1]).toMatchObject({
      id: firstRejectedClone.value.revisionId,
      submittedAt: null,
      approvedAt: null,
      rejectedAt: null,
    });
    expect(reopenedEvents).toEqual(
      expect.arrayContaining([
        {
          jobId: IDS.pausedCloneJob,
          reasonCode: "PAUSED_REVISION_CLONED",
        },
        {
          jobId: IDS.rejectedCloneJob,
          reasonCode: "REJECTED_REVISION_CLONED",
        },
      ]),
    );
    expect(reopenedEvents).toHaveLength(2);
    await expect(
      client.auditLog.findFirstOrThrow({
        where: { action: "JOB_CLOSED", targetId: IDS.closeJob },
        select: { targetType: true, result: true },
      }),
    ).resolves.toEqual({ targetType: "JOB", result: "SUCCEEDED" });
  });

  it("returns zero cross-tenant IDs and drops access immediately after assignment expiry", async () => {
    const client = getDatabase();
    const jobs = await listEmployerJobs(recruiterActor, client, NOW);
    expect(jobs.length).toBeGreaterThanOrEqual(2);
    const source = await client.job.findFirst({ where: { sourceReference: `employer:${IDS.recruiterMembership}` }, select: { id: true } });
    if (source === null) throw new Error("Source job unavailable.");
    const jobId = source.id;
    const otherActor: EmployerJobActor = { userId: IDS.ownerOther, email: "other-owner@example.ch", membershipId: IDS.ownerOtherMembership, membershipRole: "OWNER", companyId: IDS.otherCompany };
    expect(await getEmployerJobDetail(otherActor, jobId, client, NOW)).toBeNull();

    const expiresAt = new Date(NOW.getTime() + 86_400_000);
    await client.jobAssignment.updateMany({ where: { companyId: IDS.company, userId: IDS.recruiter }, data: { expiresAt } });
    expect(await listEmployerJobs(recruiterActor, client, expiresAt)).toEqual([]);
    expect(await getEmployerJobDetail(recruiterActor, jobId, client, expiresAt)).toBeNull();
  });

  it("keeps a submitted revision and its children immutable while allowing one moderation timestamp", async () => {
    const client = getDatabase();
    const job = await client.job.findFirstOrThrow({
      where: { sourceReference: { startsWith: "duplicate:" } },
      select: {
        currentRevisionId: true,
        currentRevision: {
          select: { id: true, title: true, languages: { select: { id: true } } },
        },
      },
    });
    const revision = job.currentRevision;
    if (job.currentRevisionId === null || revision === null) {
      throw new Error("The duplicated revision fixture is unavailable.");
    }

    await client.jobRevision.update({
      where: { id: revision.id },
      data: { submittedAt: NOW },
    });
    await expect(
      client.jobRevision.update({
        where: { id: revision.id },
        data: { title: `${revision.title} – unzulässig` },
      }),
    ).rejects.toBeDefined();
    const language = revision.languages[0];
    if (language === undefined) throw new Error("The language fixture is unavailable.");
    await expect(
      client.jobRevisionLanguage.update({
        where: { id: language.id },
        data: { minLevel: "C1" },
      }),
    ).rejects.toBeDefined();

    const approvedAt = new Date(NOW.getTime() + 1_000);
    await expect(
      client.jobRevision.update({
        where: { id: revision.id },
        data: { approvedAt },
      }),
    ).resolves.toMatchObject({ approvedAt });
    await expect(
      client.jobRevision.update({
        where: { id: revision.id },
        data: { rejectedAt: new Date(NOW.getTime() + 2_000) },
      }),
    ).rejects.toBeDefined();
    await expect(
      client.jobRevision.update({
        where: { id: revision.id },
        data: { submittedAt: null },
      }),
    ).rejects.toBeDefined();
  });
});

async function seed(client: DatabaseClient) {
  await client.user.createMany({ data: [
    { id: IDS.recruiter, email: "recruiter-job-test@example.ch", emailNormalized: "recruiter-job-test@example.ch", role: "RECRUITER" },
    { id: IDS.ownerOther, email: "other-owner@example.ch", emailNormalized: "other-owner@example.ch", role: "EMPLOYER" },
    { id: IDS.primaryOwner, email: "primary-owner@example.ch", emailNormalized: "primary-owner@example.ch", role: "EMPLOYER" },
    { id: IDS.admin, email: "admin-job-test@example.ch", emailNormalized: "admin-job-test@example.ch", role: "ADMIN" },
  ] });
  await client.company.createMany({ data: [
    { id: IDS.company, name: "Job Test AG", slug: "job-test-ag", industry: "Technology", size: "10-49", website: "https://job-test.example.test", about: "A complete company used for isolated employer job tests.", status: "DRAFT", values: [], benefits: [], dataProvenance: "TEST" },
    { id: IDS.otherCompany, name: "Other Tenant AG", slug: "other-tenant-ag", industry: "Technology", size: "10-49", website: "https://other-tenant.example.test", about: "A complete second company used to verify tenant isolation.", status: "DRAFT", values: [], benefits: [], dataProvenance: "TEST" },
  ] });
  await client.category.create({ data: { id: IDS.category, name: "Engineering", slug: "phase10-engineering" } });
  await client.canton.create({ data: { id: IDS.canton, code: "ZH", name: "Zürich", slug: "phase10-zuerich", language: "DE" } });
  await client.city.create({ data: { id: IDS.city, cantonId: IDS.canton, name: "Zürich", slug: "phase10-zuerich" } });
  await client.skill.create({
    data: {
      id: IDS.skill,
      name: "Phase 10 PostgreSQL",
      slug: "phase10-postgresql",
    },
  });
  const occupation = OCCUPATION_CODES_2026_FIXTURE.occupationCodes.find(
    ({ id: occupationId }) => occupationId === JOBROOM_FIXTURE_IDS.notRequired,
  );
  if (occupation === undefined) {
    throw new Error("The current Job-Room fixture is unavailable.");
  }
  await client.occupationCodeVersion.create({
    data: {
      id: IDS.occupationVersion,
      datasetKey: OCCUPATION_CODES_2026_FIXTURE.datasetKey,
      datasetYear: OCCUPATION_CODES_2026_FIXTURE.dataYear,
      version: OCCUPATION_CODES_2026_FIXTURE.datasetVersion,
      source: OCCUPATION_CODES_2026_FIXTURE.source,
      referenceUrl: OCCUPATION_CODES_2026_FIXTURE.sourceUrl,
      disclaimer: OCCUPATION_CODES_2026_FIXTURE.disclaimer,
      validFrom: new Date(OCCUPATION_CODES_2026_FIXTURE.validFrom),
      validTo: new Date(OCCUPATION_CODES_2026_FIXTURE.validTo),
    },
  });
  await client.occupationCode.create({
    data: {
      id: occupation.id,
      occupationCodeVersionId: IDS.occupationVersion,
      code: occupation.code,
      label: occupation.label,
      result: occupation.result,
      effectiveFrom:
        occupation.effectiveFrom === null
          ? null
          : new Date(occupation.effectiveFrom),
      effectiveTo:
        occupation.effectiveTo === null
          ? null
          : new Date(occupation.effectiveTo),
    },
  });
  await client.companyLocation.createMany({ data: [
    { companyId: IDS.company, cantonId: IDS.canton, cityId: IDS.city, isPrimary: true },
    { companyId: IDS.otherCompany, cantonId: IDS.canton, cityId: IDS.city, isPrimary: true },
  ] });
  await client.companyMembership.createMany({ data: [
    { id: IDS.primaryOwnerMembership, companyId: IDS.company, userId: IDS.primaryOwner, role: "OWNER", status: "ACTIVE" },
    { id: IDS.recruiterMembership, companyId: IDS.company, userId: IDS.recruiter, role: "RECRUITER", status: "ACTIVE" },
    { id: IDS.ownerOtherMembership, companyId: IDS.otherCompany, userId: IDS.ownerOther, role: "OWNER", status: "ACTIVE" },
  ] });
  await client.company.updateMany({ where: { id: { in: [IDS.company, IDS.otherCompany] } }, data: { status: "ACTIVE" } });
  await client.companyVerificationRequest.create({
    data: {
      id: IDS.verification,
      companyId: IDS.company,
      requestedByUserId: IDS.primaryOwner,
      status: "VERIFIED",
      evidenceMetadata: { fixture: "phase10-job-lifecycle" },
    },
  });
  await seedDefaultPlan(client);
  await createLifecycleJob(client, {
    jobId: IDS.materialEditJob,
    revisionId: IDS.materialEditRevision,
    slug: "phase10-material-edit-job",
    title: "Material Edit Lifecycle Engineer",
    status: "PUBLISHED",
    checksumCharacter: "a",
  });
  await createLifecycleJob(client, {
    jobId: IDS.pausedCloneJob,
    revisionId: IDS.pausedCloneRevision,
    slug: "phase10-paused-clone-job",
    title: "Paused Clone Lifecycle Engineer",
    status: "PUBLISHED",
    checksumCharacter: "b",
  });
  await createLifecycleJob(client, {
    jobId: IDS.rejectedCloneJob,
    revisionId: IDS.rejectedCloneRevision,
    slug: "phase10-rejected-clone-job",
    title: "Rejected Clone Lifecycle Engineer",
    status: "REJECTED",
    checksumCharacter: "c",
  });
  await createLifecycleJob(client, {
    jobId: IDS.closeJob,
    revisionId: IDS.closeRevision,
    slug: "phase10-close-job",
    title: "Close Lifecycle Engineer",
    status: "PUBLISHED",
    checksumCharacter: "d",
  });
}

function validStepOne(title: string): JobWizardStepOne {
  return {
    title,
    categoryId: IDS.category,
    jobType: "PERMANENT",
    workloadMin: 80,
    workloadMax: 100,
    cantonId: IDS.canton,
    cityId: IDS.city,
    locationLabel: "Zürich",
    remoteType: "HYBRID",
    remoteCountryCode: null,
    languages: [{ code: "de", minLevel: "B2" }],
    validThrough: new Date(NOW.getTime() + 60 * 86_400_000),
    startDate: null,
    startByArrangement: true,
  };
}

function validStepTwo(): JobWizardStepTwo {
  return {
    companyIntro:
      "Wir entwickeln sichere digitale Dienste für Schweizer Unternehmen.",
    tasks: [
      "Sie planen und implementieren robuste Plattformdienste für das Recruiting.",
    ],
    requirements: [
      "Sie bringen fundierte Erfahrung mit TypeScript und PostgreSQL mit.",
    ],
    niceToHave: [
      "Erfahrung mit transaktionalen Nebenläufigkeitstests ist von Vorteil.",
    ],
    offer:
      "Wir bieten transparente Arbeitsbedingungen und ein festes Weiterbildungsbudget.",
    skillIds: [IDS.skill],
    benefits: [
      {
        benefitCode: "PAID_TRAINING",
        description:
          "Ein dokumentiertes jährliches Weiterbildungsbudget steht zur Verfügung.",
      },
    ],
  };
}

function validStepThree(): JobWizardStepThree {
  return {
    salaryPeriod: "YEARLY",
    salaryMin: 110_000,
    salaryMax: 130_000,
    responseTargetDays: 7,
    applicationProcessSteps: [
      "Online-Bewerbung mit strukturierter Erstprüfung.",
      "Fachgespräch mit transparenter Rückmeldung.",
    ],
    applicationEffort: "SIMPLE",
    requiredDocumentKinds: ["CV"],
    inclusionStatement:
      "Wir begrüssen Bewerbungen unabhängig von persönlichen Merkmalen.",
    applicationContactKind: "EMAIL",
    applicationContactValue: "jobs@job-test.example.test",
  };
}

function ownerDependencies(
  client: DatabaseClient,
  correlationId: string,
) {
  return {
    actor: ownerActor,
    correlationId,
    database: client,
    now: NOW,
  } as const;
}

function jobEnvelope(
  value: Readonly<{
    jobId: string;
    jobVersion: number;
    revisionVersion: number;
  }>,
  idempotencyKey: string,
): JobCommandEnvelope {
  return {
    jobId: value.jobId,
    expectedJobVersion: value.jobVersion,
    expectedRevisionVersion: value.revisionVersion,
    idempotencyKey,
  };
}

function fixtureVersion(
  jobId: string,
): Omit<JobCommandEnvelope, "idempotencyKey"> {
  return {
    jobId,
    expectedJobVersion: 1,
    expectedRevisionVersion: 1,
  };
}

function requireSuccess<TValue>(
  result: EmployerJobCommandResult<TValue>,
  operation: string,
): Extract<EmployerJobCommandResult<TValue>, { ok: true }> {
  if (!result.ok) {
    throw new Error(
      `${operation} failed with ${result.code}: ${result.issues?.join(", ") ?? "no details"}.`,
    );
  }
  return result;
}

async function seedDefaultPlan(client: DatabaseClient) {
  await client.plan.create({
    data: {
      id: IDS.freePlan,
      code: "phase10-job-test-free",
      name: "Phase 10 Job Test Free",
      isDefaultFree: true,
    },
  });
  await client.planVersion.create({
    data: {
      id: IDS.freePlanVersion,
      planId: IDS.freePlan,
      version: 1,
      status: "DRAFT",
      priceMode: "FIXED",
      billingInterval: "MONTHLY",
      termMonths: 1,
      netPriceRappen: 0,
      monthlyEquivalentRappen: 0,
      validFrom: new Date(NOW.getTime() - 86_400_000),
    },
  });
  await client.planEntitlement.createMany({
    data: [
      {
        planVersionId: IDS.freePlanVersion,
        key: "ACTIVE_JOB_LIMIT",
        valueType: "INTEGER",
        integerValue: 10,
      },
      {
        planVersionId: IDS.freePlanVersion,
        key: "SEAT_LIMIT",
        valueType: "INTEGER",
        integerValue: 10,
      },
      {
        planVersionId: IDS.freePlanVersion,
        key: "TALENT_RADAR_ACCESS",
        valueType: "BOOLEAN",
        booleanValue: false,
      },
      {
        planVersionId: IDS.freePlanVersion,
        key: "TALENT_CONTACT_ALLOWANCE",
        valueType: "INTEGER",
        integerValue: 0,
      },
      {
        planVersionId: IDS.freePlanVersion,
        key: "JOB_BOOST_ALLOWANCE",
        valueType: "INTEGER",
        integerValue: 0,
      },
      {
        planVersionId: IDS.freePlanVersion,
        key: "ANALYTICS_LEVEL",
        valueType: "ANALYTICS_LEVEL",
        analyticsLevelValue: "NONE",
      },
      {
        planVersionId: IDS.freePlanVersion,
        key: "ENHANCED_COMPANY_PROFILE",
        valueType: "BOOLEAN",
        booleanValue: false,
      },
      {
        planVersionId: IDS.freePlanVersion,
        key: "EMPLOYER_IMPORT_ACCESS",
        valueType: "BOOLEAN",
        booleanValue: false,
      },
    ],
  });
  await client.planVersion.update({
    where: { id: IDS.freePlanVersion },
    data: { status: "ACTIVE" },
  });
}

async function createLifecycleJob(
  client: DatabaseClient,
  input: Readonly<{
    jobId: string;
    revisionId: string;
    slug: string;
    title: string;
    status: "PUBLISHED" | "REJECTED";
    checksumCharacter: string;
  }>,
) {
  const validThrough = new Date(NOW.getTime() + 60 * 86_400_000);
  const submittedAt = new Date(NOW.getTime() - 2 * 86_400_000);
  const reviewedAt = new Date(NOW.getTime() - 86_400_000);
  await client.job.create({
    data: {
      id: input.jobId,
      companyId: IDS.company,
      slug: input.slug,
      status: "DRAFT",
      sourceReference: `integration:${input.slug}`,
      createdByUserId: IDS.primaryOwner,
    },
  });
  await client.jobRevision.create({
    data: {
      id: input.revisionId,
      jobId: input.jobId,
      revisionNumber: 1,
      title: input.title,
      companyIntro:
        "Wir betreiben eine nachvollziehbare Testfirma für Job-Lebenszyklen.",
      description:
        "Wir betreiben eine nachvollziehbare Testfirma für Job-Lebenszyklen.",
      tasks: ["Zuverlässige Lebenszyklusübergänge implementieren und prüfen."],
      requirements: [
        "Fundierte Erfahrung mit transaktionalen PostgreSQL-Abläufen.",
      ],
      niceToHave: ["Erfahrung mit reproduzierbaren Nebenläufigkeitstests."],
      offer: "Transparente Bedingungen und ein dokumentiertes Lernbudget.",
      applicationProcessSteps: [
        "Bewerbung einreichen und strukturierte Rückmeldung erhalten.",
      ],
      requiredDocumentKinds: ["CV"],
      jobType: "PERMANENT",
      remoteType: "HYBRID",
      categoryId: IDS.category,
      cantonId: IDS.canton,
      cityId: IDS.city,
      locationLabel: "Zürich",
      workloadMin: 80,
      workloadMax: 100,
      salaryPeriod: "YEARLY",
      salaryMin: 105_000,
      salaryMax: 125_000,
      startByArrangement: true,
      validThrough,
      responseTargetDays: 7,
      applicationEffort: "SIMPLE",
      inclusionStatement:
        "Wir begrüssen Bewerbungen unabhängig von persönlichen Merkmalen.",
      applicationContactKind: "EMAIL",
      applicationContactValue: "jobs@job-test.example.test",
      authoredByUserId: IDS.primaryOwner,
      contentChecksum: input.checksumCharacter.repeat(64),
    },
  });
  await client.jobRevisionLanguage.create({
    data: {
      jobRevisionId: input.revisionId,
      code: "de",
      minLevel: "B2",
    },
  });
  await client.jobRevisionSkill.create({
    data: {
      jobRevisionId: input.revisionId,
      skillId: IDS.skill,
      required: true,
    },
  });
  await client.jobRevisionBenefit.create({
    data: {
      jobRevisionId: input.revisionId,
      benefitCode: "PAID_TRAINING",
      description:
        "Ein dokumentiertes jährliches Weiterbildungsbudget steht zur Verfügung.",
      sortOrder: 0,
    },
  });
  await client.jobRevision.update({
    where: { id: input.revisionId },
    data: { submittedAt },
  });
  await client.jobRevision.update({
    where: { id: input.revisionId },
    data:
      input.status === "PUBLISHED"
        ? { approvedAt: reviewedAt }
        : { rejectedAt: reviewedAt },
  });
  if (input.status === "REJECTED") {
    await client.job.update({
      where: { id: input.jobId },
      data: { status: "REJECTED", currentRevisionId: input.revisionId },
    });
    return;
  }
  await client.job.update({
    where: { id: input.jobId },
    data: {
      status: "PUBLISHED",
      currentRevisionId: input.revisionId,
      publishedRevisionId: input.revisionId,
      publishedAt: reviewedAt,
      expiresAt: validThrough,
      publishedCategoryId: IDS.category,
      publishedCantonId: IDS.canton,
      publishedCityId: IDS.city,
      publishedSalaryPeriod: "YEARLY",
      publishedSalaryMin: 105_000,
      publishedSalaryMax: 125_000,
    },
  });
}

function getDatabase() {
  if (database === undefined) throw new Error("Database unavailable.");
  return database;
}
