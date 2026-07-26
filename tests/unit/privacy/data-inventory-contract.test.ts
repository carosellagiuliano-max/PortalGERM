// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  PHASE22_DATA_INVENTORY_V1,
  PRIVACY_PROCESSORS_V1,
  PRIVACY_SUBJECT_CLASSES_V1,
  processorKeysForPrivacyActionV1,
  validatePrivacyDataInventoryV1,
} from "@/lib/privacy/data-inventory";

describe("Phase-22 privacy data-inventory contract", () => {
  it("covers every declared subject class and processor with a stable technical hash", () => {
    const first = validatePrivacyDataInventoryV1(PHASE22_DATA_INVENTORY_V1);
    const reversed = validatePrivacyDataInventoryV1([
      ...PHASE22_DATA_INVENTORY_V1,
    ].reverse());

    expect(first).toMatchObject({
      valid: true,
      issues: [],
      processors: [...PRIVACY_PROCESSORS_V1].sort(),
      subjectClasses: [...PRIVACY_SUBJECT_CLASSES_V1].sort(),
    });
    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(reversed.contentHash).toBe(first.contentHash);
  });

  it("keeps external legal decisions explicit instead of manufacturing approval", () => {
    expect(PHASE22_DATA_INVENTORY_V1).not.toHaveLength(0);
    expect(
      PHASE22_DATA_INVENTORY_V1.every(
        ({ legalBasisCode }) =>
          legalBasisCode === "EXTERNAL_DECISION_REQUIRED",
      ),
    ).toBe(true);
  });

  it("derives bounded action processors and rejects duplicate or unbounded retention rows", () => {
    expect(processorKeysForPrivacyActionV1("CANDIDATE", "EXPORT")).toEqual(
      expect.arrayContaining([
        "postgres-primary",
        "document-object-store",
        "notification-outbox",
        "email-provider",
        "analytics-store",
      ]),
    );

    const duplicate = validatePrivacyDataInventoryV1([
      ...PHASE22_DATA_INVENTORY_V1,
      PHASE22_DATA_INVENTORY_V1[0],
    ]);
    expect(duplicate.valid).toBe(false);
    expect(duplicate.issues.some((issue) => issue.startsWith("duplicate:"))).toBe(
      true,
    );

    const invalidRetention = validatePrivacyDataInventoryV1(
      PHASE22_DATA_INVENTORY_V1.map((row, index) =>
        index === 0
          ? { ...row, erasureOutcome: "RETAIN", retentionDays: null }
          : row,
      ),
    );
    expect(invalidRetention.valid).toBe(false);
    expect(
      invalidRetention.issues.some((issue) =>
        issue.startsWith("retention-required:"),
      ),
    ).toBe(true);
  });
});
