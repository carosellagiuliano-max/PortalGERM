import { describe, expect, it } from "vitest";

import {
  PHASE32_GATE_IDS,
  PHASE32_LAUNCH_CLASSES,
  PHASE32_POLICY_VERSION,
  type Phase32GateId,
  type Phase32GateOutcome,
  type Phase32LaunchClass,
  type Phase32LaunchClassPolicyInput,
  type Phase32ReleaseScope,
} from "@/lib/release/phase32-contract";
import { evaluatePhase32LaunchClassPolicy } from "@/lib/release/phase32-launch-class-policy";

describe("Phase 32 launch-class policy", () => {
  it.each(PHASE32_LAUNCH_CLASSES)(
    "approves exactly the fully evidenced %s scope",
    (launchClass) => {
      const decision = evaluatePhase32LaunchClassPolicy(
        completeInput(launchClass),
      );

      expect(decision).toMatchObject({
        status: "APPROVED",
        decision: launchClass,
        approvedClass: launchClass,
        requestedClass: launchClass,
      });
      expect(decision.evaluations).toHaveLength(6);
      expect(
        decision.evaluations.map(({ launchClass: value }) => value),
      ).toEqual(PHASE32_LAUNCH_CLASSES);
      expect(
        decision.evaluations
          .filter(({ eligible }) => eligible)
          .map(({ launchClass: value }) => value),
      ).toEqual([launchClass]);
    },
  );

  it("blocks a jump when a lower-class foundation is missing", () => {
    const input = completeInput("LC6");
    input.gates = input.gates.filter(
      ({ gateId }) => gateId !== "PHASE20_IDENTITY_NOTIFICATIONS",
    );

    const decision = evaluatePhase32LaunchClassPolicy(input);
    const lc6 = decision.evaluations.find(
      ({ launchClass }) => launchClass === "LC6",
    );

    expect(decision.status).toBe("NO_GO");
    expect(lc6?.gateFailures).toContainEqual({
      gateId: "PHASE20_IDENTITY_NOTIFICATIONS",
      expected: ["PASS"],
      observed: "MISSING",
    });
  });

  it("uses class-specific scope replacement instead of inheriting incompatible modes", () => {
    const input = completeInput("LC5");
    setGate(input, "LC4_PUBLIC_FREE_CONTROL", "FAIL");
    const decision = evaluatePhase32LaunchClassPolicy(input);

    expect(decision.approvedClass).toBe("LC5");
    expect(
      decision.evaluations.find(({ launchClass }) => launchClass === "LC5")
        ?.gateFailures,
    ).not.toContainEqual(
      expect.objectContaining({ gateId: "LC4_PUBLIC_FREE_CONTROL" }),
    );

    const mixed = completeInput("LC5");
    mixed.scope = {
      ...mixed.scope,
      operatingMode: "PUBLIC_FREE",
      moneyMode: "NO_MONEY",
    };
    const rejected = evaluatePhase32LaunchClassPolicy(mixed);
    expect(rejected.status).toBe("NO_GO");
    expect(
      rejected.evaluations.find(({ launchClass }) => launchClass === "LC5")
        ?.scopeMismatches,
    ).toEqual(expect.arrayContaining(["operatingMode", "moneyMode"]));
  });

  it("requires optional product promises to pass or be explicitly disabled", () => {
    const disabled = completeInput("LC4");
    expect(evaluatePhase32LaunchClassPolicy(disabled).approvedClass).toBe(
      "LC4",
    );

    setGate(disabled, "PHASE28_EXTERNAL_TRACKER", "NOT_RUN");
    expect(evaluatePhase32LaunchClassPolicy(disabled).status).toBe("NO_GO");

    const promised = completeInput("LC4");
    promised.scope = { ...promised.scope, externalTrackerPromised: true };
    setGate(promised, "PHASE28_EXTERNAL_TRACKER", "PASS");
    expect(evaluatePhase32LaunchClassPolicy(promised).approvedClass).toBe(
      "LC4",
    );
  });

  it("requires Company Trust conditionally for LC3 and unconditionally for LC4", () => {
    const lc3WithoutTrust = completeInput("LC3");
    lc3WithoutTrust.scope = {
      ...lc3WithoutTrust.scope,
      companyTrustSurfaces: false,
    };
    setGate(lc3WithoutTrust, "PHASE26_COMPANY_TRUST", "DISABLED");
    expect(
      evaluatePhase32LaunchClassPolicy(lc3WithoutTrust).approvedClass,
    ).toBe("LC3");

    const lc4 = completeInput("LC4");
    setGate(lc4, "PHASE26_COMPANY_TRUST", "DISABLED");
    expect(evaluatePhase32LaunchClassPolicy(lc4).status).toBe("NO_GO");
  });

  it("accepts monitored 30B/30C only below trigger and requires PASS at trigger", () => {
    const belowTrigger = completeInput("LC6");
    expect(evaluatePhase32LaunchClassPolicy(belowTrigger).approvedClass).toBe(
      "LC6",
    );

    const triggered = completeInput("LC6");
    triggered.scope = { ...triggered.scope, scale30BTriggered: true };
    expect(evaluatePhase32LaunchClassPolicy(triggered).status).toBe("NO_GO");

    setGate(triggered, "PHASE30B_SCALE", "PASS");
    expect(evaluatePhase32LaunchClassPolicy(triggered).approvedClass).toBe(
      "LC6",
    );
  });

  it("fails closed on unknown fields, gates and statuses", () => {
    for (const raw of [
      { ...completeInput("LC1"), unknown: true },
      {
        ...completeInput("LC1"),
        gates: [{ gateId: "FUTURE_GATE", outcome: "PASS" }],
      },
      {
        ...completeInput("LC1"),
        gates: [{ gateId: "GOVERNANCE_BASELINE", outcome: "WAIVED" }],
      },
    ]) {
      const decision = evaluatePhase32LaunchClassPolicy(raw);
      expect(decision).toMatchObject({
        status: "NO_GO",
        decision: "NO_GO",
        approvedClass: null,
        requestedClass: null,
      });
      expect(decision.validationIssues.length).toBeGreaterThan(0);
      expect(decision.evaluations).toHaveLength(6);
    }
  });
});

