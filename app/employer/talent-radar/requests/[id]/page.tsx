import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileTextIcon, HistoryIcon, LockKeyholeIcon, MessageSquareTextIcon } from "lucide-react";

import { CancelRequestForm } from "@/components/employer/TalentRadar/CancelRequestForm";
import { RevealedBadge } from "@/components/employer/TalentRadar/RevealedBadge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getEmployerContext } from "@/lib/auth/employer-context";
import { getServerEnvironment } from "@/lib/config/env";
import type { KeyringEntry } from "@/lib/config/env-schema";
import { getDatabase } from "@/lib/db/client";
import { requireEmployerCompanyContext } from "@/lib/employer/context";
import type { RevealKey, RevealValue } from "@/lib/privacy/reveal-dto";
import { getEmployerRadarRequestView } from "@/lib/talentradar/reveal";

export const metadata: Metadata = {
  title: "Talent-Radar-Anfrage",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function EmployerTalentRadarRequestDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const [context, employerContext, route] = await Promise.all([
    requireEmployerCompanyContext(),
    getEmployerContext(),
    params,
  ]);
  if (
    employerContext === null ||
    employerContext.current === null ||
    context.membershipRole === "VIEWER"
  ) {
    notFound();
  }

  const database = getDatabase();
  const environment = getServerEnvironment();
  const [view, evidence] = await Promise.all([
    getEmployerRadarRequestView(database, {
      actorUserId: employerContext.user.id,
      companyId: context.companyId,
      requestId: route.id,
      piiKeys: materializeRevealKeyring(
        environment.secrets.keyrings.PII_REVEAL_KEYS,
      ),
    }),
    database.employerContactRequest.findFirst({
      where: { id: route.id, companyId: context.companyId },
      select: {
        id: true,
        status: true,
        fundingSource: true,
        expiresAt: true,
        terminalAt: true,
        conversation: { select: { id: true } },
        events: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 100,
          select: { id: true, kind: true, reasonCode: true, createdAt: true },
        },
      },
    }),
  ]);
  if (view === null || evidence === null) notFound();

  const now = new Date();
  const effectiveStatus = evidence.status === "PENDING" && evidence.expiresAt <= now
    ? "EXPIRED"
    : evidence.status;

  return (
    <section aria-labelledby="request-title" className="grid gap-7">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Talent Radar · Kontaktanfrage</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 id="request-title" className="text-3xl font-semibold tracking-tight">
              {view.subject}
            </h1>
            <Badge variant="outline">{statusLabel(effectiveStatus)}</Badge>
          </div>
          <p className="mt-3 text-muted-foreground">{view.anonymousLabel}</p>
        </div>
        <Link
          href="/employer/talent-radar/requests"
          className={buttonVariants({ variant: "outline" })}
        >
          Alle Kontaktanfragen
        </Link>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)]">
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2">
              <MessageSquareTextIcon className="size-5 text-primary" aria-hidden="true" />
              Gesendete Nachricht
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="whitespace-pre-wrap leading-7">{view.messagePreview}</p>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Erstellt</dt>
                <dd>{formatDate(view.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Finanzierung</dt>
                <dd>{fundingLabel(evidence.fundingSource)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Gültig bis</dt>
                <dd>{formatDate(evidence.expiresAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Gespräch</dt>
                <dd>{evidence.conversation === null
                  ? "Noch nicht erstellt"
                  : "Anonymes Gespräch erstellt"}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle as="h2">Identitätsfreigabe</CardTitle>
              <RevealedBadge status={view.revealStatus} />
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            {view.identity.length === 0 ? (
              <div className="grid gap-2 text-sm text-muted-foreground">
                <LockKeyholeIcon className="size-5" aria-hidden="true" />
                <p>
                  Identität bleibt anonym bis zur Freigabe. Annahme allein
                  reicht dafür nicht aus.
                </p>
              </div>
            ) : (
              <dl className="grid gap-3">
                {view.identity.map((item) => (
                  <IdentityValue key={item.field} item={item} />
                ))}
              </dl>
            )}
            {view.revealStatus === "REVOKED" ? (
              <p className="text-xs leading-5 text-muted-foreground">
                Die Freigabe wurde widerrufen. Bereits zuvor gesehene oder
                kopierte Angaben können technisch nicht ungesehen gemacht werden.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-2">
            <HistoryIcon className="size-5 text-primary" aria-hidden="true" />
            Statusverlauf
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-3">
            {evidence.events.map((event) => (
              <li key={event.id} className="grid gap-1 border-l-2 pl-4 sm:grid-cols-[12rem_1fr]">
                <time className="text-xs text-muted-foreground">{formatDate(event.createdAt)}</time>
                <div>
                  <p className="font-medium">{eventLabel(event.kind)}</p>
                  {event.reasonCode === null ? null : (
                    <p className="text-xs text-muted-foreground">
                      Grund: {reasonLabel(event.reasonCode)}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {effectiveStatus === "PENDING" ? (
        <CancelRequestForm requestId={view.requestId} idempotencyKey={randomUUID()} />
      ) : null}

      <Alert>
        <FileTextIcon aria-hidden="true" />
        <AlertTitle>Request-spezifische Freigabe</AlertTitle>
        <AlertDescription>
          Angezeigt werden ausschließlich verschlüsselt gespeicherte
          Momentaufnahmen aus genau dieser Kontaktanfrage. Aktuelle Profildaten
          werden nicht nachgeladen. Identität bleibt anonym bis zur Freigabe.
        </AlertDescription>
      </Alert>
    </section>
  );
}

function IdentityValue({ item }: Readonly<{ item: RevealValue }>) {
  if (item.field === "CV_METADATA") {
    return (
      <div>
        <dt className="text-xs text-muted-foreground">CV-Metadaten</dt>
        <dd>
          {item.value.fileName} · {item.value.mimeType} · {formatBytes(item.value.sizeBytes)}
        </dd>
      </div>
    );
  }
  const labels = {
    DISPLAY_NAME: "Anzeigename",
    EMAIL: "E-Mail",
    PHONE: "Telefon",
  } as const;
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{labels[item.field]}</dt>
      <dd className="break-words">{item.value}</dd>
    </div>
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

function eventLabel(kind: string) {
  const labels: Readonly<Record<string, string>> = Object.freeze({
    CREATED: "Kontaktanfrage erstellt",
    ACCEPTED: "Kontaktanfrage angenommen",
    DECLINED: "Kontaktanfrage abgelehnt",
    EXPIRED: "Kontaktanfrage abgelaufen",
    CANCELLED: "Kontaktanfrage zurückgezogen",
    ELIGIBILITY_CANCELLED: "Kontaktanfrage automatisch beendet",
  });
  return labels[kind] ?? "Status aktualisiert";
}

function reasonLabel(reason: string) {
  const labels: Readonly<Record<string, string>> = Object.freeze({
    CANDIDATE_OPTED_OUT: "Talent-Radar-Sichtbarkeit beendet",
    CANDIDATE_PROFILE_INCOMPLETE: "Kandidatenprofil nicht mehr vollständig",
    CANDIDATE_USER_UNAVAILABLE: "Kandidatenkonto derzeit nicht verfügbar",
    COMPANY_INACTIVE: "Firma derzeit nicht aktiv",
    COMPANY_VERIFICATION_LOST: "Firmenverifizierung nicht mehr aktuell",
    REQUESTING_COMPANY_CANCELLED: "Durch die anfragende Firma zurückgezogen",
    REQUEST_EXPIRED: "Gültigkeitsfrist erreicht",
  });
  return labels[reason] ?? "Dokumentierter Statusgrund";
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Zurich",
  }).format(value);
}

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  return `${(bytes / 1_024).toFixed(bytes < 102_400 ? 1 : 0)} KB`;
}

function materializeRevealKeyring(
  entries: readonly KeyringEntry<"PII_REVEAL_KEYS">[],
): readonly RevealKey[] {
  return Object.freeze(entries.map((entry) =>
    entry.key.withValue((secret) => Object.freeze({
      version: entry.version,
      secret,
    })),
  ));
}
