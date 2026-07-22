import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  sendInvitationAction: vi.fn(),
}));

vi.mock("@/app/employer/team/actions", () => actions);
vi.mock("server-only", () => ({}));

import { InvitationForm } from "@/components/employer/invitation-form";
import { buildUpgradePrompt } from "@/lib/billing/upgrade-prompt";

describe("team invitation limit UI", () => {
  it("opens the shared upgrade dialog when the action returns a seat limit", async () => {
    actions.sendInvitationAction.mockResolvedValue({
      status: "error",
      message: "Das Sitzplatzlimit ist erreicht.",
      upgradePrompt: buildUpgradePrompt({
        reason: "SEAT_LIMIT_REACHED",
        suggestedPlanSlug: "pro",
      }),
    });
    const user = userEvent.setup();
    render(<InvitationForm />);

    await user.type(
      screen.getByRole("textbox", { name: "E-Mail" }),
      "new.member@example.test",
    );
    await user.click(screen.getByRole("button", { name: "Einladen" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Sitzplatzlimit erreicht" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Pro-Upgrade ansehen/u })).toHaveAttribute(
      "href",
      "/employer/billing/checkout?plan=pro",
    );
  }, 15_000);
});
