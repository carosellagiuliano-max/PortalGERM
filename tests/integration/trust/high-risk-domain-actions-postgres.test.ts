import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { recordAndDecideRiskSignal } from "@/lib/security/risk/risk-service";
import {
  createPhase24BillingFixture,
  createPhase24StarterCheckout,
  type Phase24BillingFixture,
} from "@/tests/fixtures/phase24-billing";
import {
  createPhase25SecurityFixture,
  type Phase25SecurityFixture,
} from "@/tests/fixtures/phase25-security";

describe("Phase 25 cross-domain high-risk holds", () => {
  let security: Phase25SecurityFixture;
  let billing: Phase24BillingFixture;

  beforeAll(async () => {
    security = await createPhase25SecurityFixture(
      "phase25_high_risk_domains",
    );
    billing = await createPhase24BillingFixture(
      "phase25_payment_case_bridge",
    );
  });

  afterAll(async () => {
    await security.dispose();
    await billing.dispose();
  });

  it("converts a Phase-24 payment hold into one minimized Trust case", async () => {
    await createPhase24StarterCheckout(billing);
    await createPhase24StarterCheckout(billing);
    await expect(createPhase24StarterCheckout(billing)).rejects.toThrow(
      "PHASE24_CHECKOUT_FAILED:PAYMENT_HELD",
    );
    const [attempt, trustCases] = await Promise.all([
      billing.database.paymentAttempt.findFirstOrThrow({
        where: { status: "HELD" },
        orderBy: { createdAt: "desc" },
      }),
      billing.database.trustSafetyCase.findMany({
        where: { category: "PAYMENT_FRAUD" },
      }),
    ]);
    expect(attempt.failureCode).toBe("PAYMENT_RISK_REVIEW");
    expect(trustCases).toHaveLength(1);
    expect(trustCases[0]).toMatchObject({
      subjectType: "PAYMENT",
      subjectId: attempt.id,
      status: "OPEN",
    });
    expect(
      await billing.database.trustSafetyContainmentEffect.count({
        where: { trustSafetyCaseId: trustCases[0]!.id },
      }),
    ).toBe(0);
  });

  it("holds an anomalous export by revoking the requester's live security state", async () => {
    const request = await security.database.privacyRequest.create({
      data: {
        requesterUserId: security.candidate.userId,
        type: "EXPORT",
        status: "IN_PROGRESS",
        dueAt: new Date(security.now.getTime() + 30 * 86_400_000),
        idempotencyKey: `phase25-export-${crypto.randomUUID()}`,
        noticeVersion: "privacy-notice-v1",
        domainEventRefs: [],
        createdAt: security.now,
        updatedAt: security.now,
      },
    });
    const result = await recordAndDecideRiskSignal(
      {
        kind: "EXPORT_ANOMALY",
        subjectType: "EXPORT",
        subjectId: request.id,
        source: "PRIVACY_EXPORT",
        observedCount: 3,
        evidenceReference: `privacy-export:${request.id}`,
        idempotencyKey: `privacy-export:${request.id}`,
      },
      {
        database: security.database,
        correlationId: crypto.randomUUID(),
        mode: "hold",
        now: security.now,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      decision: "HOLD",
      caseStatus: "HELD",
    });
    expect(
      (
        await security.database.session.findUniqueOrThrow({
          where: { id: security.candidate.sessionId },
        })
      ).revokedAt,
    ).toEqual(security.now);
    expect(
      await security.database.authAssuranceEvidence.count({
        where: {
          userId: security.candidate.userId,
          usedAt: null,
          revokedAt: null,
        },
      }),
    ).toBe(0);
  });

  it("leaves bounded normal export use unchanged", async () => {
    const request = await security.database.privacyRequest.create({
      data: {
        requesterUserId: security.employer.userId,
        type: "EXPORT",
        status: "IN_PROGRESS",
        dueAt: new Date(security.now.getTime() + 30 * 86_400_000),
        idempotencyKey: `phase25-normal-export-${crypto.randomUUID()}`,
        noticeVersion: "privacy-notice-v1",
        domainEventRefs: [],
        createdAt: security.now,
        updatedAt: security.now,
      },
    });
    const result = await recordAndDecideRiskSignal(
      {
        kind: "EXPORT_ANOMALY",
        subjectType: "EXPORT",
        subjectId: request.id,
        source: "PRIVACY_EXPORT",
        observedCount: 1,
        evidenceReference: `privacy-export:${request.id}`,
        idempotencyKey: `privacy-export:${request.id}`,
      },
      {
        database: security.database,
        correlationId: crypto.randomUUID(),
        mode: "hold",
        now: security.now,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      decision: "STEP_UP",
      caseId: null,
    });
    expect(
      (
        await security.database.session.findUniqueOrThrow({
          where: { id: security.employer.sessionId },
        })
      ).revokedAt,
    ).toBeNull();
  });
});
