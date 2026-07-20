"use client";

import { useActionState } from "react";
import { FlagIcon, SaveIcon, Undo2Icon } from "lucide-react";

import {
  reportApplicationEmployerAction,
  updateCandidateApplicationNoteAction,
  withdrawCandidateApplicationAction,
} from "@/app/candidate/applications/actions";
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
import { Textarea } from "@/components/ui/textarea";
import { INITIAL_APPLICATION_ACTION_STATE } from "@/lib/applications/action-state";
import type { ApplicationStatus } from "@/lib/policies/status/application";

export function CandidateApplicationActions({
  applicationId,
  candidateNote,
  status,
  noteIdempotencyKey,
  withdrawIdempotencyKey,
}: Readonly<{
  applicationId: string;
  candidateNote: string | null;
  status: ApplicationStatus;
  noteIdempotencyKey: string;
  withdrawIdempotencyKey: string;
}>) {
  return (
    <div className="grid gap-5">
      <PrivateNoteForm
        applicationId={applicationId}
        candidateNote={candidateNote}
        initialIdempotencyKey={noteIdempotencyKey}
      />
      {canWithdraw(status) ? (
        <WithdrawForm
          applicationId={applicationId}
          initialIdempotencyKey={withdrawIdempotencyKey}
        />
      ) : null}
      <EmployerReportForm applicationId={applicationId} />
    </div>
  );
}

function PrivateNoteForm({
  applicationId,
  candidateNote,
  initialIdempotencyKey,
}: Readonly<{
  applicationId: string;
  candidateNote: string | null;
  initialIdempotencyKey: string;
}>) {
  const [state, action, pending] = useActionState(
    updateCandidateApplicationNoteAction,
    INITIAL_APPLICATION_ACTION_STATE,
  );
  return (
    <form action={action} className="grid gap-3 rounded-xl border p-4">
      <input type="hidden" name="applicationId" value={applicationId} />
      <input
        type="hidden"
        name="idempotencyKey"
        value={state.nextIdempotencyKey ?? initialIdempotencyKey}
      />
      <div>
        <Label htmlFor="candidate-application-note">Private Notiz</Label>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Nur für dich sichtbar; sie wird nicht an das Unternehmen übermittelt.
        </p>
      </div>
      <Textarea
        id="candidate-application-note"
        name="body"
        defaultValue={candidateNote ?? ""}
        maxLength={1_000}
        required
        rows={4}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ActionMessage state={state} />
        <Button type="submit" variant="outline" disabled={pending}>
          <SaveIcon aria-hidden="true" />
          {pending ? "Speichert …" : "Notiz speichern"}
        </Button>
      </div>
    </form>
  );
}

function WithdrawForm({
  applicationId,
  initialIdempotencyKey,
}: Readonly<{
  applicationId: string;
  initialIdempotencyKey: string;
}>) {
  const [state, action, pending] = useActionState(
    withdrawCandidateApplicationAction,
    INITIAL_APPLICATION_ACTION_STATE,
  );
  return (
    <Dialog>
      <div className="grid gap-3 rounded-xl border border-destructive/25 p-4">
        <p className="font-medium">Bewerbung zurückziehen</p>
        <p className="text-xs leading-5 text-muted-foreground">
          Der Statuswechsel ist endgültig und wird dem Unternehmen mitgeteilt.
        </p>
        <ActionMessage state={state} />
        <DialogTrigger render={<Button type="button" variant="destructive" className="w-fit" />}>
          <Undo2Icon aria-hidden="true" /> Bewerbung zurückziehen
        </DialogTrigger>
      </div>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bewerbung verbindlich zurückziehen?</DialogTitle>
          <DialogDescription>
            Diese Statusänderung ist endgültig und wird dem Unternehmen mitgeteilt.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          <input type="hidden" name="applicationId" value={applicationId} />
          <input
            type="hidden"
            name="idempotencyKey"
            value={state.nextIdempotencyKey ?? initialIdempotencyKey}
          />
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="confirmed"
              value="true"
              required
              className="mt-0.5 size-4 accent-primary"
            />
            <span>Ich bestätige, dass ich diese Bewerbung zurückziehen möchte.</span>
          </label>
          <ActionMessage state={state} />
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              Abbrechen
            </DialogClose>
            <Button
              type="submit"
              variant="destructive"
              disabled={pending || state.status === "success"}
            >
              <Undo2Icon aria-hidden="true" />
              {pending ? "Wird zurückgezogen …" : "Verbindlich zurückziehen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EmployerReportForm({ applicationId }: Readonly<{ applicationId: string }>) {
  const [state, action, pending] = useActionState(
    reportApplicationEmployerAction,
    INITIAL_APPLICATION_ACTION_STATE,
  );
  return (
    <details className="rounded-xl border p-4">
      <summary className="cursor-pointer font-medium">Verdächtiges Unternehmen melden</summary>
      <form action={action} className="mt-4 grid gap-3">
        <input type="hidden" name="applicationId" value={applicationId} />
        <div className="grid gap-1.5">
          <Label htmlFor="application-report-reason">Grund</Label>
          <select
            id="application-report-reason"
            name="reasonCode"
            required
            defaultValue=""
            className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm"
          >
            <option value="" disabled>Bitte auswählen</option>
            <option value="SCAM_OR_FRAUD">Betrug oder Täuschung</option>
            <option value="MISLEADING">Irreführende Angaben</option>
            <option value="DISCRIMINATION">Diskriminierung</option>
            <option value="OUTDATED">Nicht mehr aktuell</option>
            <option value="OTHER">Anderer Grund</option>
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="application-report-description">Beschreibung</Label>
          <Textarea
            id="application-report-description"
            name="description"
            minLength={20}
            maxLength={1_500}
            required
            rows={4}
            placeholder="Beschreibe nachvollziehbar, was dir aufgefallen ist."
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ActionMessage state={state} />
          <Button type="submit" variant="outline" disabled={pending}>
            <FlagIcon aria-hidden="true" />
            {pending ? "Wird gemeldet …" : "Sicher melden"}
          </Button>
        </div>
      </form>
    </details>
  );
}

function ActionMessage({
  state,
}: Readonly<{ state: typeof INITIAL_APPLICATION_ACTION_STATE }>) {
  if (state.status === "idle") return <span />;
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={state.status === "error" ? "text-xs text-destructive" : "text-xs text-emerald-700"}
    >
      {state.message}
    </p>
  );
}

function canWithdraw(status: ApplicationStatus) {
  return ["SUBMITTED", "IN_REVIEW", "SHORTLISTED", "INTERVIEW", "OFFER"].includes(status);
}
