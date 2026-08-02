import { describe, expect, it } from "vitest";

import {
  PHASE33_EXTERNAL_GATE_IDS,
  PHASE33_RELEASE_POLICY_VERSION,
  PHASE33_TECHNICAL_GATE_IDS,
  evaluatePhase33ReleaseVerdict,
  phase33ReleaseExitCode,
  type Phase33ExternalGateLedger,
  type Phase33TechnicalManifest,
  type Phase33TechnicalTarget,
} from "@/lib/release/phase33-release-verdict";

describe("Phase 33 technical and activation verdict", () => {
  it.each([
    ["LC4", "TECHNICALLY_READY_FOR_LC4"],
    ["LC5", "TECHNICALLY_READY_FOR_LC5_CONFIGURATION"],
  ] as const)(
    "keeps a technically ready %s candidate externally blocked without evidence",
    (target, expectedVerdict) => {
      const decision = evaluatePhase33ReleaseVerdict(technicalManifest(target));

      expect(decision.technical).toEqual({
        verdict: expectedVerdict,
        blockers: [],
      });
      expect(decision.activation).toEqual({
        verdict: "ACTIVATION_BLOCKED_BY_EXTERNAL_GATES",
        blockers: ["EXTERNAL_LEDGER_MISSING"],
      });
      expect(phase33ReleaseExitCode(decision, "technical")).toBe(0);
      expect(phase33ReleaseExitCode(decision, "activation")).toBe(2);
    },
  );

  it("requires the target-specific payment contract", () => {
    const lc4 = technicalManifest("LC4");
    lc4.gates = lc4.gates.filter(
      ({ gateId }) => gateId !== "LC4_PAYMENT_CLOSED",
    );
    const lc5 = technicalManifest("LC5");
    lc5.gates = lc5.gates.filter(
      ({ gateId }) => gateId !== "LC5_PAYMENT_CONTRACT",
    );

    expect(evaluatePhase33ReleaseVerdict(lc4).technical.blockers).toContain(
      "TECHNICAL_GATE_MISSING:LC4_PAYMENT_CLOSED",
    );
    expect(evaluatePhase33ReleaseVerdict(lc5).technical.blockers).toContain(
      "TECHNICAL_GATE_MISSING:LC5_PAYMENT_CONTRACT",
    );
  });

  it("requires the closed LC4 payment baseline before LC5 configuration", () => {
    const lc5 = technicalManifest("LC5");
    lc5.gates = lc5.gates.filter(
      ({ gateId }) => gateId !== "LC4_PAYMENT_CLOSED",
    );

    expect(evaluatePhase33ReleaseVerdict(lc5).technical.blockers).toContain(
      "TECHNICAL_GATE_MISSING:LC4_PAYMENT_CLOSED",
    );
  });

  it("does not accept PASS without commit-bound evidence", () => {
    const manifest = technicalManifest("LC4");
    manifest.gates = manifest.gates.map((gate) =>
      gate.gateId === "RUNTIME_CONTRACT"
        ? { gateId: gate.gateId, outcome: "PASS" }
        : gate,
    );

    const decision = evaluatePhase33ReleaseVerdict(manifest);

    expect(decision.technical.verdict).toBe("TECHNICAL_NO_GO");
    expect(decision.technical.blockers).toContain(
      "TECHNICAL_EVIDENCE_MISSING:RUNTIME_CONTRACT",
    );
    expect(phase33ReleaseExitCode(decision, "technical")).toBe(1);
  });

  it("keeps structurally complete external declarations advisory until a protected attestation verifies them", () => {
    const technical = technicalManifest("LC5");
    const external = externalLedger("LC5");

    const decision = evaluatePhase33ReleaseVerdict(
      technical,
      external,
      new Date("2026-08-01T12:00:00.000Z"),
    );

    expect(decision).toMatchObject({
      technical: {
        verdict: "TECHNICALLY_READY_FOR_LC5_CONFIGURATION",
        blockers: [],
      },
      activation: {
        verdict: "ACTIVATION_BLOCKED_BY_EXTERNAL_GATES",
        blockers: ["PROTECTED_EXTERNAL_ATTESTATION_REQUIRED"],
      },
    });
    expect(phase33ReleaseExitCode(decision, "activation")).toBe(2);
  });

  it("blocks self-approval, expiry and candidate drift independently", () => {
    const technical = technicalManifest("LC4");
    const external = externalLedger("LC4");
    external.candidateCommitSha = "b".repeat(40);
    external.gates = external.gates.map((gate) =>
      gate.gateId === "LEGAL_PRIVACY_AVG"
        ? {
            ...gate,
            approvedBy: gate.owner,
            validUntil: "2026-07-31T23:59:59.000Z",
          }
        : gate,
    );

    const decision = evaluatePhase33ReleaseVerdict(
      technical,
      external,
      new Date("2026-08-01T12:00:00.000Z"),
    );

    expect(decision.activation.blockers).toEqual(
      expect.arrayContaining([
        "EXTERNAL_CANDIDATE_MISMATCH",
        "EXTERNAL_SELF_APPROVAL:LEGAL_PRIVACY_AVG",
        "EXTERNAL_EVIDENCE_EXPIRED:LEGAL_PRIVACY_AVG",
      ]),
    );
    expect(phase33ReleaseExitCode(decision, "activation")).toBe(2);
  });

  it("fails closed on duplicate or unknown gate data", () => {
    const duplicate = technicalManifest("LC4");
    duplicate.gates.push(duplicate.gates[0]!);
    const unknown = {
      ...technicalManifest("LC4"),
      futurePolicyBypass: true,
    };

    for (const value of [duplicate, unknown]) {
      const decision = evaluatePhase33ReleaseVerdict(value);
      expect(decision.technical.verdict).toBe("TECHNICAL_NO_GO");
      expect(decision.candidateCommitSha).toBeNull();
      expect(decision.activation.verdict).toBe(
        "ACTIVATION_BLOCKED_BY_EXTERNAL_GATES",
      );
    }
  });
});

