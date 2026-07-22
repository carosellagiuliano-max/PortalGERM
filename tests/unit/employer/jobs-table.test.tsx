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
  boostStatus: null,
  capabilities: { assignmentRole: "REVIEWER", readSummary: true, readFullRevision: true, mutateDraft: false, manageLifecycle: false },
};

describe("employer jobs table duplicate capability", () => {
  it("does not expose the mutating duplicate action to a read-only Reviewer", () => {
    const { rerender } = render(<JobsTable jobs={[reviewerJob]} actions={actions} idempotencyKeys={{}} />);
    expect(screen.queryByRole("button", { name: "Duplizieren" })).not.toBeInTheDocument();

    rerender(<JobsTable jobs={[{
      ...reviewerJob,
      id: "job-editor",
      capabilities: { ...reviewerJob.capabilities, assignmentRole: "EDITOR", mutateDraft: true },
    }]} actions={actions} idempotencyKeys={{}} />);
    expect(screen.getByRole("button", { name: "Duplizieren" })).toBeInTheDocument();
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
    expect(screen.getByRole("link", { name: /Billing und verfügbare Optionen ansehen/u })).toHaveAttribute("href", "/employer/billing");
  });
});
