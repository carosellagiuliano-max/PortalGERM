import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CandidateRadarRevealActions } from "@/components/candidate/TalentRadar/RevealActions";

vi.mock("@/app/candidate/talent-radar/requests/actions", () => ({
  grantCandidateRadarRevealAction: vi.fn(),
  previewCandidateRadarRevealAction: vi.fn(),
  revokeCandidateRadarRevealAction: vi.fn(),
}));

const DEFAULT_PROPS = Object.freeze({
  requestId: "00000000-0000-4000-8000-000000000001",
  companyName: "Beispiel AG",
  existingFields: [] as const,
  grantId: null,
  grantStatus: "NONE" as const,
  trusted: true,
  grantIdempotencyKey: "grant-idempotency-key",
  revokeIdempotencyKey: "revoke-idempotency-key",
});

describe("Candidate Talent Radar reveal action matrix", () => {
  it("offers a first reveal for NONE only while the company is trusted", () => {
    render(<CandidateRadarRevealActions {...DEFAULT_PROPS} />);

    expect(revealButton()).toBeInTheDocument();
    expect(revokeButton()).not.toBeInTheDocument();
  });

  it("offers no reveal dialog for NONE after trust loss", () => {
    render(<CandidateRadarRevealActions {...DEFAULT_PROPS} trusted={false} />);

    expect(revealButton()).not.toBeInTheDocument();
    expect(revokeButton()).not.toBeInTheDocument();
  });

  it("allows adding fields and revoking an ACTIVE grant", () => {
    render(
      <CandidateRadarRevealActions
        {...DEFAULT_PROPS}
        existingFields={["EMAIL"]}
        grantId="00000000-0000-4000-8000-000000000002"
        grantStatus="ACTIVE"
      />,
    );

    expect(revealButton()).toBeInTheDocument();
    expect(revokeButton()).toBeInTheDocument();
  });

  it("blocks new fields but preserves revocation for TRUST_BLOCKED", () => {
    render(
      <CandidateRadarRevealActions
        {...DEFAULT_PROPS}
        existingFields={["EMAIL"]}
        grantId="00000000-0000-4000-8000-000000000003"
        grantStatus="TRUST_BLOCKED"
        trusted={false}
      />,
    );

    expect(
      screen.getByText(/Neue Freigaben.*bleiben gesperrt/u),
    ).toBeInTheDocument();
    expect(revealButton()).not.toBeInTheDocument();
    expect(revokeButton()).toBeInTheDocument();
  });

  it("keeps a REVOKED grant terminal without regrant or revoke actions", () => {
    render(
      <CandidateRadarRevealActions
        {...DEFAULT_PROPS}
        existingFields={["EMAIL"]}
        grantId="00000000-0000-4000-8000-000000000004"
        grantStatus="REVOKED"
      />,
    );

    expect(screen.getByText(/kann.*nicht erneut geöffnet werden/u)).toBeInTheDocument();
    expect(revealButton()).not.toBeInTheDocument();
    expect(revokeButton()).not.toBeInTheDocument();
  });
});

function revealButton(): HTMLElement | null {
  return screen.queryByRole("button", {
    name: /Identität für Beispiel AG freigeben/u,
  });
}

function revokeButton(): HTMLElement | null {
  return screen.queryByRole("button", {
    name: /Identitätsfreigabe widerrufen/u,
  });
}
