import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";

import { NewJobWizard } from "@/components/employer/job-wizard/job-wizard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getDatabase } from "@/lib/db/client";
import { requireEmployerCompanyContext } from "@/lib/employer/context";
import { getEmployerJobCatalog, type EmployerJobActor } from "@/lib/employer/jobs";
import { createEmployerJobDraftAction } from "./actions";

export const metadata: Metadata = { title: "Inserat erfassen", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NewEmployerJobPage() {
  const [context, user] = await Promise.all([requireEmployerCompanyContext(), getCurrentUser()]);
  if (user === null) return null;
  const actor: EmployerJobActor = { userId: user.id, email: user.email, membershipId: context.membershipId, membershipRole: context.membershipRole, companyId: context.companyId };
  const catalog = await getEmployerJobCatalog(actor, getDatabase());
  return (
    <section aria-labelledby="new-job-title" className="grid gap-6">
      <div><Link href="/employer/jobs" className={buttonVariants({ variant: "ghost", size: "sm" })}>← Alle Jobs</Link></div>
      <header><p className="eyebrow">Persistierter 5-Schritt-Wizard</p><h1 id="new-job-title" className="mt-2 text-3xl font-semibold tracking-tight">Neues Inserat erfassen</h1><p className="mt-3 max-w-3xl leading-7 text-muted-foreground">Ein Entwurf verbraucht kein aktives Jobkontingent. Publikation bleibt der separaten Moderation vorbehalten.</p></header>
      {context.membershipRole === "VIEWER" ? <Alert><AlertTitle>Nur Leserechte</AlertTitle><AlertDescription>Viewer können die sichere Jobübersicht lesen, aber keinen Entwurf erstellen.</AlertDescription></Alert> : catalog === null ? <Alert><AlertTitle>Firmenkontext nicht verfügbar</AlertTitle><AlertDescription>Bitte lade die Seite neu oder wähle einen aktiven Firmenkontext.</AlertDescription></Alert> : <NewJobWizard catalog={catalog} action={createEmployerJobDraftAction} idempotencyKey={randomUUID()} defaultValidThrough="" />}
    </section>
  );
}
