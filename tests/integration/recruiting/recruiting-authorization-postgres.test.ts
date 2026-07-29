import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getCandidateInterview,
  getEmployerInterview,
  getInterviewCalendarForActor,
  proposeInterview,
  respondToInterview,
} from "@/lib/recruiting/interviews";
import {
  createPhase28RecruitingFixture,
  type Phase28RecruitingFixture,
} from "@/tests/fixtures/phase28-recruiting";

const DAY = 86_400_000;
const HOUR = 3_600_000;

describe.sequential("Phase 28 recruiting authorization boundaries", () => {
  let fixture: Phase28RecruitingFixture;
  let interviewId = "";
  let proposalId = "";

  beforeAll(async () => {
    fixture = await createPhase28RecruitingFixture("authorization");
  }, 120_000);

  afterAll(async () => {
    await fixture?.dispose();
  });

  it("denies viewer mutation and cross-company application IDs without target effects", async () => {
    const input = proposalInput(fixture.applicationId, fixture.now);
    expect(
      await proposeInterview(
        { ...fixture.access, membershipRole: "VIEWER" },
        input,
        fixture.dependencies(),
      ),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
    const companyBMembership =
      await fixture.database.companyMembership.findFirstOrThrow({
        where: {
          companyId: fixture.base.companyBId,
          userId: fixture.base.dual.userId,
          status: "ACTIVE",
        },
      });
    expect(
      await proposeInterview(
        {
          companyId: fixture.base.companyBId,
          membershipId: companyBMembership.id,
          userId: fixture.base.dual.userId,
          membershipRole: "OWNER",
        },
        input,
        fixture.dependencies(),
      ),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await fixture.database.interview.count()).toBe(0);
  });

  it("allows an authorized owner but denies foreign candidate reads and responses", async () => {
    const created = await proposeInterview(
      fixture.access,
      proposalInput(fixture.applicationId, fixture.now),
      fixture.dependencies(),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.code);
    interviewId = created.interviewId;
    proposalId = (
      await fixture.database.interviewProposal.findFirstOrThrow({
        where: { interviewId, status: "OPEN" },
      })
    ).id;

    expect(
      await getCandidateInterview(
        fixture.foreignCandidateUserId,
        interviewId,
        { database: fixture.database, environment: fixture.environment },
      ),
    ).toBeNull();
    expect(
      await respondToInterview(
        {
          actorUserId: fixture.foreignCandidateUserId,
          interviewId,
          kind: "ACCEPT",
          proposalId,
          expectedVersion: 1,
          idempotencyKey: randomUUID(),
        },
        fixture.dependencies(),
      ),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await getInterviewCalendarForActor(
        interviewId,
        fixture.foreignCandidateUserId,
        fixture.database,
        fixture.now,
      ),
    ).toBeNull();
    expect(
      await fixture.database.interviewResponse.count({ where: { interviewId } }),
    ).toBe(0);
  });

  it("requires a live recruiter assignment and rejects a suspended recruiter", async () => {
    const recruiterEmail = `phase28-recruiter-${randomUUID()}@example.test`;
    const recruiter = await fixture.database.user.create({
      data: {
        email: recruiterEmail,
        emailNormalized: recruiterEmail,
        name: "Phase 28 Recruiter",
        role: "RECRUITER",
        status: "ACTIVE",
        identityAssurance: "VERIFIED_EMAIL",
        emailVerifiedAt: fixture.now,
        dataProvenance: "TEST",
      },
    });
    await fixture.database.personaAssignment.create({
      data: {
        userId: recruiter.id,
        kind: "EMPLOYER",
        source: "SELF_SERVICE",
        status: "ACTIVE",
        version: 1,
        activatedAt: fixture.now,
        createdAt: fixture.now,
        updatedAt: fixture.now,
          events: {
            create: {
              kind: "CREATED",
            toStatus: "ACTIVE",
            source: "SELF_SERVICE",
            reasonCode: "PHASE28_TEST",
            correlationId: randomUUID(),
            createdAt: fixture.now,
          },
        },
      },
    });
    const membership = await fixture.database.companyMembership.create({
      data: {
        companyId: fixture.companyId,
        userId: recruiter.id,
        role: "RECRUITER",
        status: "ACTIVE",
        joinedAt: fixture.now,
        createdAt: fixture.now,
        updatedAt: fixture.now,
        events: {
          create: {
            kind: "CREATED",
            toRole: "RECRUITER",
            actorUserId: fixture.employerUserId,
            reasonCode: "PHASE28_TEST",
            correlationId: randomUUID(),
            createdAt: fixture.now,
          },
        },
      },
    });
    const access = {
      companyId: fixture.companyId,
      membershipId: membership.id,
      userId: recruiter.id,
      membershipRole: "RECRUITER" as const,
    };
    expect(
      await proposeInterview(
        access,
        proposalInput(fixture.applicationId, fixture.now, "unassigned"),
        fixture.dependencies(),
      ),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    await fixture.database.jobAssignment.create({
      data: {
        membershipId: membership.id,
        companyId: fixture.companyId,
        jobId: fixture.jobId,
        userId: recruiter.id,
        role: "PIPELINE",
        status: "ACTIVE",
        assignedByUserId: fixture.employerUserId,
        validFrom: fixture.now,
        createdAt: fixture.now,
        updatedAt: fixture.now,
        events: {
          create: {
            kind: "ASSIGNED",
            toRole: "PIPELINE",
            actorUserId: fixture.employerUserId,
            reasonCode: "PHASE28_TEST",
            correlationId: randomUUID(),
            createdAt: fixture.now,
          },
        },
      },
    });
    const assigned = await proposeInterview(
      access,
      proposalInput(fixture.applicationId, fixture.now, "assigned"),
      fixture.dependencies(),
    );
    expect(assigned).toMatchObject({ ok: true, status: "PROPOSED" });

    await fixture.database.user.update({
      where: { id: recruiter.id },
      data: { status: "SUSPENDED", updatedAt: fixture.now },
    });
    expect(
      await proposeInterview(
        access,
        proposalInput(fixture.applicationId, fixture.now, "suspended"),
        fixture.dependencies(),
      ),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("enforces participant/company scope in PostgreSQL and preserves owner access", async () => {
    await expect(
      fixture.database.interviewParticipant.create({
        data: {
          interviewId,
          userId: fixture.foreignCandidateUserId,
          kind: "CANDIDATE",
          status: "PENDING",
          required: true,
          createdAt: fixture.now,
          updatedAt: fixture.now,
        },
      }),
    ).rejects.toThrow(/participant|scope|candidate/iu);
    expect(
      await getEmployerInterview(
        fixture.applicationId,
        interviewId,
        fixture.access,
        { database: fixture.database, environment: fixture.environment },
        fixture.now,
      ),
    ).not.toBeNull();
  });
});

function proposalInput(
  applicationId: string,
  now: Date,
  suffix: string = randomUUID(),
) {
  return {
    applicationId,
    timeZone: "Europe/Zurich",
    subject: `Interview ${suffix}`,
    slots: [
      {
        startsAt: new Date(now.getTime() + 2 * DAY),
        endsAt: new Date(now.getTime() + 2 * DAY + HOUR),
      },
    ],
    idempotencyKey: randomUUID(),
  };
}
