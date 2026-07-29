"use client";

import { useActionState } from "react";

import {
  cancelEmployerInterviewAction,
  proposeEmployerInterviewAction,
  respondToEmployerInterviewAction,
} from "@/app/employer/applicants/[id]/interviews/actions";
import { EmployerActionFeedback } from "@/components/employer/action-form-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  INITIAL_EMPLOYER_ACTION_STATE,
} from "@/lib/employer/action-state";

export function EmployerInterviewProposalForm({
  applicationId,
  defaultSubject,
  idempotencyKey,
}: Readonly<{
  applicationId: string;
  defaultSubject: string;
  idempotencyKey: string;
}>) {
  const [state, action, pending] = useActionState(
    proposeEmployerInterviewAction,
    INITIAL_EMPLOYER_ACTION_STATE,
  );
  return (
    <form action={action} className="grid gap-4 rounded-xl border bg-card p-5">
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="timeZone" value="Europe/Zurich" />
      <input
        type="hidden"
        name="idempotencyKey"
        value={state.nextIdempotencyKey ?? idempotencyKey}
      />
      <div>
        <h2 className="font-semibold">Interviewzeiten vorschlagen</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Die Auswahl bestätigt noch keinen Termin. Zeitzone: Europe/Zurich.
        </p>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="interview-subject">Betreff</Label>
        <Input
          id="interview-subject"
          name="subject"
          defaultValue={defaultSubject}
          minLength={2}
          maxLength={200}
          required
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="interview-location">Ort oder Videolink (optional)</Label>
        <Input id="interview-location" name="location" maxLength={300} />
      </div>
      {[1, 2, 3].map((slot) => (
        <fieldset key={slot} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
          <legend className="px-1 text-sm font-medium">
            Vorschlag {slot}
            {slot === 1 ? " (erforderlich)" : " (optional)"}
          </legend>
          <div className="grid gap-1">
            <Label htmlFor={`slot-${slot}-start`}>Beginn</Label>
            <Input
              id={`slot-${slot}-start`}
              name="slotStartsAtLocal"
              type="datetime-local"
              required={slot === 1}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`slot-${slot}-end`}>Ende</Label>
            <Input
              id={`slot-${slot}-end`}
              name="slotEndsAtLocal"
              type="datetime-local"
              required={slot === 1}
            />
          </div>
        </fieldset>
      ))}
      <Button type="submit" disabled={pending}>
        {pending ? "Wird sicher gesendet …" : "Terminvorschläge senden"}
      </Button>
      <EmployerActionFeedback state={state} />
    </form>
  );
}

export function EmployerInterviewActions({
  applicationId,
  interviewId,
  version,
  proposals,
  canRespond,
  canCancel,
  featureEnabled,
  keys,
}: Readonly<{
  applicationId: string;
  interviewId: string;
  version: number;
  proposals: readonly Readonly<{ id: string; label: string }>[];
  canRespond: boolean;
  canCancel: boolean;
  featureEnabled: boolean;
  keys: Readonly<{ response: string; reschedule: string; cancel: string }>;
}>) {
  const [responseState, responseAction, responsePending] = useActionState(
    respondToEmployerInterviewAction,
    INITIAL_EMPLOYER_ACTION_STATE,
  );
  const [rescheduleState, rescheduleAction, reschedulePending] = useActionState(
    respondToEmployerInterviewAction,
    INITIAL_EMPLOYER_ACTION_STATE,
  );
  const [cancelState, cancelAction, cancelPending] = useActionState(
    cancelEmployerInterviewAction,
    INITIAL_EMPLOYER_ACTION_STATE,
  );
  const common = (
    <>
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="interviewId" value={interviewId} />
      <input type="hidden" name="expectedVersion" value={version} />
    </>
  );

  return (
    <div className="grid gap-5">
      {!featureEnabled ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          Neue Terminaktionen sind pausiert. Die Historie und sichere Absage
          bleiben verfügbar.
        </p>
      ) : null}
      {featureEnabled && canRespond && proposals.length > 0 ? (
        <form action={responseAction} className="grid gap-3 rounded-xl border p-4">
          {common}
          <input
            type="hidden"
            name="idempotencyKey"
            value={responseState.nextIdempotencyKey ?? keys.response}
          />
          <Label htmlFor="employer-interview-proposal">
            Gegenvorschlag
          </Label>
          <select
            id="employer-interview-proposal"
            name="proposalId"
            className="h-10 rounded-lg border bg-background px-3 text-sm"
          >
            {proposals.map((proposal) => (
              <option key={proposal.id} value={proposal.id}>
                {proposal.label}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              name="kind"
              value="ACCEPT"
              disabled={responsePending}
            >
              Gegenvorschlag bestätigen
            </Button>
            <Button
              type="submit"
              name="kind"
              value="DECLINE"
              variant="outline"
              disabled={responsePending}
            >
              Ablehnen
            </Button>
          </div>
          <EmployerActionFeedback state={responseState} />
        </form>
      ) : null}
      {featureEnabled && canRespond ? (
        <form
          action={rescheduleAction}
          className="grid gap-3 rounded-xl border p-4"
        >
          {common}
          <input type="hidden" name="kind" value="RESCHEDULE" />
          <input type="hidden" name="timeZone" value="Europe/Zurich" />
          <input
            type="hidden"
            name="idempotencyKey"
            value={rescheduleState.nextIdempotencyKey ?? keys.reschedule}
          />
          <h2 className="font-semibold">Andere Zeit vorschlagen</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="employer-reschedule-start">Beginn</Label>
              <Input
                id="employer-reschedule-start"
                name="startsAtLocal"
                type="datetime-local"
                required
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="employer-reschedule-end">Ende</Label>
              <Input
                id="employer-reschedule-end"
                name="endsAtLocal"
                type="datetime-local"
                required
              />
            </div>
          </div>
          <Button type="submit" variant="outline" disabled={reschedulePending}>
            Neue Zeit senden
          </Button>
          <EmployerActionFeedback state={rescheduleState} />
        </form>
      ) : null}
      {canCancel ? (
        <form action={cancelAction} className="grid gap-3 rounded-xl border p-4">
          {common}
          <input
            type="hidden"
            name="idempotencyKey"
            value={cancelState.nextIdempotencyKey ?? keys.cancel}
          />
          <Button type="submit" variant="destructive" disabled={cancelPending}>
            Interview verbindlich absagen
          </Button>
          <EmployerActionFeedback state={cancelState} />
        </form>
      ) : null}
    </div>
  );
}
