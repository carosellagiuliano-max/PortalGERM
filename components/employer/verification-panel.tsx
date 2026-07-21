"use client";

import { useActionState } from "react";

import {
  startNewCompanyVerificationCycleAction,
  submitCurrentCompanyVerificationAction,
} from "@/app/employer/company/verification/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  EmployerCompanyActionState,
  EmployerVerificationView,
} from "@/lib/employer/company";

const INITIAL_ACTION_STATE: EmployerCompanyActionState = Object.freeze({
  status: "idle",
  message: "",
});

const STATUS_LABELS: Readonly<Record<EmployerVerificationView["status"], string>> =
  Object.freeze({
    DRAFT: "Entwurf",
    PENDING: "In Prüfung",
    CHANGES_REQUESTED: "Nachweise ergänzen",
    VERIFIED: "Verifiziert",
    REJECTED: "Abgelehnt",
    REVOKED: "Widerrufen",
  });

const EVENT_LABELS: Readonly<
  Record<EmployerVerificationView["events"][number]["kind"], string>
> = Object.freeze({
  DRAFT_CREATED: "Prüfzyklus angelegt",
  SUBMITTED: "Zur Prüfung eingereicht",
  EVIDENCE_REQUESTED: "Weitere Nachweise angefordert",
  RESUBMITTED: "Nachweise erneut eingereicht",
  VERIFIED: "Verifizierung bestätigt",
  REJECTED: "Verifizierung abgelehnt",
  REVOKED: "Verifizierung widerrufen",
});

export function VerificationPanel({
  current,
  history,
  canManage,
  idempotencyKey,
}: Readonly<{
  current: EmployerVerificationView | null;
  history: readonly EmployerVerificationView[];
  canManage: boolean;
  idempotencyKey: string;
}>) {
  const formMode = getVerificationFormMode(current);

  return (
    <div className="grid gap-6">
      <VerificationSummary current={current} canManage={canManage} />
      {canManage && formMode !== null ? (
        <VerificationEvidenceForm
          current={current}
          mode={formMode}
          idempotencyKey={idempotencyKey}
        />
      ) : null}
      {!canManage ? (
        <p className="text-sm leading-6 text-muted-foreground">
          Recruiter und Viewer können den Prüfstatus sehen. Nachweise,
          interne Begründungen und Änderungen bleiben Owner und Admin vorbehalten.
        </p>
      ) : null}
      <VerificationHistory history={history} canManage={canManage} />
    </div>
  );
}

