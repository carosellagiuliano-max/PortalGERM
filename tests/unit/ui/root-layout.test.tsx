import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/shared/app-header", () => ({
  AppHeader: () => <header data-testid="app-header" />,
}));
vi.mock("@/components/shared/app-footer", () => ({
  AppFooter: () => <footer data-testid="app-footer" />,
}));
vi.mock("@/components/shared/app-providers", () => ({
  AppProviders: ({ children }: { children: ReactNode }) => children,
}));

import RootLayout from "@/app/layout";

describe("root layout", () => {
  it("sets de-CH and exposes a keyboard skip target around every page", () => {
    const markup = renderToStaticMarkup(
      <RootLayout>
        <p>Testinhalt</p>
      </RootLayout>,
    );
    const document = new DOMParser().parseFromString(markup, "text/html");

    expect(document.documentElement.lang).toBe("de-CH");
    expect(document.querySelector('a[href="#main-content"]')?.textContent).toContain(
      "Zum Inhalt springen",
    );
    expect(document.querySelector("main#main-content")?.getAttribute("tabindex")).toBe(
      "-1",
    );
    expect(document.querySelector("main#main-content")?.textContent).toContain(
      "Testinhalt",
    );
    expect(document.querySelector('[data-testid="app-header"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="app-footer"]')).not.toBeNull();
  });
});
