// @vitest-environment node

import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  COMPANY_CLAIM_INTENT_POLICY_V1,
  signCompanyClaimIntent,
  verifyCompanyClaimIntent,
  type CompanyClaimIntentSigningKey,
} from "@/lib/auth/company-claim-intent";

const NOW = new Date("2026-07-20T12:00:00.000Z");
const SLUG = "muster-werkstatt";
const KEY_BYTES = Buffer.alloc(32, 17);
const KEY = signingKey(KEY_BYTES);

describe("signed public Company claim intent", () => {
  it("round-trips a short-lived, slug-bound navigation intent", () => {
    const token = signCompanyClaimIntent({ companySlug: SLUG, now: NOW }, KEY);
    const payload = verifyCompanyClaimIntent(
      token,
      { companySlug: SLUG, now: NOW },
      KEY,
    );

    expect(payload).toEqual({
      version: 1,
      companySlug: SLUG,
      issuedAt: NOW.getTime(),
      expiresAt: NOW.getTime() + 15 * 60 * 1_000,
    });
    expect(
      payload!.expiresAt - payload!.issuedAt,
    ).toBe(COMPANY_CLAIM_INTENT_POLICY_V1.ttlMilliseconds);
    expect(COMPANY_CLAIM_INTENT_POLICY_V1.ttlMilliseconds).toBeLessThanOrEqual(
      15 * 60 * 1_000,
    );
  });

  it("contains no private Company id, user, membership, domain or authority", () => {
    const token = signCompanyClaimIntent({ companySlug: SLUG, now: NOW }, KEY);
    const [encodedPayload] = token.split(".");
    const raw = JSON.parse(
      Buffer.from(encodedPayload!, "base64url").toString("utf8"),
    ) as Record<string, unknown>;

    expect(Object.keys(raw).sort()).toEqual([
      "companySlug",
      "expiresAt",
      "issuedAt",
      "version",
    ]);
    expect(JSON.stringify(raw)).not.toMatch(
      /companyId|userId|member|owner|role|domain|evidence|authoriz/iu,
    );
  });

  it("binds the token to the expected public slug", () => {
    const token = signCompanyClaimIntent({ companySlug: SLUG, now: NOW }, KEY);
    expect(
      verifyCompanyClaimIntent(
        token,
        { companySlug: "andere-firma", now: NOW },
        KEY,
      ),
    ).toBeNull();
  });

  it("rejects payload and signature tampering", () => {
    const token = signCompanyClaimIntent({ companySlug: SLUG, now: NOW }, KEY);
    const [payload, signature] = token.split(".") as [string, string];
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    decoded.companySlug = "andere-firma";
    const tamperedPayload = Buffer.from(JSON.stringify(decoded), "utf8").toString(
      "base64url",
    );

    expect(
      verifyCompanyClaimIntent(
        `${tamperedPayload}.${signature}`,
        { companySlug: "andere-firma", now: NOW },
        KEY,
      ),
    ).toBeNull();
    expect(
      verifyCompanyClaimIntent(
        `${payload}.${signature.slice(0, -2)}aa`,
        { companySlug: SLUG, now: NOW },
        KEY,
      ),
    ).toBeNull();
  });

  it("rejects a valid HMAC from a different protocol context", () => {
    const token = signCompanyClaimIntent({ companySlug: SLUG, now: NOW }, KEY);
    const [payload] = token.split(".") as [string];
    const wrongContextSignature = createHmac("sha256", KEY_BYTES)
      .update(`company-context-v1\0${payload}`, "utf8")
      .digest("base64url");

    expect(
      verifyCompanyClaimIntent(
        `${payload}.${wrongContextSignature}`,
        { companySlug: SLUG, now: NOW },
        KEY,
      ),
    ).toBeNull();
  });

  it("uses a half-open expiry and a tightly bounded future skew", () => {
    const token = signCompanyClaimIntent({ companySlug: SLUG, now: NOW }, KEY);
    expect(
      verifyCompanyClaimIntent(
        token,
        {
          companySlug: SLUG,
          now: new Date(
            NOW.getTime() +
              COMPANY_CLAIM_INTENT_POLICY_V1.ttlMilliseconds -
              1,
          ),
        },
        KEY,
      ),
    ).not.toBeNull();
    expect(
      verifyCompanyClaimIntent(
        token,
        {
          companySlug: SLUG,
          now: new Date(
            NOW.getTime() + COMPANY_CLAIM_INTENT_POLICY_V1.ttlMilliseconds,
          ),
        },
        KEY,
      ),
    ).toBeNull();

    const futureToken = signCompanyClaimIntent(
      {
        companySlug: SLUG,
        now: new Date(
          NOW.getTime() +
            COMPANY_CLAIM_INTENT_POLICY_V1.clockSkewMilliseconds +
            1,
        ),
      },
      KEY,
    );
    expect(
      verifyCompanyClaimIntent(
        futureToken,
        { companySlug: SLUG, now: NOW },
        KEY,
      ),
    ).toBeNull();
  });

  it("fails closed for malformed, oversized and invalid-clock tokens", () => {
    expect(
      verifyCompanyClaimIntent("not.a.valid.token", { companySlug: SLUG, now: NOW }, KEY),
    ).toBeNull();
    expect(
      verifyCompanyClaimIntent(
        "a".repeat(COMPANY_CLAIM_INTENT_POLICY_V1.maximumTokenLength + 1),
        { companySlug: SLUG, now: NOW },
        KEY,
      ),
    ).toBeNull();
    const token = signCompanyClaimIntent({ companySlug: SLUG, now: NOW }, KEY);
    expect(
      verifyCompanyClaimIntent(
        token,
        { companySlug: SLUG, now: new Date(Number.NaN) },
        KEY,
      ),
    ).toBeNull();
  });

  it("rejects invalid slugs, clocks and weak signing keys at issuance", () => {
    expect(() =>
      signCompanyClaimIntent({ companySlug: "../private-id", now: NOW }, KEY),
    ).toThrow();
    expect(() =>
      signCompanyClaimIntent(
        { companySlug: SLUG, now: new Date(Number.NaN) },
        KEY,
      ),
    ).toThrow(TypeError);
    expect(() =>
      signCompanyClaimIntent(
        { companySlug: SLUG, now: NOW },
        signingKey(Buffer.alloc(16, 1)),
      ),
    ).toThrow(TypeError);
  });
});

function signingKey(bytes: Buffer): CompanyClaimIntentSigningKey {
  return Object.freeze({
    withValue<TResult>(consumer: (value: string) => TResult): TResult {
      return consumer(bytes.toString("base64"));
    },
  });
}
