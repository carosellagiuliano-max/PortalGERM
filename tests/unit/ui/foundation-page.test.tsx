import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import HomePage from "@/app/(public)/page";
import NotFound from "@/app/not-found";
import { AppHeader } from "@/components/shared/app-header";

describe("public account entry UI", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers the implemented authentication entrances without stale Foundation copy", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Sicher starten – als Talent oder Arbeitgeber.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Registrierung, Anmeldung und geschützte Portale/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Zugriff wird serverseitig entschieden",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Für Kandidat:innen" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Kandidatenkonto erstellen" })[0]).toHaveAttribute(
      "href",
      "/register/candidate",
    );
    expect(screen.getByRole("link", { name: "Arbeitgeberkonto erstellen" })).toHaveAttribute(
      "href",
      "/register/employer",
    );
    expect(screen.queryByText(/noch nicht verfügbar/)).not.toBeInTheDocument();
  });

  it("offers real desktop and mobile navigation targets", async () => {
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
    expect(desktopNavigation).toBeInTheDocument();
    expect(menuButton).toBeInTheDocument();
    expectNavigationTargets(desktopNavigation);

    menuButton.focus();
    await user.keyboard("{Enter}");
    let mobileNavigation = await screen.findByRole("navigation", {
      name: "Mobile Navigation",
    });
    expectNavigationTargets(mobileNavigation);
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
      name: "Für Kandidat:innen",
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

  it("provides a useful 404 recovery link", () => {
    render(<NotFound />);

    expect(
      screen.getByRole("heading", { name: "Diese Seite ist nicht verfügbar." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Zur Startseite/ })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: /Zur Anmeldung/ })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByText(/öffentliche Jobsuche folgt/)).toBeInTheDocument();
  });
});

function expectNavigationTargets(navigation: HTMLElement) {
  expect(
    within(navigation).getByRole("link", { name: "Für Kandidat:innen" }),
  ).toHaveAttribute("href", "/register/candidate");
  expect(within(navigation).getByRole("link", { name: "Für Arbeitgeber" })).toHaveAttribute(
    "href",
    "/register/employer",
  );
  expect(within(navigation).getByRole("link", { name: "Anmelden" })).toHaveAttribute(
    "href",
    "/login",
  );
}
