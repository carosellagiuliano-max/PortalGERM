import {
  createCorrelationId,
  normalizeCorrelationId,
} from "@/lib/utils/correlation-id";
import { describe, expect, it } from "vitest";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("correlation IDs", () => {
  it("creates a standards-shaped UUID", () => {
    expect(createCorrelationId()).toMatch(UUID_PATTERN);
  });

  it("accepts a valid incoming ID and normalizes it to lowercase", () => {
    expect(
      normalizeCorrelationId("0196F82D-3FB4-7F1A-8C9D-123456789ABC"),
    ).toBe("0196f82d-3fb4-7f1a-8c9d-123456789abc");
  });

  it.each([undefined, null, "", "unsafe value", "00000000-0000-0000-0000-000000000000"])(
    "replaces an absent or invalid incoming value (%s)",
    (value: string | null | undefined) => {
      const normalized = normalizeCorrelationId(value);
      expect(normalized).toMatch(UUID_PATTERN);
      expect(normalized).not.toBe(value);
    },
  );
});