function VerificationSummary({
  current,
  canManage,
}: Readonly<{
  current: EmployerVerificationView | null;
  canManage: boolean;
}>) {
  if (current === null) {
    return (
      <Alert>
        <AlertTitle>Noch kein Prüfzyklus</AlertTitle>
        <AlertDescription>
          {canManage
            ? "Reiche nachvollziehbare Firmennachweise ein. Das aktive Firmenprofil und das Verifizierungsabzeichen bleiben zwei getrennte Zustände."
            : "Für diese Firma wurde noch keine Verifizierungsanfrage gespeichert."}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant={isNegativeStatus(current.status) ? "destructive" : "default"}>
      <AlertTitle className="flex flex-wrap items-center gap-2">
        Aktueller Prüfstatus
        <VerificationStatusBadge status={current.status} />
      </AlertTitle>
      <AlertDescription>
        {verificationStatusDescription(current.status)}
      </AlertDescription>
    </Alert>
  );
}

function VerificationEvidenceForm({
  current,
  mode,
  idempotencyKey,
}: Readonly<{
  current: EmployerVerificationView | null;
  mode: "NEW_CYCLE" | "CURRENT_CYCLE";
  idempotencyKey: string;
}>) {
  const serverAction =
    mode === "NEW_CYCLE"
      ? startNewCompanyVerificationCycleAction
      : submitCurrentCompanyVerificationAction;
  const [state, action, pending] = useActionState(
    serverAction,
    INITIAL_ACTION_STATE,
  );
  const evidence = mode === "CURRENT_CYCLE" ? current?.evidence : null;

  return (
    <form action={action} className="grid gap-5 rounded-xl border p-4 sm:p-5" noValidate>
      <input
        type="hidden"
        name="expectedCurrentRequestId"
        value={current?.id ?? ""}
      />
      <input
        type="hidden"
        name="idempotencyKey"
        value={state.nextIdempotencyKey ?? idempotencyKey}
      />
      <div>
        <h3 className="font-semibold">
          {mode === "NEW_CYCLE"
            ? current === null
              ? "Ersten Prüfzyklus einreichen"
              : "Neuen Prüfzyklus einreichen"
            : "Nachweise im bestehenden Prüfzyklus einreichen"}
        </h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {mode === "NEW_CYCLE"
            ? "Ein neuer Zyklus ist nur ohne Vorgänger oder nach Ablehnung beziehungsweise Widerruf zulässig."
            : "Bei angeforderten Änderungen bleibt dieselbe Anfrage erhalten; es entsteht kein paralleler Prüfzyklus."}
        </p>
      </div>
      <VerificationActionFeedback state={state} />
      <div className="grid gap-2">
        <Label htmlFor="evidenceSummary">Beschreibung des Nachweises</Label>
        <Textarea
          id="evidenceSummary"
          name="evidenceSummary"
          defaultValue={evidence?.summary ?? ""}
          minLength={20}
          maxLength={1_000}
          rows={5}
          required
          disabled={pending}
          aria-invalid={Boolean(state.fieldErrors?.evidence?.length) || undefined}
          aria-describedby="verification-evidence-help"
        />
        <p
          id="verification-evidence-help"
          className="text-xs leading-5 text-muted-foreground"
        >
          Beschreibe kurz, was die Referenz belegt. Keine Passwörter,
          Ausweiskopien oder andere besonders schützenswerte Daten eintragen.
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="evidenceReference">Nachweis-Referenz</Label>
        <Input
          id="evidenceReference"
          name="evidenceReference"
          defaultValue={evidence?.reference ?? ""}
          minLength={2}
          maxLength={255}
          required
          disabled={pending}
          placeholder="z. B. Handelsregisterauszug, Referenz HR-2026-17"
          aria-invalid={Boolean(state.fieldErrors?.evidence?.length) || undefined}
        />
      </div>
      {state.fieldErrors?.evidence?.map((message) => (
        <p key={message} className="text-sm text-destructive" role="alert">
          {message}
        </p>
      ))}
      <Button type="submit" className="w-full sm:w-fit" disabled={pending}>
        {pending
          ? "Nachweise werden eingereicht …"
          : mode === "NEW_CYCLE"
            ? "Prüfzyklus starten und einreichen"
            : "Nachweise erneut einreichen"}
      </Button>
    </form>
  );
}

function VerificationActionFeedback({
  state,
}: Readonly<{ state: EmployerCompanyActionState }>) {
  if (state.status === "idle") return null;
  return (
    <Alert
      variant={state.status === "error" ? "destructive" : "default"}
      aria-live="polite"
    >
      <AlertTitle>
        {state.status === "success"
          ? "Übermittelt"
          : state.code === "CONFLICT"
            ? "Neuerer Prüfstatus erkannt"
            : "Übermittlung nicht möglich"}
      </AlertTitle>
      <AlertDescription>
        <p>{state.message}</p>
        {state.code === "CONFLICT" ? (
          <button
            type="button"
            className="mt-2 underline underline-offset-3"
            onClick={() => window.location.reload()}
          >
            Aktuellen Prüfstatus neu laden
          </button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

function VerificationHistory({
  history,
  canManage,
}: Readonly<{
  history: readonly EmployerVerificationView[];
  canManage: boolean;
}>) {
  return (
    <div className="grid gap-3">
      <h3 className="font-semibold">Prüfverlauf</h3>
      {history.length === 0 ? (
        <p className="text-sm text-muted-foreground">Noch keine Prüfereignisse.</p>
      ) : (
        <ol className="grid gap-3">
          {history.map((request, index) => (
            <li key={request.id} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">Prüfzyklus {history.length - index}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Erstellt <VerificationDate value={request.createdAt} />
                  </p>
                </div>
                <VerificationStatusBadge status={request.status} />
              </div>
              {canManage && request.evidence !== null ? (
                <dl className="mt-4 grid gap-2 rounded-lg bg-muted/50 p-3 text-sm">
                  <div>
                    <dt className="font-medium">Referenz</dt>
                    <dd className="mt-1 break-words text-muted-foreground">
                      {request.evidence.reference}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium">Beschreibung</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-muted-foreground">
                      {request.evidence.summary}
                    </dd>
                  </div>
                </dl>
              ) : null}
              {canManage && request.events.length > 0 ? (
                <ol className="mt-4 grid gap-2 border-l pl-4 text-sm">
                  {request.events.map((event, eventIndex) => (
                    <li key={`${request.id}-${event.kind}-${eventIndex}`}>
                      <p className="font-medium">{EVENT_LABELS[event.kind]}</p>
                      <p className="text-xs text-muted-foreground">
                        <VerificationDate value={event.createdAt} />
                        {event.reasonCode === null
                          ? ""
                          : ` · Grundcode ${event.reasonCode}`}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function VerificationStatusBadge({
  status,
}: Readonly<{ status: EmployerVerificationView["status"] }>) {
  const variant = status === "VERIFIED"
    ? "default"
    : isNegativeStatus(status)
      ? "destructive"
      : status === "PENDING"
        ? "secondary"
        : "outline";
  return <Badge variant={variant}>{STATUS_LABELS[status]}</Badge>;
}

function VerificationDate({ value }: Readonly<{ value: Date }>) {
  const date = new Date(value);
  return (
    <time dateTime={date.toISOString()}>
      {new Intl.DateTimeFormat("de-CH", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Zurich",
      }).format(date)}
    </time>
  );
}

function getVerificationFormMode(
  current: EmployerVerificationView | null,
): "NEW_CYCLE" | "CURRENT_CYCLE" | null {
  if (current === null || current.status === "REJECTED" || current.status === "REVOKED") {
    return "NEW_CYCLE";
  }
  if (current.status === "DRAFT" || current.status === "CHANGES_REQUESTED") {
    return "CURRENT_CYCLE";
  }
  return null;
}

function isNegativeStatus(status: EmployerVerificationView["status"]) {
  return status === "REJECTED" || status === "REVOKED";
}

function verificationStatusDescription(
  status: EmployerVerificationView["status"],
) {
  return {
    DRAFT: "Der Prüfzyklus ist angelegt und kann von Owner oder Admin eingereicht werden.",
    PENDING: "Die Nachweise sind eingereicht. Bis zur Prüfung ist keine weitere Einreichung möglich.",
    CHANGES_REQUESTED: "Ergänze die angeforderten Nachweise im bestehenden Prüfzyklus.",
    VERIFIED: "Die Firma ist verifiziert. Das Abzeichen folgt diesem gespeicherten Prüfstatus.",
    REJECTED: "Dieser Prüfzyklus wurde abgelehnt. Owner oder Admin können einen neuen Zyklus beginnen.",
    REVOKED: "Die frühere Verifizierung wurde widerrufen. Für eine neue Prüfung ist ein neuer Zyklus erforderlich.",
  }[status];
}
