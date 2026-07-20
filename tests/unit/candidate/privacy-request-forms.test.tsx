import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/candidate/privacy/actions", () => ({
  INITIAL_CANDIDATE_PRIVACY_ACTION_STATE: { status: "idle", message: "" },
  createCandidatePrivacyRequestAction: vi.fn(),
}));

import { PrivacyCorrectionRequestForm } from "@/components/candidate/privacy-request-forms";

describe("Phase-09 privacy request forms", () => {
  it("allows at most five correction fields while keeping selected fields removable", async () => {
    const user = userEvent.setup();
    render(<PrivacyCorrectionRequestForm idempotencyKey="privacy-ui-test-0001" />);
    const checkboxes = screen.getAllByRole("checkbox");

    for (const checkbox of checkboxes.slice(0, 5)) {
      await user.click(checkbox);
    }

    expect(screen.getByText("5 / 5 ausgewählt")).toBeInTheDocument();
    expect(checkboxes[0]).toBeEnabled();
    expect(checkboxes[5]).toBeDisabled();

    await user.click(checkboxes[0]!);

    expect(screen.getByText("4 / 5 ausgewählt")).toBeInTheDocument();
    expect(checkboxes[5]).toBeEnabled();
  });
});
