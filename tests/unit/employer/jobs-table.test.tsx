import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { JobsTable, type JobsTableActions } from "@/components/employer/jobs-table";
import type { EmployerJobListItem } from "@/lib/employer/jobs";

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
});
