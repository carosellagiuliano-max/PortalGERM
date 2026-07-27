import type { Metadata } from "next";

import { PrivateShell } from "@/components/auth/private-shell";
import {
  AdminGlobalSearch,
  getAdminNavigation,
} from "@/components/admin/Sidebar";
import { requireAdminPage } from "@/lib/auth/route-guards";

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
  return (
    <PrivateShell area="Administration" navigation={getAdminNavigation(user.capabilities)} navigationVariant="sidebar" identity={{ displayName: user.name ?? "Platform Admin", secondaryLabel: user.email }} contextControl={<AdminGlobalSearch enabled={user.capabilities.includes("ADMIN_GLOBAL_SEARCH")} />}>
      {children}
    </PrivateShell>
  );
}
