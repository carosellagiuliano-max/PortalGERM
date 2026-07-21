import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Dashboard } from "@/components/employer/dashboard";
import { getEmployerContext } from "@/lib/auth/employer-context";
import { getDatabase } from "@/lib/db/client";
import { getEmployerDashboardData } from "@/lib/employer/dashboard";

export const metadata: Metadata = { title: "Arbeitgeberübersicht" };

export default async function EmployerDashboardPage() {
  const context = await getEmployerContext();
  const memberships = context?.memberships ?? [];
  const current = context?.current ?? null;

  if (current !== null) {
    const data = await getEmployerDashboardData({
      companyId: current.companyId,
      membershipId: current.membershipId,
      membershipRole: current.membershipRole,
      userId: context!.user.id,
    }, getDatabase());
    if (data === null) notFound();
    return <Dashboard data={data} />;
  }

  return (
    <section aria-labelledby="employer-dashboard-title">
      <p className="eyebrow">Übersicht</p>
      <h1 id="employer-dashboard-title" className="mt-2 text-3xl font-semibold tracking-tight">
        Willkommen im Arbeitgeberportal
      </h1>
      <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
        Dein persönlicher Zugang ist aktiv. Firmenkontext und Mitgliedschaft werden bei
        jedem Aufruf serverseitig erneut geprüft.
      </p>
      <p className="mt-8 rounded-xl border bg-card p-5 text-muted-foreground">
        {memberships.length === 0
          ? "Noch kein aktiver Firmenzugang. Den Status findest du unter Firmenzugang prüfen."
          : "Wähle oben einen Firmenkontext, um die echten Kennzahlen zu laden."}
      </p>
    </section>
  );
}
