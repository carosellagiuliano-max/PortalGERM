import type { Metadata } from "next";

import { UsageBars } from "@/components/billing/usage-bars";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireEmployerBillingPage } from "@/lib/billing/employer-page-access";
import {
  canStartEmployerPlanChange,
  getEmployerBillingUsage,
} from "@/lib/billing/employer-read-model";
import { getDatabase } from "@/lib/db/client";

export const metadata: Metadata = { title: "Plan-Nutzung" };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function EmployerBillingUsagePage() {
  const { context } = await requireEmployerBillingPage();
  const database = getDatabase();
  const now = new Date();
  const [usage, canStartPlanChange] = await Promise.all([
    getEmployerBillingUsage(database, context.companyId, now),
    canStartEmployerPlanChange(database, context.companyId, now),
  ]);
  return (
    <section aria-labelledby="billing-usage-title" className="grid gap-7">
      <header><p className="eyebrow">Billing · Nutzung</p><h1 id="billing-usage-title" className="mt-2 text-3xl font-semibold tracking-tight">Planlimiten und Guthaben</h1><p className="mt-3 max-w-3xl leading-7 text-muted-foreground">Nutzung wird am aktuellen Zeitpunkt serverseitig aus wirksamen Entitlements, Ressourcen und dem unveränderlichen Credit Ledger abgeleitet.</p></header>
      {usage === null ? <Alert variant="destructive"><AlertTitle>Nutzung nicht verfügbar</AlertTitle><AlertDescription>Die Planrechte sind nicht eindeutig. Bis zur Klärung werden keine erweiterten Rechte angenommen.</AlertDescription></Alert> : <UsageBars usage={usage} canManagePlan={context.membershipRole === "OWNER"} canStartPlanChange={canStartPlanChange} />}
    </section>
  );
}
