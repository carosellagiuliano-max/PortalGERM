import type { Metadata } from "next";

import { PrivateShell } from "@/components/auth/private-shell";
import { requireEmployerPage } from "@/lib/auth/route-guards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = {
  title: "Arbeitgeberportal",
  robots: { index: false, follow: false, noarchive: true },
};

const navigation = [
  { href: "/employer/dashboard", label: "Übersicht" },
] as const;

export default async function EmployerLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireEmployerPage();
  return (
    <PrivateShell area="Arbeitgeberportal" navigation={navigation}>
      {children}
    </PrivateShell>
  );
}
