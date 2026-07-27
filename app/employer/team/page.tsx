import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { InvitationForm } from "@/components/employer/invitation-form";
import { TeamList } from "@/components/employer/team-list";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getDatabase } from "@/lib/db/client";
import { getServerEnvironment } from "@/lib/config/env";
import { canManageCompany, requireEmployerCompanyContext } from "@/lib/employer/context";
import { getEmployerTeam } from "@/lib/employer/team";

export const metadata: Metadata = { title: "Team und Zuweisungen" };
export const dynamic = "force-dynamic";

export default async function EmployerTeamPage() {
  const [context, user] = await Promise.all([
    requireEmployerCompanyContext(),
    getCurrentUser(),
  ]);
  if (user === null) notFound();
  const canManage = canManageCompany(context.membershipRole);
  if (!canManage) notFound();
  const data = await getEmployerTeam(
    context.companyId,
    {
      userId: user.id,
      membershipId: context.membershipId,
      role: context.membershipRole,
    },
    getDatabase(),
  );
  if (data === null) notFound();
  const stepUpRequired =
    getServerEnvironment().PRIVILEGED_STEP_UP_MODE === "enforce";
  return <section aria-labelledby="team-title" className="grid gap-7"><header><p className="eyebrow">Firma</p><h1 id="team-title" className="mt-2 text-3xl font-semibold tracking-tight">Team und Job-Zuweisungen</h1><p className="mt-3 max-w-3xl leading-7 text-muted-foreground">Rollen, reservierte Sitzplätze und Recruiter-Zugriffe werden serverseitig je Firmenkontext geprüft.</p></header>{canManage ? <InvitationForm companyId={context.companyId} stepUpRequired={stepUpRequired} /> : null}<TeamList data={data} canManage={canManage} companyId={context.companyId} stepUpRequired={stepUpRequired} /></section>;
}
