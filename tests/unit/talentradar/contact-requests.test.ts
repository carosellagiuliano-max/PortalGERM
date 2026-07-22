import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  contactLifecycleEventKey,
  isContactRequestEffectiveAt,
} from "@/lib/talentradar/contact-requests";

describe("contact request half-open validity", () => {
  const createdAt = new Date("2026-07-22T12:00:00.000Z");
  const expiresAt = new Date("2026-08-05T12:00:00.000Z");
  const pending = { status: "PENDING", createdAt, expiresAt };

  it("is effective at creation and strictly before expiry", () => {
    expect(isContactRequestEffectiveAt(pending, createdAt)).toBe(true);
    expect(
      isContactRequestEffectiveAt(
        pending,
        new Date(expiresAt.getTime() - 1),
      ),
    ).toBe(true);
  });

  it("is ineffective at the exact expiry boundary and after a terminal state", () => {
    expect(isContactRequestEffectiveAt(pending, expiresAt)).toBe(false);
    expect(
      isContactRequestEffectiveAt(
        { ...pending, status: "ACCEPTED" },
        createdAt,
      ),
    ).toBe(false);
  });

  it("fails closed for invalid or pre-creation clocks", () => {
    expect(
      isContactRequestEffectiveAt(
        pending,
        new Date(createdAt.getTime() - 1),
      ),
    ).toBe(false);
    expect(
      isContactRequestEffectiveAt(pending, new Date(Number.NaN)),
    ).toBe(false);
  });
});

describe("contact lifecycle idempotency identity", () => {
  const actor = "00000000-0000-4000-8000-000000000001";

  it("is deterministic, action-scoped and plaintext-free", () => {
    const key = contactLifecycleEventKey(
      "accepted",
      actor,
      "private-attempt-0001",
    );
    expect(key).toBe(
      contactLifecycleEventKey("accepted", actor, "private-attempt-0001"),
    );
    expect(key).not.toContain("private-attempt-0001");
    expect(key).toMatch(/^contact-event:accepted:[a-f0-9]{64}$/u);
    expect(
      contactLifecycleEventKey("declined", actor, "private-attempt-0001"),
    ).not.toBe(key);
    expect(
      contactLifecycleEventKey(
        "accepted",
        "00000000-0000-4000-8000-000000000002",
        "private-attempt-0001",
      ),
    ).not.toBe(key);
  });
});
