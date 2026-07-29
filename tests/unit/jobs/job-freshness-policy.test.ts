import { describe, expect, it } from "vitest";

import {
  buildJobPublicationSourceScopeV1,
  buildPublicationFingerprintV1,
  calculateJobFreshnessScheduleV1,
  dueFreshnessActionsV1,
  isJobFreshnessEligibleV1,
  nearDuplicateScoreBpsV1,
} from "@/lib/jobs/freshness-policy";

const DAY_MS = 86_400_000;
const confirmedAt = new Date("2026-07-01T12:00:00.000Z");

describe("Phase 30 job freshness policy", () => {
  it("uses the earlier of 30 days and the contractual expiry", () => {
    const thirtyDays = calculateJobFreshnessScheduleV1(
      confirmedAt,
      new Date(confirmedAt.getTime() + 90 * DAY_MS),
    );
    expect(thirtyDays.dueAt).toEqual(new Date("2026-07-31T12:00:00.000Z"));
    expect(thirtyDays.reminder7At).toEqual(
      new Date("2026-07-24T12:00:00.000Z"),
    );
    expect(thirtyDays.reminder24At).toEqual(
      new Date("2026-07-30T12:00:00.000Z"),
    );

    const earlyExpiry = calculateJobFreshnessScheduleV1(
      confirmedAt,
      new Date(confirmedAt.getTime() + 10 * DAY_MS),
    );
    expect(earlyExpiry.dueAt).toEqual(new Date("2026-07-11T12:00:00.000Z"));
  });

  it("fails closed exactly at confirmation due and review-SLA boundaries", () => {
    const dueAt = new Date("2026-07-31T12:00:00.000Z");
    const base = {
      state: "ACTIVE" as const,
      dueAt,
      enforceAt: confirmedAt,
      reviewDueAt: null,
    };
    expect(isJobFreshnessEligibleV1(base, new Date(dueAt.getTime() - 1))).toBe(
      true,
    );
    expect(isJobFreshnessEligibleV1(base, dueAt)).toBe(false);
    expect(
      isJobFreshnessEligibleV1(
        {
          ...base,
          state: "REVIEW_PENDING",
          reviewDueAt: new Date("2026-07-02T16:00:00.000Z"),
        },
        new Date("2026-07-02T16:00:00.000Z"),
      ),
    ).toBe(false);
    expect(
      isJobFreshnessEligibleV1({ ...base, state: "HOLD" }, confirmedAt),
    ).toBe(false);
  });

  it("emits reminders once and prioritizes due/SLA actions deterministically", () => {
    expect(
      dueFreshnessActionsV1(
        {
          state: "ACTIVE",
          dueAt: new Date("2026-07-31T12:00:00.000Z"),
          reminder7At: new Date("2026-07-24T12:00:00.000Z"),
          reminder24At: new Date("2026-07-30T12:00:00.000Z"),
          reminder7SentAt: null,
          reminder24SentAt: null,
          reviewDueAt: null,
        },
        new Date("2026-07-30T12:00:00.000Z"),
      ),
    ).toEqual(["REMINDER_7D", "REMINDER_24H"]);
    expect(
      dueFreshnessActionsV1(
        {
          state: "REVIEW_PENDING",
          dueAt: new Date("2026-07-31T12:00:00.000Z"),
          reminder7At: new Date("2026-07-24T12:00:00.000Z"),
          reminder24At: new Date("2026-07-30T12:00:00.000Z"),
          reminder7SentAt: confirmedAt,
          reminder24SentAt: confirmedAt,
          reviewDueAt: new Date("2026-07-29T12:00:00.000Z"),
        },
        new Date("2026-07-31T12:00:00.000Z"),
      ),
    ).toEqual(["REVIEW_SLA_EXCEEDED", "DUE"]);
  });

  it("normalizes exact duplicates and exposes an 85 percent near-duplicate boundary", () => {
    const base = fingerprintInput();
    const left = buildPublicationFingerprintV1(base);
    const reordered = buildPublicationFingerprintV1({
      ...base,
      title: "  PFLEGEFACHFRAU  ",
      tasks: [...base.tasks].reverse(),
      requirements: [...base.requirements].reverse(),
    });
    expect(reordered.exactFingerprint).toBe(left.exactFingerprint);
    expect(
      nearDuplicateScoreBpsV1(
        Array.from({ length: 17 }, (_, index) => `token-${index}`),
        Array.from({ length: 20 }, (_, index) => `token-${index}`),
      ),
    ).toBe(8_500);
  });

  it("groups every manual copy and only the same licensed import source", () => {
    expect(
      buildJobPublicationSourceScopeV1({
        origin: "MANUAL",
        importSourceId: null,
      }),
    ).toBe("manual");
    expect(
      buildJobPublicationSourceScopeV1({
        origin: "IMPORT",
        importSourceId: "10000000-0000-4000-8000-000000000001",
      }),
    ).toBe("import:10000000-0000-4000-8000-000000000001");
    expect(() =>
      buildJobPublicationSourceScopeV1({
        origin: "IMPORT",
        importSourceId: null,
      }),
    ).toThrow("import-source ID");
  });
});

function fingerprintInput() {
  return {
    title: "Pflegefachfrau",
    description: "Betreuung und Pflege auf einer Akutstation.",
    tasks: ["Pflegeplanung", "Dokumentation"],
    requirements: ["Diplom HF", "Deutsch B2"],
    offer: "Weiterbildung",
    categoryId: "health",
    cantonId: "zh",
    cityId: "zurich",
    workloadMin: 80,
    workloadMax: 100,
    jobType: "PERMANENT",
    remoteType: "ONSITE",
  } as const;
}