function technicalManifest(
  target: Phase33TechnicalTarget,
): Phase33TechnicalManifest {
  const required = new Set([
    "BASELINE_GOVERNANCE",
    "HISTORICAL_MIGRATIONS",
    "PROVIDER_MODE_MATRIX",
    "RUNTIME_CONTRACT",
    "ROLE_JOURNEYS",
    "FAILURE_RECOVERY",
    "BROWSER_ACCESSIBILITY",
    "ARTIFACT_IDENTITY",
    "FULL_REGRESSION",
    "LC4_PAYMENT_CLOSED",
    ...(target === "LC5" ? ["LC5_PAYMENT_CONTRACT"] : []),
  ]);
  const digest = `sha256:${"a".repeat(64)}`;
  return {
    policyVersion: PHASE33_RELEASE_POLICY_VERSION,
    candidateCommitSha: "a".repeat(40),
    requestedTechnicalTarget: target,
    historicalPhase32Decision: "NO_GO",
    artifacts: {
      sourceTree: digest,
      lockfile: digest,
      migrations: digest,
      compose: digest,
      standalone: digest,
      ociImage: digest,
      recovery: digest,
      testReport: digest,
    },
    gates: PHASE33_TECHNICAL_GATE_IDS.filter((gateId) =>
      required.has(gateId),
    ).map((gateId) => ({
      gateId,
      outcome: "PASS" as const,
      evidenceDigest: digest,
    })),
  };
}

function externalLedger(
  target: Phase33TechnicalTarget,
): Phase33ExternalGateLedger {
  const required = new Set([
    "LEGAL_PRIVACY_AVG",
    "PROVIDER_SECURITY_DPA",
    "TARGET_RUNTIME_OBSERVABILITY",
    "BACKUP_RESTORE_INCIDENT",
    "OPERATIONS_ON_CALL",
    "PRODUCT_PUBLIC_SCOPE",
    ...(target === "LC5"
      ? ["FINANCE_TAX_INVOICE", "PAID_PROVIDER", "WTP_DELIVERY_CAPACITY"]
      : []),
  ]);
  const digest = `sha256:${"c".repeat(64)}`;
  return {
    policyVersion: PHASE33_RELEASE_POLICY_VERSION,
    trustClass: "UNVERIFIED_EXTERNAL_DECLARATIONS",
    candidateCommitSha: "a".repeat(40),
    requestedTarget: target,
    gates: PHASE33_EXTERNAL_GATE_IDS.filter((gateId) =>
      required.has(gateId),
    ).map((gateId) => ({
      gateId,
      outcome: "APPROVED" as const,
      owner: `owner-${gateId}`,
      approvedBy: `reviewer-${gateId}`,
      evidenceReference: `evidence/${gateId}.json`,
      evidenceDigest: digest,
      validUntil: "2027-08-01T00:00:00.000Z",
    })),
    activationDecision: {
      decision: "APPROVE",
      decidedAt: "2026-08-01T10:00:00.000Z",
      decisionMakers: ["release-owner", "business-owner"],
      evidenceDigest: digest,
    },
  };
}
