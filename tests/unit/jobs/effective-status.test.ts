// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getJobExpiryProjectionDecision,
  jobExpiryEventIdempotencyKey,
  type JobExpiryProjectionSnapshot,
} from "@/lib/jobs/effective-status";

const NOW = new Date("2026-07-22T12:00:00.000Z");
const REVISION_ID = "15000000-0000-4000-8000-000000000001";

function snapshot(
  overrides: Partial<JobExpiryProjectionSnapshot> = {},
): JobExpiryProjectionSnapshot {
  const expiresAt = new Date(NOW);
  return {
    status: "PUBLISHED",
    currentRevisionId: REVISION_ID,
    publishedRevisionId: REVISION_ID,
    publishedAt: new Date("2026-07-01T12:00:00.000Z"),
    expiresAt,
    publishedRevision: {
      id: REVISION_ID,
      approvedAt: new Date("2026-06-30T12:00:00.000Z"),
      rejectedAt: null,
      validThrough: new Date(expiresAt),
    },
    ...overrides,
  };
}

describe("effective Job status projection policy", () => {
  it("projects exactly at and after the half-open valid-through boundary", () => {
    expect(getJobExpiryProjectionDecision(snapshot(), NOW)).toBe("DUE");
    const past = new Date(NOW.getTime() - 1);
    expect(
      getJobExpiryProjectionDecision(
        snapshot({
          expiresAt: past,
          publishedRevision: {
            ...snapshot().publishedRevision!,
            validThrough: past,
          },
        }),
        NOW,
      ),
    ).toBe("DUE");
  });

  it("does not project a Job while its half-open window is still valid", () => {
    const future = new Date(NOW.getTime() + 1);
    expect(
      getJobExpiryProjectionDecision(
        snapshot({
          expiresAt: future,
          publishedRevision: {
            ...snapshot().publishedRevision!,
            validThrough: future,
          },
        }),
        NOW,
      ),
    ).toBe("NOT_DUE");
  });

  it.each([
    ["current/published pointer drift", { currentRevisionId: "15000000-0000-4000-8000-000000000099" }],
    ["valid-through projection drift", { publishedRevision: { ...snapshot().publishedRevision!, validThrough: new Date(NOW.getTime() + 1) } }],
    ["missing approval", { publishedRevision: { ...snapshot().publishedRevision!, approvedAt: null } }],
    ["rejected revision", { publishedRevision: { ...snapshot().publishedRevision!, rejectedAt: new Date(NOW.getTime() - 1) } }],
    ["missing publication timestamp", { publishedAt: null }],
  ] satisfies readonly (readonly [string, Partial<JobExpiryProjectionSnapshot>])[])(
    "fails closed for %s",
    (_label, overrides) => {
      expect(getJobExpiryProjectionDecision(snapshot(overrides), NOW)).toBe(
        "INCONSISTENT",
      );
    },
  );

  it("ignores non-published and non-expiring states", () => {
    expect(
      getJobExpiryProjectionDecision(snapshot({ status: "PAUSED" }), NOW),
    ).toBe("NOT_DUE");
    expect(
      getJobExpiryProjectionDecision(snapshot({ expiresAt: null }), NOW),
    ).toBe("NOT_DUE");
  });

  it("uses a stable revision-scoped event key", () => {
    expect(
      jobExpiryEventIdempotencyKey(
        "15000000-0000-4000-8000-000000000002",
        REVISION_ID,
      ),
    ).toBe(
      "job-expiry:v1:15000000-0000-4000-8000-000000000002:15000000-0000-4000-8000-000000000001",
    );
  });

  it("rejects an invalid clock", () => {
    expect(() =>
      getJobExpiryProjectionDecision(snapshot(), new Date(Number.NaN)),
    ).toThrow(TypeError);
  });
});
