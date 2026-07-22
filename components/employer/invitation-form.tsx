"use client";

import { useActionState } from "react";

import { sendInvitationAction } from "@/app/employer/team/actions";
import { UpgradeDialog } from "@/components/billing/upgrade-dialog";
import { EmployerActionFeedback, EmployerSubmitButton } from "@/components/employer/action-form-parts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { INITIAL_EMPLOYER_ACTION_STATE } from "@/lib/employer/action-state";

export function InvitationForm() {
  const [state, action, pending] = useActionState(sendInvitationAction, INITIAL_EMPLOYER_ACTION_STATE);
  return (
    <form action={action} className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
      <div className="grid gap-1.5"><Label htmlFor="invite-email">E-Mail</Label><Input id="invite-email" name="email" type="email" required maxLength={320} placeholder="team@firma.ch" /></div>
      <div className="grid gap-1.5"><Label htmlFor="invite-role">Rolle</Label><select id="invite-role" name="role" className="h-8 rounded-lg border bg-background px-2 text-sm" defaultValue="RECRUITER"><option value="OWNER">Inhaber:in</option><option value="ADMIN">Admin</option><option value="RECRUITER">Recruiter:in</option><option value="VIEWER">Leser:in</option></select></div>
      <EmployerSubmitButton pending={pending} label="Einladen" pendingLabel="Wird reserviert …" />
      <div className="grid gap-3 sm:col-span-3">
        <EmployerActionFeedback state={state} />
        {state.upgradePrompt === undefined ? null : (
          <UpgradeDialog prompt={state.upgradePrompt} defaultOpen />
        )}
      </div>
    </form>
  );
}
