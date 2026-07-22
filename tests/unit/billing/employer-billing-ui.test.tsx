import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/employer/billing/profile/actions", () => ({
  saveBillingProfileAction: vi.fn(),
}));
vi.mock("@/app/employer/billing/actions", () => ({
  cancelSubscriptionAction: vi.fn(),
}));

import { BillingProfileForm } from "@/components/billing/billing-profile-form";
import { CancelSubscriptionDialog } from "@/components/billing/cancel-subscription-dialog";
import { CheckoutSummary } from "@/components/billing/checkout-summary";
import { UsageBars } from "@/components/billing/usage-bars";

describe("employer billing UI contracts", () => {
  it("renders authoritative Rappen totals and the immutable billing preview", () => {
    render(
      <CheckoutSummary
        preview={{
          kind: "PLAN",
          slug: "pro",
          quantity: 1,
          name: "Pro",
          description: "Pro Monatsplan",
          transitionLabel: "Neuer Monatsplan",
          unitNetRappen: 39_900,
          netRappen: 39_900,
          taxRateBasisPoints: 810,
          vatRappen: 3_232,
          totalRappen: 43_132,
          targetJobId: null,
          importSetupApprovalId: null,
          planLimits: {
            activeJobs: 10,
            seats: 5,
            talentContacts: 10,
            jobBoosts: 3,
          },
          retentionOptions: [],
          profile: {
            legalName: "Muster AG",
            billingContactEmail: "billing@example.test",
            street: "Bahnhofstrasse 1",
            postalCode: "8001",
            city: "Zürich",
            countryCode: "CH",
            uid: null,
            vatNumber: null,
            version: 1,
          },
        }}
      />,
    );

    expect(screen.getByText("CHF 399.00")).toBeInTheDocument();
    expect(screen.getByText("CHF 32.32")).toBeInTheDocument();
    expect(screen.getByText("CHF 431.32")).toBeInTheDocument();
    expect(screen.getByText("Muster AG")).toBeInTheDocument();
    expect(screen.getByText(/pro Rechnungszeile gerundet/u)).toBeInTheDocument();
  });

  it("keeps tenant and authoritative price fields out of the billing profile form", () => {
    const { container } = render(<BillingProfileForm profile={null} />);

    expect(screen.getByLabelText("Rechtlicher Firmenname")).toHaveAttribute("name", "legalName");
    expect(screen.getByDisplayValue("Schweiz")).toBeDisabled();
    expect(container.querySelector('[name="countryCode"]')).toHaveValue("CH");
    expect(container.querySelector('[name="companyId"]')).toBeNull();
    expect(container.querySelector('[name="priceRappen"]')).toBeNull();
  });

  it("shows included, purchased and admin-funded credits as separate sources", () => {
    render(
      <UsageBars
        canManagePlan
        canStartPlanChange
        usage={{
          talentRadarAccess: true,
          activeJobs: { used: 2, limit: 10 },
          seats: { used: 3, limit: 5, pendingInvitations: 1 },
          includedContacts: { used: 3, remaining: 7, granted: 10 },
          includedBoosts: { used: 1, remaining: 2, granted: 3 },
          purchasedAndGranted: [
            {
              id: "pack",
              creditType: "TALENT_CONTACT",
              fundingSource: "PURCHASED_PACK",
              remaining: 10,
              validTo: new Date("2027-07-21T10:00:00.000Z"),
              expiringSoon: false,
            },
            {
              id: "admin",
              creditType: "JOB_BOOST",
              fundingSource: "ADMIN_GRANT",
              remaining: 2,
              validTo: new Date("2026-08-01T10:00:00.000Z"),
              expiringSoon: true,
            },
          ],
          totalFundable: { talentContacts: 17, jobBoosts: 4 },
          ledgerHistory: [],
        }}
      />,
    );

    expect(screen.getByText(/Noch 7 inkludiert verfügbar/u)).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", {
        name: "Talent-Radar-Kontakte in dieser Planperiode: 3 von 10 verwendet",
      }),
    ).toHaveAttribute("aria-valuenow", "30");
    expect(
      screen.getByRole("progressbar", {
        name: "Inkludierte Job Boosts in dieser Planperiode: 1 von 3 verwendet",
      }),
    ).toHaveAttribute("aria-valuenow", "33");
    expect(screen.getByText("Gekauftes Pack · gültig bis 21.07.2027")).toBeInTheDocument();
    expect(screen.getByText("Admin-Gutschrift · gültig bis 01.08.2026")).toBeInTheDocument();
    expect(screen.getByText(/Aktuell finanzierbare Talent-Kontakte:/u)).toHaveTextContent("17");
    expect(
      screen.getByRole("heading", { name: "Guthaben nach Finanzierungsquelle" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Zusätzliches Guthaben läuft bald ab")).toBeInTheDocument();
    expect(
      screen.queryByText("Mindestens eine Planlimite ist zu 80 % erreicht."),
    ).not.toBeInTheDocument();
  });

  it("shows the shared warning when included contacts or boosts reach 80 percent", () => {
    render(
      <UsageBars
        canManagePlan
        canStartPlanChange
        usage={{
          talentRadarAccess: true,
          activeJobs: { used: 1, limit: 10 },
          seats: { used: 1, limit: 5, pendingInvitations: 0 },
          includedContacts: { used: 8, remaining: 2, granted: 10 },
          includedBoosts: { used: 4, remaining: 1, granted: 5 },
          purchasedAndGranted: [],
          totalFundable: { talentContacts: 2, jobBoosts: 1 },
          ledgerHistory: [],
        }}
      />,
    );

    expect(
      screen.getByText("Mindestens eine Planlimite ist zu 80 % erreicht."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", {
        name: "Talent-Radar-Kontakte in dieser Planperiode: 8 von 10 verwendet",
      }),
    ).toHaveAttribute("aria-valuenow", "80");
    expect(
      screen.getByRole("progressbar", {
        name: "Inkludierte Job Boosts in dieser Planperiode: 4 von 5 verwendet",
      }),
    ).toHaveAttribute("aria-valuenow", "80");
  });

  it("never sends a company Admin from usage to the Owner-only plan checkout", () => {
    render(
      <UsageBars
        canManagePlan={false}
        canStartPlanChange={false}
        usage={{
          talentRadarAccess: false,
          activeJobs: { used: 1, limit: 1 },
          seats: { used: 1, limit: 1, pendingInvitations: 0 },
          includedContacts: { used: 0, remaining: 0, granted: 0 },
          includedBoosts: { used: 0, remaining: 0, granted: 0 },
          purchasedAndGranted: [],
          totalFundable: { talentContacts: 0, jobBoosts: 0 },
          ledgerHistory: [],
        }}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Planoptionen ansehen" }),
    ).toHaveAttribute("href", "/pricing");
    expect(
      screen.queryByRole("link", { name: "Plan upgraden" }),
    ).not.toBeInTheDocument();
  });

  it("routes a cancelling Owner warning to the existing Billing change", () => {
    render(
      <UsageBars
        canManagePlan
        canStartPlanChange={false}
        usage={{
          talentRadarAccess: false,
          activeJobs: { used: 3, limit: 3 },
          seats: { used: 1, limit: 2, pendingInvitations: 0 },
          includedContacts: { used: 0, remaining: 0, granted: 0 },
          includedBoosts: { used: 0, remaining: 0, granted: 0 },
          purchasedAndGranted: [],
          totalFundable: { talentContacts: 0, jobBoosts: 0 },
          ledgerHistory: [],
        }}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Vorgemerkte Planänderung ansehen" }),
    ).toHaveAttribute("href", "/employer/billing");
    expect(
      screen.queryByRole("link", { name: "Plan upgraden" }),
    ).not.toBeInTheDocument();
  });

  it("lets the Owner confirm the retained team selection before cancellation", () => {
    render(
      <CancelSubscriptionDialog
        periodEnd={new Date("2026-08-21T10:00:00.000Z")}
        idempotencyKey="phase12-cancel-ui"
        retentionOptions={[
          {
            membershipId: "40000000-0000-4000-8000-000000000001",
            label: "Owner Beispiel",
            role: "OWNER",
            selectedByDefault: true,
          },
          {
            membershipId: "40000000-0000-4000-8000-000000000002",
            label: "Recruiter Beispiel",
            role: "RECRUITER",
            selectedByDefault: false,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Abo kündigen" }));
    expect(
      screen.getByRole("checkbox", { name: /Owner Beispiel/u }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /Recruiter Beispiel/u }),
    ).not.toBeChecked();
    expect(screen.getByText(/Owner-zuerst-Auswahl/u)).toBeInTheDocument();
  });
});
