"use client";

import { useActionState } from "react";

import { saveBillingProfileAction } from "@/app/employer/billing/profile/actions";
import { EmployerActionFeedback, EmployerSubmitButton } from "@/components/employer/action-form-parts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  INITIAL_BILLING_ACTION_STATE,
} from "@/lib/billing/employer-action-state";
import type { BillingProfileReadModel } from "@/lib/billing/employer-read-model";

export function BillingProfileForm({
  profile,
}: Readonly<{ profile: BillingProfileReadModel | null }>) {
  const [state, action, pending] = useActionState(
    saveBillingProfileAction,
    INITIAL_BILLING_ACTION_STATE,
  );
  return (
    <form action={action} className="grid gap-5">
      <input
        type="hidden"
        name="expectedVersion"
        value={profile?.version ?? ""}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="billing-legal-name"
          name="legalName"
          label="Rechtlicher Firmenname"
          defaultValue={profile?.legalName}
          autoComplete="organization"
          maxLength={200}
          required
        />
        <Field
          id="billing-email"
          name="billingContactEmail"
          label="E-Mail für Rechnungen"
          defaultValue={profile?.billingContactEmail}
          type="email"
          autoComplete="email"
          maxLength={320}
          required
        />
        <Field
          id="billing-street"
          name="street"
          label="Strasse und Hausnummer"
          defaultValue={profile?.street}
          autoComplete="street-address"
          maxLength={200}
          required
        />
        <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3">
          <Field
            id="billing-postal-code"
            name="postalCode"
            label="PLZ"
            defaultValue={profile?.postalCode}
            autoComplete="postal-code"
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
            required
          />
          <Field
            id="billing-city"
            name="city"
            label="Ort"
            defaultValue={profile?.city}
            autoComplete="address-level2"
            maxLength={160}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="billing-country">Land</Label>
          <Input id="billing-country" value="Schweiz" disabled />
          <input type="hidden" name="countryCode" value="CH" />
          <p className="text-xs text-muted-foreground">
            Im Mock-MVP sind nur Schweizer Rechnungsprofile freigegeben.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            id="billing-uid"
            name="uid"
            label="UID (optional)"
            defaultValue={profile?.uid ?? ""}
            placeholder="CHE-123.456.789"
            maxLength={32}
          />
          <Field
            id="billing-vat-number"
            name="vatNumber"
            label="MWST-Nr. (optional)"
            defaultValue={profile?.vatNumber ?? ""}
            placeholder="CHE-123.456.789 MWST"
            maxLength={32}
          />
        </div>
      </div>
      <EmployerActionFeedback state={state} />
      <EmployerSubmitButton
        pending={pending}
        label="Rechnungsprofil speichern"
        pendingLabel="Wird sicher gespeichert …"
      />
    </form>
  );
}

function Field({
  id,
  label,
  ...input
}: Readonly<React.ComponentProps<typeof Input> & { id: string; label: string }>) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...input} />
    </div>
  );
}
