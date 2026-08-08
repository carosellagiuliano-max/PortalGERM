import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/admin/actions", () => ({
  adminCommandAction: vi.fn(),
}));

import { CompanyClosureAction } from "@/components/admin/company-closure-action";

const COMPANY_ID = "34c00000-0000-4000-8000-000000000001";

describe("CompanyClosureAction", () => {
  it("renders an explicit irreversible closure confirmation when Billing is clear", () => {
    const { container } = render(
      <CompanyClosureAction
        companyId={COMPANY_ID}
        blockingSubscription={null}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Firma endgültig schliessen" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", {
        name: "Zur Bestätigung FIRMA_SCHLIESSEN eingeben",
      }),
    ).toHaveAttribute("pattern", "FIRMA_SCHLIESSEN");
    expect(container.querySelector('input[name="operation"]')).toHaveValue(
      "company-close",
    );
    expect(container.querySelector('input[name="companyId"]')).toHaveValue(
      COMPANY_ID,
    );
    expect(
      container.querySelector('input[name="expectedStatus"]'),
    ).toHaveValue("SUSPENDED");
  });

  it("shows the Billing blocker and does not render a closure action", () => {
    render(
      <CompanyClosureAction
        companyId={COMPANY_ID}
        blockingSubscription={{
          status: "CANCELLING",
          currentPeriodEnd: new Date("2026-09-30T22:00:00.000Z"),
        }}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Der endgültige Abschluss ist gesperrt",
    );
    expect(
      screen.queryByRole("button", { name: "Firma endgültig schliessen" }),
    ).not.toBeInTheDocument();
  });
});
