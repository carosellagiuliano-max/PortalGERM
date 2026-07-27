import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { recordAndDecideRiskSignal } from "@/lib/security/risk/risk-service";
import {
  createPhase25SecurityFixture,
  type Phase25SecurityFixture,
} from "@/tests/fixtures/phase25-security";
import { createPhase25TrustCompany } from "@/tests/fixtures/phase25-trust";

describe("Phase 25 scam signal to bounded case", () => {
  let fixture: Phase25SecurityFixture;

  beforeAll(async () => {
    fixture = await createPhase25SecurityFixture("phase25_scam_cases");
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  it("holds only the corroborated scam job and never the whole company", async () => {
    const scenario = await createPhase25TrustCompany(fixture);
    const input = {
      kind: "JOB_SCAM",
      subjectType: "JOB",
      subjectId: scenario.job.id,
      companyId: scenario.company.id,
      source: "ABUSE_REPORT",
      observedCount: 2,
      evidenceReference: `abuse-report:${crypto.randomUUID()}`,
      idempotencyKey: `abuse-report:${crypto.randomUUID()}`,
    } as const;
    const dependencies = {
      database: fixture.database,
      correlationId: crypto.randomUUID(),
      mode: "hold",
      now: fixture.now,
    } as const;
    const result = await recordAndDecideRiskSignal(input, dependencies);
    const replay = await recordAndDecideRiskSignal(input, dependencies);
    expect(result.ok).toBe(true);
    expect(replay.ok).toBe(true);
    if (!result.ok || !replay.ok) return;
    expect(result.value).toMatchObject({
      decision: "HOLD",
      caseStatus: "HELD",
      replay: false,
    });
    expect(replay.value).toMatchObject({
      caseId: result.value.caseId,
      replay: true,
    });
    const [job, company, ownerSession, effects] = await Promise.all([
      fixture.database.job.findUniqueOrThrow({
        where: { id: scenario.job.id },
      }),
      fixture.database.company.findUniqueOrThrow({
        where: { id: scenario.company.id },
      }),
      fixture.database.session.findUniqueOrThrow({
        where: { id: fixture.employer.sessionId },
      }),
      fixture.database.trustSafetyContainmentEffect.findMany({
        where: { trustSafetyCaseId: result.value.caseId! },
      }),
    ]);
    expect(job.status).toBe("PAUSED");
    expect(company.status).toBe("ACTIVE");
    expect(ownerSession.revokedAt).toBeNull();
    expect(effects.map(({ effectScope }) => effectScope)).toEqual([
      "PUBLIC_JOB",
    ]);
  });

  it("leaves a legitimate duplicate control in ALLOW without a case", async () => {
    const scenario = await createPhase25TrustCompany(fixture);
    const result = await recordAndDecideRiskSignal(
      {
        kind: "JOB_DUPLICATE",
        subjectType: "JOB",
        subjectId: scenario.job.id,
        companyId: scenario.company.id,
        source: "JOB_MODERATION",
        observedCount: 1,
        evidenceReference: `duplicate-check:${crypto.randomUUID()}`,
        idempotencyKey: `duplicate-check:${crypto.randomUUID()}`,
      },
      {
        database: fixture.database,
        correlationId: crypto.randomUUID(),
        mode: "hold",
        now: fixture.now,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      decision: "ALLOW",
      caseId: null,
      caseStatus: null,
    });
    expect(
      (
        await fixture.database.job.findUniqueOrThrow({
          where: { id: scenario.job.id },
        })
      ).status,
    ).toBe("PUBLISHED");
  });
});
