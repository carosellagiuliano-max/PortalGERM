// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  candidateMessageInputSchema,
  deriveCandidateMessageSendAvailability,
} from "@/lib/candidate/messages";

describe("candidate message send availability", () => {
  it("rejects raw null, C1 and bidirectional controls", () => {
    const base = {
      conversationId: "61000000-0000-4000-8000-000000000001",
      body: "Sichere Nachricht",
      idempotencyKey: "message-control-test",
    };

    for (const control of ["\u0000", "\u0085", "\u202e"]) {
      expect(
        candidateMessageInputSchema.safeParse({
          ...base,
          body: `${base.body}${control}`,
        }).success,
      ).toBe(false);
    }
  });

  it("allows a Radar thread only for one current VERIFIED cycle on an ACTIVE company", () => {
    expect(deriveCandidateMessageSendAvailability({
      kind: "TALENT_RADAR",
      companyStatus: "ACTIVE",
      currentVerifiedCycles: 1,
    })).toEqual({ allowed: true, reason: null });

    expect(deriveCandidateMessageSendAvailability({
      kind: "TALENT_RADAR",
      companyStatus: "SUSPENDED",
      currentVerifiedCycles: 1,
    })).toEqual({
      allowed: false,
      reason: "RADAR_COMPANY_INACTIVE",
    });

    expect(deriveCandidateMessageSendAvailability({
      kind: "TALENT_RADAR",
      companyStatus: "ACTIVE",
      currentVerifiedCycles: 0,
    })).toEqual({
      allowed: false,
      reason: "RADAR_COMPANY_UNVERIFIED",
    });
    expect(deriveCandidateMessageSendAvailability({
      kind: "TALENT_RADAR",
      companyStatus: "ACTIVE",
      currentVerifiedCycles: 2,
    })).toEqual({
      allowed: false,
      reason: "RADAR_COMPANY_UNVERIFIED",
    });
  });

  it("does not apply the Radar trust policy to application threads", () => {
    expect(deriveCandidateMessageSendAvailability({
      kind: "APPLICATION",
      companyStatus: "CLOSED",
      currentVerifiedCycles: 0,
    })).toEqual({ allowed: true, reason: null });
  });
});
