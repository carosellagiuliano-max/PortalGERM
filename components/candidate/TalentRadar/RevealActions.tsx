"use client";

import { useActionState } from "react";
import { EyeIcon, ShieldOffIcon } from "lucide-react";

import {
  grantCandidateRadarRevealAction,
  previewCandidateRadarRevealAction,
  revokeCandidateRadarRevealAction,
  type CandidateRadarActionState,
  type CandidateRevealPreviewState,
} from "@/app/candidate/talent-radar/requests/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { RevealField } from "@/lib/generated/prisma/enums";
import type { RevealValue } from "@/lib/privacy/reveal-dto";

const INITIAL_STATE: CandidateRadarActionState = Object.freeze({
  status: "idle",
  message: "",
});
const INITIAL_PREVIEW_STATE: CandidateRevealPreviewState = INITIAL_STATE;
const FIELD_OPTIONS = Object.freeze([
  { value: "DISPLAY_NAME", label: "Anzeigename" },
  { value: "EMAIL", label: "E-Mail-Adresse" },
  { value: "PHONE", label: "Telefonnummer" },
  { value: "CV_METADATA", label: "Lebenslauf-Metadaten" },
] as const);

export function CandidateRadarRevealActions({
  requestId,
  companyName,
  existingFields,
  grantId,
  grantStatus,
  trusted,
  grantIdempotencyKey,
  revokeIdempotencyKey,
}: Readonly<{
  requestId: string;
  companyName: string;
  existingFields: readonly RevealField[];
  grantId: string | null;
  grantStatus: "NONE" | "ACTIVE" | "REVOKED" | "TRUST_BLOCKED";
  trusted: boolean;
  grantIdempotencyKey: string;
  revokeIdempotencyKey: string;
}>) {
  const available = FIELD_OPTIONS.filter(
    ({ value }) => !existingFields.includes(value),
  );

  return (
    <div className="grid gap-4">
      {grantStatus === "REVOKED" ? (
        <p className="rounded-xl border bg-muted/30 p-4 text-sm leading-6 text-muted-foreground">
          Diese Freigabe wurde widerrufen und kann für dieselbe Anfrage nicht
          erneut geöffnet werden. Der anonyme Gesprächsverlauf bleibt erhalten.
        </p>
      ) : null}
      {grantStatus === "TRUST_BLOCKED" ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          Die Firma ist derzeit nicht verifiziert. Neue Freigaben und der Zugriff
          auf bereits freigegebene Felder bleiben gesperrt.
        </p>
      ) : null}
      {trusted &&
      (grantStatus === "NONE" || grantStatus === "ACTIVE") &&
      available.length > 0 ? (
        <RevealDialog
          requestId={requestId}
          companyName={companyName}
          available={available}
          grantIdempotencyKey={grantIdempotencyKey}
        />
      ) : null}
      {grantId !== null &&
      (grantStatus === "ACTIVE" || grantStatus === "TRUST_BLOCKED") ? (
        <RevokeDialog
          requestId={requestId}
          grantId={grantId}
          companyName={companyName}
          revokeIdempotencyKey={revokeIdempotencyKey}
        />
      ) : null}
    </div>
  );
}

