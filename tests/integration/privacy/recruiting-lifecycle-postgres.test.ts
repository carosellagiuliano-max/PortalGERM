import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PHASE22_DATA_INVENTORY_V1 } from "@/lib/privacy/data-inventory";
import {
  applyRecruitingPrivacyErasureV1,
  collectRecruitingPrivacyExportV1,
} from "@/lib/privacy/recruiting-lifecycle";
import { createExternalApplicationTracker } from "@/lib/recruiting/external-tracker";
import {
  proposeInterview,
  respondToInterview,
} from "@/lib/recruiting/interviews";
import {
  createPhase28RecruitingFixture,
  type Phase28RecruitingFixture,
} from "@/tests/fixtures/phase28-recruiting";

const DAY = 86_400_000;
const HOUR = 3_600_000;

describe.sequential("Phase 28 recruiting privacy lifecycle", () => {
  let fixture: Phase28RecruitingFixture;
  let ownTrackerId = "";
  let foreignTrackerId = "";
  let ownInterviewId = "";
  let foreignInterviewId = "";
  let holdId = "";

  beforeAll(async () => {
    fixture = await createPhase28RecruitingFixture("privacy_lifecycle");
    const ownTracker = await createExternalApplicationTracker(
      {
        candidateUserId: fixture.candidateUserId,
        jobId: fixture.jobId,
        jobRevisionId: fixture.revisionId,
        idempotencyKey: randomUUID(),
      },
      fixture.dependencies(),
    );
    const foreignTracker = await createExternalApplicationTracker(
      {
        candidateUserId: fixture.foreignCandidateUserId,
        jobId: fixture.jobId,
        jobRevisionId: fixture.revisionId,
        idempotencyKey: randomUUID(),
      },
      fixture.dependencies(),
    );
    if (!ownTracker.ok || !foreignTracker.ok) {
      throw new Error("Phase 28 privacy tracker setup failed.");
    }
    ownTrackerId = ownTracker.trackerId;
    foreignTrackerId = foreignTracker.trackerId;

    const ownInterview = await proposeInterview(
      fixture.access,
      proposalInput(fixture.applicationId, fixture.now, "OWN_INTERVIEW_CANARY"),
      fixture.dependencies(),
    );
    const foreignApplication = await fixture.database.application.create({
      data: {
        jobId: fixture.jobId,
        submittedJobRevisionId: fixture.revisionId,
        candidateProfileId: fixture.foreignCandidateProfileId,
        idempotencyKey: `phase28-foreign-application-${randomUUID()}`,
        submissionPayloadHash: "f".repeat(64),
        status: "SUBMITTED",
        submittedAt: fixture.now,
        updatedAt: fixture.now,
      },
    });
    const foreignInterview = await proposeInterview(
      fixture.access,
      proposalInput(
        foreignApplication.id,
        fixture.now,
        "FOREIGN_INTERVIEW_CANARY",
      ),
      fixture.dependencies(),
    );
    if (!ownInterview.ok || !foreignInterview.ok) {
      throw new Error("Phase 28 privacy interview setup failed.");
    }
    ownInterviewId = ownInterview.interviewId;
    foreignInterviewId = foreignInterview.interviewId;
    const ownProposal =
      await fixture.database.interviewProposal.findFirstOrThrow({
        where: { interviewId: ownInterviewId, status: "OPEN" },
      });
    const accepted = await respondToInterview(
      {
        actorUserId: fixture.candidateUserId,
        interviewId: ownInterviewId,
        kind: "ACCEPT",
        proposalId: ownProposal.id,
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
      },
      fixture.dependencies(),
    );
    if (!accepted.ok) throw new Error("Interview acceptance setup failed.");

    const subjectHash = createHash("sha256")
      .update(fixture.candidateUserId, "utf8")
      .digest("hex");
    const hold = await fixture.database.legalHold.create({
      data: {
        subjectUserId: fixture.candidateUserId,
        subjectReferenceHash: subjectHash,
        entityType: "INTERVIEW_SCHEDULING",
        entityReferenceHash: createHash("sha256")
          .update(ownInterviewId, "utf8")
          .digest("hex"),
        scope: "INTERVIEW_SCHEDULING",
        basisRef: "external-review:phase28-hold",
        safeReasonCode: "ACTIVE_LEGAL_HOLD",
        createdByUserId: fixture.base.admin.userId,
        reviewedByUserId: fixture.base.admin.userId,
        startsAt: new Date(fixture.now.getTime() - HOUR),
        reviewAt: new Date(fixture.now.getTime() + DAY),
      },
    });
    holdId = hold.id;
  }, 120_000);

  afterAll(async () => {
    await fixture?.dispose();
  });

  it("registers both subject classes with bounded retain/correct/export outcomes", () => {
    const rows = PHASE22_DATA_INVENTORY_V1.filter(({ entityKey }) =>
      ["EXTERNAL_APPLICATION_TRACKER", "INTERVIEW_SCHEDULING"].includes(
        entityKey,
      ),
    );
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityKey: "EXTERNAL_APPLICATION_TRACKER",
          subjectClass: "CANDIDATE",
          exportOutcome: "INCLUDE",
          correctionOutcome: "CORRECT",
          erasureOutcome: "RETAIN",
          retentionDays: 400,
        }),
        expect.objectContaining({
          entityKey: "INTERVIEW_SCHEDULING",
          subjectClass: "CANDIDATE",
          retentionDays: 400,
        }),
        expect.objectContaining({
          entityKey: "INTERVIEW_SCHEDULING",
          subjectClass: "EMPLOYER_MEMBER",
          retentionDays: 400,
        }),
      ]),
    );
  });

  it("exports complete owned data while excluding foreign trackers, participants and canaries", async () => {
    const candidateExport = await collectRecruitingPrivacyExportV1(
      fixture.database,
      fixture.candidateUserId,
    );
    expect(candidateExport.externalApplications.map(({ id }) => id)).toEqual([
      ownTrackerId,
    ]);
    expect(candidateExport.interviews.map(({ id }) => id)).toEqual([
      ownInterviewId,
    ]);
    expect(candidateExport.interviews[0]?.participants).toHaveLength(1);
    expect(candidateExport.interviews[0]?.reminders).toHaveLength(1);
    const serialized = JSON.stringify(candidateExport);
    expect(serialized).not.toContain(foreignTrackerId);
    expect(serialized).not.toContain(foreignInterviewId);
    expect(serialized).not.toContain(fixture.foreignCandidateUserId);
    expect(serialized).not.toContain("FOREIGN_INTERVIEW_CANARY");

    const foreignExport = await collectRecruitingPrivacyExportV1(
      fixture.database,
      fixture.foreignCandidateUserId,
    );
    expect(foreignExport.externalApplications.map(({ id }) => id)).toEqual([
      foreignTrackerId,
    ]);
    expect(foreignExport.interviews.map(({ id }) => id)).toEqual([
      foreignInterviewId,
    ]);
  });

  it("archives/cancels the subject workflow idempotently while preserving foreign data and holds", async () => {
    const requestId = randomUUID();
    const result = await fixture.database.$transaction((transaction) =>
      applyRecruitingPrivacyErasureV1(transaction, {
        userId: fixture.candidateUserId,
        candidateProfileId: fixture.candidateProfileId,
        requestId,
        now: fixture.now,
      }),
    );
    expect(result).toEqual({
      ownedInterviews: 1,
      cancelledInterviews: 1,
      externalTrackers: 1,
      archivedExternalTrackers: 1,
    });
    await expect(
      fixture.database.externalApplicationTracker.findUniqueOrThrow({
        where: { id: ownTrackerId },
      }),
    ).resolves.toMatchObject({
      status: "ARCHIVED",
      reminderAt: null,
      archivedAt: fixture.now,
    });
    await expect(
      fixture.database.interview.findUniqueOrThrow({
        where: { id: ownInterviewId },
      }),
    ).resolves.toMatchObject({
      status: "CANCELLED",
      cancelledAt: fixture.now,
    });
    expect(
      await fixture.database.interviewReminder.count({
        where: { interviewId: ownInterviewId, status: "PENDING" },
      }),
    ).toBe(0);
    await expect(
      fixture.database.externalApplicationTracker.findUniqueOrThrow({
        where: { id: foreignTrackerId },
      }),
    ).resolves.toMatchObject({ status: "BEGUN", archivedAt: null });
    await expect(
      fixture.database.interview.findUniqueOrThrow({
        where: { id: foreignInterviewId },
      }),
    ).resolves.toMatchObject({ status: "PROPOSED", cancelledAt: null });
    await expect(
      fixture.database.legalHold.findUniqueOrThrow({ where: { id: holdId } }),
    ).resolves.toMatchObject({
      status: "ACTIVE",
      basisRef: "external-review:phase28-hold",
    });

    const replay = await fixture.database.$transaction((transaction) =>
      applyRecruitingPrivacyErasureV1(transaction, {
        userId: fixture.candidateUserId,
        candidateProfileId: fixture.candidateProfileId,
        requestId,
        now: fixture.now,
      }),
    );
    expect(replay).toMatchObject({
      ownedInterviews: 1,
      cancelledInterviews: 0,
      externalTrackers: 1,
      archivedExternalTrackers: 0,
    });
    expect(
      await fixture.database.interviewEvent.count({
        where: {
          interviewId: ownInterviewId,
          reasonCode: "PRIVACY_ERASURE",
        },
      }),
    ).toBe(1);
    expect(
      await fixture.database.externalApplicationEvent.count({
        where: {
          trackerId: ownTrackerId,
          reasonCode: "PRIVACY_ERASURE",
        },
      }),
    ).toBe(1);
  });
});

function proposalInput(applicationId: string, now: Date, subject: string) {
  return {
    applicationId,
    timeZone: "Europe/Zurich",
    subject,
    location: `${subject}_LOCATION`,
    slots: [
      {
        startsAt: new Date(now.getTime() + 2 * DAY),
        endsAt: new Date(now.getTime() + 2 * DAY + HOUR),
      },
    ],
    idempotencyKey: randomUUID(),
  };
}
