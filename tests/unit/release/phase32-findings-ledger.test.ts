import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import ledgerFixture from "@/codex-plan/release/phase32-lc1-findings-ledger.json";
import {
  parsePhase32FindingsLedger,
  PHASE32_FINDING_IDS,
  PHASE32_FINDING_STATUSES,
} from "@/lib/release/phase32-findings-ledger";

type MutableRecord = Record<string, unknown>;
type MutableLedger = {
  schemaVersion: string;
  targetLaunchClass: string;
  auditDate: string;
  records: MutableRecord[];
  [key: string]: unknown;
};

function fixture(): MutableLedger {
  return structuredClone(ledgerFixture) as unknown as MutableLedger;
}

function finding(ledger: MutableLedger, id: string): MutableRecord {
  const record = ledger.records.find((candidate) => candidate.id === id);
  if (record === undefined) throw new Error(`Missing fixture finding ${id}`);
  return record;
}

function nested(record: MutableRecord, key: string): MutableRecord {
  const value = record[key];
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`Expected ${String(record.id)}.${key} to be an object`);
  return value as MutableRecord;
}

describe("Phase 32 LC1 findings ledger", () => {
  it("accepts exactly one complete, unique STH-001..STH-037 ledger", () => {
    const parsed = parsePhase32FindingsLedger(ledgerFixture);

    expect(parsed.targetLaunchClass).toBe("LC1");
    expect(parsed.records).toHaveLength(37);
    expect(parsed.records.map((record) => record.id)).toEqual(
      PHASE32_FINDING_IDS,
    );
    expect(new Set(parsed.records.map((record) => record.id))).toHaveLength(37);

    const counts = Object.fromEntries(
      PHASE32_FINDING_STATUSES.map((status) => [
        status,
        parsed.records.filter((record) => record.status === status).length,
      ]),
    );
    expect(counts).toEqual({
      CLOSED: 14,
      DISABLED: 13,
      EXTERNAL: 8,
      DEFERRED_MONITORED: 2,
    });
  });

  it("uses repository paths for every source-evidence reference", () => {
    const parsed = parsePhase32FindingsLedger(ledgerFixture);
    const missing = parsed.records.flatMap((record) =>
      record.sourceEvidence
        .filter((path) => !existsSync(resolve(process.cwd(), path)))
        .map((path) => `${record.id}:${path}`),
    );

    expect(missing).toEqual([]);
  });

  it("rejects missing, duplicate and unknown finding IDs", () => {
    const missing = fixture();
    missing.records.pop();
    expect(() => parsePhase32FindingsLedger(missing)).toThrow();

    const duplicate = fixture();
    duplicate.records[36]!.id = "STH-001";
    expect(() => parsePhase32FindingsLedger(duplicate)).toThrow(
      /duplicate finding id|missing finding id/u,
    );

    const unknown = fixture();
    unknown.records[36]!.id = "STH-038";
    expect(() => parsePhase32FindingsLedger(unknown)).toThrow();
  });

  it("rejects unknown status values and any LC1 status or priority drift", () => {
    const unknown = fixture();
    finding(unknown, "STH-001").status = "PASS";
    expect(() => parsePhase32FindingsLedger(unknown)).toThrow();

    const statusDrift = fixture();
    const first = finding(statusDrift, "STH-001");
    first.status = "DISABLED";
    first.disablement = {
      serverGates: [
        { key: "IDENTITY_VERIFICATION_ENFORCEMENT", expectedValue: "false" },
      ],
      negativeEvidenceAlias: "phase32.negative.sth-001.status-drift",
    };
    delete first.candidateEvidenceAliases;
    expect(() => parsePhase32FindingsLedger(statusDrift)).toThrow(
      /STH-001 must use LC1 status CLOSED/u,
    );

    const priorityDrift = fixture();
    finding(priorityDrift, "STH-024").priority = "P2";
    expect(() => parsePhase32FindingsLedger(priorityDrift)).toThrow(
      /STH-024 must use LC1 priority P1/u,
    );
  });

  it("denies unknown fields at the ledger, record and status-detail levels", () => {
    const topLevel = fixture();
    topLevel.approved = true;
    expect(() => parsePhase32FindingsLedger(topLevel)).toThrow();

    const recordLevel = fixture();
    finding(recordLevel, "STH-001").approved = true;
    expect(() => parsePhase32FindingsLedger(recordLevel)).toThrow();

    const disabledDetail = fixture();
    nested(finding(disabledDetail, "STH-005"), "disablement").fallback = "mock";
    expect(() => parsePhase32FindingsLedger(disabledDetail)).toThrow();

    const externalDetail = fixture();
    nested(finding(externalDetail, "STH-004"), "externalGate").waived = true;
    expect(() => parsePhase32FindingsLedger(externalDetail)).toThrow();

    const monitoringDetail = fixture();
    nested(finding(monitoringDetail, "STH-020"), "monitoring").ignored = true;
    expect(() => parsePhase32FindingsLedger(monitoringDetail)).toThrow();
  });

  it("requires candidate-bound aliases for every CLOSED finding", () => {
    const noCandidateEvidence = fixture();
    finding(noCandidateEvidence, "STH-024").candidateEvidenceAliases = [];

    expect(() => parsePhase32FindingsLedger(noCandidateEvidence)).toThrow();
  });

  it("requires server gates and a negative-evidence alias for DISABLED findings", () => {
    const noServerGate = fixture();
    nested(finding(noServerGate, "STH-005"), "disablement").serverGates = [];
    expect(() => parsePhase32FindingsLedger(noServerGate)).toThrow();

    const duplicateGate = fixture();
    const disablement = nested(
      finding(duplicateGate, "STH-005"),
      "disablement",
    );
    const gates = disablement.serverGates as MutableRecord[];
    gates.push(structuredClone(gates[0]!));
    expect(() => parsePhase32FindingsLedger(duplicateGate)).toThrow(
      /server gates must be unique/u,
    );

    const missingAlias = fixture();
    nested(
      finding(missingAlias, "STH-005"),
      "disablement",
    ).negativeEvidenceAlias = "";
    expect(() => parsePhase32FindingsLedger(missingAlias)).toThrow();
  });

  it("requires owner, scope, future review, source document and safe deactivation for EXTERNAL findings", () => {
    const wrongOwner = fixture();
    nested(finding(wrongOwner, "STH-004"), "externalGate").ownerRole =
      "OTHER_OWNER";
    expect(() => parsePhase32FindingsLedger(wrongOwner)).toThrow(
      /external owner must equal the finding owner/u,
    );

    const staleReview = fixture();
    nested(finding(staleReview, "STH-004"), "externalGate").reviewAt =
      "2026-07-30";
    expect(() => parsePhase32FindingsLedger(staleReview)).toThrow(
      /external reviewAt must be after auditDate/u,
    );

    const danglingDocument = fixture();
    nested(
      finding(danglingDocument, "STH-004"),
      "externalGate",
    ).sourceDocument = "codex-plan/runbooks/deployment.md";
    expect(() => parsePhase32FindingsLedger(danglingDocument)).toThrow(
      /external sourceDocument must be listed in sourceEvidence/u,
    );
  });

  it("requires current metrics, trigger, alert owner, future review and evidence for monitored findings", () => {
    const noMetric = fixture();
    nested(finding(noMetric, "STH-020"), "monitoring").currentMetrics = [];
    expect(() => parsePhase32FindingsLedger(noMetric)).toThrow();

    const noTrigger = fixture();
    nested(finding(noTrigger, "STH-020"), "monitoring").trigger = "";
    expect(() => parsePhase32FindingsLedger(noTrigger)).toThrow();

    const staleReview = fixture();
    nested(finding(staleReview, "STH-020"), "monitoring").reviewAt =
      "2026-07-30";
    expect(() => parsePhase32FindingsLedger(staleReview)).toThrow(
      /monitoring reviewAt must be after auditDate/u,
    );
  });

  it("rejects duplicate source references and evidence aliases", () => {
    const duplicateSource = fixture();
    const first = finding(duplicateSource, "STH-001");
    const sources = first.sourceEvidence as string[];
    sources.push(sources[0]!);
    expect(() => parsePhase32FindingsLedger(duplicateSource)).toThrow(
      /sourceEvidence must be unique/u,
    );

    const duplicateAlias = fixture();
    finding(duplicateAlias, "STH-002").candidateEvidenceAliases = [
      "phase32.candidate.sth-001.identity-verification",
    ];
    expect(() => parsePhase32FindingsLedger(duplicateAlias)).toThrow(
      /evidence alias .* is already bound/u,
    );
  });
});
