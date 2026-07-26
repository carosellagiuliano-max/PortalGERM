import { describe, expect, it } from "vitest";

import { canCommitLoginEmailChange } from "@/lib/auth/email-change-policy";

describe("Phase 20 login e-mail change policy", () => {
  const now = new Date("2026-07-26T12:00:00.000Z");
  const valid = {
    pendingStatus: "PENDING" as const,
    challengeEpoch: 2,
    currentEpoch: 1,
    initiatedBySessionId: "session-a",
    currentSessionId: "session-a",
    expiresAt: new Date("2026-07-26T12:30:00.000Z"),
    now,
  };

  it("requires the next address epoch, the initiating session and live pending state", () => {
    expect(canCommitLoginEmailChange(valid)).toBe(true);
    expect(
      canCommitLoginEmailChange({ ...valid, currentSessionId: "session-b" }),
    ).toBe(false);
    expect(
      canCommitLoginEmailChange({ ...valid, challengeEpoch: 3 }),
    ).toBe(false);
    expect(
      canCommitLoginEmailChange({ ...valid, pendingStatus: "COMPLETED" }),
    ).toBe(false);
    expect(canCommitLoginEmailChange({ ...valid, expiresAt: now })).toBe(
      false,
    );
  });
});
