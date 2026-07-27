import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { recordAndDecideRiskSignal } from "@/lib/security/risk/risk-service";
import {
  createPhase25SecurityFixture,
  type Phase25SecurityFixture,
} from "@/tests/fixtures/phase25-security";
import { createPhase25TrustCompany } from "@/tests/fixtures/phase25-trust";

describe("Phase 25 persisted risk decisions", () => {
  let fixture: Phase25SecurityFixture;

  beforeAll(async () => {
    fixture = await createPhase25SecurityFixture("phase25_risk_decisions");
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  it("records one minimized signal, decision and case per dedupe input", async () => {
    const input = {
      kind: "RECOVERY_ABUSE",
      subjectType: "USER",
      subjectId: fixture.candidate.userId,
      source: "RECOVERY_GUARD",
      observedCount: 3,
      windowStartedAt: new Date(fixture.now.getTime() - 60_000),
      windowEndedAt: fixture.now,
      evidenceReference: `recovery-guard:${crypto.randomUUID()}`,
      idempotencyKey: `recovery-guard:${crypto.randomUUID()}`,
    } as const;
    const dependencies = {
      database: fixture.database,
      correlationId: crypto.randomUUID(),
      mode: "observe",
      now: fixture.now,
    } as const;
    const first = await recordAndDecideRiskSignal(input, dependencies);
    const replay = await recordAndDecideRiskSignal(input, dependencies);
    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    if (!first.ok || !replay.ok) return;
    expect(first.value).toMatchObject({
      decision: "HOLD",
      caseStatus: "OPEN",
      replay: false,
    });
    expect(replay.value).toMatchObject({
      signalId: first.value.signalId,
      decisionId: first.value.decisionId,
      caseId: first.value.caseId,
      replay: true,
    });
    expect(await fixture.database.riskSignal.count()).toBe(1);
    expect(await fixture.database.trustRiskDecision.count()).toBe(1);
    expect(await fixture.database.trustSafetyCase.count()).toBe(1);
    const persisted = await fixture.database.riskSignal.findFirstOrThrow();
    expect(persisted.evidenceDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(persisted)).not.toContain(input.evidenceReference);
  });

  it("rejects a foreign company claim and unknown risk attributes", async () => {
    const own = await createPhase25TrustCompany(fixture);
    const foreign = await fixture.database.company.create({
      data: {
        name: "Foreign Phase 25 AG",
        slug: `phase25-foreign-${crypto.randomUUID()}`,
        status: "DRAFT",
      },
    });
    const crossTenant = await recordAndDecideRiskSignal(
      {
        kind: "JOB_SCAM",
        subjectType: "JOB",
        subjectId: own.job.id,
        companyId: foreign.id,
        source: "ABUSE_REPORT",
        observedCount: 2,
        evidenceReference: `abuse-report:${crypto.randomUUID()}`,
        idempotencyKey: `abuse-report:${crypto.randomUUID()}`,
      },
      {
        database: fixture.database,
        correlationId: crypto.randomUUID(),
        mode: "observe",
        now: fixture.now,
      },
    );
    expect(crossTenant).toEqual({ ok: false, code: "SUBJECT_MISMATCH" });
    const poisoned = await recordAndDecideRiskSignal(
      {
        kind: "JOB_SCAM",
        subjectType: "JOB",
        subjectId: own.job.id,
        source: "ABUSE_REPORT",
        observedCount: 2,
        protectedAttribute: "nationality",
        evidenceReference: `abuse-report:${crypto.randomUUID()}`,
        idempotencyKey: `abuse-report:${crypto.randomUUID()}`,
      },
      {
        database: fixture.database,
        correlationId: crypto.randomUUID(),
        mode: "observe",
        now: fixture.now,
      },
    );
    expect(poisoned).toEqual({ ok: false, code: "INVALID_INPUT" });
  });
});
