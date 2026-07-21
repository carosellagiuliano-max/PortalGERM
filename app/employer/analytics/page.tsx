import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AnalyticsCards } from "@/components/employer/analytics-cards";
import { getEmployerContext } from "@/lib/auth/employer-context";
import { getDatabase } from "@/lib/db/client";
import { getEmployerAnalyticsData } from "@/lib/employer/analytics";
import { requireEmployerCompanyContext } from "@/lib/employer/context";

export const metadata: Metadata = { title: "Arbeitgeber Analytics" };
export const dynamic = "force-dynamic";

export default async function EmployerAnalyticsPage() {
  const [context, employerContext] = await Promise.all([requireEmployerCompanyContext(), getEmployerContext()]);
  if (employerContext === null) notFound();
  const data = await getEmployerAnalyticsData({
    companyId: context.companyId,
    membershipId: context.membershipId,
    membershipRole: context.membershipRole,
    userId: employerContext.user.id,
  }, getDatabase());
  if (data === null) notFound();
  return (
    <section aria-labelledby="analytics-title" className="grid gap-7">
      <header>
        <p className="eyebrow">Analytics · letzte 30 Tage</p>
        <h1 id="analytics-title" className="mt-2 text-3xl font-semibold tracking-tight">Funnel und Reaktionszeit</h1>
        <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">Datenschutzfreundliche, planabhängige Kennzahlen ohne künstliche Beispielcharts.</p>
      </header>
      <AnalyticsCards data={data} />
    </section>
  );
}
