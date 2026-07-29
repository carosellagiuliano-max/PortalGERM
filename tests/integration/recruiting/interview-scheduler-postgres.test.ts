import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  cancelInterview,
  getInterviewCalendarForActor,
  proposeInterview,
  respondToInterview,
} from "@/lib/recruiting/interviews";
import {
  createPhase28RecruitingFixture,
  type Phase28RecruitingFixture,
} from "@/tests/fixtures/phase28-recruiting";

const HOUR = 3_600_000;
const DAY = 86_400_000;

describe.sequential("Phase 28 interview scheduler on PostgreSQL", () => {
  let fixture: Phase28RecruitingFixture;
  let interviewId = "";
  let version = 0;
  let initialProposalId = "";

  beforeAll(async () => {
    fixture = await createPhase28RecruitingFixture("interview_scheduler");
  }, 120_000);

  afterAll(async () => {
    await fixture?.dispose();
  });

  it("proposes multiple versioned slots without changing the legacy application status", async () => {
    const proposed = await proposeInterview(
      fixture.access,
      {
        applicationId: fixture.applicationId,
        timeZone: "Europe/Zurich",
        subject: "Technisches Interview",
        location: "Zürich, Raum 28",
        slots: [
          {
            startsAt: new Date(fixture.now.getTime() + 2 * DAY),
            endsAt: new Date(fixture.now.getTime() + 2 * DAY + HOUR),
          },
          {
            startsAt: new Date(fixture.now.getTime() + 3 * DAY),
            endsAt: new Date(fixture.now.getTime() + 3 * DAY + HOUR),
          },
        ],
        idempotencyKey: randomUUID(),
      },
      fixture.dependencies(),
    );
    expect(proposed).toMatchObject({
      ok: true,
      replay: false,
      status: "PROPOSED",
      version: 1,
    });
    if (!proposed.ok) throw new Error(proposed.code);
    interviewId = proposed.interviewId;
    version = proposed.version;
    const stored = await fixture.database.interview.findUniqueOrThrow({
      where: { id: interviewId },
      include: { proposals: true, participants: true, events: true },
    });
    initialProposalId = stored.proposals[0]!.id;
    expect(stored.proposals).toHaveLength(2);
    expect(stored.participants).toHaveLength(2);
    expect(stored.events.map(({ kind }) => kind)).toEqual(["PROPOSED"]);
    expect(
      await fixture.database.application.findUniqueOrThrow({
        where: { id: fixture.applicationId },
        select: { status: true },
      }),
    ).toEqual({ status: "SUBMITTED" });
  });

  it("accepts exactly once and creates one calendar request plus deduplicated reminders", async () => {
    const key = randomUUID();
    const accepted = await respondToInterview(
      {
        actorUserId: fixture.candidateUserId,
        interviewId,
        kind: "ACCEPT",
        proposalId: initialProposalId,
        expectedVersion: version,
        idempotencyKey: key,
      },
      fixture.dependencies(),
    );
    expect(accepted).toMatchObject({
      ok: true,
      replay: false,
      status: "SCHEDULED",
      version: 2,
    });
    if (!accepted.ok) throw new Error(accepted.code);
    version = accepted.version;
    expect(
      await respondToInterview(
        {
          actorUserId: fixture.candidateUserId,
          interviewId,
          kind: "ACCEPT",
          proposalId: initialProposalId,
          expectedVersion: 1,
          idempotencyKey: key,
        },
        fixture.dependencies(),
      ),
    ).toMatchObject({ ok: true, replay: true, version: 2 });
    expect(
      await fixture.database.calendarArtifact.count({
        where: { interviewId, method: "REQUEST" },
      }),
    ).toBe(1);
    expect(
      await fixture.database.interviewReminder.count({
        where: { interviewId, status: "PENDING" },
      }),
    ).toBe(2);
    const calendar = await getInterviewCalendarForActor(
      interviewId,
      fixture.candidateUserId,
      fixture.database,
      fixture.now,
    );
    expect(calendar?.calendar).toContain("\r\nMETHOD:REQUEST\r\n");
    expect(calendar?.calendar).not.toContain(fixture.candidateUserId);
  });

  it("reschedules through a new proposal version and rejects stale concurrency", async () => {
    const requestedStart = new Date(fixture.now.getTime() + 4 * DAY);
    const requestedEnd = new Date(requestedStart.getTime() + HOUR);
    const rescheduled = await respondToInterview(
      {
        actorUserId: fixture.candidateUserId,
        interviewId,
        kind: "RESCHEDULE",
        requestedStartsAt: requestedStart,
        requestedEndsAt: requestedEnd,
        requestedTimeZone: "Europe/Zurich",
        expectedVersion: version,
        idempotencyKey: randomUUID(),
      },
      fixture.dependencies(),
    );
    expect(rescheduled).toMatchObject({
      ok: true,
      status: "RESCHEDULE_PENDING",
      version: 3,
    });
    if (!rescheduled.ok) throw new Error(rescheduled.code);
    version = rescheduled.version;
    expect(
      await respondToInterview(
        {
          actorUserId: fixture.employerUserId,
          interviewId,
          kind: "RESCHEDULE",
          requestedStartsAt: new Date(fixture.now.getTime() + 5 * DAY),
          requestedEndsAt: new Date(fixture.now.getTime() + 5 * DAY + HOUR),
          requestedTimeZone: "Europe/Zurich",
          expectedVersion: 2,
          idempotencyKey: randomUUID(),
        },
        fixture.dependencies(),
      ),
    ).toEqual({ ok: false, code: "CONFLICT" });
    const candidateProposal =
      await fixture.database.interviewProposal.findFirstOrThrow({
        where: { interviewId, version: 2, status: "OPEN" },
      });
    const accepted = await respondToInterview(
      {
        actorUserId: fixture.employerUserId,
        interviewId,
        kind: "ACCEPT",
        proposalId: candidateProposal.id,
        expectedVersion: version,
        idempotencyKey: randomUUID(),
      },
      fixture.dependencies(),
    );
    expect(accepted).toMatchObject({
      ok: true,
      status: "SCHEDULED",
      version: 4,
    });
    if (!accepted.ok) throw new Error(accepted.code);
    version = accepted.version;
    const stored = await fixture.database.interview.findUniqueOrThrow({
      where: { id: interviewId },
    });
    expect(stored.scheduledStartAt).toEqual(requestedStart);
  });

  it("cancels after the feature kill switch and serves only a CANCEL calendar", async () => {
    const disabledDependencies = {
      ...fixture.dependencies(),
      environment: {
        ...fixture.environment,
        INTERVIEW_SCHEDULER: "disabled" as const,
      },
    };
    const key = randomUUID();
    const cancelled = await cancelInterview(
      {
        actorUserId: fixture.employerUserId,
        interviewId,
        expectedVersion: version,
        idempotencyKey: key,
      },
      disabledDependencies,
    );
    expect(cancelled).toMatchObject({
      ok: true,
      replay: false,
      status: "CANCELLED",
      version: 5,
    });
    expect(
      await cancelInterview(
        {
          actorUserId: fixture.employerUserId,
          interviewId,
          expectedVersion: version,
          idempotencyKey: key,
        },
        disabledDependencies,
      ),
    ).toMatchObject({ ok: true, replay: true, status: "CANCELLED" });
    expect(
      await fixture.database.interviewReminder.count({
        where: { interviewId, status: "PENDING" },
      }),
    ).toBe(0);
    const calendar = await getInterviewCalendarForActor(
      interviewId,
      fixture.candidateUserId,
      fixture.database,
      fixture.now,
    );
    expect(calendar?.calendar).toContain("\r\nMETHOD:CANCEL\r\n");
    expect(calendar?.calendar).toContain("STATUS:CANCELLED");
  });

  it("keeps responses and events append-only", async () => {
    const response =
      await fixture.database.interviewResponse.findFirstOrThrow({
        where: { interviewId },
      });
    const event = await fixture.database.interviewEvent.findFirstOrThrow({
      where: { interviewId },
    });
    await expect(
      fixture.database.interviewResponse.delete({ where: { id: response.id } }),
    ).rejects.toThrow(/append-only/iu);
    await expect(
      fixture.database.interviewEvent.update({
        where: { id: event.id },
        data: { reasonCode: "MANIPULATED" },
      }),
    ).rejects.toThrow(/append-only/iu);
  });
});
