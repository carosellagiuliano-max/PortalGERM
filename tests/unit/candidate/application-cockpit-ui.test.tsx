import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/candidate/applications/actions", () => ({
  reportApplicationEmployerAction: vi.fn(),
  updateCandidateApplicationNoteAction: vi.fn(),
  withdrawCandidateApplicationAction: vi.fn(),
}));

import { CandidateApplicationActions } from "@/components/candidate/application-actions";
import { ApplicationKanban } from "@/components/candidate/application-kanban";
import { ApplicationList } from "@/components/candidate/application-list";
import { ApplicationPagination } from "@/components/candidate/application-pagination";
import type { CandidateApplicationListItem } from "@/lib/applications/queries";

const APPLICATION: CandidateApplicationListItem = Object.freeze({
  id: "11111111-1111-4111-8111-111111111111",
  jobTitle: "Frontend Engineer",
  companyName: "Demo AG",
  submittedAt: new Date("2026-07-18T08:00:00.000Z"),
  status: "IN_REVIEW",
  lastUpdatedAt: new Date("2026-07-19T09:30:00.000Z"),
  employerResponseMinutes: 1_530,
  employerHasResponded: true,
  hasCandidateNote: true,
  conversationId: "22222222-2222-4222-8222-222222222222",
});

describe("Phase-09 application cockpit UI", () => {
  it("shows the full application summary and an explicit note action in list view", () => {
    render(<ApplicationList applications={[APPLICATION]} />);

    expect(screen.getByText(/Eingereicht/u)).toBeInTheDocument();
    expect(screen.getByText(/Aktualisiert/u)).toBeInTheDocument();
    expect(screen.getByText(/Erste Reaktion nach/u)).toBeInTheDocument();
    expect(screen.getByText("In Prüfung")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Notiz bearbeiten" })).toHaveAttribute(
      "href",
      `/candidate/applications/${APPLICATION.id}#candidate-note`,
    );
  });

  it("keeps the same required summary fields and note action in Kanban view", () => {
    render(<ApplicationKanban applications={[APPLICATION]} />);

    expect(screen.getAllByText(/Eingereicht/u).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Aktualisiert/u)).toBeInTheDocument();
    expect(screen.getByText(/Erste Reaktion nach/u)).toBeInTheDocument();
    expect(screen.getAllByText("In Prüfung").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("link", { name: "Notiz bearbeiten" })).toHaveAttribute(
      "href",
      `/candidate/applications/${APPLICATION.id}#candidate-note`,
    );
  });

  it("requires an accessible confirmation dialog before withdrawal", async () => {
    const user = userEvent.setup();
    render(
      <CandidateApplicationActions
        applicationId={APPLICATION.id}
        candidateNote={null}
        status="SUBMITTED"
        noteIdempotencyKey="note-test-key"
        withdrawIdempotencyKey="withdraw-test-key"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Bewerbung zurückziehen" }),
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Bewerbung verbindlich zurückziehen?",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", {
        name: /Ich bestätige, dass ich diese Bewerbung zurückziehen möchte/u,
      }),
    ).toBeRequired();
    expect(
      screen.getByRole("button", { name: "Verbindlich zurückziehen" }),
    ).toBeInTheDocument();
  });

  it("shows the total and preserves search, status and view across pages", () => {
    render(
      <ApplicationPagination
        pagination={{
          page: 3,
          totalPages: 5,
          total: 105,
          from: 51,
          to: 75,
        }}
        view="kanban"
        filter={{ status: "IN_REVIEW", query: "Frontend Engineer" }}
      />,
    );

    expect(
      screen.getByText("Bewerbungen 51–75 von 105 · Seite 3 von 5"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zurück" })).toHaveAttribute(
      "href",
      "/candidate/applications?view=kanban&status=IN_REVIEW&q=Frontend+Engineer&page=2",
    );
    expect(screen.getByRole("link", { name: "Weiter" })).toHaveAttribute(
      "href",
      "/candidate/applications?view=kanban&status=IN_REVIEW&q=Frontend+Engineer&page=4",
    );
  });
});
