// @vitest-environment node

import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  SIGNED_JOB_INTENT_POLICY_V1,
  buildJobIntentNextPath,
  signJobIntent,
  verifyJobIntent,
  type SignedJobIntentKey,
} from "@/lib/auth/signed-intent";
import { parseSafeNext } from "@/lib/auth/safe-next";

const NOW = new Date("2026-07-20T12:00:00.000Z");
const SLUG = "pflegefachperson-zuerich";
const ANALYTICS_SESSION_ID = "12345678-1234-4234-8234-123456789abc";
const KEY_BYTES = Buffer.alloc(32, 31);
const KEY = signingKey(KEY_BYTES);

describe("signed SAVE/APPLY job intent", () => {
  it.each(["SAVE", "APPLY"] as const)("round-trips the %s action", (action) => {
    const token = signJobIntent({ action, jobSlug: SLUG, now: NOW }, KEY);
    expect(
      verifyJobIntent(token, { action, jobSlug: SLUG, now: NOW }, KEY),
    ).toEqual({
      version: 1,
      action,
      jobSlug: SLUG,
      issuedAt: NOW.getTime(),
      expiresAt: NOW.getTime() + 30 * 60 * 1_000,
    });
    expect(buildJobIntentNextPath(SLUG, token)).toBe(`/jobs/${SLUG}?intent=${token}`);
  });

  it("round-trips an optional analytics session without adding authority", () => {
    const token = signJobIntent(
      {
        action: "APPLY",
        jobSlug: SLUG,
        analyticsSessionId: ANALYTICS_SESSION_ID,
        now: NOW,
      },
      KEY,
    );

    expect(
      verifyJobIntent(token, { action: "APPLY", jobSlug: SLUG, now: NOW }, KEY),
    ).toEqual({
      version: 1,
      action: "APPLY",
      jobSlug: SLUG,
      analyticsSessionId: ANALYTICS_SESSION_ID,
      issuedAt: NOW.getTime(),
      expiresAt: NOW.getTime() + SIGNED_JOB_INTENT_POLICY_V1.ttlMilliseconds,
    });
  });

  it("rejects an invalid analytics session id when signing or verifying", () => {
    expect(() =>
      signJobIntent(
        {
          action: "APPLY",
          jobSlug: SLUG,
          analyticsSessionId: "not-a-uuid",
          now: NOW,
        },
        KEY,
      ),
    ).toThrow();

    const invalidPayload = Buffer.from(
      JSON.stringify({
        version: 1,
        action: "APPLY",
        jobSlug: SLUG,
        analyticsSessionId: "not-a-uuid",
        issuedAt: NOW.getTime(),
        expiresAt:
          NOW.getTime() + SIGNED_JOB_INTENT_POLICY_V1.ttlMilliseconds,
      }),
      "utf8",
    ).toString("base64url");
    const signature = createHmac("sha256", KEY_BYTES)
      .update(
        `${SIGNED_JOB_INTENT_POLICY_V1.context}\0${invalidPayload}`,
        "utf8",
      )
      .digest("base64url");

    expect(
      verifyJobIntent(`${invalidPayload}.${signature}`, { now: NOW }, KEY),
    ).toBeNull();
  });

  it("contains navigation intent only and grants no identity or authority", () => {
    const token = signJobIntent({ action: "APPLY", jobSlug: SLUG, now: NOW }, KEY);
    const [encodedPayload] = token.split(".");
    const raw = JSON.parse(
      Buffer.from(encodedPayload!, "base64url").toString("utf8"),
    ) as Record<string, unknown>;

    expect(Object.keys(raw).sort()).toEqual([
      "action",
      "expiresAt",
      "issuedAt",
      "jobSlug",
      "version",
    ]);
    expect(JSON.stringify(raw)).not.toMatch(
      /user|candidate|companyId|jobId|role|permission|document|authoriz/iu,
    );
  });

  it("binds action and slug and rejects tampering", () => {
    const token = signJobIntent({ action: "APPLY", jobSlug: SLUG, now: NOW }, KEY);
    expect(verifyJobIntent(token, { action: "SAVE", jobSlug: SLUG, now: NOW }, KEY)).toBeNull();
    expect(verifyJobIntent(token, { action: "APPLY", jobSlug: "anderer-job", now: NOW }, KEY)).toBeNull();

    const [payload, signature] = token.split(".") as [string, string];
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    decoded.action = "SAVE";
    const changed = Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url");
    expect(verifyJobIntent(`${changed}.${signature}`, { now: NOW }, KEY)).toBeNull();
  });

  it("rejects another protocol context, expiry and excessive future skew", () => {
    const token = signJobIntent({ action: "APPLY", jobSlug: SLUG, now: NOW }, KEY);
    const [payload] = token.split(".") as [string];
    const wrongContext = createHmac("sha256", KEY_BYTES)
      .update(`other-protocol\0${payload}`, "utf8")
      .digest("base64url");
    expect(verifyJobIntent(`${payload}.${wrongContext}`, { now: NOW }, KEY)).toBeNull();
    expect(
      verifyJobIntent(
        token,
        { now: new Date(NOW.getTime() + SIGNED_JOB_INTENT_POLICY_V1.ttlMilliseconds) },
        KEY,
      ),
    ).toBeNull();

    const future = signJobIntent(
      {
        action: "SAVE",
        jobSlug: SLUG,
        now: new Date(NOW.getTime() + SIGNED_JOB_INTENT_POLICY_V1.clockSkewMilliseconds + 1),
      },
      KEY,
    );
    expect(verifyJobIntent(future, { now: NOW }, KEY)).toBeNull();
  });

  it("fails closed for malformed/oversized tokens and weak keys", () => {
    expect(verifyJobIntent("not.a.token", { now: NOW }, KEY)).toBeNull();
    expect(
      verifyJobIntent(
        "a".repeat(SIGNED_JOB_INTENT_POLICY_V1.maximumTokenLength + 1),
        { now: NOW },
        KEY,
      ),
    ).toBeNull();
    expect(() =>
      signJobIntent(
        { action: "SAVE", jobSlug: SLUG, now: NOW },
        signingKey(Buffer.alloc(8, 1)),
      ),
    ).toThrow(TypeError);
    expect(() =>
      signJobIntent({ action: "SAVE", jobSlug: "../private", now: NOW }, KEY),
    ).toThrow();
  });

  it("preserves only a safe Login/Register next and re-verifies tamper/expiry after auth", () => {
    const token = signJobIntent({ action: "APPLY", jobSlug: SLUG, now: NOW }, KEY);
    const next = buildJobIntentNextPath(SLUG, token);
    expect(parseSafeNext(next, "CANDIDATE")).toBe(next);
    expect(parseSafeNext(next, "EMPLOYER")).toBeNull();
    expect(parseSafeNext("https://evil.example/jobs?intent=a.b", "CANDIDATE")).toBeNull();

    const [payload, signature] = token.split(".") as [string, string];
    const tamperedPayload = `${payload.slice(0, -1)}${payload.endsWith("a") ? "b" : "a"}`;
    const tamperedNext = buildJobIntentNextPath(SLUG, `${tamperedPayload}.${signature}`);
    expect(parseSafeNext(tamperedNext, "CANDIDATE")).toBe(tamperedNext);
    expect(
      verifyJobIntent(`${tamperedPayload}.${signature}`, { action: "APPLY", jobSlug: SLUG, now: NOW }, KEY),
    ).toBeNull();
    expect(
      verifyJobIntent(
        token,
        {
          action: "APPLY",
          jobSlug: SLUG,
          now: new Date(NOW.getTime() + SIGNED_JOB_INTENT_POLICY_V1.ttlMilliseconds),
        },
        KEY,
      ),
    ).toBeNull();
  });
});

function signingKey(bytes: Buffer): SignedJobIntentKey {
  return Object.freeze({
    withValue<TResult>(consumer: (value: string) => TResult): TResult {
      return consumer(bytes.toString("base64"));
    },
  });
}
