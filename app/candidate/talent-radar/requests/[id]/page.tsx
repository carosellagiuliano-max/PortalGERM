import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BadgeCheckIcon,
  CalendarClockIcon,
  FlagIcon,
  LockKeyholeIcon,
  MessageCircleIcon,
  ShieldAlertIcon,
} from "lucide-react";

import { CandidateRadarRequestActions } from "@/components/candidate/TalentRadar/RequestActions";
import { CandidateRadarRevealActions } from "@/components/candidate/TalentRadar/RevealActions";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import type { RevealField } from "@/lib/generated/prisma/enums";
import {
  getCandidateRadarRequest,
  type CandidateRadarRequestStatus,
} from "@/lib/talentradar/candidate-request-view";
import { formatDate, formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = {
  title: "Talent-Radar-Anfrage",
  robots: { index: false, follow: false, noarchive: true },
};
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function CandidateRadarRequestPage({
  params,
  searchParams,
}: PageProps) {
  const user = await requireCandidatePage();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const request = await getCandidateRadarRequest(getDatabase(), user.id, id);
  if (request === null) notFound();
  const updated = singleValue(query.updated);
  const existingFields = request.reveal?.fields ?? [];
  const revealStatus = request.reveal?.status ?? "NONE";

  return (
    <section aria-labelledby="radar-request-title" className="grid max-w-5xl gap-7">
      <div>
        <Link
          href="/candidate/talent-radar/requests"
          className={buttonVariants({ variant: "ghost" })}
        >
          ← Zurück zu den Kontaktanfragen
        </Link>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <p className="eyebrow">Talent-Radar-Kontaktanfrage</p>
          <Badge variant={statusVariant(request.status)}>
            {statusLabel(request.status)}
          </Badge>
        </div>
        <h1
          id="radar-request-title"
          className="mt-2 text-3xl font-semibold tracking-tight"
        >
          {request.company.name}
        </h1>
        <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
          Identität bleibt anonym, bis du sie in einem separaten Schritt
          ausdrücklich freigibst.
        </p>
      </div>

      {updated === null ? null : (
        <p
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950"
        >
          {updateMessage(updated)}
        </p>
      )}

      {!request.trusted ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          <ShieldAlertIcon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Firma derzeit nicht verifiziert</p>
            <p>
              Annehmen, neue Identitätsfreigaben und neue Nachrichten bleiben
              gesperrt. Die minimale Anfragehistorie und die Meldefunktion bleiben
              für dich sichtbar.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Anfrage</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Zweck / Betreff
              </p>
              <p className="mt-1 font-medium">{request.subject}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Nachricht
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">
                {request.messagePreview}
              </p>
            </div>
            <dl className="grid gap-3 rounded-xl bg-muted/30 p-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Eingegangen</dt>
                <dd className="mt-1 font-medium">{formatDateTime(request.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Antwortfrist</dt>
                <dd className="mt-1 font-medium">{formatDateTime(request.expiresAt)}</dd>
              </div>
            </dl>
            {request.status === "PENDING" && request.trusted ? (
              <CandidateRadarRequestActions
                requestId={request.id}
                companyName={request.company.name}
                acceptIdempotencyKey={randomUUID()}
                declineIdempotencyKey={randomUUID()}
              />
            ) : (
              <RequestReadOnlyNotice status={request.status} />
            )}
          </CardContent>
        </Card>

        <div className="grid content-start gap-5">
          <Card>
            <CardHeader>
              <CardTitle as="h2" className="flex items-center gap-2">
                <BadgeCheckIcon className="size-5 text-primary" aria-hidden="true" />
                Firma
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <p className="font-medium">{request.company.name}</p>
              <p className="text-muted-foreground">
                {request.trusted
                  ? "Aktiv und aktuell verifiziert"
                  : "Derzeit nicht verifiziert"}
              </p>
              <Link
                href={`/candidate/talent-radar/requests/${request.id}/report`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <FlagIcon aria-hidden="true" /> Firma melden
              </Link>
            </CardContent>
          </Card>

          {request.conversationId === null ? null : (
            <Card>
              <CardHeader>
                <CardTitle as="h2" className="flex items-center gap-2">
                  <MessageCircleIcon className="size-5 text-primary" aria-hidden="true" />
                  Anonymes Gespräch
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm leading-6 text-muted-foreground">
                <p>
                  Die Annahme hat ein Talent-Radar-Gespräch erstellt, aber keine
                  Identität freigegeben.
                </p>
                {request.trusted ? (
                  <Link
                    href={`/candidate/messages/${request.conversationId}`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    Zum Gespräch
                  </Link>
                ) : (
                  <p className="font-medium text-foreground">
                    Neue Nachrichten sind derzeit gesperrt.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {request.status === "ACCEPTED" ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2">
              <LockKeyholeIcon className="size-5 text-primary" aria-hidden="true" />
              Identitätsfreigabe
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            <p className="text-sm leading-6 text-muted-foreground">
              Du bestimmst Feld für Feld, welche unveränderliche Momentaufnahme
              diese Firma erhält. Eine Profiländerung aktualisiert frühere
              Freigaben nicht automatisch.
            </p>
            {existingFields.length === 0 ? (
              <p className="rounded-xl bg-muted/30 p-4 text-sm">
                Noch keine Identitätsfelder freigegeben.
              </p>
            ) : (
              <div>
                <p className="text-sm font-medium">Freigegebene Felder</p>
                <ul className="mt-2 flex flex-wrap gap-2" aria-label="Freigegebene Identitätsfelder">
                  {existingFields.map((field) => (
                    <li key={field}>
                      <Badge variant="outline">{revealFieldLabel(field)}</Badge>
                    </li>
                  ))}
                </ul>
                {request.reveal === null ? null : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Erste Freigabe am {formatDate(request.reveal.revealedAt)}
                  </p>
                )}
              </div>
            )}
            <CandidateRadarRevealActions
              requestId={request.id}
              companyName={request.company.name}
              existingFields={existingFields}
              grantId={request.reveal?.grantId ?? null}
              grantStatus={revealStatus}
              trusted={request.trusted}
              grantIdempotencyKey={randomUUID()}
              revokeIdempotencyKey={randomUUID()}
            />
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-start gap-3 rounded-xl border bg-muted/20 p-5 text-sm leading-6">
        <CalendarClockIcon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        <p className="text-muted-foreground">
          DSG-freundliches MVP — Orientierung, keine Rechtsberatung. Identität
          bleibt anonym, bis du sie freigibst.
        </p>
      </div>
    </section>
  );
}

function RequestReadOnlyNotice({
  status,
}: Readonly<{ status: CandidateRadarRequestStatus }>) {
  const message = {
    PENDING:
      "Die Anfrage kann wegen des aktuellen Firmenvertrauens nicht bearbeitet werden.",
    ACCEPTED:
      "Du hast diese Anfrage angenommen. Die Identitätsfreigabe bleibt ein separater Schritt.",
    DECLINED: "Du hast diese Anfrage abgelehnt. Sie ist schreibgeschützt.",
    EXPIRED: "Die Antwortfrist ist abgelaufen. Die Anfrage ist schreibgeschützt.",
    CANCELLED:
      "Diese Anfrage wurde storniert und ist schreibgeschützt. Du kannst die Firma weiterhin melden.",
  }[status];
  return (
    <p className="rounded-xl border bg-muted/30 p-4 text-sm leading-6 text-muted-foreground">
      {message}
    </p>
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

function revealFieldLabel(field: RevealField): string {
  return {
    DISPLAY_NAME: "Anzeigename",
    EMAIL: "E-Mail-Adresse",
    PHONE: "Telefonnummer",
    CV_METADATA: "Lebenslauf-Metadaten",
  }[field];
}

function singleValue(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function updateMessage(value: string): string {
  return {
    accepted:
      "Kontaktanfrage angenommen. Das Gespräch ist anonym; es wurden keine Identitätsdaten freigegeben.",
    declined: "Kontaktanfrage abgelehnt. Es wurde kein Gespräch erstellt.",
    revealed: "Die bestätigten Identitätsfelder wurden für diese Anfrage freigegeben.",
    revoked:
      "Die Identitätsfreigabe wurde widerrufen. Bereits gesehene oder kopierte Daten können technisch nicht zurückgeholt werden.",
  }[value] ?? "Die Anfrage wurde aktualisiert.";
}

type PageProps = Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<{ updated?: string | string[] }>;
}>;
