"use client";

import { useActionState } from "react";

import {
  cancelCandidatePrivacyRequestAction,
  INITIAL_CANDIDATE_PRIVACY_ACTION_STATE,
} from "@/app/candidate/privacy/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function PrivacyCaseCancelForm({
  requestId,
  version,
  idempotencyKey,
}: Readonly<{
  requestId: string;
  version: number;
  idempotencyKey: string;
}>) {
  const [state, action, pending] = useActionState(
    cancelCandidatePrivacyRequestAction,
    INITIAL_CANDIDATE_PRIVACY_ACTION_STATE,
  );
  return (
    <form action={action} className="grid gap-3 rounded-lg border p-3">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <p className="text-sm text-muted-foreground">
        Nur offene oder noch in der Identitätsprüfung befindliche Fälle können
        abgebrochen werden.
      </p>
      <Button type="submit" variant="outline" disabled={pending || state.status === "success"}>
        {pending ? "Wird abgebrochen …" : "Anfrage abbrechen"}
      </Button>
      {state.status === "idle" ? null : (
        <Alert variant={state.status === "error" ? "destructive" : "default"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}
