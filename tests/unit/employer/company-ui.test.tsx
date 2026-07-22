import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/employer/company/actions", () => ({
  completeEmployerCompanyOnboardingAction: vi.fn(),
  saveEmployerCompanyProfileAction: vi.fn(),
}));
vi.mock("@/app/employer/company/verification/actions", () => ({
  startNewCompanyVerificationCycleAction: vi.fn(),
  submitCurrentCompanyVerificationAction: vi.fn(),
}));

import {
  CompanyForm,
  type CompanyFormInitialValues,
} from "@/components/employer/company-form";
import { VerificationPanel } from "@/components/employer/verification-panel";
import type { EmployerVerificationView } from "@/lib/employer/company";
import type { UpgradePrompt } from "@/lib/billing/upgrade-prompt";

const INITIAL: CompanyFormInitialValues = Object.freeze({
  expectedUpdatedAt: "2026-07-20T10:00:00.000Z",
  name: "Swiss Talent AG",
  uid: "CHE-123.456.789",
  industry: "Technology",
  size: "11–50",
  website: "https://example.ch/",
  logoStorageKey: "companies/swiss-talent/logo.svg",
  coverStorageKey: "companies/swiss-talent/cover.webp",
  linkedinUrl: "https://www.linkedin.com/company/swiss-talent",
  facebookUrl: "",
  instagramUrl: "",
  about: "Ein vollständiges Firmenprofil für den UI-Vertrag.",
  values: "Verantwortung\nTransparenz",
  benefits: "Flexible Arbeitszeiten",
  locations: [
    {
      id: "20000000-0000-4000-8000-000000000001",
      cantonId: "20000000-0000-4000-8000-000000000002",
      cityId: "20000000-0000-4000-8000-000000000003",
      address: "Bahnhofstrasse 1",
      postalCode: "8001",
      isPrimary: true,
    },
  ],
});

const ENHANCED_PROFILE_PROMPT: UpgradePrompt = Object.freeze({
  reason: "ENHANCED_PROFILE_NOT_INCLUDED",
  title: "Erweitertes Firmenprofil nicht enthalten",
  description:
    "Verfügbare Katalogoption: Pro Firmenprofil für CHF 249.00 netto pro Monat.",
  cta: Object.freeze({
    href: "/employer/billing/checkout?plan=pro",
    label: "Pro Firmenprofil-Upgrade ansehen",
  }),
});

const REQUEST: EmployerVerificationView = Object.freeze({
  id: "20000000-0000-4000-8000-000000000004",
  status: "CHANGES_REQUESTED",
  supersedesRequestId: null,
  createdAt: new Date("2026-07-20T10:00:00.000Z"),
  updatedAt: new Date("2026-07-20T11:00:00.000Z"),
  evidence: Object.freeze({
    summary: "Nicht öffentliche Nachweisbeschreibung für Owner und Admin.",
    reference: "PRIVATE-HR-17",
  }),
  events: Object.freeze([
    Object.freeze({
      kind: "EVIDENCE_REQUESTED",
      fromStatus: "PENDING",
      toStatus: "CHANGES_REQUESTED",
      reasonCode: "PRIVATE_REASON",
      createdAt: new Date("2026-07-20T11:00:00.000Z"),
    }),
  ]),
});

describe("Phase-10 company UI roles", () => {
  it(
    "renders the complete Company profile as read-only for Recruiter and Viewer",
    () => {
      render(
      <CompanyForm
        initial={INITIAL}
        canManage={false}
        enhancedProfileAllowed
        enhancedProfileUpgradePrompt={ENHANCED_PROFILE_PROMPT}
        cantons={[
          {
            id: INITIAL.locations[0]?.cantonId ?? "",
            code: "ZH",
            name: "Zürich",
          },
        ]}
        cities={[
          {
            id: INITIAL.locations[0]?.cityId ?? "",
            cantonId: INITIAL.locations[0]?.cantonId ?? "",
            name: "Zürich",
          },
        ]}
      />,
    );

      expect(screen.getByText("Schreibgeschützte Firmenansicht")).toBeInTheDocument();
      expect(screen.getByLabelText("Firmenname")).toBeDisabled();
      expect(screen.getByDisplayValue(INITIAL.linkedinUrl)).toBeDisabled();
      expect(
        screen.queryByRole("button", { name: "Firmenprofil speichern" }),
      ).not.toBeInTheDocument();
    },
    30_000,
  );

  it("receives the server-built prompt and uses the shared dialog when the premium fields are locked", async () => {
    const user = userEvent.setup();
    render(
      <CompanyForm
        initial={INITIAL}
        canManage
        enhancedProfileAllowed={false}
        enhancedProfileUpgradePrompt={ENHANCED_PROFILE_PROMPT}
        cantons={[]}
        cities={[]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Erweitertes Firmenprofil" })).toBeInTheDocument();
    expect(screen.getByText(/aktuellen Plan schreibgeschützt/u)).toBeInTheDocument();
    expect(screen.queryByLabelText("Cover Storage-Key (optional)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Unternehmenswerte")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Firmen-Benefits")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Upgrade-Optionen anzeigen" }),
    );
    expect(await screen.findByText(/Pro Firmenprofil für CHF 249.00/u)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pro Firmenprofil-Upgrade ansehen" })).toHaveAttribute(
      "href",
      "/employer/billing/checkout?plan=pro",
    );
  });

  it("does not render evidence or internal reasons in a read-only verification view", () => {
    render(
      <VerificationPanel
        current={REQUEST}
        history={[REQUEST]}
        canManage={false}
        idempotencyKey="20000000-0000-4000-8000-000000000005"
      />,
    );

    expect(screen.getAllByText("Nachweise ergänzen").length).toBeGreaterThan(0);
    expect(screen.queryByText("PRIVATE-HR-17")).not.toBeInTheDocument();
    expect(screen.queryByText(/PRIVATE_REASON/u)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nachweise/u })).not.toBeInTheDocument();
  });

  it("keeps a pending cycle closed and offers a new cycle only after rejection", () => {
    const pending = { ...REQUEST, status: "PENDING" as const };
    const { rerender } = render(
      <VerificationPanel
        current={pending}
        history={[pending]}
        canManage
        idempotencyKey="20000000-0000-4000-8000-000000000006"
      />,
    );
    expect(screen.queryByRole("button", { name: /Prüfzyklus starten/u })).not.toBeInTheDocument();

    const rejected = { ...REQUEST, status: "REJECTED" as const };
    rerender(
      <VerificationPanel
        current={rejected}
        history={[rejected]}
        canManage
        idempotencyKey="20000000-0000-4000-8000-000000000007"
      />,
    );
    expect(
      screen.getByRole("button", { name: "Prüfzyklus starten und einreichen" }),
    ).toBeInTheDocument();
  });
});
