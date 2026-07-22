import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { UpgradeDialog } from "@/components/billing/upgrade-dialog";
import { PlanGate } from "@/components/employer/plan-gate";
import { buildUpgradePrompt } from "@/lib/billing/upgrade-prompt";

describe("UpgradeDialog", () => {
  it("opens an accessible dialog and renders only the prebuilt safe CTA", async () => {
    const user = userEvent.setup();
    const prompt = buildUpgradePrompt({
      reason: "SEAT_LIMIT_REACHED",
      suggestedPlanSlug: "pro",
    });
    render(<UpgradeDialog prompt={prompt} />);

    await user.click(
      screen.getByRole("button", { name: "Upgrade-Optionen anzeigen" }),
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Sitzplatzlimit erreicht" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Pro-Upgrade ansehen/u })).toHaveAttribute(
      "href",
      "/employer/billing/checkout?plan=pro",
    );
    expect(screen.getByRole("button", { name: "Später" })).toBeInTheDocument();
  });

  it("can open immediately after a server action returns a limit", async () => {
    render(
      <UpgradeDialog
        prompt={buildUpgradePrompt({
          reason: "SEAT_LIMIT_REACHED",
          suggestedPlanSlug: "pro",
        })}
        defaultOpen
      />,
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("uses the shared dialog for a server-gated analytics surface", async () => {
    const user = userEvent.setup();
    render(
      <PlanGate
        allowed={false}
        title="Erweiterte Analytics"
        explanation="Planrecht fehlt."
        upgradePrompt={buildUpgradePrompt({
          reason: "ADVANCED_ANALYTICS_NOT_INCLUDED",
          suggestedPlanSlug: "pro",
          actorRole: "ADMIN",
        })}
      >
        <p>Gesperrte Auswertung</p>
      </PlanGate>,
    );

    expect(screen.queryByText("Gesperrte Auswertung")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Upgrade-Optionen anzeigen" }),
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pläne vergleichen" })).toHaveAttribute(
      "href",
      "/pricing",
    );
  });
});
