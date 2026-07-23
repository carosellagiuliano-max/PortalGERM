// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  buildRateLimitChecks,
  consumeRateLimit,
  createMemoryRateLimitStore,
  getRadarZurichCalendarDate,
  RADAR_DISTINCT_FILTER_BUDGET_V1,
  RATE_LIMIT_PRESETS_V1,
  resolveSourceIp,
} from "@/lib/auth/rate-limit";

const KEY = { version: "2026-07", secret: "rate-limit-test-secret" } as const;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const IDENTITY = {
  sourceIp: "192.0.2.10",
  normalizedEmail: "user@example.ch",
  userId: "user-1",
  actorId: "user-1",
  companyId: "company-1",
  candidateId: "candidate-1",
  targetId: "job-1",
  membershipId: "membership-1",
  membershipActive: true,
};

describe("RATE_LIMIT_PRESETS_V1", () => {
  it("freezes every required scope and limit", () => {
    expect(RATE_LIMIT_PRESETS_V1).toEqual({
      LOGIN: {
        buckets: [
          { scope: "IP_EMAIL", limit: 10, windowMs: 15 * MINUTE },
          { scope: "IP", limit: 30, windowMs: HOUR },
        ],
      },
      REGISTER: {
        buckets: [{ scope: "IP", limit: 10, windowMs: HOUR }],
      },
      FORGOT_PASSWORD: {
        buckets: [{ scope: "IP_EMAIL", limit: 5, windowMs: HOUR }],
      },
      APPLICATION_SUBMIT: {
        buckets: [
          { scope: "USER", limit: 30, windowMs: HOUR },
          { scope: "IP", limit: 100, windowMs: HOUR },
        ],
      },
      APPLICATION_CANDIDATE_MUTATION: {
        buckets: [
          { scope: "USER", limit: 60, windowMs: HOUR },
          { scope: "IP", limit: 120, windowMs: HOUR },
        ],
      },
      CANDIDATE_PROFILE_MUTATION: {
        buckets: [
          { scope: "USER", limit: 30, windowMs: HOUR },
          { scope: "IP", limit: 100, windowMs: HOUR },
        ],
      },
      JOB_ALERT_MUTATION: {
        buckets: [
          { scope: "USER", limit: 60, windowMs: HOUR },
          { scope: "IP", limit: 120, windowMs: HOUR },
        ],
      },
      MESSAGE_SEND: {
        buckets: [
          { scope: "USER", limit: 60, windowMs: HOUR },
          { scope: "IP", limit: 120, windowMs: HOUR },
        ],
      },
      PRIVACY_REQUEST: {
        buckets: [{ scope: "USER", limit: 5, windowMs: 30 * DAY }],
      },
      PRIVACY_IDENTITY_CHALLENGE: {
        buckets: [
          { scope: "USER", limit: 5, windowMs: 15 * MINUTE },
          { scope: "IP", limit: 20, windowMs: HOUR },
        ],
      },
      LEAD: {
        buckets: [{ scope: "IP", limit: 10, windowMs: HOUR }],
      },
      LEAD_DENIAL_AUDIT: {
        buckets: [{ scope: "IP", limit: 1, windowMs: HOUR }],
      },
      SECURITY_DENIAL_AUDIT: {
        buckets: [{ scope: "ACTOR_OR_IP", limit: 1, windowMs: HOUR }],
      },
      ABUSE_INTAKE_PRECHECK: {
        buckets: [
          { scope: "ACTOR_OR_IP", limit: 10, windowMs: DAY },
          { scope: "IP", limit: 20, windowMs: DAY },
        ],
      },
      ABUSE_INTAKE: {
        buckets: [
          { scope: "ACTOR_OR_IP_TARGET", limit: 3, windowMs: DAY },
        ],
      },
      CONTACT_REQUEST: {
        buckets: [
          { scope: "COMPANY", limit: 20, windowMs: HOUR },
          { scope: "USER", limit: 30, windowMs: HOUR },
          { scope: "CANDIDATE", limit: 3, windowMs: 30 * DAY },
        ],
      },
      RADAR_LIST: {
        buckets: [{ scope: "MEMBERSHIP", limit: 10, windowMs: MINUTE }],
      },
    });
    expect(RADAR_DISTINCT_FILTER_BUDGET_V1).toEqual({ limit: 30, calendarTimeZone: "Europe/Zurich" });
  });

  it("derives only versioned HMAC keys and never stores raw identifiers", () => {
    const serialized = JSON.stringify(buildRateLimitChecks("LOGIN", IDENTITY, KEY));
    expect(serialized).not.toContain(IDENTITY.sourceIp);
    expect(serialized).not.toContain(IDENTITY.normalizedEmail);
    expect(serialized).toContain("2026-07:");
    expect(() => buildRateLimitChecks("LOGIN", { sourceIp: IDENTITY.sourceIp }, KEY)).toThrow(TypeError);
    const abuse = JSON.stringify(buildRateLimitChecks("ABUSE_INTAKE", IDENTITY, KEY));
    expect(abuse).not.toContain(IDENTITY.actorId);
    expect(abuse).not.toContain(IDENTITY.targetId);
    expect(() =>
      buildRateLimitChecks(
        "ABUSE_INTAKE",
        { targetId: IDENTITY.targetId },
        KEY,
      )
    ).toThrow(TypeError);
  });

  it("allows N, blocks N+1, and reopens at the half-open boundary", async () => {
    const store = createMemoryRateLimitStore("test");
    const now = new Date("2026-07-19T10:00:00.000Z");
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(consumeRateLimit("REGISTER", IDENTITY, { store, key: KEY, now })).resolves.toEqual({ allowed: true, status: 200 });
    }
    const blocked = await consumeRateLimit("REGISTER", IDENTITY, { store, key: KEY, now });
    expect(blocked).toMatchObject({ allowed: false, status: 429, code: "RATE_LIMITED", retryAfterSeconds: 3600 });

    const boundary = new Date(now.getTime() + 60 * 60_000);
    await expect(consumeRateLimit("REGISTER", IDENTITY, { store, key: KEY, now: boundary })).resolves.toEqual({ allowed: true, status: 200 });
  });

  it("checks compound limits atomically and supports privacy/membership guards", async () => {
    const store = createMemoryRateLimitStore("test");
    const now = new Date("2026-07-19T10:00:00.000Z");
    expect(await consumeRateLimit("PRIVACY_REQUEST", { ...IDENTITY, samePrivacyTypeOpen: true }, { store, key: KEY, now })).toMatchObject({ code: "OPEN_REQUEST_EXISTS" });
    expect(await consumeRateLimit("RADAR_LIST", { ...IDENTITY, membershipActive: false }, { store, key: KEY, now })).toMatchObject({ code: "INACTIVE_MEMBERSHIP" });
  });

  it("refuses memory in production-like modes", () => {
    expect(() => createMemoryRateLimitStore("production" as "test")).toThrow();
  });
});

