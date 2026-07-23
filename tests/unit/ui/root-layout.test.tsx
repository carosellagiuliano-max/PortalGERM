import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: () => ({ APP_URL: "http://localhost:3000" }),
}));
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      "x-nonce": "0123456789abcdef0123456789abcdef",
    }),
}));

vi.mock("@/components/shared/app-providers", () => ({
  AppProviders: ({ children }: { children: ReactNode }) => children,
}));

import RootLayout, { generateMetadata } from "@/app/layout";

describe("root layout", () => {
  it("provides an absolute metadata base for relative canonical URLs", () => {
    const metadata = generateMetadata();

    expect(metadata.metadataBase).toBeInstanceOf(URL);
    if (!(metadata.metadataBase instanceof URL)) {
      throw new TypeError("Expected an absolute metadata base URL.");
    }
    expect(metadata.metadataBase.protocol).toMatch(/^https?:$/u);
  });

  it("sets de-CH and delegates route chrome to nested layouts", async () => {
    const markup = renderToStaticMarkup(
      await RootLayout({
        children: <p>Testinhalt</p>,
      }),
    );
    const document = new DOMParser().parseFromString(markup, "text/html");

    expect(document.documentElement.lang).toBe("de-CH");
    expect(document.body.textContent).toContain("Testinhalt");
    expect(document.querySelector('a[href="#main-content"]')).toBeNull();
    expect(document.querySelector("main")).toBeNull();
    expect(document.querySelector("header")).toBeNull();
    expect(document.querySelector("footer")).toBeNull();
  });
});
