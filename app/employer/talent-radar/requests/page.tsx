import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClockIcon, ChevronRightIcon, InboxIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getEmployerContext } from "@/lib/auth/employer-context";
import { getDatabase } from "@/lib/db/client";
import { requireEmployerCompanyContext } from "@/lib/employer/context";

export const metadata: Metadata = {
  title: "Talent-Radar-Kontaktanfragen",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function EmployerTalentRadarRequestsPage() {
  const [context, employerContext] = await Promise.all([
    requireEmployerCompanyContext(),
    getEmployerContext(),
  ]);
  if (
    employerContext === null ||
    employerContext.current === null ||
    context.membershipRole === "VIEWER"
  ) {
    notFound();
  }

  const requests = await getDatabase().employerContactRequest.findMany({
    where: { companyId: context.companyId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
    select: {
      id: true,
      subject: true,
      status: true,
      fundingSource: true,
      cantonBucketSnapshot: true,
      categoryBucketSnapshot: true,
      createdAt: true,
      expiresAt: true,
      revealGrant: { select: { revokedAt: true } },
    },
  });
  const now = new Date();

  return (
    <section aria-labelledby="contact-requests-title" className="grid gap-7">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Talent Radar</p>
          <h1 id="contact-requests-title" className="mt-2 text-3xl font-semibold tracking-tight">
            Kontaktanfragen
          </h1>
          <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
            Firmenbezogene Historie mit Status und Finanzierung. Identität bleibt
            anonym bis zur Freigabe.
          </p>
        </div>
        <Link href="/employer/talent-radar" className={buttonVariants({ variant: "outline" })}>
          Zur Talentsuche
        </Link>
      </header>

      {requests.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <InboxIcon className="size-8 text-muted-foreground" aria-hidden="true" />
            <div>
              <h2 className="font-medium">Noch keine Kontaktanfragen</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Kontaktanfragen erscheinen hier, sobald ein anonymer Radar-Kontakt
                sicher erstellt wurde.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {requests.map((request) => {
            const effectiveStatus = request.status === "PENDING" && request.expiresAt <= now
              ? "EXPIRED"
              : request.status;
            return (
              <Card key={request.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        {humanize(request.categoryBucketSnapshot)} · {request.cantonBucketSnapshot}
                      </p>
                      <CardTitle as="h2" className="mt-1">{request.subject}</CardTitle>
                    </div>
                    <Badge variant="outline">{statusLabel(effectiveStatus)}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm text-muted-foreground">
                  <p className="flex items-center gap-2">
                    <CalendarClockIcon className="size-4" aria-hidden="true" />
                    Erstellt {formatDate(request.createdAt)}
                  </p>
                  <p>Finanzierung: {fundingLabel(request.fundingSource)}</p>
                  <p>
                    Identität: {request.revealGrant === null
                      ? "nicht freigegeben"
                      : request.revealGrant.revokedAt === null
                        ? "separat freigegeben"
                        : "Freigabe widerrufen"}
                  </p>
                </CardContent>
                <CardFooter className="justify-end">
                  <Link
                    href={`/employer/talent-radar/requests/${request.id}`}
                    className={buttonVariants({ variant: "outline" })}
                  >
                    Details <ChevronRightIcon aria-hidden="true" />
                  </Link>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}

function statusLabel(status: string) {
  const labels: Readonly<Record<string, string>> = Object.freeze({
    PENDING: "Ausstehend",
    ACCEPTED: "Angenommen",
    DECLINED: "Abgelehnt",
    EXPIRED: "Abgelaufen",
    CANCELLED: "Zurückgezogen",
  });
  return labels[status] ?? "Unbekannt";
}

function fundingLabel(source: string) {
  const labels: Readonly<Record<string, string>> = Object.freeze({
    PLAN_ALLOWANCE: "Plan-Kontingent",
    PURCHASED_PACK: "Kontaktpaket",
    ADMIN_GRANT: "Admin-Gutschrift",
  });
  return labels[source] ?? "Unbekannt";
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Zurich",
  }).format(value);
}

function humanize(value: string) {
  return value.split("-").map((part) =>
    part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
