import { describe, expect, it } from "vitest";

import {
  PHASE32_GATE_IDS,
  PHASE32_LAUNCH_CLASSES,
  PHASE32_POLICY_VERSION,
  phase32LaunchClassPolicyInputSchema,
} from "@/lib/release/phase32-contract";

describe("Phase 32 strict release contracts", () => {
  it("keeps exactly six ordered launch classes and a closed gate vocabulary", () => {
    expect(PHASE32_LAUNCH_CLASSES).toEqual([
      "LC1",
      "LC2",
      "LC3",
      "LC4",
      "LC5",
      "LC6",
    ]);
    expect(new Set(PHASE32_GATE_IDS).size).toBe(PHASE32_GATE_IDS.length);
  });

  it("accepts a strict release scope and unique known gates", () => {
    expect(
      phase32LaunchClassPolicyInputSchema.safeParse(validInput()).success,
    ).toBe(true);
  });

  it.each([
    ["top-level", { futurePolicy: true }],
    ["scope", { scope: { futureScope: true } }],
    ["gate record", { gate: { evidence: "unvalidated" } }],
  ])("rejects an unknown %s field", (_label, mutation) => {
    const input = validInput() as Record<string, unknown>;
    if ("scope" in mutation) {
      input.scope = {
        ...(input.scope as Record<string, unknown>),
        ...mutation.scope,
      };
    } else if ("gate" in mutation) {
      input.gates = [
        {
          ...((input.gates as Record<string, unknown>[])[0] ?? {}),
          ...mutation.gate,
        },
      ];
    } else {
      Object.assign(input, mutation);
    }
    expect(phase32LaunchClassPolicyInputSchema.safeParse(input).success).toBe(
      false,
    );
  });

  it("rejects unknown gates, unknown outcomes and duplicate gate ids", () => {
    const unknownGate = validInput();
    unknownGate.gates = [{ gateId: "FUTURE_GATE", outcome: "PASS" }];
    expect(
      phase32LaunchClassPolicyInputSchema.safeParse(unknownGate).success,
    ).toBe(false);

    const unknownOutcome = validInput();
    unknownOutcome.gates = [
      { gateId: "GOVERNANCE_BASELINE", outcome: "WAIVED" },
    ];
    expect(
      phase32LaunchClassPolicyInputSchema.safeParse(unknownOutcome).success,
    ).toBe(false);

    const duplicate = validInput();
    duplicate.gates = [
      { gateId: "GOVERNANCE_BASELINE", outcome: "PASS" },
      { gateId: "GOVERNANCE_BASELINE", outcome: "PASS" },
    ];
    expect(
      phase32LaunchClassPolicyInputSchema.safeParse(duplicate).success,
    ).toBe(false);
  });
});

function validInput(): {
  policyVersion: string;
  scope: Record<string, unknown>;
  gates: Record<string, unknown>[];
} {
  return {
    policyVersion: PHASE32_POLICY_VERSION,
    scope: {
      requestedClass: "LC1",
      operatingMode: "LOCAL_DEMO",
      dataMode: "SYNTHETIC_ONLY",
      providerMode: "MOCK_OR_DISABLED",
      moneyMode: "NO_MONEY",
      accessMode: "LOCAL_ONLY",
      acquisitionMode: "NONE",
      publicIndexing: false,
      companyTrustSurfaces: false,
      multiPersonaPromised: false,
      externalTrackerPromised: false,
      interviewSchedulerPromised: false,
      scale30BTriggered: false,
      scale30CTriggered: false,
    },
    gates: [{ gateId: "GOVERNANCE_BASELINE", outcome: "PASS" }],
  };
}
