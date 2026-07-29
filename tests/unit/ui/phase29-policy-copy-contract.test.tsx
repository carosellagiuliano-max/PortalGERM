import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancelSubscription: vi.fn(),
  grantReveal: vi.fn(),
  previewReveal: vi.fn(),
  revokeReveal: vi.fn(),
  startVerification: vi.fn(),
  submitVerification: vi.fn(),
}));

vi.mock("@/app/employer/billing/actions", () => ({
  cancelSubscriptionAction: mocks.cancelSubscription,
}));
vi.mock("@/app/employer/company/verification/actions", () => ({
  startNewCompanyVerificationCycleAction: mocks.startVerification,
  submitCurrentCompanyVerificationAction: mocks.submitVerification,
}));
vi.mock("@/app/candidate/talent-radar/requests/actions", () => ({
  grantCandidateRadarRevealAction: mocks.grantReveal,
  previewCandidateRadarRevealAction: mocks.previewReveal,
  revokeCandidateRadarRevealAction: mocks.revokeReveal,
}));

import { CancelSubscriptionDialog } from "@/components/billing/cancel-subscription-dialog";
import { CheckoutSummary } from "@/components/billing/checkout-summary";
import { CandidateRadarRevealActions } from "@/components/candidate/TalentRadar/RevealActions";
import { VerificationPanel } from "@/components/employer/verification-panel";
import {
  CHECKOUT_CALCULATION_COPY,
  COMPANY_VERIFICATION_SCOPE_COPY,
  IDENTITY_REVEAL_REVOCATION_LIMIT_COPY,
  SUBSCRIPTION_CANCELLATION_EFFECT_COPY,
  TRUST_COPY_CONTRACT_VERSION,
} from "@/lib/ux/trust-copy";

describe("Phase-29 visible policy copy contract", () => {
  it("shows the versioned company-verification scope in the actual employer UI", () => {
    render(
      <VerificationPanel
        current={null}
        history={[]}
        canManage
        idempotencyKey="phase29-verification"
      />,
    );

    expect(screen.getByText(COMPANY_VERIFICATION_SCOPE_COPY, { exact: false })).toBeVisible();
    expect(TRUST_COPY_CONTRACT_VERSION).toBe("phase29-trust-copy-v1");
  });

  it("names the recipient boundary and irreversible reveal consequence before revocation", async () => {
    const user = userEvent.setup();
    render(
      <CandidateRadarRevealActions
        requestId="29000000-0000-4000-8000-000000000029"
        companyName="Beispiel AG"
        existingFields={["DISPLAY_NAME", "EMAIL", "PHONE", "CV_METADATA"]}
        grantId="29000000-0000-4000-8000-000000000030"
        grantStatus="ACTIVE"
        trusted
        grantIdempotencyKey="phase29-grant"
        revokeIdempotencyKey="phase29-revoke"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Identitätsfreigabe widerrufen" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(IDENTITY_REVEAL_REVOCATION_LIMIT_COPY);
    expect(dialog).toHaveTextContent("Beispiel AG");
  });

  it("shows cancellation timing and downgrade effects before confirmation", async () => {
    const user = userEvent.setup();
    render(
      <CancelSubscriptionDialog
        periodEnd={new Date("2026-08-31T00:00:00.000Z")}
        idempotencyKey="phase29-cancel"
        retentionOptions={[
          {
            membershipId: "29000000-0000-4000-8000-000000000031",
            label: "Owner",
            role: "OWNER",
            selectedByDefault: true,
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Abo kündigen" }));
    expect(screen.getByText(SUBSCRIPTION_CANCELLATION_EFFECT_COPY)).toBeVisible();
    expect(
      screen.getByText(/Die bezahlten Rechte bleiben bis unmittelbar vor/u),
    ).toBeVisible();
  });

  it("keeps server-side CHF calculation and stored plan limits visible at checkout", () => {
    render(
      <CheckoutSummary
        preview={{
          kind: "PLAN",
          slug: "starter",
          quantity: 1,
          name: "Starter",
          description: "Planvorschau",
          transitionLabel: null,
          unitNetRappen: 14_900,
          netRappen: 14_900,
          taxRateBasisPoints: 810,
          vatRappen: 1_207,
          totalRappen: 16_107,
          profile: null,
          planLimits: {
            activeJobs: 3,
            seats: 2,
            talentContacts: 5,
            jobBoosts: 1,
          },
          retentionOptions: [],
          targetJobId: null,
          importSetupApprovalId: null,
        }}
      />,
    );

    expect(screen.getByText(CHECKOUT_CALCULATION_COPY, { exact: false })).toBeVisible();
    expect(screen.getByText("3 aktive Jobs")).toBeVisible();
    expect(screen.getByText("Total inkl. MWST")).toBeVisible();
  });
});
