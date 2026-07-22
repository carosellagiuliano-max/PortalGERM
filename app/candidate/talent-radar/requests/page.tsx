import type { Metadata } from "next";
import Link from "next/link";
import { Building2Icon, InboxIcon, ShieldCheckIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import {
  listCandidateRadarRequests,
  type CandidateRadarRequestStatus,
} from "@/lib/talentradar/candidate-request-view";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = {
  title: "Talent-Radar-Kontaktanfragen",
  robots: { index: false, follow: false, noarchive: true },
};
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function CandidateRadarRequestsPage() {
  const user = await requireCandidatePage();
  const requests = await listCandidateRadarRequests(getDatabase(), user.id);

  return (
    <section aria-labelledby="radar-requests-title" className="grid max-w-5xl gap-7">
      <div>
        <Link
          href="/candidate/talent-radar"
          className={buttonVariants({ variant: "ghost" })}
        >
          ← Zurück zum Talent Radar
        </Link>
        <p className="eyebrow mt-5">Wer hat dich kontaktiert?</p>
        <h1
          id="radar-requests-title"
          className="mt-2 text-3xl font-semibold tracking-tight"
        >
          Talent-Radar-Kontaktanfragen
        </h1>
        <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
          Hier entscheidest du über jede Anfrage. Eine Annahme eröffnet zunächst
          nur ein anonymes Gespräch. Identität bleibt anonym, bis du sie freigibst.
        </p>
      </div>

      {requests.length === 0 ? (
        <Card>
          <CardContent className="grid justify-items-center gap-3 py-12 text-center">
            <InboxIcon className="size-8 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">Noch keine Kontaktanfragen</p>
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">
              Sobald eine berechtigte und verifizierte Firma eine Anfrage sendet,
              erscheint sie hier – ohne automatische Identitätsfreigabe.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ol className="grid gap-4" aria-label="Kontaktanfragen">
          {requests.map((request) => (
            <li key={request.id}>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle as="h2" className="flex items-center gap-2">
                        <Building2Icon className="size-5 text-primary" aria-hidden="true" />
                        {request.company.name}
                      </CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Eingegangen am {formatDate(request.createdAt)}
                      </p>
                    </div>
                    <Badge variant={statusVariant(request.status)}>
                      {statusLabel(request.status)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <div>
                    <p className="font-medium">{request.subject}</p>
                    <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                      {request.messagePreview}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <ShieldCheckIcon className="size-4" aria-hidden="true" />
                      {request.trusted
                        ? "Firma aktuell verifiziert"
                        : "Firma derzeit nicht verifiziert"}
                    </p>
                    <Link
                      href={`/candidate/talent-radar/requests/${request.id}`}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      Anfrage ansehen
                    </Link>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function statusLabel(status: CandidateRadarRequestStatus): string {
  return {
    PENDING: "Offen",
    ACCEPTED: "Angenommen",
    DECLINED: "Abgelehnt",
    EXPIRED: "Abgelaufen",
    CANCELLED: "Storniert",
  }[status];
}

function statusVariant(status: CandidateRadarRequestStatus) {
  return status === "ACCEPTED"
    ? ("secondary" as const)
    : status === "PENDING"
      ? ("default" as const)
      : ("outline" as const);
}
