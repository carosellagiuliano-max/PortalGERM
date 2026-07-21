import type { Metadata } from "next";
import { Clock3Icon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClaimPendingActions } from "@/components/employer/claim-pending-actions";
import { requirePendingCompanyClaimPage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";

export const metadata: Metadata = { title: "Firmenanspruch in Prüfung" };

export default async function CompanyClaimPendingPage() {
  const user = await requirePendingCompanyClaimPage();
  const claim = await getDatabase().companyClaimRequest.findFirstOrThrow({
    where: { requesterEmployerUserId: user.id, status: { in: ["PENDING", "NEEDS_EVIDENCE"] } },
    select: { status: true, evidenceSummary: true, updatedAt: true },
  });
  return (
    <section aria-labelledby="claim-title" className="max-w-3xl">
      <p className="eyebrow">Firmenzugang</p>
      <h1 id="claim-title" className="mt-2 text-3xl font-semibold tracking-tight">
        Dein Firmenanspruch wird geprüft
      </h1>
      <Card className="mt-7 border-primary/15">
        <CardHeader>
          <span className="mb-2 grid size-11 place-items-center rounded-lg bg-secondary text-secondary-foreground">
            <Clock3Icon className="size-5" aria-hidden="true" />
          </span>
          <CardTitle as="h2">Noch kein Unternehmenszugriff</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 leading-6 text-muted-foreground">
          <p>
            Wir haben anhand begrenzter Abgleichsignale ein mögliches bestehendes
            Unternehmen erkannt. Deshalb wurde kein neues Unternehmen und keine
            Mitgliedschaft automatisch angelegt.
          </p>
          <p>
            Ein Admin prüft den Anspruch und fordert bei Bedarf Nachweise an. Bis zur
            ausdrücklichen Freigabe kannst du keine Unternehmensdaten lesen oder ändern.
          </p>
        </CardContent>
      </Card>
      <div className="mt-6">
        <p className="mb-4 text-sm text-muted-foreground">Status: {claim.status === "NEEDS_EVIDENCE" ? "Nachweis angefordert" : "In Prüfung"} · aktualisiert {new Intl.DateTimeFormat("de-CH").format(claim.updatedAt)}</p>
        <ClaimPendingActions existingEvidence={claim.evidenceSummary} />
      </div>
    </section>
  );
}
