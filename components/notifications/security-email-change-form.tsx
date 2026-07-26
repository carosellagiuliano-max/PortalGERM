"use client";

import { useActionState } from "react";

import { INITIAL_AUTH_ACTION_STATE } from "@/components/auth/auth-action-state";
import {
  FormFeedback,
  SubmitButton,
  formControlClassName,
} from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  cancelLoginEmailChangeAction,
  requestLoginEmailChangeAction,
} from "@/lib/auth/identity-actions";

export function SecurityEmailChangeForm({
  currentEmail,
  enabled,
  pendingTarget,
}: Readonly<{
  currentEmail: string;
  enabled: boolean;
  pendingTarget: string | null;
}>) {
  const [state, action, pending] = useActionState(
    requestLoginEmailChangeAction,
    INITIAL_AUTH_ACTION_STATE,
  );
  const [cancelState, cancelAction, cancelling] = useActionState(
    cancelLoginEmailChangeAction,
    INITIAL_AUTH_ACTION_STATE,
  );
  return (
    <div className="grid gap-5">
      <div className="rounded-lg bg-muted p-4 text-sm">
        <p className="font-medium">Aktuelle Login-Adresse</p>
        <p className="mt-1 break-all text-muted-foreground">{currentEmail}</p>
      </div>
      {pendingTarget === null ? null : (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">Bestätigung ausstehend</p>
          <p className="mt-1 break-all">
            {pendingTarget}. Bis zur Bestätigung bleibt die aktuelle Adresse
            autoritativ.
          </p>
          <form action={cancelAction} className="mt-3">
            <Button type="submit" variant="outline" disabled={cancelling}>
              {cancelling ? "Bricht ab …" : "Änderung abbrechen"}
            </Button>
          </form>
          <div className="mt-3">
            <FormFeedback state={cancelState} />
          </div>
        </div>
      )}
      {!enabled ? (
        <p
          className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground"
          role="status"
        >
          Die Login-E-Mail-Änderung ist für diese Umgebung noch gesperrt.
          Bestehende Login- und Recovery-Wege bleiben unverändert.
        </p>
      ) : (
        <form action={action} className="grid gap-4" noValidate>
          <FormFeedback state={state} />
          <div className="grid gap-2">
            <Label htmlFor="targetEmail">Neue E-Mail-Adresse</Label>
            <input
              id="targetEmail"
              name="targetEmail"
              type="email"
              autoComplete="email"
              className={formControlClassName(false)}
              defaultValue={
                typeof state.values?.targetEmail === "string"
                  ? state.values.targetEmail
                  : ""
              }
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="currentPassword">Aktuelles Passwort</Label>
            <input
              id="currentPassword"
              name="password"
              type="password"
              autoComplete="current-password"
              className={formControlClassName(false)}
            />
          </div>
          <SubmitButton
            pending={pending}
            idleLabel="Neue Adresse sicher vormerken"
            pendingLabel="Adresse wird geprüft …"
          />
        </form>
      )}
    </div>
  );
}
