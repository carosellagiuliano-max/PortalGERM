import type { Metadata } from "next";

import { DemoDataBanner } from "@/components/layout/demo-data-banner";
import { SkipLink } from "@/components/layout/skip-link";
import { AppFooter } from "@/components/shared/app-footer";
import { AppHeader } from "@/components/shared/app-header";
import { getPublicDataContext } from "@/lib/public/environment";

export function generateMetadata(): Metadata {
  return getPublicDataContext().publicIndexingAllowed
    ? {}
    : { robots: { index: false, follow: false, noarchive: true, nosnippet: true } };
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