function RevealDialog({
  requestId,
  companyName,
  available,
  grantIdempotencyKey,
}: Readonly<{
  requestId: string;
  companyName: string;
  available: readonly (typeof FIELD_OPTIONS)[number][];
  grantIdempotencyKey: string;
}>) {
  const [previewState, previewAction, previewPending] = useActionState(
    previewCandidateRadarRevealAction,
    INITIAL_PREVIEW_STATE,
  );
  const [grantState, grantAction, grantPending] = useActionState(
    grantCandidateRadarRevealAction,
    INITIAL_STATE,
  );

  return (
    <Dialog>
      <DialogTrigger render={<Button type="button" className="w-fit" />}>
        <EyeIcon aria-hidden="true" /> Identität für {companyName} freigeben
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Identitätsfelder bewusst freigeben</DialogTitle>
          <DialogDescription>
            Nichts ist vorausgewählt. Erstelle zuerst eine exakte Vorschau; erst
            deine separate Bestätigung gibt diese Momentaufnahme an {companyName}
            frei.
          </DialogDescription>
        </DialogHeader>

        <form action={previewAction} className="grid gap-4 rounded-xl border p-4">
          <input type="hidden" name="requestId" value={requestId} />
          <fieldset className="grid gap-3">
            <legend className="font-medium">Felder für die Vorschau wählen</legend>
            {available.map((field) => (
              <label key={field.value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="fields"
                  value={field.value}
                  className="size-4 accent-primary"
                />
                {field.label}
              </label>
            ))}
          </fieldset>
          <ActionMessage state={previewState} />
          <Button type="submit" variant="outline" disabled={previewPending}>
            {previewPending ? "Vorschau wird erstellt …" : "Exakte Vorschau erstellen"}
          </Button>
        </form>

        {previewState.preview === undefined ? null : (
          <form action={grantAction} className="grid gap-4 rounded-xl border border-primary/30 p-4">
            <input type="hidden" name="requestId" value={requestId} />
            <input
              type="hidden"
              name="confirmationToken"
              value={previewState.preview.confirmationToken}
            />
            <input
              type="hidden"
              name="idempotencyKey"
              value={grantIdempotencyKey}
            />
            <div>
              <p className="font-medium">Diese Werte werden freigegeben</p>
              <dl className="mt-3 grid gap-3">
                {previewState.preview.values.map((value) => (
                  <PreviewValue key={value.field} value={value} />
                ))}
              </dl>
            </div>
            <div className="rounded-lg bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
              <p>Empfängerin: {previewState.preview.recipientCompanyName}</p>
              <p>Einwilligungsversion: {previewState.preview.noticeVersion}</p>
              <p>
                Vorschau gültig bis: {formatExpiry(previewState.preview.expiresAt)}
              </p>
            </div>
            <label className="flex items-start gap-2 text-sm leading-6">
              <input
                type="checkbox"
                name="confirmed"
                value="true"
                required
                className="mt-1 size-4 accent-primary"
              />
              <span>
                Ich bestätige genau diese Felder und Werte für {companyName}.
              </span>
            </label>
            <ActionMessage state={grantState} />
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                Abbrechen
              </DialogClose>
              <Button type="submit" disabled={grantPending}>
                {grantPending ? "Wird freigegeben …" : "Auswahl verbindlich freigeben"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RevokeDialog({
  requestId,
  grantId,
  companyName,
  revokeIdempotencyKey,
}: Readonly<{
  requestId: string;
  grantId: string;
  companyName: string;
  revokeIdempotencyKey: string;
}>) {
  const [state, action, pending] = useActionState(
    revokeCandidateRadarRevealAction,
    INITIAL_STATE,
  );
  return (
    <Dialog>
      <DialogTrigger
        render={<Button type="button" variant="outline" className="w-fit" />}
      >
        <ShieldOffIcon aria-hidden="true" /> Identitätsfreigabe widerrufen
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Identitätsfreigabe widerrufen?</DialogTitle>
          <DialogDescription>
            Nach dem Widerruf erhält {companyName} über SwissTalentHub keinen
            weiteren Zugriff auf die freigegebenen Felder. Bereits gesehene oder
            kopierte Daten können technisch nicht ungesehen gemacht werden.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="grantId" value={grantId} />
          <input
            type="hidden"
            name="confirmationVersion"
            value="identity-reveal-revoke-v1"
          />
          <input
            type="hidden"
            name="idempotencyKey"
            value={revokeIdempotencyKey}
          />
          <div className="grid gap-1.5">
            <Label htmlFor="reveal-revoke-reason">Grund</Label>
            <select
              id="reveal-revoke-reason"
              name="reasonCode"
              defaultValue="PRIVACY_CHOICE"
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
            >
              <option value="PRIVACY_CHOICE">Meine Datenschutzentscheidung</option>
              <option value="TRUST_CONCERN">Vertrauensbedenken</option>
              <option value="OTHER">Anderer Grund</option>
            </select>
          </div>
          <label className="flex items-start gap-2 text-sm leading-6">
            <input
              type="checkbox"
              name="confirmed"
              value="true"
              required
              className="mt-1 size-4 accent-primary"
            />
            <span>
              Ich habe verstanden, dass bereits gesehene oder kopierte Daten nicht
              technisch zurückgeholt werden können.
            </span>
          </label>
          <ActionMessage state={state} />
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Abbrechen
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Wird widerrufen …" : "Freigabe verbindlich widerrufen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PreviewValue({ value }: Readonly<{ value: RevealValue }>) {
  const label = FIELD_OPTIONS.find((field) => field.value === value.field)?.label;
  const display =
    value.field === "CV_METADATA"
      ? `${value.value.fileName} · ${value.value.mimeType} · ${formatBytes(value.value.sizeBytes)}`
      : value.value;
  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm">{display}</dd>
    </div>
  );
}

function ActionMessage({
  state,
}: Readonly<{ state: CandidateRadarActionState | CandidateRevealPreviewState }>) {
  if (state.status === "idle") return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {state.message}
    </p>
  );
}

function formatBytes(sizeBytes: number): string {
  return `${new Intl.NumberFormat("de-CH", { maximumFractionDigits: 1 }).format(
    sizeBytes / 1_024 / 1_024,
  )} MB`;
}

function formatExpiry(value: string): string {
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Zurich",
  }).format(new Date(value));
}
