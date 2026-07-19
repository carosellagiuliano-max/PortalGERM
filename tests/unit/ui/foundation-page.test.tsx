import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import FoundationPage from "@/app/(public)/page";
import NotFound from "@/app/not-found";
import { AppHeader } from "@/components/shared/app-header";

describe("foundation UI", () => {
  it("states the current scope honestly and exposes no fake product action", () => {
    render(<FoundationPage />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Eine belastbare Grundlage, bevor Produktfunktionen entstehen.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Jobsuche, Anmeldung, Portale und Billing sind noch nicht verfügbar/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Technischer Foundation-Umfang",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Sichere Konfiguration" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("offers real desktop and mobile navigation targets", async () => {
    const user = userEvent.setup();
    render(<AppHeader />);

    expect(
      screen.getByRole("link", { name: "SwissTalentHub Startseite" }),
    ).toHaveAttribute("href", "/");
    const desktopNavigation = screen.getByRole("navigation", {
      name: "Hauptnavigation",
    });
    const menuButton = screen.getByRole("button", { name: "Navigation öffnen" });
    expect(desktopNavigation).toBeInTheDocument();
    expect(menuButton).toBeInTheDocument();
    expectNavigationTargets(desktopNavigation);

    menuButton.focus();
    await user.keyboard("{Enter}");
    let mobileNavigation = await screen.findByRole("navigation", {
      name: "Mobile Navigation",
    });
    expectNavigationTargets(mobileNavigation);

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

    await user.click(
      within(mobileNavigation).getByRole("link", { name: "Grundlage" }),
    );
    await waitFor(() => {
      expect(
        screen.queryByRole("navigation", { name: "Mobile Navigation" }),
      ).not.toBeInTheDocument();
    });
  });

  it("provides a useful 404 recovery link", () => {
    render(<NotFound />);

    expect(
      screen.getByRole("heading", { name: "Diese Seite ist nicht verfügbar." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Zur Foundation/ })).toHaveAttribute(
      "href",
      "/",
    );
  });
});

function expectNavigationTargets(navigation: HTMLElement) {
  expect(within(navigation).getByRole("link", { name: "Grundlage" })).toHaveAttribute(
    "href",
    "/#foundation",
  );
  expect(
    within(navigation).getByRole("link", { name: "Projektstatus" }),
  ).toHaveAttribute("href", "/#status");
  expect(within(navigation).getByRole("link", { name: "Live-Status" })).toHaveAttribute(
    "href",
    "/health/live",
  );
}
