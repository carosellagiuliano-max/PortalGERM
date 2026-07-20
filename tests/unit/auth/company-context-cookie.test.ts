// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  COMPANY_CONTEXT_COOKIE_POLICY_V1,
  createCompanyContextCookie,
  signCompanyContextCookie,
  verifyCompanyContextCookie,
  type CompanyContextSigningKey,
} from "@/lib/auth/company-context-cookie";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const COMPANY_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-07-20T12:00:00.000Z");

const KEY: CompanyContextSigningKey = Object.freeze({
  withValue<TResult>(consumer: (value: string) => TResult): TResult {
    return consumer(Buffer.alloc(32, 7).toString("base64"));
  },
});

describe("signed user-bound company context cookie", () => {
  it("round-trips only for the bound user and bounded lifetime", () => {
    const value = signCompanyContextCookie(
      { userId: USER_ID, companyId: COMPANY_ID, now: NOW },
      KEY,
    );
    expect(
      verifyCompanyContextCookie(value, { userId: USER_ID, now: NOW }, KEY),
    ).toEqual({
      version: 1,
      userId: USER_ID,
      companyId: COMPANY_ID,
      issuedAt: NOW.getTime(),
      expiresAt:
        NOW.getTime() + COMPANY_CONTEXT_COOKIE_POLICY_V1.ttlMilliseconds,
    });
    expect(
      verifyCompanyContextCookie(
        value,
        { userId: OTHER_USER_ID, now: NOW },
        KEY,
      ),
    ).toBeNull();
    expect(
      verifyCompanyContextCookie(
        value,
        {
          userId: USER_ID,
          now: new Date(
            NOW.getTime() + COMPANY_CONTEXT_COOKIE_POLICY_V1.ttlMilliseconds,
          ),
        },
        KEY,
      ),
    ).toBeNull();
    expect(
      verifyCompanyContextCookie(
        value,
        { userId: USER_ID, now: new Date(Number.NaN) },
        KEY,
      ),
    ).toBeNull();
  });

  it("fails closed for payload or signature tampering", () => {
    const value = signCompanyContextCookie(
      { userId: USER_ID, companyId: COMPANY_ID, now: NOW },
      KEY,
    );
    const [payload, signature] = value.split(".") as [string, string];
    const tamperedPayload = `${payload[0] === "a" ? "b" : "a"}${payload.slice(1)}`;
    expect(
      verifyCompanyContextCookie(
        `${tamperedPayload}.${signature}`,
        { userId: USER_ID, now: NOW },
        KEY,
      ),
    ).toBeNull();
    expect(
      verifyCompanyContextCookie(
        `${payload}.${signature.slice(0, -2)}aa`,
        { userId: USER_ID, now: NOW },
        KEY,
      ),
    ).toBeNull();
  });

  it("returns httpOnly Lax options and production-only Secure", () => {
    const local = createCompanyContextCookie(
      {
        userId: USER_ID,
        companyId: COMPANY_ID,
        now: NOW,
        production: false,
      },
      KEY,
    );
    const production = createCompanyContextCookie(
      {
        userId: USER_ID,
        companyId: COMPANY_ID,
        now: NOW,
        production: true,
      },
      KEY,
    );
    expect(local).toMatchObject({
      name: "company_context",
      options: {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        path: "/",
      },
    });
    expect(production.options.secure).toBe(true);
  });
});
