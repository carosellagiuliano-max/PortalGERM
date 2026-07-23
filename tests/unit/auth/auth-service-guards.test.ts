// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const password = vi.hoisted(() => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));
const rateLimit = vi.hoisted(() => ({
  consumeAuthRateLimit: vi.fn(),
  recordRateLimitDenial: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/password", () => ({
  PASSWORD_HASH_POLICY_V1: Object.freeze({
    algorithm: "bcrypt",
    algorithmVersion: "bcrypt-v1-cost12",
  }),
  hashPassword: password.hashPassword,
  verifyPassword: password.verifyPassword,
}));
vi.mock("@/lib/auth/rate-limit-runtime", () => ({
  consumeAuthRateLimit: rateLimit.consumeAuthRateLimit,
  hashAuthIdentifier: vi.fn(),
}));
vi.mock("@/lib/security/rate-limit-audit", () => ({
  recordRateLimitDenial: rateLimit.recordRateLimitDenial,
}));

import {
  loginWithPassword,
  registerCandidate,
  registerEmployer,
  resetPassword,
} from "@/lib/auth/auth-service";

const request = Object.freeze({
  correlationId: "06000000-0000-4000-8000-000000000099",
  expectedOrigin: "https://phase06.test",
  origin: "https://phase06.test",
  production: true,
  sourceIp: "192.0.2.99",
  userAgent: "phase06-unit",
});

describe("Phase 06 auth service guards", () => {
  beforeEach(() => {
    password.hashPassword.mockReset();
    password.verifyPassword.mockReset();
    rateLimit.consumeAuthRateLimit.mockReset();
    rateLimit.recordRateLimitDenial.mockReset().mockResolvedValue({
      written: true,
      gated: false,
    });
  });

  it("uses the request correlation as a stable anonymous rate-limit target", async () => {
    rateLimit.consumeAuthRateLimit.mockResolvedValue({
      allowed: false,
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 60,
      audit: {
        action: "RATE_LIMITED",
        preset: "LOGIN",
        scope: "IP_IDENTIFIER",
      },
    });
    const dependencies = {
      database: {} as never,
      environment: { marker: "environment" } as never,
      request,
      now: new Date("2026-07-23T10:00:00.000Z"),
    };

    await expect(
      loginWithPassword(
        { email: "candidate@example.test", password: "irrelevant" },
        dependencies,
      ),
    ).resolves.toEqual({
      ok: false,
      code: "RATE_LIMITED",
      retryAfterSeconds: 60,
    });
    expect(rateLimit.recordRateLimitDenial).toHaveBeenCalledWith(
      { preset: "LOGIN", scope: "IP_IDENTIFIER" },
      {
        actorKind: "ANONYMOUS",
        capability: "AUTH_RATE_LIMIT",
        targetId: request.correlationId,
        targetType: "SYSTEM_TASK",
      },
      {
        database: dependencies.database,
        environment: dependencies.environment,
        request,
        now: dependencies.now,
      },
    );
  });

  it("rejects an unknown reset token before starting bcrypt work", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const result = await resetPassword(
      {
        token: "a".repeat(43),
        password: "StrongPassword1!",
        passwordConfirmation: "StrongPassword1!",
      },
      {
        database: { passwordResetToken: { findUnique } } as never,
        environment: {} as never,
        request,
      },
    );

    expect(result).toEqual({ ok: false, code: "INVALID_RESET_TOKEN" });
    expect(findUnique).toHaveBeenCalledOnce();
    expect(password.hashPassword).not.toHaveBeenCalled();
  });

  it("rejects forged direct-use-case registration calls before hashing or persistence", async () => {
    const dependencies = {
      database: {} as never,
      environment: {} as never,
      request,
    };
    const candidate = await registerCandidate(
      {
        email: "forged-candidate@example.test",
        name: "Forged Candidate",
        password: "StrongPassword1!",
        passwordConfirmation: "StrongPassword1!",
        acceptedTerms: false,
        marketingConsent: false,
      } as never,
      dependencies,
    );
    const employer = await registerEmployer(
      {
        email: "owner@forged-company.test",
        name: "Forged Employer",
        companyName: "Forged Company AG",
        cantonCode: "ZH",
        companySize: "1-9",
        password: "StrongPassword1!",
        passwordConfirmation: "StrongPassword1!",
        acceptedTerms: false,
        marketingConsent: false,
      } as never,
      dependencies,
    );

    expect(candidate).toEqual({ ok: false, code: "REGISTRATION_FAILED" });
    expect(employer).toEqual({ ok: false, code: "REGISTRATION_FAILED" });
    expect(password.hashPassword).not.toHaveBeenCalled();
  });

  it("rejects an invalid claimed company id before rate limiting or hashing", async () => {
    const result = await registerEmployer(
      {
        email: "owner@example.test",
        name: "Example Owner",
        companyName: "Example AG",
        cantonCode: "ZH",
        companySize: "1-9",
        password: "StrongPassword1!",
        passwordConfirmation: "StrongPassword1!",
        acceptedTerms: true,
        marketingConsent: false,
      } as never,
      {
        database: {} as never,
        environment: {} as never,
        request,
        claimedCompanyId: "not-a-company-id",
      },
    );

    expect(result).toEqual({ ok: false, code: "REGISTRATION_FAILED" });
    expect(password.hashPassword).not.toHaveBeenCalled();
  });
});
