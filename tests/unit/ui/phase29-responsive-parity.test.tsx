import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/app/admin/actions", () => ({
  adminCommandAction: vi.fn(),
}));

import { JobReviewTable } from "@/components/admin/JobReviewTable";
import {
  JobsTable,
  type JobsTableActions,
} from "@/components/employer/jobs-table";
import type { EmployerJobListItem } from "@/lib/employer/job-contracts";

const idleAction: JobsTableActions["submit"] = async () => ({
  status: "idle",
});
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

const editableJob: EmployerJobListItem = {
  id: "phase29-job",
  slug: "phase29-job",
  status: "DRAFT",
  version: 2,
  revisionId: "phase29-revision",
  revisionVersion: 3,
  title: "Mobile Pflegefachperson",
  location: "Zürich",
  applications: 4,
  views: 25,
  saves: 6,
  score: { points: 88, maxPoints: 100 },
  boostStatus: null,
  capabilities: {
    assignmentRole: "EDITOR",
    readSummary: true,
    readFullRevision: true,
    mutateDraft: true,
    manageLifecycle: false,
  },
};

describe("Phase 29 responsive action parity", () => {
  it("uses one semantic Employer table and one action set for every viewport", () => {
    render(
      <JobsTable
        jobs={[editableJob]}
        actions={actions}
        idempotencyKeys={{
          [editableJob.id]: {
            submit: "phase29-submit",
            duplicate: "phase29-duplicate",
          },
        }}
      />,
    );

    const table = screen.getByRole("table", {
      name: "Jobs und verfügbare Aktionen",
    });
    expect(table).toHaveAttribute("data-responsive-table", "true");
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(
      within(table).getAllByText("Aktionen", { exact: true }),
    ).toHaveLength(2);
    expect(within(table).getAllByRole("link", { name: "Öffnen" })).toHaveLength(
      1,
    );
    expect(
      within(table).getAllByRole("link", { name: "Bearbeiten" }),
    ).toHaveLength(1);
    expect(
      within(table).getAllByRole("button", { name: "Einreichen" }),
    ).toHaveLength(1);
    expect(
      within(table).getAllByRole("button", { name: "Duplizieren" }),
    ).toHaveLength(1);
    expect(
      within(table).getByText("Fair-Job-Score", { selector: "span" }),
    ).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the Admin review primary action in the same responsive row", () => {
    render(
      <JobReviewTable
        jobs={[
          {
            id: "phase29-admin-job",
            status: "APPROVED",
            company: { name: "Phase 29 AG" },
            currentRevision: {
              title: "Pflegefachperson HF",
              scoreSnapshots: [{ scorePoints: 90, maxPoints: 100 }],
            },
            boosts: [],
          },
        ]}
      />,
    );

    const table = screen.getByRole("table", {
      name: "Job-Prüfung und verfügbare Aktionen",
    });
    expect(within(table).getAllByRole("link", { name: "Prüfen" })).toHaveLength(
      1,
    );
    expect(
      within(table).getByRole("link", { name: "Prüfen" }).closest("td"),
    ).toHaveAttribute("data-responsive-actions", "true");
    expect(within(table).getByText("Phase 29 AG")).toBeVisible();
    expect(within(table).getByText("90/100")).toBeVisible();
  });
});
