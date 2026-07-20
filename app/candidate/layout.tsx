import type { Metadata } from "next";

import { PrivateShell } from "@/components/auth/private-shell";
import { requireCandidatePage } from "@/lib/auth/route-guards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = {
  title: "Kandidatenportal",
  robots: { index: false, follow: false, noarchive: true },
};

const navigation = [
  { href: "/candidate/dashboard", label: "Übersicht" },
  { href: "/candidate/jobpass", label: "SwissJobPass" },
] as const;

export default async function CandidateLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireCandidatePage();
  return (
    <PrivateShell area="Kandidatenportal" navigation={navigation}>
      {children}
    </PrivateShell>
  );
}
