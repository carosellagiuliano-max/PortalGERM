import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/candidate/messages/actions", () => ({
  sendCandidateMessageAction: vi.fn(),
}));

import { CandidateMessageComposeForm } from "@/components/candidate/message-compose-form";

describe("candidate message compose form", () => {
  it("does not render message controls for a trust-blocked Radar thread", () => {
    render(
      <CandidateMessageComposeForm
        conversationId="11111111-1111-4111-8111-111111111111"
        initialIdempotencyKey="message-ui-blocked-0001"
        blockedReason="Diese Firma ist derzeit nicht aktuell verifiziert. Neue Nachrichten in diesem Talent-Radar-Gespräch sind gesperrt."
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      /Neue Nachrichten in diesem Talent-Radar-Gespräch sind gesperrt/u,
    );
    expect(screen.queryByRole("textbox", { name: "Nachricht" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nachricht senden" })).not.toBeInTheDocument();
  });

  it("keeps the compose controls available when the server read-model allows sending", () => {
    render(
      <CandidateMessageComposeForm
        conversationId="22222222-2222-4222-8222-222222222222"
        initialIdempotencyKey="message-ui-allowed-0001"
      />,
    );

    expect(screen.getByRole("textbox", { name: "Nachricht" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Nachricht senden" })).toBeEnabled();
  });
});
