import type { Metadata } from "next";

import { PrivateShell } from "@/components/auth/private-shell";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = {
  title: "Kandidatenportal",
  robots: { index: false, follow: false, noarchive: true },
};

const navigation = [
  { href: "/candidate/dashboard", label: "Übersicht" },
  { href: "/candidate/jobpass", label: "SwissJobPass" },
  { href: "/candidate/saved-jobs", label: "Gespeicherte Jobs" },
  { href: "/candidate/applications", label: "Bewerbungen" },
  { href: "/candidate/alerts", label: "Jobabos" },
  { href: "/candidate/messages", label: "Nachrichten" },
  { href: "/candidate/privacy", label: "Privatsphäre" },
] as const;

export default async function CandidateLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireCandidatePage();
  const profile = await getDatabase().candidateProfile.findUnique({
    where: { userId: user.id },
    select: { firstName: true, lastName: true, publicDisplayName: true },
  });
  const legalName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ");
  const displayName = profile?.publicDisplayName?.trim() || legalName || user.name || user.email;
  return (
    <PrivateShell
      area="Kandidatenportal"
      navigation={navigation}
      navigationVariant="sidebar"
      identity={{ displayName, secondaryLabel: "Kandidat/in" }}
    >
      {children}
    </PrivateShell>
  );
}
