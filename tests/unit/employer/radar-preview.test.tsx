import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TalentRadarLockedPreview } from "@/components/employer/talent-radar-locked-preview";

describe("Phase 10 Talent Radar preview", () => {
  it("stays explicitly illustrative even for an entitled plan", () => {
    render(<TalentRadarLockedPreview entitled allowance={10} />);
    expect(screen.getByRole("heading", { name: "Talent Radar" })).toBeInTheDocument();
    expect(screen.getByText(/weder Kandidat:innen noch Radar-Profile abgefragt/i)).toBeInTheDocument();
    expect(screen.getByText(/private Suche wird mit Phase 14 verfügbar/i)).toBeInTheDocument();
    expect(screen.queryByText(/12\s*\/\s*25/u)).not.toBeInTheDocument();
  });
});
