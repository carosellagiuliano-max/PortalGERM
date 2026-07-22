"use client";

import { useActionState } from "react";

import { cancelContactRequestAction } from "@/app/employer/talent-radar/actions";
import { EmployerActionFeedback, EmployerSubmitButton } from "@/components/employer/action-form-parts";
import { INITIAL_TALENT_RADAR_ACTION_STATE } from "@/components/employer/TalentRadar/action-state";

export function CancelRequestForm({
  requestId,
  idempotencyKey,
}: Readonly<{ requestId: string; idempotencyKey: string }>) {
  const [state, action, pending] = useActionState(
    cancelContactRequestAction,
    INITIAL_TALENT_RADAR_ACTION_STATE,
  );
  return (
    <form action={action} className="grid gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
      <input type="hidden" name="requestId" value={requestId} />
      <input
        type="hidden"
        name="idempotencyKey"
        value={state.nextIdempotencyKey ?? idempotencyKey}
      />
      <div>
        <h2 className="font-medium">Anfrage zurückziehen</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Nur ausstehende Anfragen können zurückgezogen werden. Der bereits
          verwendete Credit wird nicht automatisch erstattet.
        </p>
      </div>
      <EmployerSubmitButton
        pending={pending}
        label="Kontaktanfrage zurückziehen"
        pendingLabel="Wird zurückgezogen …"
        variant="destructive"
      />
      <EmployerActionFeedback state={state} />
    </form>
  );
}
