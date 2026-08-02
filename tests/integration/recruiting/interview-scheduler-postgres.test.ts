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

  it("revokes Company calendar access with a stale participant Membership", async () => {
    await expect(
      getInterviewCalendarForActor(
        interviewId,
        fixture.employerUserId,
        fixture.database,
        fixture.now,
      ),
    ).resolves.not.toBeNull();

    const fallbackOwner =
      await fixture.database.companyMembership.findFirstOrThrow({
        where: {
          companyId: fixture.companyId,
          userId: fixture.base.dual.userId,
          status: "ACTIVE",
        },
        select: { id: true, role: true },
      });
    await fixture.database.companyMembership.update({
      where: { id: fallbackOwner.id },
      data: { role: "OWNER" },
    });
    await fixture.database.companyMembership.update({
      where: { id: fixture.membershipId },
      data: { status: "SUSPENDED" },
    });
    try {
      await expect(
        getInterviewCalendarForActor(
          interviewId,
          fixture.employerUserId,
          fixture.database,
          fixture.now,
        ),
      ).resolves.toBeNull();
      await expect(
        getInterviewCalendarForActor(
          interviewId,
          fixture.candidateUserId,
          fixture.database,
          fixture.now,
        ),
      ).resolves.not.toBeNull();
    } finally {
      await fixture.database.companyMembership.update({
        where: { id: fixture.membershipId },
        data: { status: "ACTIVE" },
      });
      await fixture.database.companyMembership.update({
        where: { id: fallbackOwner.id },
        data: { role: fallbackOwner.role },
      });
    }
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

describe.sequential("Phase 33 interview proposal abuse boundary", () => {
  let fixture: Phase28RecruitingFixture;

  beforeAll(async () => {
    fixture = await createPhase28RecruitingFixture("proposal_rate_limit");
  }, 120_000);

  afterAll(async () => {
    await fixture?.dispose();
  });

  it("rate-limits an authorized Application target with audit and zero denied domain effects", async () => {
    for (let index = 0; index < 10; index += 1) {
      await expect(
        proposeInterview(
          fixture.access,
          proposalInput(fixture.applicationId, fixture.now, `allowed-${index}`),
          fixture.dependencies(),
        ),
      ).resolves.toMatchObject({ ok: true, replay: false });
    }

    const before = await Promise.all([
      fixture.database.interview.count(),
      fixture.database.interviewProposal.count(),
      fixture.database.interviewParticipant.count(),
      fixture.database.interviewEvent.count(),
      fixture.database.notificationOutbox.count(),
    ]);
    const deniedDependencies = fixture.dependencies();
    await expect(
      proposeInterview(
        fixture.access,
        proposalInput(fixture.applicationId, fixture.now, "denied"),
        deniedDependencies,
      ),
    ).resolves.toEqual({ ok: false, code: "RATE_LIMITED" });
    await expect(
      Promise.all([
        fixture.database.interview.count(),
        fixture.database.interviewProposal.count(),
        fixture.database.interviewParticipant.count(),
        fixture.database.interviewEvent.count(),
        fixture.database.notificationOutbox.count(),
      ]),
    ).resolves.toEqual(before);
    await expect(
      fixture.database.auditLog.findFirst({
        where: {
          action: "RATE_LIMITED",
          actorUserId: fixture.employerUserId,
          companyId: fixture.companyId,
          correlationId: deniedDependencies.request.correlationId,
          targetId: fixture.applicationId,
          targetType: "APPLICATION",
        },
        select: { metadata: true, reasonCode: true, result: true },
      }),
    ).resolves.toMatchObject({
      metadata: {
        preset: "INTERVIEW_PROPOSE",
        scope: "ACTOR_OR_IP_TARGET",
      },
      reasonCode: "RATE_LIMITED",
      result: "DENIED",
    });
  });

  it("does not spend a target bucket for an unauthorized Application ID", async () => {
    const before = await fixture.database.rateLimitBucket.count({
      where: { namespace: { startsWith: "v1:INTERVIEW_PROPOSE:" } },
    });
    const foreignApplicationId = randomUUID();
    await expect(
      proposeInterview(
        fixture.access,
        proposalInput(foreignApplicationId, fixture.now, "foreign"),
        fixture.dependencies(),
      ),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    await expect(
      fixture.database.rateLimitBucket.count({
        where: { namespace: { startsWith: "v1:INTERVIEW_PROPOSE:" } },
      }),
    ).resolves.toBe(before);
  });
});

function proposalInput(applicationId: string, now: Date, suffix: string) {
  return {
    applicationId,
    timeZone: "Europe/Zurich",
    subject: `Phase 33 Interview ${suffix}`,
    slots: [
      {
        startsAt: new Date(now.getTime() + 7 * DAY),
        endsAt: new Date(now.getTime() + 7 * DAY + HOUR),
      },
    ],
    idempotencyKey: `phase33-${suffix}`,
  };
}
