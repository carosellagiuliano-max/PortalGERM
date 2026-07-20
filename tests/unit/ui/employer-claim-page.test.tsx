import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  getEmployerRegistrationClaimDefaults: vi.fn(),
  registerEmployerAction: vi.fn(async () => ({ status: "idle" as const })),
}));

vi.mock("@/lib/auth/server-actions", () => actions);

import EmployerRegistrationPage from "@/app/(auth)/register/employer/page";

describe("employer claim registration page", () => {
  beforeEach(() => {
    actions.getEmployerRegistrationClaimDefaults.mockReset();
    actions.registerEmployerAction.mockClear();
  });

  it("does not invoke claim resolution for an ordinary registration URL", async () => {
    render(
      await EmployerRegistrationPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(actions.getEmployerRegistrationClaimDefaults).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Unternehmensname")).toHaveValue("");
    expect(document.querySelector('input[name="claim"]')).toBeNull();
  });

  it("shows canonical defaults and carries the exact verified pair", async () => {
    actions.getEmployerRegistrationClaimDefaults.mockResolvedValue({
      companyId: "22222222-2222-4222-8222-222222222222",
      companySlug: "musterfirma-ag",
      companyName: "Musterfirma AG",
      cantonCode: "ZH",
    });

    render(
      await EmployerRegistrationPage({
        searchParams: Promise.resolve({
          claim: "musterfirma-ag",
          intent: "signed-intent",
          next: "https://attacker.invalid",
        }),
      }),
    );

    expect(actions.getEmployerRegistrationClaimDefaults).toHaveBeenCalledWith(
      "musterfirma-ag",
      "signed-intent",
    );
    expect(screen.getByLabelText("Unternehmensname")).toHaveValue(
      "Musterfirma AG",
    );
    expect(document.querySelector('input[name="claim"]')).toHaveValue(
      "musterfirma-ag",
    );
    expect(document.querySelector('input[name="intent"]')).toHaveValue(
      "signed-intent",
    );
    expect(document.querySelector('input[name="next"]')).toBeNull();
    expect(screen.queryByText(/attacker\.invalid/u)).not.toBeInTheDocument();
  });

  it.each([
    ["half-present", { claim: "musterfirma-ag" }],
    ["duplicate", { claim: ["musterfirma-ag"], intent: "signed-intent" }],
  ])("rejects a %s query generically without resolving it", async (_label, query) => {
    render(
      await EmployerRegistrationPage({
        searchParams: Promise.resolve(query),
      }),
    );

    expect(actions.getEmployerRegistrationClaimDefaults).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Link nicht verwendbar" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Unternehmensname")).not.toBeInTheDocument();
  });

  it("rejects a forged or expired pair with the same generic page", async () => {
    actions.getEmployerRegistrationClaimDefaults.mockResolvedValue(null);

    render(
      await EmployerRegistrationPage({
        searchParams: Promise.resolve({
          claim: "musterfirma-ag",
          intent: "invalid-or-expired",
        }),
      }),
    );

    expect(screen.getByText(/ungültig oder abgelaufen/u)).toBeInTheDocument();
    expect(screen.queryByLabelText("Unternehmensname")).not.toBeInTheDocument();
  });
});
