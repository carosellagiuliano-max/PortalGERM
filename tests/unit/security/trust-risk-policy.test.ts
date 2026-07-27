import { describe, expect, it } from "vitest";

import {
  evaluateTrustRiskSignal,
  TRUST_RISK_POLICY_VERSION,
} from "@/lib/security/risk/trust-risk-policy";

describe("Phase 25 trust risk decision matrix", () => {
  it.each([
    ["CREDENTIAL_STUFFING", "USER", "AUTH_RATE_LIMIT", 1, "ALLOW"],
    ["CREDENTIAL_STUFFING", "USER", "AUTH_RATE_LIMIT", 5, "STEP_UP"],
    ["CREDENTIAL_STUFFING", "USER", "AUTH_RATE_LIMIT", 20, "HOLD"],
    ["RECOVERY_ABUSE", "USER", "RECOVERY_GUARD", 1, "REVIEW"],
    ["RECOVERY_ABUSE", "USER", "RECOVERY_GUARD", 3, "HOLD"],
    ["PAYMENT_FRAUD", "PAYMENT", "PAYMENT_RISK", 1, "REVIEW"],
    ["PAYMENT_FRAUD", "PAYMENT", "PAYMENT_RISK", 2, "HOLD"],
    ["COMPROMISED_COMPANY", "COMPANY", "TRUST_REVIEW", 1, "REVIEW"],
    ["COMPROMISED_COMPANY", "COMPANY", "INCIDENT_CONFIRMED", 1, "REVOKE"],
  ] as const)(
    "%s on %s with count %s resolves to %s",
    (kind, subjectType, source, observedCount, expected) => {
      expect(
        evaluateTrustRiskSignal({
          kind,
          subjectType,
          source,
          observedCount,
        }),
      ).toMatchObject({
        kind: expected,
        policyVersion: TRUST_RISK_POLICY_VERSION,
      });
    },
  );

  it("does not accept a mismatched subject as authority", () => {
    expect(
      evaluateTrustRiskSignal({
        kind: "JOB_SCAM",
        subjectType: "USER",
        source: "ABUSE_REPORT",
        observedCount: 100,
      }),
    ).toMatchObject({
      kind: "REVIEW",
      reasonCode: "SUBJECT_SIGNAL_MISMATCH",
    });
  });

  it("ignores unknown score-like inputs because the API is a closed minimum", () => {
    const baseline = evaluateTrustRiskSignal({
      kind: "JOB_DUPLICATE",
      subjectType: "JOB",
      source: "JOB_MODERATION",
      observedCount: 1,
    });
    const poisoned = evaluateTrustRiskSignal({
      kind: "JOB_DUPLICATE",
      subjectType: "JOB",
      source: "JOB_MODERATION",
      observedCount: 1,
      protectedAttribute: "age",
      secretScore: 999,
    } as Parameters<typeof evaluateTrustRiskSignal>[0]);
    expect(poisoned).toEqual(baseline);
  });
});
