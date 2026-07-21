import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { hashInvitationToken, teamInvitationSchema } from "@/lib/employer/team";

describe("Phase 10 team invitation contracts", () => {
  it("normalizes invitee email and accepts only closed company roles", () => {
    expect(teamInvitationSchema.parse({ email: " Team@Example.CH ", role: "RECRUITER" })).toEqual({
      email: "team@example.ch",
      role: "RECRUITER",
    });
    expect(teamInvitationSchema.safeParse({ email: "team@example.ch", role: "PLATFORM_ADMIN" }).success).toBe(false);
  });

  it("stores a one-way fixed-length token digest instead of the raw link secret", () => {
    const raw = "raw-invitation-secret-that-must-never-be-persisted";
    const digest = hashInvitationToken(raw);
    expect(digest).toBe(createHash("sha256").update(raw, "utf8").digest("hex"));
    expect(digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(digest).not.toContain(raw);
  });
});
