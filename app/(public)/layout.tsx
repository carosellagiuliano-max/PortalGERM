import type { Metadata } from "next";

import { DemoDataBanner } from "@/components/layout/demo-data-banner";
import { SkipLink } from "@/components/layout/skip-link";
import { AppFooter } from "@/components/shared/app-footer";
import { AppHeader } from "@/components/shared/app-header";
import { getPublicDataContext } from "@/lib/public/environment";

const PUBLIC_DESCRIPTION =
  "Faire Jobtransparenz, Lohnorientierung und datenschutzfreundliche Zugänge für Kandidat:innen und Arbeitgeber.";

export function generateMetadata(): Metadata {
  const defaults: Metadata = {
    title: {
      default: "SwissTalentHub",
      template: "%s | SwissTalentHub",
    },
    description: PUBLIC_DESCRIPTION,
    openGraph: {
      type: "website",
      locale: "de_CH",
      siteName: "SwissTalentHub",
      title: "SwissTalentHub",
      description: PUBLIC_DESCRIPTION,
    },
    twitter: {
      card: "summary_large_image",
      title: "SwissTalentHub",
      description: PUBLIC_DESCRIPTION,
    },
  };
  return getPublicDataContext().publicIndexingAllowed
    ? defaults
    : {
        ...defaults,
        robots: { index: false, follow: false, noarchive: true, nosnippet: true },
      };
}

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const publicData = getPublicDataContext();

  return (
    <>
      <SkipLink />
      <div className="flex min-h-screen flex-col">
        <AppHeader />
        {publicData.showDemoBanner ? <DemoDataBanner /> : null}
        <main id="main-content" className="flex-1" tabIndex={-1}>
          {children}
        </main>
        <AppFooter />
      </div>
    </>
  );
}
