import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createCandidatePersona,
  switchPersonaContext,
} from "@/lib/auth/persona-context";
import {
  createPhase27PersonaFixture,
  type Phase27PersonaFixture,
} from "@/tests/fixtures/phase27-persona";

describe.sequential("Phase 27 persona creation evidence", () => {
  let fixture: Phase27PersonaFixture;

  beforeAll(async () => {
    fixture = await createPhase27PersonaFixture("creation_evidence");
  }, 120_000);

  afterAll(async () => {
    await fixture.dispose();
  });

  it("creates a candidate profile only with exact single-use step-up evidence", async () => {
    const wrongGrant = await fixture.issueGrant(fixture.employer, {
      purpose: "IDENTITY_PERSONA",
      action: "PERSONA_CANDIDATE_CREATE",
      resourceId: fixture.candidate.userId,
    });
    expect(
      await createCandidatePersona(
        {
          stepUpEvidenceId: wrongGrant.evidenceId,
          stepUpGrantToken: wrongGrant.grantToken,
        },
        await fixture.contextActor(fixture.employer),
        fixture.dependencies(),
      ),
    ).toEqual({ ok: false, code: "STEP_UP_REQUIRED" });
    expect(
      await fixture.database.candidateProfile.count({
        where: { userId: fixture.employer.userId },
      }),
    ).toBe(0);

    const grant = await fixture.issueGrant(fixture.employer, {
      purpose: "IDENTITY_PERSONA",
      action: "PERSONA_CANDIDATE_CREATE",
      resourceId: fixture.employer.userId,
    });
    const created = await createCandidatePersona(
      {
        stepUpEvidenceId: grant.evidenceId,
        stepUpGrantToken: grant.grantToken,
      },
      await fixture.contextActor(fixture.employer),
      fixture.dependencies(),
    );
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) throw new Error(created.code);

    const [user, assignment, profile, events, evidence, audit] =
      await Promise.all([
        fixture.database.user.findUniqueOrThrow({
          where: { id: fixture.employer.userId },
          select: { role: true },
        }),
        fixture.database.personaAssignment.findUniqueOrThrow({
          where: {
            userId_kind: {
              userId: fixture.employer.userId,
              kind: "CANDIDATE",
            },
          },
        }),
        fixture.database.candidateProfile.findUniqueOrThrow({
          where: { userId: fixture.employer.userId },
        }),
        fixture.database.candidateOnboardingEvent.findMany({
          where: { candidateProfileId: created.candidateProfileId },
        }),
        fixture.database.authAssuranceEvidence.findUniqueOrThrow({
          where: { id: grant.evidenceId },
          select: { usedAt: true, revokedAt: true },
        }),
        fixture.database.auditLog.findMany({
          where: {
            actorUserId: fixture.employer.userId,
            action: "PERSONA_ASSIGNMENT_CHANGED",
          },
        }),
      ]);
    expect(user.role).toBe("EMPLOYER");
    expect(assignment).toMatchObject({
      id: created.assignmentId,
      kind: "CANDIDATE",
      source: "SELF_SERVICE",
      status: "ACTIVE",
    });
    expect(profile).toMatchObject({
      id: created.candidateProfileId,
      onboardingStatus: "DRAFT",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "DRAFT_CREATED",
      reasonCode: "PERSONA_ACTIVATION",
    });
    expect(evidence).toEqual({ usedAt: fixture.now, revokedAt: null });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      targetType: "PERSONA_ASSIGNMENT",
      portalContext: "CANDIDATE",
      result: "SUCCEEDED",
    });

    expect(
      await createCandidatePersona(
        {
          stepUpEvidenceId: grant.evidenceId,
          stepUpGrantToken: grant.grantToken,
        },
        await fixture.contextActor(fixture.employer),
        fixture.dependencies(),
      ),
    ).toEqual({ ok: false, code: "ALREADY_EXISTS" });
  });

  it("can select the new portal but does not infer a company or admin grant", async () => {
    const switched = await switchPersonaContext(
      { portal: "CANDIDATE" },
      await fixture.contextActor(fixture.employer),
      fixture.dependencies(),
    );
    expect(switched).toMatchObject({
      ok: true,
      portal: "CANDIDATE",
      companyId: null,
    });
    expect(
      await fixture.database.adminCapabilityGrant.count({
        where: { userId: fixture.employer.userId },
      }),
    ).toBe(0);
  });
});
