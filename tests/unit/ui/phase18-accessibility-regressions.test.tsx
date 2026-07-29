import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/admin/actions", () => ({
  adminCommandAction: vi.fn(),
}));
vi.mock("@/app/employer/team/actions", () => ({
  changeMemberRoleAction: vi.fn(),
  removeMemberAction: vi.fn(),
  resendInvitationAction: vi.fn(),
  revokeInvitationAction: vi.fn(),
}));
vi.mock("@/app/employer/team/assignments/actions", () => ({
  assignRecruiterAction: vi.fn(),
  revokeAssignmentAction: vi.fn(),
}));

import { SignalCards } from "@/components/admin/BusinessCockpit/SignalCards";
import { JobReviewTable } from "@/components/admin/JobReviewTable";
import { TeamList } from "@/components/employer/team-list";

describe("Phase-18 accessibility regressions", () => {
  it("gives the business-cockpit lead controls visible accessible names", () => {
    render(
      <SignalCards
        signals={[
          {
            reason: "LEAD_FOLLOW_UP",
            dataProvenance: "LIVE",
            companyId: "company-accessibility",
            companyName: "Beispiel AG",
            title: "Lead nachfassen",
            evidence: "Termin offen",
            suggestedAction: "Owner kontaktieren.",
            leadId: "lead-accessibility",
            leadStatus: "NEW",
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("textbox", { name: "Vorbefüllte Admin-Notiz" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Neuer Lead-Status" }),
    ).toBeInTheDocument();
  });

  it("keeps the job-review action reachable inside an explicit scroll region", () => {
    render(
      <JobReviewTable
        jobs={[
          {
            id: "job-accessibility",
            status: "APPROVED",
            company: { name: "Beispiel AG" },
            currentRevision: {
              title: "Software Engineer",
              scoreSnapshots: [{ scorePoints: 92, maxPoints: 100 }],
            },
            boosts: [],
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("region", {
        name: "Job-Prüfung und verfügbare Aktionen",
      }),
    ).toHaveAttribute("data-responsive-table-region", "true");
    const reviewLink = screen.getByRole("link", { name: "Prüfen" });
    expect(reviewLink).toHaveClass("whitespace-nowrap");
    expect(reviewLink.closest("td")).toHaveAttribute(
      "data-responsive-actions",
      "true",
    );
  });

  it("names each member role selector with the affected team member", () => {
    const data = {
      memberships: [
        {
          id: "membership-accessibility",
          role: "OWNER",
          status: "ACTIVE",
          joinedAt: new Date("2026-07-20T10:00:00.000Z"),
          user: {
            id: "user-accessibility",
            name: "Ada Muster",
            email: "ada@example.test",
          },
        },
      ],
      invitations: [],
      assignments: [],
      jobs: [],
    } as ComponentProps<typeof TeamList>["data"];

    render(<TeamList data={data} canManage />);

    expect(
      screen.getByRole("combobox", { name: "Rolle für Ada Muster" }),
    ).toBeInTheDocument();
  });
});
