import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const publicDataContext = vi.hoisted(() => ({ showDemoBanner: true }));

vi.mock("@/lib/public/environment", () => ({
  getPublicDataContext: () => ({
    eligibilityEnvironment: "non-production",
    liveOnly: false,
    publicIndexingAllowed: false,
    showDemoBanner: publicDataContext.showDemoBanner,
  }),
}));
vi.mock("@/components/shared/app-header", () => ({
  AppHeader: () => <header data-testid="public-header" />,
}));
vi.mock("@/components/shared/app-footer", () => ({
  AppFooter: () => <footer data-testid="public-footer" />,
}));

import AuthLayout from "@/app/(auth)/layout";
import PublicLayout from "@/app/(public)/layout";

describe("route group shells", () => {
  beforeEach(() => {
    publicDataContext.showDemoBanner = true;
  });

  it("owns one public main landmark, skip target and persistent demo notice", () => {
    const document = parse(
      <PublicLayout>
        <h1>Öffentlicher Inhalt</h1>
      </PublicLayout>,
    );

    expect(document.querySelectorAll("main")).toHaveLength(1);
    expect(document.querySelector("main#main-content")?.getAttribute("tabindex")).toBe(
      "-1",
    );
    expect(document.querySelector('a[href="#main-content"]')?.textContent).toContain(
      "Zum Inhalt springen",
    );
    expect(document.querySelector('[data-testid="public-header"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="public-footer"]')).not.toBeNull();
    expect(document.body.textContent).toContain(
      "Demo-Daten – keine reale Marktaktivität.",
    );
  });

  it("hides the demo notice outside local and preview mode", () => {
    publicDataContext.showDemoBanner = false;
    const document = parse(<PublicLayout>Live-Inhalt</PublicLayout>);

    expect(document.body.textContent).not.toContain("Demo-Daten");
  });

  it("gives auth pages a reduced brand shell with one main and no public chrome", () => {
    const document = parse(<AuthLayout>Anmeldeformular</AuthLayout>);

    expect(document.querySelectorAll("main")).toHaveLength(1);
    expect(document.querySelector("main#main-content")?.textContent).toContain(
      "Anmeldeformular",
    );
    expect(document.querySelector('a[href="#main-content"]')).not.toBeNull();
    expect(
      document.querySelector('a[aria-label="SwissTalentHub Startseite"]'),
    ).not.toBeNull();
    expect(
      [...document.querySelectorAll('a[href="/"]')].some((link) =>
        link.textContent?.includes("Zur Startseite"),
      ),
    ).toBe(true);
    expect(document.querySelector('[data-testid="public-header"]')).toBeNull();
    expect(document.querySelector('[data-testid="public-footer"]')).toBeNull();
  });
});

function parse(node: ReactNode) {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}
