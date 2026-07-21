"use client";

import { useActionState } from "react";

import {
  acceptInvitationAction,
  registerInvitationAccountAction,
} from "@/app/(auth)/invite/resume/actions";
import { EmployerActionFeedback, EmployerSubmitButton } from "@/components/employer/action-form-parts";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { INITIAL_EMPLOYER_ACTION_STATE } from "@/lib/employer/action-state";

export function InvitationAcceptance({ authenticated, companyName, intendedRole }: Readonly<{ authenticated: boolean; companyName?: string; intendedRole?: string }>) {
  const [acceptState, acceptAction, acceptPending] = useActionState(acceptInvitationAction, INITIAL_EMPLOYER_ACTION_STATE);
  const [registerState, registerAction, registerPending] = useActionState(registerInvitationAccountAction, INITIAL_EMPLOYER_ACTION_STATE);
  if (authenticated) return <form action={acceptAction} className="grid gap-4"><p>Du trittst <strong>{companyName}</strong> als {intendedRole} bei.</p><EmployerSubmitButton pending={acceptPending} label="Einladung annehmen" pendingLabel="Sitzplatz wird geprüft …" /><EmployerActionFeedback state={acceptState} /></form>;
  return <form action={registerAction} className="grid gap-4"><div className="grid gap-1.5"><Label htmlFor="invite-name">Name</Label><Input id="invite-name" name="name" required minLength={2} maxLength={160} autoComplete="name" /></div><div className="grid gap-1.5"><Label htmlFor="invite-register-email">E-Mail der Einladung</Label><Input id="invite-register-email" name="email" type="email" required maxLength={320} autoComplete="email" /></div><div className="grid gap-1.5"><Label htmlFor="invite-password">Passwort</Label><Input id="invite-password" name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></div><label className="flex items-start gap-2 text-sm"><Checkbox name="acceptedTerms" value="true" required /><span>Ich akzeptiere die Nutzungsbedingungen (Fassung 20. Juli 2026).</span></label><label className="flex items-start gap-2 text-sm"><Checkbox name="marketingConsent" value="true" /><span>Ich möchte freiwillig Produktneuigkeiten erhalten.</span></label><EmployerSubmitButton pending={registerPending} label="Konto erstellen und beitreten" pendingLabel="Einladung wird geprüft …" /><EmployerActionFeedback state={registerState} /></form>;
}
