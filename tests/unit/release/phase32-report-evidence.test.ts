import { describe, expect, it } from "vitest";

import {
  PHASE32_REPORT_EVIDENCE_VERSION,
  phase32ReportEvidenceSchema,
  type Phase32ReportEvidence,
  type Phase32ReportEvidenceExpectation,
  validatePhase32ReportEvidence,
} from "@/lib/release/phase32-report-evidence";

const COMMIT = "1".repeat(40);
const ARTIFACT = "2".repeat(64);
const LOG_DIGEST = "3".repeat(64);
const BROWSER_DIGEST = "4".repeat(64);
const RECOVERY_DIGEST = "5".repeat(64);

describe("Phase 32 report evidence descriptor", () => {
  it("binds one report to its candidate, primary log and sorted attachments", () => {
    const input = descriptor();
    const result = validatePhase32ReportEvidence(input, expectation(input));

    expect(result).toEqual(input);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.primaryLog)).toBe(true);
    expect(Object.isFrozen(result.attachments)).toBe(true);
  });

  it("rejects duplicate or overlapping evidence paths", () => {
    const duplicate = descriptor();
    duplicate.attachments[1]!.path = duplicate.attachments[0]!.path;
    expect(() => validatePhase32ReportEvidence(duplicate)).toThrow(
      /duplicate evidence path|unique and sorted/u,
    );

    const overlapsPrimary = descriptor();
    overlapsPrimary.primaryLog.path = "test-results/phase17/browser.log";
    expect(() => validatePhase32ReportEvidence(overlapsPrimary)).toThrow(
      /overlapping evidence directory/u,
    );
  });

  it.each([
    "../phase17",
    "/test-results/phase17",
    "test-results\\phase17",
    "test-results//phase17",
    "C:/test-results/phase17",
    "test-results/./phase17",
  ])("rejects unsafe or non-POSIX path %s", (path) => {
    const input = descriptor();
    input.attachments[0]!.path = path;
    expect(phase32ReportEvidenceSchema.safeParse(input).success).toBe(false);
  });

  it("detects a well-formed digest tamper against freshly hashed evidence", () => {
    const original = descriptor();
    const tampered = descriptor();
    tampered.primaryLog.sha256 = "a".repeat(64);

    expect(() =>
      validatePhase32ReportEvidence(tampered, expectation(original)),
    ).toThrow(/PHASE32_REPORT_EVIDENCE_BINDING_MISMATCH/u);
  });

  it("rejects unknown fields at every descriptor level", () => {
    const topLevel = descriptor() as Record<string, unknown>;
    topLevel.futureEvidence = true;
    expect(() => validatePhase32ReportEvidence(topLevel)).toThrow(
      /Unrecognized key/u,
    );

    const nested = descriptor();
    Object.assign(nested.attachments[0]!, { uri: "unverified" });
    expect(() => validatePhase32ReportEvidence(nested)).toThrow(
      /Unrecognized key/u,
    );
  });
});

type MutableDescriptor = {
  -readonly [
    TKey in keyof Phase32ReportEvidence
  ]: Phase32ReportEvidence[TKey] extends readonly (infer TItem)[]
    ? Array<{ -readonly [TItemKey in keyof TItem]: TItem[TItemKey] }>
    : Phase32ReportEvidence[TKey] extends object
      ? {
          -readonly [
            TObjectKey in keyof Phase32ReportEvidence[TKey]
          ]: Phase32ReportEvidence[TKey][TObjectKey];
        }
      : Phase32ReportEvidence[TKey];
};

function descriptor(): MutableDescriptor {
  return {
    schemaVersion: PHASE32_REPORT_EVIDENCE_VERSION,
    reportKind: "BROWSER",
    commitSha: COMMIT,
    artifactSha256: ARTIFACT,
    primaryLog: {
      path: "reports/browser.log",
      sha256: LOG_DIGEST,
    },
    attachments: [
      {
        path: "test-results/phase17",
        sha256: BROWSER_DIGEST,
        fileCount: 4,
        sizeBytes: 4096,
      },
      {
        path: "test-results/phase18",
        sha256: RECOVERY_DIGEST,
        fileCount: 2,
        sizeBytes: 2048,
      },
    ],
  };
}

function expectation(
  value: MutableDescriptor,
): Phase32ReportEvidenceExpectation {
  const { schemaVersion: _schemaVersion, ...expected } = structuredClone(value);
  return expected;
}
