"use client";

import { useActionState } from "react";

import {
  cancelCandidateInterviewAction,
  respondToCandidateInterviewAction,
} from "@/app/candidate/interviews/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  INITIAL_APPLICATION_ACTION_STATE,
  type ApplicationActionState,
} from "@/lib/applications/action-state";

type Proposal = Readonly<{
  id: string;
  label: string;
}>;

export function CandidateInterviewActions({
  interviewId,
  version,
  proposals,
  canRespond,
  canCancel,
  featureEnabled,
  keys,
}: Readonly<{
  interviewId: string;
  version: number;
  proposals: readonly Proposal[];
  canRespond: boolean;
  canCancel: boolean;
  featureEnabled: boolean;
  keys: Readonly<{
    response: string;
    reschedule: string;
    cancel: string;
  }>;
}>) {
  const [responseState, responseAction, responsePending] = useActionState(
    respondToCandidateInterviewAction,
    INITIAL_APPLICATION_ACTION_STATE,
  );
  const [rescheduleState, rescheduleAction, reschedulePending] = useActionState(
    respondToCandidateInterviewAction,
    INITIAL_APPLICATION_ACTION_STATE,
  );
  const [cancelState, cancelAction, cancelPending] = useActionState(
    cancelCandidateInterviewAction,
    INITIAL_APPLICATION_ACTION_STATE,
  );

  return (
    <div className="grid min-w-0 gap-5">
      {!featureEnabled ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          Neue Terminantworten sind pausiert. Bestehende Buchungen bleiben
          sichtbar und können sicher abgesagt oder exportiert werden.
        </p>
      ) : null}

      {featureEnabled && canRespond && proposals.length > 0 ? (
        <form
          action={responseAction}
          className="grid min-w-0 gap-3 rounded-xl border p-4"
        >
          <h2 className="font-semibold">Auf Vorschlag antworten</h2>
          <input type="hidden" name="interviewId" value={interviewId} />
          <input type="hidden" name="expectedVersion" value={version} />
          <input
            type="hidden"
            name="idempotencyKey"
            value={responseState.nextIdempotencyKey ?? keys.response}
          />
          <Label htmlFor="candidate-proposal">Terminvorschlag</Label>
          <select
            id="candidate-proposal"
            name="proposalId"
            className="h-10 w-full min-w-0 max-w-full rounded-lg border bg-background px-3 text-sm"
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
              Termin bestätigen
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
          <ActionFeedback state={responseState} />
        </form>
      ) : null}

      {featureEnabled && canRespond ? (
        <form
          action={rescheduleAction}
          className="grid min-w-0 gap-3 rounded-xl border p-4"
        >
          <h2 className="font-semibold">Andere Zeit vorschlagen</h2>
          <input type="hidden" name="interviewId" value={interviewId} />
          <input type="hidden" name="expectedVersion" value={version} />
          <input type="hidden" name="kind" value="RESCHEDULE" />
          <input type="hidden" name="timeZone" value="Europe/Zurich" />
          <input
            type="hidden"
            name="idempotencyKey"
            value={rescheduleState.nextIdempotencyKey ?? keys.reschedule}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="candidate-reschedule-start">
                Beginn (Zürich)
              </Label>
              <Input
                id="candidate-reschedule-start"
                name="startsAtLocal"
                type="datetime-local"
                required
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="candidate-reschedule-end">Ende (Zürich)</Label>
              <Input
                id="candidate-reschedule-end"
                name="endsAtLocal"
                type="datetime-local"
                required
              />
            </div>
          </div>
          <Button type="submit" variant="outline" disabled={reschedulePending}>
            Neue Zeit senden
          </Button>
          <ActionFeedback state={rescheduleState} />
        </form>
      ) : null}

      {canCancel ? (
        <form
          action={cancelAction}
          className="grid min-w-0 gap-3 rounded-xl border p-4"
        >
          <input type="hidden" name="interviewId" value={interviewId} />
          <input type="hidden" name="expectedVersion" value={version} />
          <input
            type="hidden"
            name="idempotencyKey"
            value={cancelState.nextIdempotencyKey ?? keys.cancel}
          />
          <Button type="submit" variant="destructive" disabled={cancelPending}>
            Interview verbindlich absagen
          </Button>
          <ActionFeedback state={cancelState} />
        </form>
      ) : null}
    </div>
  );
}

function ActionFeedback({
  state,
}: Readonly<{ state: ApplicationActionState }>) {
  if (state.message === undefined) return null;
  return (
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
