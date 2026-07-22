import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { InvoiceView } from "@/components/billing/invoice-view";
import { deriveInvoiceDisplayStatus } from "@/lib/billing/employer-read-model";

const DUE_AT = new Date("2026-07-22T12:00:00.000Z");

describe("employer invoice display status", () => {
  it.each([
    ["before the due instant", new Date("2026-07-22T11:59:59.999Z"), "ISSUED"],
    ["at the due instant", new Date("2026-07-22T12:00:00.000Z"), "OVERDUE"],
    ["after the due instant", new Date("2026-07-22T12:00:00.001Z"), "OVERDUE"],
  ] as const)("derives ISSUED as expected %s", (_label, now, expected) => {
    expect(deriveInvoiceDisplayStatus("ISSUED", DUE_AT, now)).toBe(expected);
  });

  it.each(["DRAFT", "PAID", "VOID"] as const)(
    "does not reinterpret terminal or non-issued status %s",
    (status) => {
      expect(deriveInvoiceDisplayStatus(status, DUE_AT, DUE_AT)).toBe(status);
    },
  );

  it("renders the derived overdue label with the destructive badge treatment", () => {
    render(
      <InvoiceView
        invoice={{
          number: "INV-2026-0001",
          status: "ISSUED",
          displayStatus: "OVERDUE",
          billingLegalNameSnapshot: "Beispiel AG",
          billingContactEmailSnapshot: "billing@example.test",
          billingStreetSnapshot: "Musterweg 1",
          billingPostalCodeSnapshot: "8000",
          billingCitySnapshot: "Zürich",
          billingCountryCodeSnapshot: "CH",
          billingUidSnapshot: null,
          billingVatNumberSnapshot: null,
          netTotalRappen: 10_000,
          vatTotalRappen: 810,
          totalRappen: 10_810,
          dueAt: DUE_AT,
          issuedAt: new Date("2026-07-01T12:00:00.000Z"),
          paidAt: null,
          lines: [],
        }}
      />,
    );

    expect(screen.getByText("Überfällig")).toHaveClass("text-destructive");
    expect(screen.queryByText("Offen")).not.toBeInTheDocument();
  });
});
