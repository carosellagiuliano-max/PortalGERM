// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  REGISTRATION_CONSENT_NOTICES_V1,
  createRegistrationMarketingConsent,
  createRegistrationTermsConsent,
} from "@/lib/auth/registration-consent";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-07-20T12:00:00.000Z");

describe("server-owned registration consent", () => {
  it("pins canonical Terms and Marketing notice hashes", () => {
    expect(REGISTRATION_CONSENT_NOTICES_V1.TERMS).toMatchObject({
      kind: "TERMS",
      purpose: "Terms acceptance",
      noticeVersion: "terms-v1",
      noticeHash:
        "49cad2f30273aace47f2732df3dd25e9789768a295b0f640176ce696409e8081",
    });
    expect(REGISTRATION_CONSENT_NOTICES_V1.MARKETING).toMatchObject({
      kind: "MARKETING",
      purpose: "Marketing communication",
      noticeVersion: "marketing-v1",
      noticeHash:
        "8bf93b00620a33b8e4e3aa94ae92b40465202b3c31295302ff457c26addf4dd9",
    });
  });

  it("builds mandatory Terms and separate optional Marketing events", () => {
    expect(createRegistrationTermsConsent({ userId: USER_ID, effectiveAt: NOW })).toEqual({
      userId: USER_ID,
      actorUserId: USER_ID,
      kind: "TERMS",
      granted: true,
      purpose: "Terms acceptance",
      noticeVersion: "terms-v1",
      noticeHash:
        "49cad2f30273aace47f2732df3dd25e9789768a295b0f640176ce696409e8081",
      effectiveAt: NOW,
    });
    expect(
      createRegistrationMarketingConsent({
        userId: USER_ID,
        effectiveAt: NOW,
        granted: false,
      }),
    ).toMatchObject({ kind: "MARKETING", granted: false });
  });
});
