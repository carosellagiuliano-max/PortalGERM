import type { Metadata } from "next";
import "@fontsource-variable/inter";

import { AppFooter } from "@/components/shared/app-footer";
import { AppHeader } from "@/components/shared/app-header";
import { AppProviders } from "@/components/shared/app-providers";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "SwissTalentHub · Foundation",
    template: "%s · SwissTalentHub",
  },
  description:
    "Technische Grundlage für das geplante SwissTalentHub MVP. Produktfunktionen folgen in späteren Phasen.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de-CH" suppressHydrationWarning>
      <body>
        <AppProviders>
          <a
            href="#main-content"
            className="fixed top-2 left-2 z-[100] -translate-y-20 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform focus:translate-y-0"
          >
            Zum Inhalt springen
          </a>
          <div className="flex min-h-screen flex-col">
            <AppHeader />
            <main id="main-content" className="flex-1" tabIndex={-1}>
              {children}
            </main>
            <AppFooter />
          </div>
        </AppProviders>
      </body>
    </html>
  );
}
