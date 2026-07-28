import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { switchPersonaContext } from "@/lib/auth/persona-context";
import {
  createPhase27PersonaFixture,
  type Phase27PersonaFixture,
} from "@/tests/fixtures/phase27-persona";

describe.sequential("Phase 27 persisted persona context", () => {
  let fixture: Phase27PersonaFixture;

  beforeAll(async () => {
    fixture = await createPhase27PersonaFixture("context");
  }, 120_000);

  afterAll(async () => {
    await fixture.dispose();
  });

  it("switches one session context without granting authority and revokes stale action grants", async () => {
    const staleActor = await fixture.contextActor(fixture.dual);
    const boundGrant = await fixture.issueGrant(fixture.dual, {
      purpose: "EMPLOYER_TEAM",
      action: "TEAM_INVITE",
      tenantId: fixture.companyAId,
      resourceId: crypto.randomUUID(),
    });

    const switched = await switchPersonaContext(
      { portal: "CANDIDATE" },
      staleActor,
      fixture.dependencies(),
    );
    expect(switched).toEqual({
      ok: true,
      portal: "CANDIDATE",
      companyId: null,
      contextVersion: 2,
    });
    await expect(
      fixture.database.authAssuranceEvidence.findUniqueOrThrow({
        where: { id: boundGrant.evidenceId },
        select: { revokedAt: true, usedAt: true },
      }),
    ).resolves.toEqual({
      revokedAt: fixture.now,
      usedAt: null,
    });
    await expect(
      fixture.database.session.findUniqueOrThrow({
        where: { id: fixture.dual.sessionId },
        select: {
          activePortal: true,
          activeCompanyId: true,
          contextVersion: true,
        },
      }),
    ).resolves.toEqual({
      activePortal: "CANDIDATE",
      activeCompanyId: null,
      contextVersion: 2,
    });

    expect(
      await switchPersonaContext(
        { portal: "EMPLOYER", companyId: fixture.companyAId },
        staleActor,
        fixture.dependencies(),
      ),
    ).toEqual({ ok: false, code: "STALE_CONTEXT" });
  });

  it("requires the exact active membership for company A/B and an explicit choice when ambiguous", async () => {
    const actor = await fixture.contextActor(fixture.dual);
    expect(
      await switchPersonaContext(
        { portal: "EMPLOYER" },
        actor,
        fixture.dependencies(),
      ),
    ).toEqual({ ok: false, code: "COMPANY_SELECTION_REQUIRED" });

    const switched = await switchPersonaContext(
      { portal: "EMPLOYER", companyId: fixture.companyBId },
      actor,
      fixture.dependencies(),
    );
    expect(switched).toMatchObject({
      ok: true,
      portal: "EMPLOYER",
      companyId: fixture.companyBId,
    });

    expect(
      await switchPersonaContext(
        { portal: "EMPLOYER", companyId: fixture.companyAId },
        await fixture.contextActor(fixture.candidate),
        fixture.dependencies(),
      ),
    ).toEqual({ ok: false, code: "CONTEXT_UNAVAILABLE" });
    expect(
      await switchPersonaContext(
        { portal: "EMPLOYER", companyId: crypto.randomUUID() },
        await fixture.contextActor(fixture.dual),
        fixture.dependencies(),
      ),
    ).toEqual({ ok: false, code: "CONTEXT_UNAVAILABLE" });
  });

  it("persists minimized structured audit and essential analytics context", async () => {
    const audits = await fixture.database.auditLog.findMany({
      where: {
        actorUserId: fixture.dual.userId,
        action: "PERSONA_CONTEXT_SWITCHED",
      },
      orderBy: { createdAt: "asc" },
    });
    expect(audits).toHaveLength(2);
    expect(
      audits.map(({ portalContext, sessionContextVersion, companyId }) => ({
        portalContext,
        sessionContextVersion,
        companyId,
      })),
    ).toEqual([
      {
        portalContext: "CANDIDATE",
        sessionContextVersion: 2,
        companyId: null,
      },
      {
        portalContext: "EMPLOYER",
        sessionContextVersion: 3,
        companyId: fixture.companyBId,
      },
    ]);

    const analytics = await fixture.database.analyticsEvent.findMany({
      where: {
        kind: "PERSONA_CONTEXT_SWITCHED",
        pseudonymousActorId: { not: null },
      },
      orderBy: { occurredAt: "asc" },
    });
    expect(analytics).toHaveLength(2);
    expect(JSON.stringify(analytics)).not.toContain(fixture.dual.email);
    expect(analytics[1]).toMatchObject({
      portalContext: "EMPLOYER",
      sessionContextVersion: 3,
      companyId: fixture.companyBId,
    });
  });
});
