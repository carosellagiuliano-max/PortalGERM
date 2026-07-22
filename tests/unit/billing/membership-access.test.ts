import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveRetainedSeatSelection } from "@/lib/billing/membership-access";

const JOINED = new Date("2026-01-01T00:00:00.000Z");

describe("ADR-028 retained Membership revalidation", () => {
  it("preserves a valid explicit snapshot", () => {
    expect(
      resolveRetainedSeatSelection(
        [
          membership("owner", "owner-user", "OWNER", 0),
          membership("recruiter", "recruiter-user", "RECRUITER", 1),
          membership("viewer", "viewer-user", "VIEWER", 2),
        ],
        2,
        ["owner", "viewer"],
        "owner-user",
      ),
    ).toEqual(
      expect.objectContaining({
        retainedMembershipIds: ["owner", "viewer"],
        nonRetainedActiveMembershipIds: ["recruiter"],
      }),
    );
  });

  it("falls back deterministically when the snapshotted Owner was demoted", () => {
    expect(
      resolveRetainedSeatSelection(
        [
          membership("old-owner", "old-owner-user", "ADMIN", 0),
          membership("current-owner", "current-owner-user", "OWNER", 1),
          membership("recruiter", "recruiter-user", "RECRUITER", 2),
        ],
        2,
        ["old-owner", "recruiter"],
        "old-owner-user",
      ),
    ).toEqual(
      expect.objectContaining({
        defaultOwnerMembershipId: "current-owner",
        retainedMembershipIds: ["current-owner", "old-owner"],
        nonRetainedActiveMembershipIds: ["recruiter"],
      }),
    );
  });
});

function membership(
  id: string,
  userId: string,
  role: "OWNER" | "ADMIN" | "RECRUITER" | "VIEWER",
  dayOffset: number,
) {
  return {
    id,
    userId,
    role,
    status: "ACTIVE" as const,
    joinedAt: new Date(JOINED.getTime() + dayOffset * 86_400_000),
  };
}
