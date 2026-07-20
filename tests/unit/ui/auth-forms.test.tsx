import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  loginAction: vi.fn(),
  registerCandidateAction: vi.fn(),
  registerEmployerAction: vi.fn(),
  forgotPasswordAction: vi.fn(),
  resetPasswordAction: vi.fn(),
  switchCompanyContextAction: vi.fn(),
}));

vi.mock("@/lib/auth/server-actions", () => actions);

import { CandidateRegistrationForm } from "@/components/auth/candidate-registration-form";
import { EmployerRegistrationForm } from "@/components/auth/employer-registration-form";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { LoginForm } from "@/components/auth/login-form";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

const idle = { status: "idle" as const };

describe("Phase 06 authentication forms", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    Object.values(actions).forEach((action) => action.mockReset());
    actions.loginAction.mockResolvedValue(idle);
    actions.registerCandidateAction.mockResolvedValue(idle);
    actions.registerEmployerAction.mockResolvedValue(idle);
    actions.forgotPasswordAction.mockResolvedValue(idle);
    actions.resetPasswordAction.mockResolvedValue(idle);
    actions.switchCompanyContextAction.mockResolvedValue(idle);
  });

  it("uses password-manager-friendly login fields and carries a local next path", () => {
    render(<LoginForm next="/candidate/dashboard" />);

    expect(screen.getByLabelText("E-Mail-Adresse")).toHaveAttribute(
      "autocomplete",
      "email",
    );
    expect(screen.getByLabelText("Passwort")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    expect(document.querySelector('input[name="next"]')).toHaveValue(
      "/candidate/dashboard",
    );
    expect(screen.getByRole("button", { name: "Sicher anmelden" })).toBeEnabled();
  });

  it("shows the generic login failure returned by the server action", async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    actions.loginAction.mockResolvedValue({
      status: "error",
      message: "E-Mail oder Passwort falsch.",
      values: { email: "missing@example.ch" },
    });
    render(<LoginForm />);

    const initialEmail = screen.getByLabelText("E-Mail-Adresse");
    await user.type(initialEmail, "missing@example.ch");
    await user.type(screen.getByLabelText("Passwort"), "WrongPassword1!");
    await user.click(screen.getByRole("button", { name: "Sicher anmelden" }));

    expect(await screen.findByText("E-Mail oder Passwort falsch.")).toBeInTheDocument();
    const preservedEmail = screen.getByLabelText("E-Mail-Adresse");
    expect(preservedEmail).not.toBe(initialEmail);
    expect(preservedEmail).toHaveValue("missing@example.ch");
    expect(
      consoleError.mock.calls.some(([message]) =>
        String(message).includes(
          "changing the default value state of an uncontrolled FieldControl",
        ),
      ),
    ).toBe(false);
  });

  it("keeps candidate Terms and optional marketing unticked and never bundles Radar", () => {
    render(<CandidateRegistrationForm />);

    expect(screen.getByRole("checkbox", { name: /Nutzungsbedingungen/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Produktneuigkeiten/ })).not.toBeChecked();
    expect(screen.getByText(/Talent Radar ist nicht Teil dieser Registrierung/)).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  it("collects employer claim signals while leaving both consents unticked", () => {
    render(<EmployerRegistrationForm />);

    expect(screen.getByLabelText("Schweizer UID (optional)")).toHaveAttribute(
      "placeholder",
      "CHE-123.456.789",
    );
    expect(screen.getByLabelText("Kanton")).toBeRequired();
    expect(screen.getByLabelText("Unternehmensgrösse")).toBeRequired();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getAllByRole("checkbox")[0]).not.toBeChecked();
    expect(screen.getAllByRole("checkbox")[1]).not.toBeChecked();
    expect(screen.getByText(/verleihen nicht automatisch Eigentum oder Zugriff/)).toBeInTheDocument();
  });

  it("uses an indistinguishable forgot-password explanation", () => {
    render(<ForgotPasswordForm />);

    expect(screen.getByRole("button", { name: "Zurücksetzlink anfordern" })).toBeEnabled();
    expect(screen.getByLabelText("E-Mail-Adresse")).toHaveAttribute("autocomplete", "email");
  });

  it("reads the reset token from the URL fragment, removes it and keeps it only in the POST field", async () => {
    const tokenValue = "one-time-secret-that-is-at-least-thirty-two-bytes";
    window.history.replaceState(
      null,
      "",
      `/reset-password#token=${tokenValue}`,
    );
    render(<ResetPasswordForm />);

    const token = document.querySelector('input[name="token"]');
    expect(token).toHaveAttribute("type", "hidden");
    await waitFor(() => expect(token).toHaveValue(tokenValue));
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/reset-password");
    expect(screen.getAllByLabelText(/Passwort/)).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Passwort sicher ändern" })).toBeEnabled();
  });

  it("never accepts a reset bearer token from the logged HTTP query", async () => {
    window.history.replaceState(
      null,
      "",
      "/reset-password?token=query-secret-that-must-not-be-consumed",
    );
    render(<ResetPasswordForm />);

    expect(
      await screen.findByText(
        "Der Link ist ungültig, abgelaufen oder wurde bereits verwendet.",
      ),
    ).toBeInTheDocument();
    expect(document.querySelector('input[name="token"]')).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Passwort sicher ändern" }),
    ).toBeDisabled();
  });

  it("disables login submission while the action is pending", async () => {
    let resolveAction: ((value: typeof idle) => void) | undefined;
    actions.loginAction.mockImplementation(
      () =>
        new Promise<typeof idle>((resolve) => {
          resolveAction = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText("E-Mail-Adresse"), "user@example.ch");
    await user.type(screen.getByLabelText("Passwort"), "StrongPassword1!");
    await user.click(screen.getByRole("button", { name: "Sicher anmelden" }));

    expect(screen.getByRole("button", { name: "Anmeldung läuft …" })).toBeDisabled();
    resolveAction?.(idle);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sicher anmelden" })).toBeEnabled();
    });
  });
});
