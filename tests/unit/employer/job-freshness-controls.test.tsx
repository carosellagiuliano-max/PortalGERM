import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { JobFreshnessControls } from "@/components/employer/job-freshness-controls";
import type { EmployerJobFormState } from "@/lib/employer/jobs";

const idleAction = async (): Promise<EmployerJobFormState> => ({
  status: "idle",
});

describe("job freshness controls", () => {
  it("renders the due date in Europe/Zurich independently of the server timezone", () => {
    render(
      <JobFreshnessControls
        jobId="job-1"
        jobVersion={1}
        revisionVersion={1}
        state="ACTIVE"
        dueAt="2026-01-02T23:30:00.000Z"
        confirmIdempotencyKey="confirm-1"
        filledIdempotencyKey="filled-1"
        confirmAction={idleAction}
        filledAction={idleAction}
      />,
    );

    expect(
      screen.getByText(/Späteste nächste Bestätigung:/u),
    ).toHaveTextContent("03.01.2026, 00:30");
  });
});
