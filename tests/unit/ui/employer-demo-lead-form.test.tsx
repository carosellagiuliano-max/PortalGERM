import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  submitEmployerDemoLeadAction: vi.fn(),
}));

vi.mock("@/app/(public)/employers/demo/actions", () => actions);

import { LeadForm } from "@/components/marketing/lead-form";
import {
  INITIAL_LEAD_ACTION_STATE,
  type LeadActionState,
} from "@/lib/sales/lead-action-state";

const privacyNotice =
  "Die Angaben werden zweckgebunden für diese Anfrage verarbeitet und anschliessend nach der geltenden Aufbewahrungsregel gelöscht.";

const defaultProps = {
  idempotencyKey: "lead-test-idempotency-key",
  initialInterest: "IMPORT" as const,
  privacyNotice,
};

describe("Phase 08 employer demo lead form", () => {
  beforeEach(() => {
    actions.submitEmployerDemoLeadAction.mockReset();
    actions.submitEmployerDemoLeadAction.mockResolvedValue(
      INITIAL_LEAD_ACTION_STATE,
    );
  });

  it("renders every labelled field with the intended browser hints and optionality", () => {
    render(<LeadForm {...defaultProps} />);

    const company = screen.getByRole("textbox", { name: "Unternehmen" });
    expect(company).toHaveAttribute("name", "companyName");
    expect(company).toHaveAttribute("autocomplete", "organization");
    expect(company).toHaveAttribute("maxlength", "200");
    expect(company).toBeRequired();

    const contact = screen.getByRole("textbox", { name: "Kontaktperson" });
    expect(contact).toHaveAttribute("name", "contactName");
    expect(contact).toHaveAttribute("autocomplete", "name");
    expect(contact).toHaveAttribute("maxlength", "160");
    expect(contact).toBeRequired();

    const email = screen.getByRole("textbox", { name: "Geschäftliche E-Mail" });
    expect(email).toHaveAttribute("name", "email");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("inputmode", "email");
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(email).toHaveAttribute("maxlength", "320");
    expect(email).toBeRequired();

    const phone = screen.getByRole("textbox", { name: "Telefon (optional)" });
    expect(phone).toHaveAttribute("name", "phone");
    expect(phone).toHaveAttribute("type", "tel");
    expect(phone).toHaveAttribute("inputmode", "tel");
    expect(phone).toHaveAttribute("autocomplete", "tel");
    expect(phone).toHaveAttribute("maxlength", "32");
    expect(phone).toHaveAttribute("placeholder", "+41 79 123 45 67");
    expect(phone).not.toBeRequired();

    const message = screen.getByRole("textbox", { name: "Worum geht es?" });
    expect(message).toHaveAttribute("name", "message");
    expect(message).toHaveAttribute("minlength", "20");
    expect(message).toHaveAttribute("maxlength", "2000");
    expect(message).toBeRequired();
    expect(message).toHaveAccessibleDescription(
      /20 bis 2'000 Zeichen\. Keine Bewerbungsunterlagen oder sensiblen Personendaten\./,
    );

    const idempotencyKey = document.querySelector<HTMLInputElement>(
      'input[name="idempotencyKey"]',
    );
    expect(idempotencyKey).toHaveAttribute("type", "hidden");
    expect(idempotencyKey).toHaveValue(defaultProps.idempotencyKey);
  });

  it("offers the complete controlled option sets and keeps phone and callback optional", () => {
    render(<LeadForm {...defaultProps} />);

    expectOptions(screen.getByRole("combobox", { name: "Unternehmensgrösse" }), [
      ["", "Grösse wählen"],
      ["1_9", "1–9 Mitarbeitende"],
      ["10_49", "10–49 Mitarbeitende"],
      ["50_249", "50–249 Mitarbeitende"],
      ["250_999", "250–999 Mitarbeitende"],
      ["1000_PLUS", "1'000 oder mehr Mitarbeitende"],
    ]);
    expectOptions(screen.getByRole("combobox", { name: "Einstellungsbedarf" }), [
      ["", "Bedarf wählen"],
      ["ONE_ROLE", "Eine konkrete Stelle"],
      ["TWO_TO_FIVE", "2–5 Einstellungen"],
      ["SIX_TO_TWENTY", "6–20 Einstellungen"],
      ["TWENTY_PLUS", "Mehr als 20 Einstellungen"],
      ["EXPLORING", "Erst orientieren"],
    ]);
    const interest = screen.getByRole("combobox", { name: "Interesse" });
    expectOptions(interest, [
      ["", "Thema wählen"],
      ["GENERAL", "Allgemeine Demo"],
      ["STARTER", "Starter"],
      ["PRO", "Pro"],
      ["BUSINESS", "Business"],
      ["ENTERPRISE", "Enterprise"],
      ["IMPORT", "XML-/JSON-Import"],
    ]);
    expect(interest).toHaveValue("IMPORT");

    const callback = screen.getByRole("combobox", {
      name: "Gewünschtes Rückruffenster (optional)",
    });
    expectOptions(callback, [
      ["", "Kein Wunsch"],
      ["MORNING", "Vormittags"],
      ["AFTERNOON", "Nachmittags"],
      ["ANYTIME", "Zeitlich flexibel"],
    ]);
    expect(callback).not.toBeRequired();
    expect(screen.getByRole("textbox", { name: "Telefon (optional)" })).not.toBeRequired();
  });

  it("keeps the honeypot outside the tab and accessibility trees and explains privacy", async () => {
    const user = userEvent.setup();
    render(<LeadForm {...defaultProps} />);

    const honeypot = document.querySelector<HTMLInputElement>(
      'input[name="websiteConfirmation"]',
    );
    expect(honeypot).not.toBeNull();
    expect(honeypot).toHaveAttribute("tabindex", "-1");
    expect(honeypot).toHaveAttribute("autocomplete", "off");
    expect(honeypot?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(
      screen.queryByRole("textbox", { name: "Website bestätigen" }),
    ).not.toBeInTheDocument();

    await user.tab();
    expect(screen.getByRole("textbox", { name: "Unternehmen" })).toHaveFocus();
    expect(honeypot).not.toHaveFocus();

    const purpose = screen.getByRole("checkbox", {
      name: /Ich bitte SwissTalentHub, mich zu dieser Anfrage zu kontaktieren/,
    });
    expect(purpose).toBeRequired();
    expect(purpose).not.toBeChecked();
    expect(purpose).toHaveAccessibleDescription(
      /Die Angaben werden zweckgebunden.*Aufbewahrungsregel gelöscht\./,
    );
    expect(
      screen.getByText(/keine Einwilligung in allgemeine Marketing-E-Mails/),
    ).toBeInTheDocument();
  });

  it("disables submission and announces the pending state until the action resolves", async () => {
    const user = userEvent.setup();
    let resolveAction!: (state: LeadActionState) => void;
    const pendingResult = new Promise<LeadActionState>((resolve) => {
      resolveAction = resolve;
    });
    actions.submitEmployerDemoLeadAction.mockReturnValue(pendingResult);
    render(<LeadForm {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: "Demo anfragen" }));

    const pendingButton = await screen.findByRole("button", {
      name: "Anfrage wird sicher erfasst …",
    });
    expect(pendingButton).toBeDisabled();

    await act(async () => {
      resolveAction({ status: "error", message: "Bitte versuche es erneut." });
      await pendingResult;
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Bitte versuche es erneut.",
    );
    expect(screen.getByRole("button", { name: "Demo anfragen" })).toBeEnabled();
  });

  it("renders global and field errors while retaining safe submitted values", async () => {
    const user = userEvent.setup();
    actions.submitEmployerDemoLeadAction.mockResolvedValue({
      status: "error",
      message: "Bitte prüfe die markierten Angaben.",
      fieldErrors: {
        email: ["Bitte prüfe die E-Mail-Adresse."],
        acceptedContactPurpose: ["Bitte bestätige den Kontaktzweck."],
      },
      values: {
        companyName: "Alpenblick AG",
        contactName: "Mira Muster",
        email: "ungueltig",
        interestCode: "IMPORT",
        message: "Wir möchten einen kontrollierten Import besprechen.",
      },
    } satisfies LeadActionState);
    render(<LeadForm {...defaultProps} />);

    const company = screen.getByRole("textbox", { name: "Unternehmen" });
    const contact = screen.getByRole("textbox", { name: "Kontaktperson" });
    const email = screen.getByRole("textbox", { name: "Geschäftliche E-Mail" });
    const message = screen.getByRole("textbox", { name: "Worum geht es?" });
    await user.type(company, "Alpenblick AG");
    await user.type(contact, "Mira Muster");
    await user.type(email, "ungueltig");
    await user.type(message, "Wir möchten einen kontrollierten Import besprechen.");
    await user.click(screen.getByRole("button", { name: "Demo anfragen" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Bitte prüfe die markierten Angaben.",
    );
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("Bitte prüfe die E-Mail-Adresse.");
    const purpose = screen.getByRole("checkbox", {
      name: /Ich bitte SwissTalentHub, mich zu dieser Anfrage zu kontaktieren/,
    });
    expect(purpose).toHaveAttribute("aria-invalid", "true");
    expect(purpose).toHaveAccessibleDescription(
      `${privacyNotice} Bitte bestätige den Kontaktzweck.`,
    );
    expect(company).toHaveValue("Alpenblick AG");
    expect(contact).toHaveValue("Mira Muster");
    expect(message).toHaveValue(
      "Wir möchten einen kontrollierten Import besprechen.",
    );
  });

  it("replaces the form with a focused success status", async () => {
    const user = userEvent.setup();
    actions.submitEmployerDemoLeadAction.mockResolvedValue({
      status: "success",
      message: "Danke. Wir haben deine Anfrage sicher erfasst.",
    } satisfies LeadActionState);
    render(<LeadForm {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: "Demo anfragen" }));

    const status = await screen.findByRole("status");
    expect(within(status).getByRole("heading", { name: "Anfrage erfasst" })).toBeInTheDocument();
    expect(status).toHaveTextContent("Danke. Wir haben deine Anfrage sicher erfasst.");
    expect(status).toHaveAttribute("tabindex", "-1");
    await waitFor(() => expect(status).toHaveFocus());
    expect(screen.queryByRole("button", { name: "Demo anfragen" })).not.toBeInTheDocument();
  });
});

function expectOptions(
  select: HTMLElement,
  expected: ReadonlyArray<readonly [string, string]>,
) {
  expect(
    within(select).getAllByRole("option").map((option) => [
      option.getAttribute("value") ?? "",
      option.textContent ?? "",
    ]),
  ).toEqual(expected);
}
