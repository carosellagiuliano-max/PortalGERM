import type { Metadata } from "next";
import "@fontsource-variable/inter";

import { AppProviders } from "@/components/shared/app-providers";
import { getServerEnvironment } from "@/lib/config/env";

import "./globals.css";

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(getServerEnvironment().APP_URL),
    title: {
      default: "SwissTalentHub",
      template: "%s · SwissTalentHub",
    },
    description:
      "Faire Jobtransparenz, Lohnorientierung und datenschutzfreundliche Zugänge für Kandidat:innen und Arbeitgeber.",
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de-CH" suppressHydrationWarning data-scroll-behavior="smooth">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
