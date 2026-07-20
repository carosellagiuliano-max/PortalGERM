import { describe, expect, it } from "vitest";

import {
  JOB_ALERT_POLICY_V1,
  createJobAlertUnsubscribeToken,
  firstJobAlertDueAt,
  hashJobAlertUnsubscribeToken,
  isInsideJobAlertWindow,
  jobAlertCommandSchema,
  jobAlertEligibilityEnvironment,
  jobAlertWindow,
  nextJobAlertDueAt,
} from "@/lib/candidate/job-alert-policy";

describe("JOB_ALERT_POLICY_V1 Zurich schedule", () => {
  it("schedules DAILY at 08:00 on the next local calendar day", () => {
    expect(firstJobAlertDueAt(new Date("2026-01-13T05:30:00.000Z"), "DAILY"))
      .toEqual(new Date("2026-01-14T07:00:00.000Z"));
    expect(firstJobAlertDueAt(new Date("2026-07-13T19:30:00.000Z"), "DAILY"))
      .toEqual(new Date("2026-07-14T06:00:00.000Z"));
  });

  it("uses the same Monday only before 08:00 and otherwise the next Monday", () => {
    expect(firstJobAlertDueAt(new Date("2026-07-20T05:59:59.999Z"), "WEEKLY"))
      .toEqual(new Date("2026-07-20T06:00:00.000Z"));
    expect(firstJobAlertDueAt(new Date("2026-07-20T06:00:00.000Z"), "WEEKLY"))
      .toEqual(new Date("2026-07-27T06:00:00.000Z"));
    expect(firstJobAlertDueAt(new Date("2026-07-20T10:00:00.000Z"), "WEEKLY"))
      .toEqual(new Date("2026-07-27T06:00:00.000Z"));
  });

  it("crosses Zurich spring and autumn DST with local 08:00 intact", () => {
    expect(nextJobAlertDueAt(new Date("2026-03-28T20:00:00.000Z"), "DAILY"))
      .toEqual(new Date("2026-03-29T06:00:00.000Z"));
    expect(nextJobAlertDueAt(new Date("2026-10-24T20:00:00.000Z"), "DAILY"))
      .toEqual(new Date("2026-10-25T07:00:00.000Z"));
    expect(nextJobAlertDueAt(new Date("2026-03-28T12:00:00.000Z"), "WEEKLY"))
      .toEqual(new Date("2026-03-30T06:00:00.000Z"));
    expect(nextJobAlertDueAt(new Date("2026-10-24T12:00:00.000Z"), "WEEKLY"))
      .toEqual(new Date("2026-10-26T07:00:00.000Z"));
  });
});

describe("JOB_ALERT_POLICY_V1 digest window", () => {
  it("owns exactly the half-open interval (cutoff, now]", () => {
    const window = jobAlertWindow(
      new Date("2026-07-01T00:00:00.000Z"),
      new Date("2026-07-10T10:00:00.000Z"),
      new Date("2026-07-20T10:00:00.000Z"),
    );

    expect(isInsideJobAlertWindow(new Date("2026-07-10T10:00:00.000Z"), window))
      .toBe(false);
    expect(isInsideJobAlertWindow(new Date("2026-07-10T10:00:00.001Z"), window))
      .toBe(true);
    expect(isInsideJobAlertWindow(new Date("2026-07-20T10:00:00.000Z"), window))
      .toBe(true);
    expect(isInsideJobAlertWindow(new Date("2026-07-20T10:00:00.001Z"), window))
      .toBe(false);
  });
});

describe("JOB_ALERT_POLICY_V1 public eligibility environment", () => {
  it.each(["production", "staging"])(
    "treats %s as production-like",
    (appEnvironment) => {
      expect(jobAlertEligibilityEnvironment(appEnvironment)).toBe("production");
    },
  );

  it.each(["local", "ci", "preview"])(
    "keeps %s eligible for explicit non-production fixtures",
    (appEnvironment) => {
      expect(jobAlertEligibilityEnvironment(appEnvironment)).toBe("non-production");
    },
  );
});

describe("job alert commands and unsubscribe tokens", () => {
  it("rejects inverted workload ranges", () => {
    const result = jobAlertCommandSchema.safeParse({
      active: true,
      deliveryConsentAccepted: true,
      frequency: "DAILY",
      query: {
        keyword: "Pflege",
        cantonId: null,
        cityId: null,
        radiusKm: 25,
        categoryId: null,
        workloadMin: 90,
        workloadMax: 60,
        salaryTransparentOnly: true,
        remotePreference: "ANY",
      },
    });
    expect(result.success).toBe(false);
  });

  it("creates 256-bit raw tokens, stores only SHA-256 and expires after 180 days", () => {
    const issuedAt = new Date("2026-07-20T10:00:00.000Z");
    const token = createJobAlertUnsubscribeToken(
      issuedAt,
      (size) => Buffer.alloc(size, 0x5a),
    );

    expect(Buffer.from(token.rawToken, "base64url")).toHaveLength(
      JOB_ALERT_POLICY_V1.unsubscribeTokenBytes,
    );
    expect(token.rawToken).toHaveLength(43);
    expect(token.tokenHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(hashJobAlertUnsubscribeToken(token.rawToken)).toBe(token.tokenHash);
    expect(token.expiresAt.getTime() - issuedAt.getTime()).toBe(
      180 * 24 * 60 * 60 * 1_000,
    );
  });
});
