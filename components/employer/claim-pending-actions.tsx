"use client";

import { useActionState } from "react";

import { addClaimEvidenceAction, cancelClaimAction } from "@/app/employer/company/claim-pending/actions";
import { EmployerActionFeedback, EmployerSubmitButton } from "@/components/employer/action-form-parts";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { INITIAL_EMPLOYER_ACTION_STATE } from "@/lib/employer/action-state";

export function ClaimPendingActions({ existingEvidence }: Readonly<{ existingEvidence: string | null }>) {
  const [evidenceState, evidenceAction, evidencePending] = useActionState(addClaimEvidenceAction, INITIAL_EMPLOYER_ACTION_STATE);
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelClaimAction, INITIAL_EMPLOYER_ACTION_STATE);
  return <div className="grid gap-4"><form action={evidenceAction} className="grid gap-3 rounded-xl border bg-card p-4"><Label htmlFor="claim-evidence">Begrenzter Nachweis</Label><Textarea id="claim-evidence" name="evidence" required minLength={20} maxLength={1000} rows={5} defaultValue={existingEvidence ?? ""} placeholder="Beschreibe deine Funktion und welche prüfbaren Unterlagen du bereitstellen kannst. Keine Passwörter oder Ausweiskopien einfügen." /><EmployerSubmitButton pending={evidencePending} label="Nachweis ergänzen" /><EmployerActionFeedback state={evidenceState} /></form><form action={cancelAction} className="grid gap-2"><EmployerSubmitButton pending={cancelPending} label="Anspruch zurückziehen" variant="destructive" /><EmployerActionFeedback state={cancelState} /></form></div>;
}
