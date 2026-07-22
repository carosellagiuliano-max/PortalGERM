"use client";

import { useActionState } from "react";
import Link from "next/link";
import { BookmarkIcon, SendIcon } from "lucide-react";

import { startPublicJobIntentAction } from "@/app/(public)/jobs/actions";
import { applyToJobAction } from "@/app/candidate/applications/actions";
import { confirmSaveJobAction } from "@/app/candidate/saved-jobs/actions";
import { useProductAnalyticsSessionId } from "@/components/analytics/public-job-analytics";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  INITIAL_APPLICATION_ACTION_STATE,
} from "@/lib/applications/action-state";
import type { ApplicationConfirmationProjection } from "@/lib/applications/confirmation";
import { INITIAL_SAVED_JOB_ACTION_STATE } from "@/lib/candidate/saved-job-action-state";

export function PublicJobActions({ jobSlug }: Readonly<{ jobSlug: string }>) {
  const analyticsSessionId = useProductAnalyticsSessionId();
  return (
    <div className="grid grid-cols-2 gap-2">
      <form action={startPublicJobIntentAction}>
        <input type="hidden" name="action" value="SAVE" />
        <input type="hidden" name="jobSlug" value={jobSlug} />
        <input
          type="hidden"
          name="analyticsSessionId"
          value={analyticsSessionId}
        />
        <Button type="submit" variant="outline" className="w-full">
          <BookmarkIcon aria-hidden="true" /> Speichern
        </Button>
      </form>
      <form action={startPublicJobIntentAction}>
        <input type="hidden" name="action" value="APPLY" />
        <input type="hidden" name="jobSlug" value={jobSlug} />
        <input
          type="hidden"
          name="analyticsSessionId"
          value={analyticsSessionId}
        />
        <Button type="submit" className="w-full">
          <SendIcon aria-hidden="true" /> Bewerben
        </Button>
      </form>
    </div>
  );
}

export function SaveIntentConfirmation({
  signedIntent,
}: Readonly<{ signedIntent: string }>) {
  const [state, action, pending] = useActionState(
    confirmSaveJobAction,
    INITIAL_SAVED_JOB_ACTION_STATE,
  );
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="signedIntent" value={signedIntent} />
      {state.status === "error" ? (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
      <p className="text-sm leading-6 text-muted-foreground">
        Bestätige, dass du diese aktuell veröffentlichte Stelle in deiner privaten
        Merkliste speichern möchtest.
      </p>
      <Button type="submit" variant="outline" disabled={pending}>
        <BookmarkIcon aria-hidden="true" />
        {pending ? "Wird gespeichert …" : "Jetzt speichern"}
      </Button>
    </form>
  );
}

export function ApplyIntentConfirmation({
  signedIntent,
  idempotencyKey,
  projection,
  documents,
  identityComplete,
}: Readonly<{
  signedIntent: string;
  idempotencyKey: string;
  projection: ApplicationConfirmationProjection;
  documents: readonly Readonly<{
    id: string;
    safeFilename: string;
    mimeType: string;
    sizeBytes: number;
  }>[];
  identityComplete: boolean;
}>) {
  const [state, action, pending] = useActionState(
    applyToJobAction,
    INITIAL_APPLICATION_ACTION_STATE,
  );
  const requiresCv = projection.job.requiredDocumentKinds.includes("CV");
  const requiresCoverLetter =
    projection.job.requiredDocumentKinds.includes("COVER_LETTER");
  const canSubmit = identityComplete && (!requiresCv || documents.length > 0);

  return (
    <form action={action} className="grid gap-5" noValidate>
      <input type="hidden" name="signedIntent" value={signedIntent} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input
        type="hidden"
        name="confirmationVersion"
        value={projection.confirmationVersion}
      />
      <input
        type="hidden"
        name="confirmationSnapshotHash"
        value={projection.confirmationSnapshotHash}
      />
      {state.status === "error" ? (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
      <div className="grid gap-3 rounded-lg bg-muted/35 p-4 text-sm">
        <p>
          <strong>Absender:</strong> {projection.candidate.firstName}{" "}
          {projection.candidate.lastName} · {projection.candidate.email}
        </p>
        <p>
          <strong>Empfänger:</strong> {projection.recipient.companyName} ·{" "}
          {projection.recipient.contactValue}
        </p>
        <p>
          <strong>Stelle:</strong> {projection.job.title}
        </p>
      </div>
      {!identityComplete ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
          Bitte ergänze zuerst Vor- und Nachname in deinem{" "}
          <Link href="/candidate/jobpass" className="font-medium underline">
            SwissJobPass
          </Link>
          . Dein Profil darf trotzdem im Entwurfsstatus bleiben.
        </p>
      ) : null}
      {requiresCv ? (
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Lebenslauf auswählen</legend>
          {documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Kein aktiver CV vorhanden. Füge im SwissJobPass zuerst CV-Metadaten hinzu.
            </p>
          ) : (
            documents.map((document, index) => (
              <label key={document.id} className="flex gap-3 rounded-lg border p-3 text-sm">
                <input
                  type="radio"
                  name="selectedDocumentIds"
                  value={document.id}
                  required
                  defaultChecked={documents.length === 1 || index === 0}
                />
                <span>
                  <strong className="block">{document.safeFilename}</strong>
                  <span className="text-xs text-muted-foreground">
                    {document.mimeType} · {formatFileSize(document.sizeBytes)}
                  </span>
                </span>
              </label>
            ))
          )}
        </fieldset>
      ) : null}
      <label className="grid gap-2 text-sm font-medium">
        Motivationsschreiben {requiresCoverLetter ? "(erforderlich)" : "(optional)"}
        <Textarea
          name="coverLetter"
          minLength={requiresCoverLetter ? 1 : undefined}
          maxLength={4_000}
          required={requiresCoverLetter}
          rows={7}
          placeholder="Warum passt diese Stelle zu dir?"
        />
      </label>
      <label className="flex items-start gap-3 rounded-lg border p-3 text-sm leading-6">
        <input
          type="checkbox"
          name="confirmed"
          value="true"
          required
          className="mt-1"
        />
        <span>{projection.confirmationNotice}</span>
      </label>
      <Button type="submit" size="lg" disabled={pending || !canSubmit}>
        <SendIcon aria-hidden="true" />
        {pending
          ? "Bewerbung wird sicher erfasst …"
          : projection.job.applicationEffort === "SIMPLE"
            ? "Schnellbewerbung senden"
            : "Bewerbung senden"}
      </Button>
    </form>
  );
}

export function JobIntentAuthenticationLinks({
  next,
}: Readonly<{ next: string }>) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Link
        href={`/login?next=${encodeURIComponent(next)}`}
        className={buttonVariants()}
      >
        Anmelden
      </Link>
      <Link
        href={`/register/candidate?next=${encodeURIComponent(next)}`}
        className={buttonVariants({ variant: "outline" })}
      >
        Kandidatenkonto erstellen
      </Link>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.ceil(bytes / 1_024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}
