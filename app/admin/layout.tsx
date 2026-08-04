import type { Metadata } from "next";

import { PrivateShell } from "@/components/auth/private-shell";
import { PersonaContextSwitcher } from "@/components/auth/persona-context-switcher";
import {
  AdminGlobalSearch,
  getAdminNavigation,
} from "@/components/admin/Sidebar";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getCurrentPersonaContextOverview } from "@/lib/auth/persona-page";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = {
  title: "Administration",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireAdminPage();
  const personaOverview = await getCurrentPersonaContextOverview();
  return (
    <PrivateShell
      area="Administration"
      navigation={getAdminNavigation(user.capabilities)}
      navigationVariant="sidebar"
      identity={{
        displayName: user.name ?? "Platform Admin",
        secondaryLabel: user.email,
      }}
      sessionRotationDelayMilliseconds={user.sessionRotationDelayMilliseconds}
      contextControl={
        <div className="grid min-w-0 gap-3">
          {personaOverview === null ? null : (
            <PersonaContextSwitcher
              activePortal={personaOverview.activePortal}
              portals={personaOverview.portals}
              companies={personaOverview.companies}
              compact
            />
          )}
          <AdminGlobalSearch
            enabled={user.capabilities.includes("ADMIN_GLOBAL_SEARCH")}
          />
        </div>
      }
    >
      {children}
    </PrivateShell>
  );
}
