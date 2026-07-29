"use client";

import { useActionState } from "react";

import {
  createExternalTrackerAction,
  setExternalTrackerReminderAction,
  transitionExternalTrackerAction,
} from "@/app/candidate/applications/external/actions";
import {
  INITIAL_APPLICATION_ACTION_STATE,
} from "@/lib/applications/action-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ExternalTrackerResumeForm({
  idempotencyKey,
}: Readonly<{ idempotencyKey: string }>) {
  const [state, action, pending] = useActionState(
    createExternalTrackerAction,
    INITIAL_APPLICATION_ACTION_STATE,
  );
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <Button type="submit" disabled={pending}>
        {pending ? "Wird übernommen …" : "Freiwillig als begonnen übernehmen"}
      </Button>
      <ActionMessage state={state} />
    </form>
  );
}

export function ExternalTrackerActions({
  trackerId,
  version,
  nextStatuses,
  statusIdempotencyKey,
  reminderIdempotencyKey,
  featureEnabled,
}: Readonly<{
  trackerId: string;
  version: number;
  nextStatuses: readonly string[];
  statusIdempotencyKey: string;
  reminderIdempotencyKey: string;
  featureEnabled: boolean;
}>) {
  const [statusState, statusAction, statusPending] = useActionState(
    transitionExternalTrackerAction,
    INITIAL_APPLICATION_ACTION_STATE,
  );
  const [reminderState, reminderAction, reminderPending] = useActionState(
    setExternalTrackerReminderAction,
    INITIAL_APPLICATION_ACTION_STATE,
  );
  const currentVersion = Math.max(
    version,
    actionVersion(statusState.values?.version),
    actionVersion(reminderState.values?.version),
  );
  return (
    <div className="grid gap-6">
      {!featureEnabled ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          Neue Änderungen und Erinnerungen sind pausiert. Der bisherige
          Verlauf bleibt vollständig lesbar.
        </p>
      ) : null}
      {!featureEnabled || nextStatuses.length === 0 ? null : (
        <form action={statusAction} className="grid gap-3">
          <input type="hidden" name="trackerId" value={trackerId} />
          <input type="hidden" name="expectedVersion" value={currentVersion} />
          <input
            type="hidden"
            name="idempotencyKey"
            value={statusState.nextIdempotencyKey ?? statusIdempotencyKey}
          />
          <Label htmlFor="external-next-status">Neuer, von dir bestätigter Status</Label>
          <select
            id="external-next-status"
            name="nextStatus"
            className="h-10 rounded-lg border bg-background px-3 text-sm"
          >
            {nextStatuses.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status] ?? status}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={statusPending}>
            {statusPending ? "Wird gespeichert …" : "Eigene Angabe speichern"}
          </Button>
          <ActionMessage state={statusState} />
        </form>
      )}

      {featureEnabled ? (
      <form action={reminderAction} className="grid gap-3">
        <input type="hidden" name="trackerId" value={trackerId} />
        <input type="hidden" name="expectedVersion" value={currentVersion} />
        <input
          type="hidden"
          name="idempotencyKey"
          value={reminderState.nextIdempotencyKey ?? reminderIdempotencyKey}
        />
        <input type="hidden" name="timeZone" value="Europe/Zurich" />
        <Label htmlFor="external-reminder-at">Freiwillige Erinnerung (Zürich)</Label>
        <Input
          id="external-reminder-at"
          name="reminderAtLocal"
          type="datetime-local"
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={reminderPending}>
            Erinnerung speichern
          </Button>
          <Button
            type="submit"
            name="removeReminder"
            value="true"
            variant="outline"
            disabled={reminderPending}
          >
            Erinnerung entfernen
          </Button>
        </div>
        <ActionMessage state={reminderState} />
      </form>
      ) : null}
    </div>
  );
}

function ActionMessage({
  state,
}: Readonly<{ state: typeof INITIAL_APPLICATION_ACTION_STATE }>) {
  return state.message === undefined ? null : (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={
        state.status === "error"
          ? "text-sm text-destructive"
          : "text-sm text-muted-foreground"
      }
    >
      {state.message}
    </p>
  );
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  SUBMITTED: "Als eingereicht bestätigt",
  INTERVIEW: "Interview",
  OFFER: "Angebot",
  REJECTED: "Absage",
  HIRED: "Eingestellt",
  WITHDRAWN: "Zurückgezogen",
  ARCHIVED: "Archivieren",
};

function actionVersion(value: string | boolean | undefined) {
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}
