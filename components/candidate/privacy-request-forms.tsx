"use client";

import { useActionState, useState } from "react";
import Link from "next/link";

import {
  INITIAL_CANDIDATE_PRIVACY_ACTION_STATE,
  type CandidatePrivacyActionState,
} from "@/app/candidate/privacy/action-state";
import { createCandidatePrivacyRequestAction } from "@/app/candidate/privacy/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PRIVACY_REQUEST_POLICY_V1 } from "@/lib/privacy/requests";
import { cn } from "@/lib/utils";

const CORRECTION_FIELDS = [
  ["DISPLAY_NAME", "Anzeigename"],
  ["LEGAL_NAME", "Rechtlicher Name"],
  ["EMAIL", "E-Mail"],
  ["PHONE", "Telefon"],
  ["LOCATION", "Standort"],
  ["PROFILE_PREFERENCES", "Profil-Präferenzen"],
  ["CONSENT_HISTORY", "Einwilligungen"],
  ["APPLICATION_DATA", "Bewerbungsdaten"],
  ["OTHER_ACCOUNT_DATA", "Andere Kontodaten"],
] as const;

export function PrivacyExportRequestForm({
  idempotencyKey,
}: Readonly<{ idempotencyKey: string }>) {
  const [state, action, pending] = useActionState(
    createCandidatePrivacyRequestAction,
    INITIAL_CANDIDATE_PRIVACY_ACTION_STATE,
  );
  return (
    <form action={action} className="grid gap-3" noValidate>
      <input type="hidden" name="type" value="EXPORT" />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <PrivacyActionFeedback state={state} />
      <Button type="submit" className="w-fit" disabled={pending || state.status === "success"}>
        {pending ? "Export-Fall wird erstellt …" : "Export-Fall erstellen"}
      </Button>
    </form>
  );
}

export function PrivacyDeleteRequestForm({
  idempotencyKey,
  fieldId = "deleteConfirmation",
  className,
}: Readonly<{
  idempotencyKey: string;
  fieldId?: string;
  className?: string;
}>) {
  const [state, action, pending] = useActionState(
    createCandidatePrivacyRequestAction,
    INITIAL_CANDIDATE_PRIVACY_ACTION_STATE,
  );
  const fieldError = state.fieldErrors?.deleteConfirmation;
  return (
    <form action={action} className={cn("grid gap-3", className)} noValidate>
      <input type="hidden" name="type" value="DELETE" />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <PrivacyActionFeedback state={state} />
      <label className="text-sm font-medium" htmlFor={fieldId}>
        Zur Bestätigung exakt eingeben:
      </label>
      <code className="overflow-x-auto rounded bg-muted px-2 py-1 text-xs">
        {PRIVACY_REQUEST_POLICY_V1.deleteConfirmationPhrase}
      </code>
      <Input
        id={fieldId}
        name="deleteConfirmation"
        required
        autoComplete="off"
        className="h-10"
        aria-invalid={fieldError === undefined ? undefined : true}
        aria-describedby={fieldError === undefined ? undefined : `${fieldId}-error`}
      />
      <FieldError id={`${fieldId}-error`} messages={fieldError} />
      <Button
        type="submit"
        variant="destructive"
        className="w-fit"
        disabled={pending || state.status === "success"}
      >
        {pending ? "Anfrage wird erfasst …" : "Löschung beantragen"}
      </Button>
    </form>
  );
}

export function PrivacyCorrectionRequestForm({
  idempotencyKey,
}: Readonly<{ idempotencyKey: string }>) {
  const [state, action, pending] = useActionState(
    createCandidatePrivacyRequestAction,
    INITIAL_CANDIDATE_PRIVACY_ACTION_STATE,
  );
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const selectionError = state.fieldErrors?.correctionFieldCodes;
  const textError = state.fieldErrors?.correctionText;
  const selectionLocked = selected.size >= 5;
  const submitted = state.status === "success";

  return (
    <form action={action} className="grid gap-3" noValidate>
      <input type="hidden" name="type" value="CORRECT" />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <PrivacyActionFeedback state={state} />
      <fieldset
        className="grid gap-2"
        aria-invalid={selectionError === undefined ? undefined : true}
        aria-describedby="privacy-correction-selection-count privacy-correction-selection-error"
      >
        <legend className="mb-1 text-sm font-medium">1 bis 5 Bereiche</legend>
        {CORRECTION_FIELDS.map(([value, label]) => {
          const checked = selected.has(value);
          return (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="correctionFieldCodes"
                value={value}
                checked={checked}
                disabled={pending || submitted || (!checked && selectionLocked)}
                onChange={(event) => {
                  const nextChecked = event.currentTarget.checked;
                  setSelected((current) => {
                    const next = new Set(current);
                    if (nextChecked && next.size < 5) next.add(value);
                    if (!nextChecked) next.delete(value);
                    return next;
                  });
                }}
                className="size-4 accent-primary"
              />
              {label}
            </label>
          );
        })}
      </fieldset>
      <p
        id="privacy-correction-selection-count"
        className="text-xs text-muted-foreground"
        aria-live="polite"
      >
        {selected.size} / 5 ausgewählt
      </p>
      <FieldError id="privacy-correction-selection-error" messages={selectionError} />
      <Textarea
        name="correctionText"
        minLength={20}
        maxLength={1000}
        required
        rows={5}
        placeholder="Beschreibe die gewünschte Korrektur sachlich (20–1000 Zeichen)."
        aria-invalid={textError === undefined ? undefined : true}
        aria-describedby={textError === undefined ? undefined : "privacy-correction-text-error"}
      />
      <FieldError id="privacy-correction-text-error" messages={textError} />
      <Button
        type="submit"
        className="w-fit"
        disabled={pending || submitted}
      >
        {pending ? "Anfrage wird erfasst …" : "Korrektur anfordern"}
      </Button>
    </form>
  );
}

function PrivacyActionFeedback({
  state,
}: Readonly<{ state: CandidatePrivacyActionState }>) {
  if (state.status === "idle") return null;
  return (
    <Alert variant={state.status === "error" ? "destructive" : "default"} aria-live="polite">
      <AlertTitle>
        {state.status === "success" ? "Anfrage erfasst" : "Anfrage nicht möglich"}
      </AlertTitle>
      <AlertDescription>
        {state.message}
        {state.supportPath === undefined ? null : (
          <Link href={state.supportPath} className="mt-2 block font-medium underline">
            Datenschutzanliegen an den Support senden
          </Link>
        )}
      </AlertDescription>
    </Alert>
  );
}

function FieldError({
  id,
  messages,
}: Readonly<{ id: string; messages?: readonly string[] }>) {
  if (messages === undefined || messages.length === 0) return null;
  return (
    <p id={id} className="text-sm text-destructive" role="alert">
      {messages.join(" ")}
    </p>
  );
}
