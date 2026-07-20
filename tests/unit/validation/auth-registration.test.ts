import { describe, expect, it } from "vitest";

import {
  candidateRegistrationSchema,
  employerRegistrationSchema,
  registerSchema,
  resetPasswordSchema,
} from "@/lib/validation/auth";

const PASSWORD = "StrongPass1!";

describe("Phase 06 registration validation", () => {
  const candidate = {
    name: "Ada Beispiel",
    email: " ADA@EXAMPLE.CH ",
    password: PASSWORD,
    passwordConfirmation: PASSWORD,
    acceptedTerms: true,
  } as const;

  it("requires literal current-Terms acceptance and owns notice data server-side", () => {
    expect(candidateRegistrationSchema.parse(candidate)).toMatchObject({
      email: "ada@example.ch",
      acceptedTerms: true,
      marketingConsent: false,
    });
    expect(
      candidateRegistrationSchema.safeParse({
        ...candidate,
        acceptedTerms: false,
      }).success,
    ).toBe(false);
    expect(
      candidateRegistrationSchema.safeParse({
        ...candidate,
        acceptedTermsNoticeVersion: "forged-v99",
      }).success,
    ).toBe(false);
  });

  it("validates employer-only fields and canonicalizes the optional UID", () => {
    const employer = employerRegistrationSchema.parse({
      ...candidate,
      companyName: "Beispiel AG",
      uid: "che 116 075 613",
      cantonCode: "ZH",
      companySize: "11-50",
      marketingConsent: true,
    });
    expect(employer).toMatchObject({
      uid: "CHE-116.075.613",
      cantonCode: "ZH",
      marketingConsent: true,
    });
    expect(
      employerRegistrationSchema.safeParse({
        ...employer,
        cantonCode: "zh",
      }).success,
    ).toBe(false);
    expect(
      employerRegistrationSchema.safeParse({
        ...employer,
        email: "person@gmail.com",
      }).success,
    ).toBe(false);
  });

  it("keeps the generic registration union role-closed", () => {
    expect(
      registerSchema.safeParse({ ...candidate, role: "CANDIDATE" }).success,
    ).toBe(true);
    expect(
      registerSchema.safeParse({ ...candidate, role: "ADMIN" }).success,
    ).toBe(false);
  });

  it("confirm-validates a bounded opaque password-reset token", () => {
    expect(
      resetPasswordSchema.safeParse({
        token: "a".repeat(43),
        password: PASSWORD,
        passwordConfirmation: PASSWORD,
      }).success,
    ).toBe(true);
    expect(
      resetPasswordSchema.safeParse({
        token: "https://evil.example/?token=secret",
        password: PASSWORD,
        passwordConfirmation: "OtherPass1!",
      }).success,
    ).toBe(false);
  });

  it("rejects passwords beyond bcrypt's 72 UTF-8-byte boundary", () => {
    const tooManyAsciiBytes = `${"A".repeat(68)}a1!x`;
    const tooManyUnicodeBytes = `${"Ä".repeat(35)}aA1!`;

    expect(tooManyAsciiBytes.length).toBe(72);
    expect(new TextEncoder().encode(tooManyAsciiBytes).byteLength).toBe(72);
    expect(
      candidateRegistrationSchema.safeParse({
        ...candidate,
        password: tooManyAsciiBytes,
        passwordConfirmation: tooManyAsciiBytes,
      }).success,
    ).toBe(true);
    expect(new TextEncoder().encode(tooManyUnicodeBytes).byteLength).toBeGreaterThan(72);
    expect(
      candidateRegistrationSchema.safeParse({
        ...candidate,
        password: tooManyUnicodeBytes,
        passwordConfirmation: tooManyUnicodeBytes,
      }).success,
    ).toBe(false);
  });
});
