"use client";

import { useActionState } from "react";

import { INITIAL_AUTH_ACTION_STATE } from "@/components/auth/auth-action-state";
import {
  FormFeedback,
  SubmitButton,
} from "@/components/auth/form-parts";
import { StepUpGrantControl } from "@/components/security/step-up-grant-control";
import { createCandidatePersonaAction } from "@/lib/auth/server-actions";

export function CandidatePersonaCreation({
  userId,
  securityHref,
}: Readonly<{
  userId: string;
  securityHref: string;
}>) {
  const [state, action, pending] = useActionState(
    createCandidatePersonaAction,
    INITIAL_AUTH_ACTION_STATE,
  );

  return (
    <section
      aria-labelledby="candidate-persona-create-title"
      className="grid gap-4 rounded-xl border bg-card p-4"
    >
      <div className="grid gap-1">
        <h2
          className="text-base font-semibold"
          id="candidate-persona-create-title"
        >
          Kandidaten-Arbeitsbereich hinzufügen
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Es entsteht ein leeres Kandidatenprofil. Firmenrechte, Adminrechte
          und bestehende Daten werden dadurch weder kopiert noch erweitert.
        </p>
      </div>
      <form action={action} className="grid gap-3">
        <StepUpGrantControl
          action="PERSONA_CANDIDATE_CREATE"
          purpose="IDENTITY_PERSONA"
          resourceId={userId}
          securityHref={securityHref}
        />
        <SubmitButton
          idleLabel="Kandidaten-Arbeitsbereich anlegen"
          pending={pending}
          pendingLabel="Berechtigung und Identität werden geprüft …"
        />
        <FormFeedback state={state} />
      </form>
    </section>
  );
}
