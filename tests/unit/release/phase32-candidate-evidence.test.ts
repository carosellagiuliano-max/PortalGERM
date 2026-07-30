import { describe, expect, it } from "vitest";

import ledgerFixture from "@/codex-plan/release/phase32-lc1-findings-ledger.json";
import {
  applyPhase32DisabledServerGates,
  assertPhase32DisabledServerGates,
  extractPhase32CandidateEvidenceAliases,
  PHASE32_CANDIDATE_REPORT_KIND_BY_FINDING,
  resolvePhase32CandidateEvidence,
  type Phase32CandidateReport,
} from "@/lib/release/phase32-candidate-evidence";
import {
  parsePhase32FindingsLedger,
  PHASE32_FINDING_IDS,
  type Phase32FindingsLedger,
} from "@/lib/release/phase32-findings-ledger";
import { PHASE32_REQUIRED_REPORT_KINDS } from "@/lib/release/phase32-g4-manifest";

function candidateReports(): Phase32CandidateReport[] {
  return PHASE32_REQUIRED_REPORT_KINDS.map((kind, index) => ({
    kind,
    status: "PASSED",
    reportSha256: "0123456789abcdef"[index % 16]!.repeat(64),
  }));
}

function mutableLedger(): Phase32FindingsLedger {
  return structuredClone(
    parsePhase32FindingsLedger(ledgerFixture),
  ) as Phase32FindingsLedger;
}

describe("Phase 32 candidate evidence", () => {
  it("maps all 37 findings and every status-specific alias exactly once", () => {
    const ledger = parsePhase32FindingsLedger(ledgerFixture);
    const expectedAliases = ledger.records.flatMap((record) =>
      extractPhase32CandidateEvidenceAliases(record),
    );
    const bindings = resolvePhase32CandidateEvidence(
      ledger,
      candidateReports(),
    );

    expect(Object.keys(PHASE32_CANDIDATE_REPORT_KIND_BY_FINDING)).toEqual(
      PHASE32_FINDING_IDS,
    );
    expect(bindings).toHaveLength(37);
    expect(bindings.map((binding) => binding.findingId)).toEqual(
      PHASE32_FINDING_IDS,
    );
    expect(bindings.map((binding) => binding.alias)).toEqual(expectedAliases);
    expect(new Set(bindings.map((binding) => binding.alias))).toHaveLength(37);
    expect(
      bindings.every(
        (binding) =>
          binding.reportKind ===
          PHASE32_CANDIDATE_REPORT_KIND_BY_FINDING[binding.findingId],
      ),
    ).toBe(true);
  });

  it("keeps STH-024 blocked until external walkthrough evidence is available", () => {
    const ledger = parsePhase32FindingsLedger(ledgerFixture);
    const blocked = resolvePhase32CandidateEvidence(ledger, candidateReports());
    const unblocked = resolvePhase32CandidateEvidence(
      ledger,
      candidateReports(),
      { externalWalkthroughAvailable: true },
    );

    expect(
      blocked.find((binding) => binding.findingId === "STH-024")
        ?.externalWalkthroughBlocked,
    ).toBe(true);
    expect(
      unblocked.find((binding) => binding.findingId === "STH-024")
        ?.externalWalkthroughBlocked,
    ).toBe(false);
    expect(
      blocked
        .filter((binding) => binding.findingId !== "STH-024")
        .every((binding) => !binding.externalWalkthroughBlocked),
    ).toBe(true);
  });

  it("fails closed when an alias or required candidate report is missing", () => {
    const missingAlias = mutableLedger();
    const first = missingAlias.records.find(
      (record) => record.id === "STH-001",
    );
    if (first?.status !== "CLOSED") throw new Error("missing STH-001 fixture");
    first.candidateEvidenceAliases.splice(
      0,
      first.candidateEvidenceAliases.length,
    );

    expect(() =>
      resolvePhase32CandidateEvidence(missingAlias, candidateReports()),
    ).toThrow(/STH-001 has no candidate evidence alias/u);

    const ledger = parsePhase32FindingsLedger(ledgerFixture);
    expect(() =>
      resolvePhase32CandidateEvidence(
        ledger,
        candidateReports().filter((report) => report.kind !== "INTEGRATION"),
      ),
    ).toThrow(/requires missing candidate report INTEGRATION/u);
  });

  it("overrides poisoned ambient values without mutating the input", () => {
    const ledger = parsePhase32FindingsLedger(ledgerFixture);
    const ambient: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      KEEP_ME: "ambient",
    };
    for (const record of ledger.records) {
      if (record.status !== "DISABLED") continue;
      for (const gate of record.disablement.serverGates) {
        ambient[gate.key] = `poisoned-${gate.expectedValue}`;
      }
    }
    const original = { ...ambient };

    const frozen = applyPhase32DisabledServerGates(ledger, ambient);

    expect(ambient).toEqual(original);
    expect(frozen).not.toBe(ambient);
    expect(frozen.KEEP_ME).toBe("ambient");
    for (const record of ledger.records) {
      if (record.status !== "DISABLED") continue;
      for (const gate of record.disablement.serverGates) {
        expect(frozen[gate.key]).toBe(gate.expectedValue);
      }
    }
    expect(() =>
      assertPhase32DisabledServerGates(ledger, frozen),
    ).not.toThrow();

    frozen.PAID_SELF_SERVICE = "true";
    expect(() => assertPhase32DisabledServerGates(ledger, frozen)).toThrow(
      /PAID_SELF_SERVICE must equal "false"/u,
    );
  });

  it("rejects conflicting expected values for the same server gate", () => {
    const ledger = mutableLedger();
    const recovery = ledger.records.find((record) => record.id === "STH-035");
    if (recovery?.status !== "DISABLED")
      throw new Error("missing STH-035 fixture");
    const paidSelfService = recovery.disablement.serverGates.find(
      (gate) => gate.key === "PAID_SELF_SERVICE",
    );
    if (paidSelfService === undefined)
      throw new Error("missing PAID_SELF_SERVICE fixture");
    paidSelfService.expectedValue = "true";

    expect(() =>
      applyPhase32DisabledServerGates(ledger, { NODE_ENV: "test" }),
    ).toThrow(/conflicting values for PAID_SELF_SERVICE/u);
  });
});
