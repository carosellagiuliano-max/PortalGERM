// @vitest-environment node

import { describe, expect, it } from "vitest";

import { candidateAnalyticsSubjectV1 } from "@/lib/analytics/pseudonyms";

describe("candidate analytics pseudonym V1", () => {
  it("derives a stable, non-raw and versioned subject from a User UUID", () => {
    const userId = "11111111-1111-4111-8111-111111111111";

    expect(candidateAnalyticsSubjectV1(userId)).toBe(
      "candidate-v1-406b421fe093f1578ea4c9d6500809a4",
    );
    expect(candidateAnalyticsSubjectV1(userId)).not.toContain(userId);
  });

  it("normalizes UUID casing while keeping different users separate", () => {
    const uppercase = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
    const lowercase = uppercase.toLowerCase();

    expect(candidateAnalyticsSubjectV1(uppercase)).toBe(
      candidateAnalyticsSubjectV1(lowercase),
    );
    expect(candidateAnalyticsSubjectV1(lowercase)).not.toBe(
      candidateAnalyticsSubjectV1("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
    );
  });

  it.each([
    "",
    "candidate-user-1",
    "11111111-1111-0111-8111-111111111111",
    "11111111-1111-4111-7111-111111111111",
  ])("rejects a non-canonical User id: %s", (userId) => {
    expect(() => candidateAnalyticsSubjectV1(userId)).toThrow(TypeError);
  });
});