describe("Radar Zurich calendar attribution", () => {
  it("uses the local date at summer and winter midnight boundaries", () => {
    expect(getRadarZurichCalendarDate(new Date("2026-07-19T21:59:59.999Z"))).toBe("2026-07-19");
    expect(getRadarZurichCalendarDate(new Date("2026-07-19T22:00:00.000Z"))).toBe("2026-07-20");
    expect(getRadarZurichCalendarDate(new Date("2026-12-19T22:59:59.999Z"))).toBe("2026-12-19");
    expect(getRadarZurichCalendarDate(new Date("2026-12-19T23:00:00.000Z"))).toBe("2026-12-20");
  });

  it("uses the correct local date across both Zurich DST transitions", () => {
    expect(getRadarZurichCalendarDate(new Date("2026-03-28T22:59:59.999Z"))).toBe("2026-03-28");
    expect(getRadarZurichCalendarDate(new Date("2026-03-28T23:00:00.000Z"))).toBe("2026-03-29");
    expect(getRadarZurichCalendarDate(new Date("2026-03-29T21:59:59.999Z"))).toBe("2026-03-29");
    expect(getRadarZurichCalendarDate(new Date("2026-03-29T22:00:00.000Z"))).toBe("2026-03-30");

    expect(getRadarZurichCalendarDate(new Date("2026-10-24T21:59:59.999Z"))).toBe("2026-10-24");
    expect(getRadarZurichCalendarDate(new Date("2026-10-24T22:00:00.000Z"))).toBe("2026-10-25");
    expect(getRadarZurichCalendarDate(new Date("2026-10-25T22:59:59.999Z"))).toBe("2026-10-25");
    expect(getRadarZurichCalendarDate(new Date("2026-10-25T23:00:00.000Z"))).toBe("2026-10-26");
  });

  it("rejects an invalid clock", () => {
    expect(() => getRadarZurichCalendarDate(new Date(Number.NaN))).toThrow(TypeError);
  });
});

describe("trusted proxy source IP resolution", () => {
  it("ignores spoofed forwarding outside the explicit topology", () => {
    expect(resolveSourceIp({ remoteAddress: "203.0.113.10", forwardedForHeader: "198.51.100.20" })).toBe("203.0.113.10");
    expect(resolveSourceIp({
      remoteAddress: "203.0.113.10",
      forwardedForHeader: "198.51.100.20",
      topology: { trustedProxyAddresses: ["203.0.113.99"], forwardedHops: 1 },
    })).toBe("203.0.113.10");
  });

  it("uses only the configured trusted hop and rejects malformed chains", () => {
    expect(resolveSourceIp({
      remoteAddress: "203.0.113.10",
      forwardedForHeader: "198.51.100.20",
      topology: { trustedProxyAddresses: ["203.0.113.10"], forwardedHops: 1 },
    })).toBe("198.51.100.20");
    expect(() => resolveSourceIp({
      remoteAddress: "203.0.113.10",
      forwardedForHeader: "not-an-ip",
      topology: { trustedProxyAddresses: ["203.0.113.10"], forwardedHops: 1 },
    })).toThrow(TypeError);
  });
});
