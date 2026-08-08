import { describe, expect, it } from "vitest";

import {
  canUseSyntheticPublicResponseEvidence,
  projectSyntheticPublicResponseEvidence,
  PUBLIC_RESPONSE_EVIDENCE_POLICY_V1,
  UNKNOWN_PUBLIC_RESPONSE_EVIDENCE,
} from "@/lib/search/public-response-evidence-policy";

const SYNTHETIC_PROJECTION = Object.freeze({
  responseTargetDays: 5,
  responseSampleSize: 20,
  responseWithinTargetBps: 8_500,
});

describe("public response-evidence boundary", () => {
  it.each(["local", "ci"] as const)(
    "permits a valid synthetic projection only in %s",
    (environment) => {
      expect(canUseSyntheticPublicResponseEvidence(environment)).toBe(true);
      expect(
        projectSyntheticPublicResponseEvidence(
          SYNTHETIC_PROJECTION,
          environment,
        ),
      ).toEqual({
        known: true,
        targetDays: 5,
        onTimeRateBps: 8_500,
        sampleSizeBucket: "20–49",
      });
    },
  );

  it.each(["preview", "staging", "production"] as const)(
    "suppresses populated Company fields in %s",
    (environment) => {
      expect(canUseSyntheticPublicResponseEvidence(environment)).toBe(false);
      expect(
        projectSyntheticPublicResponseEvidence(
          SYNTHETIC_PROJECTION,
          environment,
        ),
      ).toBe(UNKNOWN_PUBLIC_RESPONSE_EVIDENCE);
    },
  );

  it("fails closed when the environment is not supplied", () => {
    expect(
      projectSyntheticPublicResponseEvidence(SYNTHETIC_PROJECTION, undefined),
    ).toBe(UNKNOWN_PUBLIC_RESPONSE_EVIDENCE);
  });

  it.each([
    { responseTargetDays: 0 },
    { responseTargetDays: 31 },
    { responseSampleSize: 19 },
    { responseSampleSize: Number.MAX_SAFE_INTEGER + 1 },
    { responseWithinTargetBps: -1 },
    { responseWithinTargetBps: 10_001 },
  ])("rejects an invalid local projection %#", (patch) => {
    expect(
      projectSyntheticPublicResponseEvidence(
        { ...SYNTHETIC_PROJECTION, ...patch },
        "local",
      ),
    ).toBe(UNKNOWN_PUBLIC_RESPONSE_EVIDENCE);
  });

  it("documents that no durable production projection is available", () => {
    expect(PUBLIC_RESPONSE_EVIDENCE_POLICY_V1).toMatchObject({
      version: "PUBLIC_RESPONSE_EVIDENCE_POLICY_V1",
      productionProjectionState: "UNAVAILABLE",
      minimumSampleSize: 20,
    });
  });
});
