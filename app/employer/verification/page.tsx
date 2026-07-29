import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "@/components/shared/app-link";
import { notFound } from "next/navigation";

import { CompanyTrustWorkflow } from "@/components/employer/company-trust-workflow";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireEmployerPage } from "@/lib/auth/route-guards";
import { companyVerificationRuntimeFlags } from "@/lib/companies/verification/composition";
import { getCompanyVerificationOwnerWorkspace } from "@/lib/companies/verification/owner-read-model";
import { getDatabase } from "@/lib/db/client";
import { requireEmployerCompanyContext } from "@/lib/employer/context";

export const metadata: Metadata = {
  title: "Firmenidentität prüfen",
  robots: { index: false, follow: false, noarchive: true },
};
export const dynamic = "force-dynamic";

export default async function EmployerCompanyVerificationPage() {
  const [user, context] = await Promise.all([
    requireEmployerPage(),
    requireEmployerCompanyContext(),
  ]);
  const workspace = await getCompanyVerificationOwnerWorkspace(getDatabase(), {
    actorUserId: user.id,
    companyId: context.companyId,
    membershipId: context.membershipId,
    now: new Date(),
  });
  if (workspace === null) notFound();
  const runtime = companyVerificationRuntimeFlags();

  return (
    <section className="grid gap-7" aria-labelledby="company-trust-title">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Firma · Trust</p>
          <h1 id="company-trust-title" className="mt-2 text-3xl font-semibold tracking-tight">
            Firmenidentität prüfen
          </h1>
          <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
            Register, Domainkontrolle, unabhängige Entscheidung, Ablauf und
            Widerruf bilden einen gemeinsamen, nachvollziehbaren Prüfprozess.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{workspace.company.name}</Badge>
          <Link href="/employer/company" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Zum Firmenprofil
          </Link>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Was das Abzeichen aussagt</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm leading-6 text-muted-foreground sm:grid-cols-3">
          <p><strong className="text-foreground">Umfang:</strong> UID-Register und Kontrolle der angegebenen Domain.</p>
          <p><strong className="text-foreground">Nicht enthalten:</strong> Bonität, jede einzelne Stelle oder generelle Betrugsfreiheit.</p>
          <p><strong className="text-foreground">Fail-closed:</strong> Ablauf, Hold oder Widerruf sperrt Badge, öffentliche Jobs und Radar beim nächsten Read.</p>
        </CardContent>
      </Card>

      <CompanyTrustWorkflow
        workspace={workspace}
        activation={runtime.activation}
        stepUpRequired={runtime.stepUpMode === "enforce"}
        idempotencyKeys={{
          begin: randomUUID(),
          domain: randomUUID(),
          appeal: randomUUID(),
        }}
      />
    </section>
  );
}