const SCOPE_BY_CLASS: Readonly<
  Record<Phase32LaunchClass, Phase32ReleaseScope>
> = {
  LC1: scope({
    requestedClass: "LC1",
    operatingMode: "LOCAL_DEMO",
    dataMode: "SYNTHETIC_ONLY",
    providerMode: "MOCK_OR_DISABLED",
    moneyMode: "NO_MONEY",
    accessMode: "LOCAL_ONLY",
    acquisitionMode: "NONE",
    publicIndexing: false,
    companyTrustSurfaces: false,
  }),
  LC2: scope({
    requestedClass: "LC2",
    operatingMode: "SUPERVISED_DESIGN_PARTNER",
    dataMode: "ALLOWLISTED_REAL",
    providerMode: "FLOW_SCOPED_APPROVED",
    moneyMode: "NO_MONEY",
    accessMode: "SUPERVISED_ALLOWLIST",
    acquisitionMode: "CLOSED_COHORT",
    publicIndexing: false,
    companyTrustSurfaces: false,
  }),
  LC3: scope({
    requestedClass: "LC3",
    operatingMode: "INVITE_ONLY_PILOT",
    dataMode: "ALLOWLISTED_REAL",
    providerMode: "APPROVED_REAL",
    moneyMode: "NO_MONEY",
    accessMode: "INVITE_ONLY",
    acquisitionMode: "CLOSED_COHORT",
    publicIndexing: false,
    companyTrustSurfaces: true,
  }),
  LC4: scope({
    requestedClass: "LC4",
    operatingMode: "PUBLIC_FREE",
    dataMode: "REAL",
    providerMode: "APPROVED_REAL",
    moneyMode: "NO_MONEY",
    accessMode: "PUBLIC_SELF_SERVICE",
    acquisitionMode: "BOUNDED_PUBLIC",
    publicIndexing: true,
    companyTrustSurfaces: true,
  }),
  LC5: scope({
    requestedClass: "LC5",
    operatingMode: "PAID_SELF_SERVICE",
    dataMode: "REAL",
    providerMode: "APPROVED_REAL",
    moneyMode: "APPROVED_PAID_OFFERS",
    accessMode: "PUBLIC_SELF_SERVICE",
    acquisitionMode: "BOUNDED_PUBLIC",
    publicIndexing: true,
    companyTrustSurfaces: true,
  }),
  LC6: scope({
    requestedClass: "LC6",
    operatingMode: "SCALED_PRODUCTION",
    dataMode: "REAL",
    providerMode: "APPROVED_REAL",
    moneyMode: "APPROVED_PAID_OFFERS",
    accessMode: "PUBLIC_SELF_SERVICE",
    acquisitionMode: "BROAD",
    publicIndexing: true,
    companyTrustSurfaces: true,
  }),
};

function completeInput(
  launchClass: Phase32LaunchClass,
): Phase32LaunchClassPolicyInput {
  const input: Phase32LaunchClassPolicyInput = {
    policyVersion: PHASE32_POLICY_VERSION,
    scope: { ...SCOPE_BY_CLASS[launchClass] },
    gates: PHASE32_GATE_IDS.map((gateId) => ({
      gateId,
      outcome: "PASS" as const,
    })),
  };
  setGate(input, "PHASE27_MULTI_PERSONA", "DISABLED");
  setGate(input, "PHASE28_EXTERNAL_TRACKER", "DISABLED");
  setGate(input, "PHASE28_INTERVIEW_SCHEDULER", "DISABLED");
  if (launchClass === "LC1" || launchClass === "LC2") {
    setGate(input, "PHASE26_COMPANY_TRUST", "DISABLED");
  }
  if (launchClass === "LC6") {
    setGate(input, "PHASE30B_SCALE", "DEFERRED_MONITORED");
    setGate(input, "PHASE30C_SITEMAP", "DEFERRED_MONITORED");
  }
  return input;
}

function setGate(
  input: Phase32LaunchClassPolicyInput,
  gateId: Phase32GateId,
  outcome: Phase32GateOutcome,
) {
  input.gates = input.gates.map((gate) =>
    gate.gateId === gateId ? { gateId, outcome } : gate,
  );
}

function scope(
  input: Pick<
    Phase32ReleaseScope,
    | "requestedClass"
    | "operatingMode"
    | "dataMode"
    | "providerMode"
    | "moneyMode"
    | "accessMode"
    | "acquisitionMode"
    | "publicIndexing"
    | "companyTrustSurfaces"
  >,
): Phase32ReleaseScope {
  return {
    ...input,
    multiPersonaPromised: false,
    externalTrackerPromised: false,
    interviewSchedulerPromised: false,
    scale30BTriggered: false,
    scale30CTriggered: false,
  };
}
