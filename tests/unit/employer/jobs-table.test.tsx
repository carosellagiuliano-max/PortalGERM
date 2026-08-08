import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { JobsTable, type JobsTableActions } from "@/components/employer/jobs-table";
import { buildUpgradePrompt } from "@/lib/billing/upgrade-prompt";
import type { EmployerJobListItem } from "@/lib/employer/job-contracts";

const idleAction: JobsTableActions["duplicate"] = async () => ({ status: "idle" });
const actions: JobsTableActions = {
  submit: idleAction,
  pause: idleAction,
  pauseAndRevise: idleAction,
  clonePaused: idleAction,
  cloneRejected: idleAction,
  duplicate: idleAction,
  reactivate: idleAction,
  close: idleAction,
};

const reviewerJob: EmployerJobListItem = {
  id: "job-reviewer",
  slug: "reviewer-job",
  status: "DRAFT",
  version: 1,
  revisionId: "revision-reviewer",
  revisionVersion: 1,
  title: "Reviewer Job",
  location: "Zürich",
  applications: 0,
  views: 0,
  saves: 0,
  score: null,
  boostStatus: "ACTIVE",
  capabilities: { assignmentRole: "REVIEWER", readSummary: true, readFullRevision: true, mutateDraft: false, manageLifecycle: false },
};

describe("employer jobs table duplicate capability", () => {
  it("does not expose the mutating duplicate action to a read-only Reviewer", () => {
    const { rerender } = render(<JobsTable jobs={[reviewerJob]} actions={actions} idempotencyKeys={{}} />);
    expect(
      screen.getByRole("region", {
        name: "Jobs und verfügbare Aktionen",
      }),
    ).toHaveAttribute(
      "data-responsive-table-region",
      "true",
    );
    expect(
      screen.getByRole("table", {
        name: "Jobs und verfügbare Aktionen",
      }),
    ).toHaveAttribute("data-responsive-table", "true");
    expect(screen.queryByRole("button", { name: "Duplizieren" })).not.toBeInTheDocument();
    expect(screen.getByText("Zuweisung: Prüfung")).toBeInTheDocument();
    expect(screen.getByText("Entwurf")).toBeInTheDocument();
    expect(screen.getByText("Aktiv")).toBeInTheDocument();
    expect(screen.queryByText("REVIEWER")).not.toBeInTheDocument();
    expect(screen.queryByText("DRAFT")).not.toBeInTheDocument();

    rerender(<JobsTable jobs={[{
      ...reviewerJob,
      id: "job-editor",
      capabilities: { ...reviewerJob.capabilities, assignmentRole: "EDITOR", mutateDraft: true },
    }]} actions={actions} idempotencyKeys={{}} />);
    expect(screen.getByRole("button", { name: "Duplizieren" })).toBeInTheDocument();
    expect(screen.getByText("Zuweisung: Redaktion")).toBeInTheDocument();
  });

  it("opens the shared upgrade dialog when reactivation returns the typed job limit", async () => {
    const user = userEvent.setup();
    const reactivate = vi.fn<JobsTableActions["reactivate"]>().mockResolvedValue({
      status: "error",
      message: "Das aktive Joblimit ist erreicht.",
      upgradePrompt: buildUpgradePrompt({
        reason: "ACTIVE_JOB_LIMIT_REACHED",
        suggestedProductSlug: "additional-job-30d",
        suggestedPlanSlug: "pro",
      }),
    });
    render(
      <JobsTable
        jobs={[{
          ...reviewerJob,
          id: "job-paused",
          status: "PAUSED",
          revisionVersion: 3,
          capabilities: {
            ...reviewerJob.capabilities,
            assignmentRole: null,
            manageLifecycle: true,
          },
        }]}
        actions={{ ...actions, reactivate }}
        idempotencyKeys={{}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Reaktivieren" }));

    expect(reactivate).toHaveBeenCalledOnce();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Aktives Joblimit erreicht" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Kaufstatus und Freigaben prüfen/u }),
    ).toHaveAttribute("href", "/employer/billing/subscription");
  });
});
