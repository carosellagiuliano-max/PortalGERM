// @vitest-environment node

import { describe, expect, it } from "vitest";

import { projectCanonicalResponseMedianMinutes } from "@/lib/search/response-evidence";

const NOW = new Date("2026-07-22T12:00:00.000Z");
const DAY = 86_400_000;

describe("public response median projection", () => {
  it("projects the canonical median only for a coherent >=20-case cohort", () => {
    const cases = Array.from({ length: 20 }, (_, index) => responseCase(
      index,
      index < 10 ? 60 : 120,
    ));

    expect(projectCanonicalResponseMedianMinutes({
      responseTargetDays: 5,
      responseSampleSize: 20,
      responseWithinTargetBps: 10_000,
    }, cases, NOW)).toBe(90);
  });

  it("fails closed for an undersized or incoherent public projection", () => {
    const nineteen = Array.from({ length: 19 }, (_, index) => responseCase(index, 60));
    const twenty = [...nineteen, responseCase(19, 60)];

    expect(projectCanonicalResponseMedianMinutes({
      responseTargetDays: 5,
      responseSampleSize: 19,
      responseWithinTargetBps: 10_000,
    }, nineteen, NOW)).toBeNull();
    expect(projectCanonicalResponseMedianMinutes({
      responseTargetDays: 5,
      responseSampleSize: 20,
      responseWithinTargetBps: 9_000,
    }, twenty, NOW)).toBeNull();
  });

  it("keeps the median private when fewer than 20 due cases received a response", () => {
    const cases = Array.from({ length: 20 }, (_, index) => responseCase(
      index,
      index === 19 ? null : 60,
    ));

    expect(projectCanonicalResponseMedianMinutes({
      responseTargetDays: 5,
      responseSampleSize: 20,
      responseWithinTargetBps: 9_500,
    }, cases, NOW)).toBeNull();
  });
});

function responseCase(index: number, responseMinutes: number | null) {
  const submittedAt = new Date(NOW.getTime() - (10 + index / 100) * DAY);
  return {
    applicationId: `application-${index}`,
    submittedAt,
    responseTargetDays: 5,
    firstResponseAt: responseMinutes === null
      ? null
      : new Date(submittedAt.getTime() + responseMinutes * 60_000),
  };
}
