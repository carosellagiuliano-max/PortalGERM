// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const password = vi.hoisted(() => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
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

import {
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
});
