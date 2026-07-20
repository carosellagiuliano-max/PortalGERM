import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppFooter } from "@/components/shared/app-footer";
import { AppHeader } from "@/components/shared/app-header";

describe("public shell components", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers real desktop and mobile navigation targets with keyboard recovery", async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<AppHeader />);

    expect(
      screen.getByRole("link", { name: "SwissTalentHub Startseite" }),
    ).toHaveAttribute("href", "/");
    const desktopNavigation = screen.getByRole("navigation", {
      name: "Hauptnavigation",
    });
    const menuButton = screen.getByRole("button", { name: "Navigation öffnen" });
    expect(desktopNavigation).toHaveClass("lg:flex");
    expect(menuButton).toHaveClass("size-11");
    expectNavigationTargets(desktopNavigation);
    expect(screen.queryByRole("link", { name: "Preise" })).not.toBeInTheDocument();

    menuButton.focus();
    await user.keyboard("{Enter}");
    let mobileNavigation = await screen.findByRole("navigation", {
      name: "Mobile Navigation",
    });
    expectNavigationTargets(mobileNavigation);
    expect(
      screen.getByRole("button", { name: "Navigation schliessen" }),
    ).toHaveClass("size-11");
    expect(
      consoleError.mock.calls.some(([message]) =>
        String(message).includes("expected a native <button>"),
      ),
    ).toBe(false);

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        screen.queryByRole("navigation", { name: "Mobile Navigation" }),
      ).not.toBeInTheDocument();
    });
    expect(menuButton).toHaveFocus();

    await user.keyboard("{Enter}");
    mobileNavigation = await screen.findByRole("navigation", {
      name: "Mobile Navigation",
    });
    const candidateLink = within(mobileNavigation).getByRole("link", {
      name: "Kostenlos starten",
    });
    candidateLink.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });
    await user.click(candidateLink);
    await waitFor(() => {
      expect(
        screen.queryByRole("navigation", { name: "Mobile Navigation" }),
      ).not.toBeInTheDocument();
    });
  });

  it("renders a comprehensive footer without future-route links", () => {
    render(<AppFooter />);

    expect(screen.getByRole("navigation", { name: "Entdecken" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Konto" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Jobs entdecken" })).toHaveAttribute(
      "href",
      "/jobs",
    );
    expect(screen.getByText(/DE-CH · Schweizer Franken/)).toBeInTheDocument();
    expect(screen.getByText(/keine Rechts-, Finanz- oder Lohnberatung/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Preise" })).not.toBeInTheDocument();
  });
});

function expectNavigationTargets(navigation: HTMLElement) {
  const targets = [
    ["Jobs", "/jobs"],
    ["Unternehmen", "/companies"],
    ["Lohn-Radar", "/salary-radar"],
    ["Ratgeber", "/guide"],
    ["Für Arbeitgeber", "/register/employer"],
    ["Kostenlos starten", "/register/candidate"],
    ["Login", "/login"],
  ] as const;

  for (const [label, href] of targets) {
    const link = within(navigation).getByRole("link", { name: label });
    expect(link).toHaveAttribute("href", href);
    expect(link).toHaveClass("h-11");
  }
}
