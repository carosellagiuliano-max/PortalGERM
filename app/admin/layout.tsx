import type { Metadata } from "next";

import { PrivateShell } from "@/components/auth/private-shell";
import { requireAdminPage } from "@/lib/auth/route-guards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = {
  title: "Administration",
  robots: { index: false, follow: false, noarchive: true },
};

const navigation = [{ href: "/admin", label: "Übersicht" }] as const;

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireAdminPage();
  return (
    <PrivateShell area="Administration" navigation={navigation}>
      {children}
    </PrivateShell>
  );
}
