"use client";

import { useActionState } from "react";

import { cancelSubscriptionAction } from "@/app/employer/billing/actions";
import { EmployerActionFeedback, EmployerSubmitButton } from "@/components/employer/action-form-parts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { INITIAL_BILLING_ACTION_STATE } from "@/lib/billing/employer-action-state";
import { formatDate } from "@/lib/utils/format";

export function CancelSubscriptionDialog({
  periodEnd,
  idempotencyKey,
  retentionOptions,
}: Readonly<{
  periodEnd: Date;
  idempotencyKey: string;
  retentionOptions: readonly Readonly<{
    membershipId: string;
    label: string;
    role: "OWNER" | "ADMIN" | "RECRUITER" | "VIEWER";
    selectedByDefault: boolean;
  }>[];
}>) {
  const [state, action, pending] = useActionState(
    cancelSubscriptionAction,
    INITIAL_BILLING_ACTION_STATE,
  );
  const retentionLimit = retentionOptions.filter(
    (membership) => membership.selectedByDefault,
  ).length;
  return (
    <Dialog>
      <DialogTrigger render={<Button type="button" variant="destructive" />}>
        Abo kündigen
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Abonnement per Periodenende kündigen?</DialogTitle>
          <DialogDescription>
            Die bezahlten Rechte bleiben bis unmittelbar vor {formatDate(periodEnd)}
            bestehen. Danach gilt automatisch Free Basic; es wird kein künstliches
            Free-Abonnement erstellt.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <div className="rounded-lg bg-muted p-3 text-sm leading-6">
            Teammitglieder über der Free-Sitzplatzlimite werden am Stichtag
            suspendiert. Offene Einladungen werden widerrufen. Historische
            Bewerbungen und Rechnungen bleiben lesbar.
          </div>
          <fieldset className="grid gap-2 rounded-lg border p-3">
            <legend className="px-1 text-sm font-semibold">
              Team unter Free Basic beibehalten
            </legend>
            <p className="text-xs leading-5 text-muted-foreground">
              Wähle {retentionLimit === 1 ? "eine Person" : `höchstens ${retentionLimit} Personen`}.
              Mindestens eine aktive Owner-Mitgliedschaft muss erhalten bleiben;
              die sichere Owner-zuerst-Auswahl ist vorausgewählt.
            </p>
            {retentionOptions.map((membership) => (
              <label
                key={membership.membershipId}
                className="flex items-center gap-2 text-sm"
              >
                <Checkbox
                  name="retainedMembershipIds"
                  value={membership.membershipId}
                  defaultChecked={membership.selectedByDefault}
                />
                <span>{membership.label} · {membership.role}</span>
              </label>
            ))}
          </fieldset>
          <div className="flex items-start gap-2">
            <Checkbox id="cancel-confirm" name="confirm" value="yes" required />
            <Label htmlFor="cancel-confirm" className="leading-5">
              Ich habe die Auswirkungen per Periodenende verstanden.
            </Label>
          </div>
          <EmployerActionFeedback state={state} />
          <DialogFooter className="mx-0 mb-0 px-0 pb-0">
            <DialogClose render={<Button type="button" variant="outline" />}>Zurück</DialogClose>
            <EmployerSubmitButton
              pending={pending}
              label="Kündigung vormerken"
              pendingLabel="Wird vorgemerkt …"
              variant="destructive"
            />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
