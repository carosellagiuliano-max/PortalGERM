import type { Metadata } from "next";

import { PrivateShell } from "@/components/auth/private-shell";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { getServerEnvironment } from "@/lib/config/env";
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
  { href: "/candidate/notifications", label: "Benachrichtigungen" },
] as const;

export default async function CandidateLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireCandidatePage();
  const environment = getServerEnvironment();
  if (
    environment.IDENTITY_VERIFICATION_ENFORCEMENT &&
    (user.emailVerifiedAt === null ||
      user.identityAssurance !== "VERIFIED_EMAIL")
  ) {
    return (
      <PrivateShell
        area="Kandidatenportal"
        navigation={[
          {
            href: "/candidate/notifications",
            label: "Identität & Benachrichtigungen",
          },
        ]}
        navigationVariant="top"
        identity={{
          displayName: user.name ?? user.email,
          secondaryLabel: "E-Mail-Bestätigung ausstehend",
        }}
      >
        {children}
      </PrivateShell>
    );
  }
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
