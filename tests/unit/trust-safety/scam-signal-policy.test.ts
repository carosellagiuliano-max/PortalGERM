import { describe, expect, it } from "vitest";

import { evaluateScamSignal } from "@/lib/trust-safety/scam-signal-policy";

describe("Phase 25 scam and velocity signal policy", () => {
  it.each([
    ["JOB_SCAM", "JOB", 1, "REVIEW"],
    ["JOB_SCAM", "JOB", 2, "HOLD"],
    ["JOB_DUPLICATE", "JOB", 1, "ALLOW"],
    ["JOB_DUPLICATE", "JOB", 2, "REVIEW"],
    ["MASS_MESSAGING", "COMPANY", 10, "STEP_UP"],
    ["MASS_MESSAGING", "COMPANY", 30, "HOLD"],
    ["MASS_CONTACT", "CONTACT_REQUEST", 5, "STEP_UP"],
    ["REPEATED_COMPLAINT", "COMPANY", 2, "HOLD"],
  ] as const)(
    "%s / %s / %s results in %s",
    (kind, subjectType, observedCount, decision) => {
      expect(
        evaluateScamSignal({ kind, subjectType, observedCount }),
      ).toMatchObject({ kind: decision });
    },
  );

  it("keeps a single similar job in the legitimate control group", () => {
    expect(
      evaluateScamSignal({
        kind: "JOB_DUPLICATE",
        subjectType: "JOB",
        observedCount: 1,
      }),
    ).toMatchObject({
      kind: "ALLOW",
      opensCase: false,
    });
  });
});
