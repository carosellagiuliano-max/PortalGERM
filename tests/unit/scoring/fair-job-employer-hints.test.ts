import {
  FAIR_JOB_REASON_FALLBACK_HINT_DE_V2,
  FAIR_JOB_REASON_HINTS_DE_V2,
  getFairJobEmployerHintDe,
} from "@/lib/scoring/fair-job-employer-hints";
import {
  FAIR_JOB_FACTOR_ORDER_V2,
  type FairJobReasonCodeV2,
} from "@/lib/scoring/fair-job-score";
import { describe, expect, it } from "vitest";

const EVIDENCE_STATES = ["MISSING", "PARTIAL", "MET"] as const;
const ALL_REASON_CODES = FAIR_JOB_FACTOR_ORDER_V2.flatMap((factor) =>
  EVIDENCE_STATES.map(
    (state) => `${factor}_${state}` as FairJobReasonCodeV2,
  ),
);

describe("German Fair-Job employer hints", () => {
  it("maps every stable v2 reason code to a readable German hint", () => {
    expect(Object.keys(FAIR_JOB_REASON_HINTS_DE_V2).sort()).toEqual(
      [...ALL_REASON_CODES].sort(),
    );

    for (const reasonCode of ALL_REASON_CODES) {
      const hint = getFairJobEmployerHintDe(reasonCode);
      expect(hint).toBe(FAIR_JOB_REASON_HINTS_DE_V2[reasonCode]);
      expect(hint.trim().length).toBeGreaterThan(20);
      expect(hint).not.toContain(reasonCode);
    }
  });

  it.each([undefined, null, "", "   ", "UNKNOWN_CODE", 17])(
    "uses the fail-safe hint for unknown or empty input %j",
    (reasonCode) => {
      expect(getFairJobEmployerHintDe(reasonCode)).toBe(
        FAIR_JOB_REASON_FALLBACK_HINT_DE_V2,
      );
    },
  );

  it("normalizes harmless surrounding whitespace for a known code", () => {
    expect(getFairJobEmployerHintDe("  SALARY_MISSING  ")).toBe(
      FAIR_JOB_REASON_HINTS_DE_V2.SALARY_MISSING,
    );
  });
});
