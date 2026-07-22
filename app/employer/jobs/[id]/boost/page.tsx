import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BoostDialog } from "@/components/billing/BoostDialog";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getEmployerBoostPurchaseView } from "@/lib/billing/boosts";
import { requireEmployerBillingPage } from "@/lib/billing/employer-page-access";
import { getDatabase } from "@/lib/db/client";

export const metadata: Metadata = {
  title: "Job boosten",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function EmployerJobBoostPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const [{ user, context }, route] = await Promise.all([
    requireEmployerBillingPage(false),
    params,
  ]);
  const view = await getEmployerBoostPurchaseView(
    {
      userId: user.id,
      email: user.email,
      companyId: context.companyId,
      membershipId: context.membershipId,
      membershipRole: context.membershipRole,
    },
    route.id,
    getDatabase(),
  );
  if (view === null) notFound();
  return (
    <section aria-labelledby="boost-title" className="grid gap-7">
      <div>
        <Link href={`/employer/jobs/${view.job.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          ← Zur Stelle
        </Link>
      </div>
      <header>
        <p className="eyebrow">Job Boost</p>
        <h1 id="boost-title" className="mt-2 text-3xl font-semibold tracking-tight">{view.job.title}</h1>
        <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">Wähle eine transparente, sofort startende Sichtbarkeitsphase für diese öffentlich berechtigte Stelle.</p>
      </header>
      <Card>
        <CardHeader><CardTitle as="h2">Stellen-Vorschau</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div><p className="font-medium">{view.job.title}</p><p className="text-sm text-muted-foreground">Stelle läuft bis {formatDate(view.job.expiresAt)}</p></div>
          <Badge variant="secondary">Fair-Job-Score {view.job.fairScore ?? "–"}/100</Badge>
        </CardContent>
      </Card>
      <BoostDialog
        view={view}
        creditIdempotencyKey={randomUUID()}
        cancellationIdempotencyKey={randomUUID()}
      />
    </section>
  );
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Zurich",
  }).format(value);
}
