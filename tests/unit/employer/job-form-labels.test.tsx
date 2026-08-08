import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { NewJobWizard } from "@/components/employer/job-wizard/job-wizard";
import type { EmployerJobCatalog } from "@/lib/employer/job-contracts";

const catalog: EmployerJobCatalog = {
  categories: [{ id: "category-1", name: "Engineering" }],
  cantons: [{ id: "canton-1", code: "ZH", name: "Zürich" }],
  cities: [{ id: "city-1", cantonId: "canton-1", name: "Zürich" }],
  skills: [],
  occupations: [],
};

describe("employer job form copy", () => {
  it("keeps enum values in form submissions while showing understandable labels", () => {
    render(
      <NewJobWizard
        catalog={catalog}
        action={async () => ({ status: "idle" })}
        idempotencyKey="job-create-label-test"
        defaultValidThrough="2026-09-30"
      />,
    );

    const jobType = screen.getByLabelText("Vertragsart");
    expect(within(jobType).getByRole("option", { name: "Festanstellung" })).toHaveValue(
      "PERMANENT",
    );
    expect(within(jobType).getByRole("option", { name: "Lehrstelle" })).toHaveValue(
      "APPRENTICESHIP",
    );

    const remoteType = screen.getByLabelText("Arbeitsmodell");
    expect(within(remoteType).getByRole("option", { name: "Vor Ort" })).toHaveValue(
      "ONSITE",
    );
    expect(
      within(remoteType).getByRole("option", { name: "Vollständig remote" }),
    ).toHaveValue("REMOTE");
  });
});
