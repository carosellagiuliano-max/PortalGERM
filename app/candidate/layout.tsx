import type { Metadata } from "next";

import { PrivateShell } from "@/components/auth/private-shell";
import { PersonaContextSwitcher } from "@/components/auth/persona-context-switcher";
import { getCurrentPersonaContextOverview } from "@/lib/auth/persona-page";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { isRecruitingFeatureAvailableV1 } from "@/lib/recruiting/feature-gates";

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
  { href: "/candidate/settings/security", label: "Sicherheit" },
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
  const database = getDatabase();
  const [profile, personaOverview, externalHistoryCount, interviewHistoryCount] =
    await Promise.all([
    database.candidateProfile.findUnique({
      where: { userId: user.id },
      select: { firstName: true, lastName: true, publicDisplayName: true },
    }),
    getCurrentPersonaContextOverview(),
    database.externalApplicationTracker.count({
      where: { candidateProfile: { userId: user.id } },
    }),
    database.interview.count({
      where: {
        candidateProfile: { userId: user.id },
        participants: {
          some: { userId: user.id, kind: "CANDIDATE" },
        },
      },
    }),
  ]);
  const legalName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ");
  const displayName = profile?.publicDisplayName?.trim() || legalName || user.name || user.email;
  const visibleNavigation = navigation.flatMap((item) =>
    item.href !== "/candidate/applications"
      ? [item]
      : [
          item,
          ...(isRecruitingFeatureAvailableV1(
            environment,
            "external_application_tracker",
          ) || externalHistoryCount > 0
            ? [
                {
                  href: "/candidate/applications/external",
                  label: "Externe Verläufe",
                },
              ]
            : []),
          ...(isRecruitingFeatureAvailableV1(
            environment,
            "interview_scheduler",
          ) || interviewHistoryCount > 0
            ? [{ href: "/candidate/interviews", label: "Interviews" }]
            : []),
        ],
  );
  return (
    <PrivateShell
      area="Kandidatenportal"
      navigation={visibleNavigation}
      navigationVariant="sidebar"
      identity={{ displayName, secondaryLabel: "Kandidat/in" }}
      contextControl={
        personaOverview === null ? undefined : (
          <PersonaContextSwitcher
            activePortal={personaOverview.activePortal}
            portals={personaOverview.portals}
            companies={personaOverview.companies}
            compact
          />
        )
      }
    >
      {children}
    </PrivateShell>
  );
}
