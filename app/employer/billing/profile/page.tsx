import type { Metadata } from "next";
import Link from "next/link";

import { BillingProfileForm } from "@/components/billing/billing-profile-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireEmployerBillingPage } from "@/lib/billing/employer-page-access";
import { getCompanyBillingProfile } from "@/lib/billing/employer-read-model";
import { getDatabase } from "@/lib/db/client";

export const metadata: Metadata = { title: "Rechnungsprofil" };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function EmployerBillingProfilePage() {
  const { context } = await requireEmployerBillingPage();
  const profile = await getCompanyBillingProfile(getDatabase(), context.companyId);
  return (
    <section aria-labelledby="billing-profile-title" className="grid gap-7">
      <header>
        <p className="eyebrow">Billing · Rechnungsprofil</p>
        <h1 id="billing-profile-title" className="mt-2 text-3xl font-semibold tracking-tight">Rechnungsangaben</h1>
        <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
          Die aktuelle Adresse wird nur beim Erstellen einer Bestellung gelesen. Bereits
          ausgestellte Bestellungen und Rechnungen behalten ihre damaligen Snapshots.
        </p>
      </header>
      {profile === null ? <Alert><AlertTitle>Noch unvollständig</AlertTitle><AlertDescription>Ohne vollständiges Schweizer Rechnungsprofil wird serverseitig keine Bestellung erstellt.</AlertDescription></Alert> : null}
      <Card>
        <CardHeader><CardTitle as="h2">Schweizer Rechnungsprofil</CardTitle><CardDescription>Bearbeitbar für aktive Owner- und Admin-Mitgliedschaften.</CardDescription></CardHeader>
        <CardContent><BillingProfileForm profile={profile} /></CardContent>
      </Card>
      <Link href="/employer/billing" className={buttonVariants({ variant: "outline" })}>Zurück zur Billing-Übersicht</Link>
    </section>
  );
}
