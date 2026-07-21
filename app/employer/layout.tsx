import type { Metadata } from "next";

import { PrivateShell } from "@/components/auth/private-shell";
import { CompanyContextPicker } from "@/components/employer/company-context-picker";
import { getEmployerContext } from "@/lib/auth/employer-context";
import { requireEmployerPage } from "@/lib/auth/route-guards";
import { getPrismaEffectiveEntitlements } from "@/lib/billing/prisma-publish-quota";
import { getDatabase } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = {
  title: "Arbeitgeberportal",
  robots: { index: false, follow: false, noarchive: true },
};

const navigation = [
  { href: "/employer/dashboard", label: "Dashboard" },
  { href: "/employer/company", label: "Firma" },
  { href: "/employer/team", label: "Team" },
  { href: "/employer/jobs", label: "Jobs" },
  { href: "/employer/applicants", label: "Bewerber:innen" },
  { href: "/employer/talent-radar", label: "Talent Radar" },
  { href: "/employer/analytics", label: "Analytics" },
] as const;

export default async function EmployerLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireEmployerPage();
  const context = await getEmployerContext();
  const current = context?.current ?? null;
  let planLabel = "Free Basic";
  if (current !== null) {
    const result = await getPrismaEffectiveEntitlements(
      current.companyId,
      new Date(),
      getDatabase(),
    );
    if (result.ok) planLabel = formatPlanLabel(result.value.source.planSlug);
  }
  const canSeeTeamNavigation =
    current?.membershipRole === "OWNER" || current?.membershipRole === "ADMIN";
  const visibleNavigation = canSeeTeamNavigation
    ? navigation
    : navigation.filter((item) => item.href !== "/employer/team");
  return (
    <PrivateShell
      area="Arbeitgeberportal"
      navigation={context === null || context.memberships.length === 0 ? [] : visibleNavigation}
      navigationVariant={context === null || context.memberships.length === 0 ? "top" : "sidebar"}
      identity={{
        displayName: user.name ?? user.email,
        secondaryLabel: current?.membershipRole ?? user.role,
      }}
      contextControl={
        context === null || context.memberships.length === 0 ? undefined : (
          <CompanyContextPicker
            memberships={context.memberships}
            current={current}
            planLabel={planLabel}
          />
        )
      }
    >
      {children}
    </PrivateShell>
  );
}

function formatPlanLabel(slug: string) {
  const normalized = slug.trim().toLowerCase();
  return ({
    free: "Free Basic",
    "free-basic": "Free Basic",
    starter: "Starter",
    pro: "Pro",
    business: "Business",
    enterprise: "Enterprise",
  } as const)[normalized as "free"] ?? slug;
}
