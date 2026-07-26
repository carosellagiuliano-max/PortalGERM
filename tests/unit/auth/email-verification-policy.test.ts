import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  EMAIL_VERIFICATION_POLICY_V1,
  isIdentityActionAllowed,
  isVerificationChallengeCurrent,
  publicVerificationMessage,
} from "@/lib/auth/email-verification-policy";
import {
  createVerificationToken,
  hashVerificationTarget,
  hashVerificationToken,
  parseVerificationToken,
  verifyDerivedVerificationToken,
} from "@/lib/auth/verification-token";
import { parseEnvironment } from "@/lib/config/env-schema";
import { createValidEnvironment } from "@/tests/fixtures/environment";

const CHALLENGE_ID = "20000000-0000-4000-8000-000000000001";

describe("Phase 20 e-mail verification policy", () => {
  const environment = parseEnvironment(createValidEnvironment());

  it("derives a bounded token without storing the bearer and binds purpose/epoch", () => {
    const token = createVerificationToken(
      CHALLENGE_ID,
      "REGISTRATION",
      1,
      environment.secrets.session,
    );
    expect(token).toMatch(/^v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/u);
    expect(parseVerificationToken(token)).toEqual({
      challengeId: CHALLENGE_ID,
      signature: token.split(".")[2],
      tokenHash: hashVerificationToken(token),
    });
    expect(hashVerificationToken(token)).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      verifyDerivedVerificationToken(token, {
        challengeId: CHALLENGE_ID,
        purpose: "REGISTRATION",
        addressEpoch: 1,
        secret: environment.secrets.session,
      }),
    ).toBe(true);
    expect(
      verifyDerivedVerificationToken(token, {
        challengeId: CHALLENGE_ID,
        purpose: "INVITATION",
        addressEpoch: 1,
        secret: environment.secrets.session,
      }),
    ).toBe(false);
    expect(
      verifyDerivedVerificationToken(token, {
        challengeId: CHALLENGE_ID,
        purpose: "REGISTRATION",
        addressEpoch: 2,
        secret: environment.secrets.session,
      }),
    ).toBe(false);
    expect(parseVerificationToken(`${token}x`)).toBeNull();
  });

  it("accepts only current, unused, unsuperseded, unexpired epochs", () => {
    const now = new Date("2026-07-26T12:00:00.000Z");
    const current = {
      addressEpoch: 1,
      currentAddressEpoch: 1,
      expiresAt: new Date(
        now.getTime() + EMAIL_VERIFICATION_POLICY_V1.ttlMilliseconds,
      ),
      usedAt: null,
      supersededAt: null,
      now,
    };
    expect(isVerificationChallengeCurrent(current)).toBe(true);
    expect(
      isVerificationChallengeCurrent({
        ...current,
        expiresAt: now,
      }),
    ).toBe(false);
    expect(
      isVerificationChallengeCurrent({ ...current, usedAt: now }),
    ).toBe(false);
    expect(
      isVerificationChallengeCurrent({ ...current, supersededAt: now }),
    ).toBe(false);
    expect(
      isVerificationChallengeCurrent({
        ...current,
        currentAddressEpoch: 2,
      }),
    ).toBe(false);
  });

  it("keeps low assurance limited to verification, logout and explicit help", () => {
    for (const action of [
      "LOGOUT",
      "VERIFY_EMAIL",
      "RESEND_VERIFICATION",
      "SECURITY_HELP",
      "ONBOARDING_DRAFT",
    ] as const) {
      expect(
        isIdentityActionAllowed({
          action,
          assurance: "LOW_ASSURANCE",
          emailVerifiedAt: null,
        }),
      ).toBe(true);
    }
    for (const action of [
      "APPLICATION_SUBMIT",
      "COMPANY_PUBLISH",
      "BILLING_WRITE",
      "RADAR_WRITE",
      "PRIVACY_EXECUTE",
      "TEAM_ROLE_WRITE",
      "LOGIN_EMAIL_CHANGE",
    ] as const) {
      expect(
        isIdentityActionAllowed({
          action,
          assurance: "LOW_ASSURANCE",
          emailVerifiedAt: null,
        }),
      ).toBe(false);
    }
    expect(
      isIdentityActionAllowed({
        action: "APPLICATION_SUBMIT",
        assurance: "VERIFIED_EMAIL",
        emailVerifiedAt: new Date(),
      }),
    ).toBe(true);
    expect(
      isIdentityActionAllowed({
        action: "APPLICATION_SUBMIT",
        assurance: "VERIFIED_EMAIL",
        emailVerifiedAt: null,
      }),
    ).toBe(false);
  });

  it("hashes targets and exposes generic public copy without addresses", () => {
    const first = hashVerificationTarget(
      "candidate@example.test",
      environment.secrets.session,
    );
    const second = hashVerificationTarget(
      "other@example.test",
      environment.secrets.session,
    );
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(first).not.toBe(second);
    expect(first).not.toContain("candidate");
    expect(publicVerificationMessage("requested")).toContain("Falls");
    expect(publicVerificationMessage("invalid")).not.toContain("@");
  });
});
