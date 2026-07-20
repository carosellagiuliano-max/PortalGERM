"use client";

import { useActionState, useEffect, useRef } from "react";

import { submitEmployerDemoLeadAction } from "@/app/(public)/employers/demo/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  INITIAL_LEAD_ACTION_STATE,
  type LeadActionField,
  type LeadActionState,
} from "@/lib/sales/lead-action-state";
import type { LeadFormInput } from "@/lib/validation/billing";

const companySizes = [
  ["1_9", "1–9 Mitarbeitende"],
  ["10_49", "10–49 Mitarbeitende"],
  ["50_249", "50–249 Mitarbeitende"],
  ["250_999", "250–999 Mitarbeitende"],
  ["1000_PLUS", "1'000 oder mehr Mitarbeitende"],
] as const;

const hiringNeeds = [
  ["ONE_ROLE", "Eine konkrete Stelle"],
  ["TWO_TO_FIVE", "2–5 Einstellungen"],
  ["SIX_TO_TWENTY", "6–20 Einstellungen"],
  ["TWENTY_PLUS", "Mehr als 20 Einstellungen"],
  ["EXPLORING", "Erst orientieren"],
] as const;

const interests = [
  ["GENERAL", "Allgemeine Demo"],
  ["STARTER", "Starter"],
  ["PRO", "Pro"],
  ["BUSINESS", "Business"],
  ["ENTERPRISE", "Enterprise"],
  ["IMPORT", "XML-/JSON-Import"],
] as const;

const callbackWindows = [
  ["MORNING", "Vormittags"],
  ["AFTERNOON", "Nachmittags"],
  ["ANYTIME", "Zeitlich flexibel"],
] as const;

export function LeadForm({
  idempotencyKey,
  initialInterest,
  privacyNotice,
}: Readonly<{
  idempotencyKey: string;
  initialInterest: LeadFormInput["interestCode"];
  privacyNotice: string;
}>) {
  const [state, action, pending] = useActionState(
    submitEmployerDemoLeadAction,
    INITIAL_LEAD_ACTION_STATE,
  );
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status === "success") resultRef.current?.focus();
  }, [state.status]);

  if (state.status === "success") {
    return (
      <div
        ref={resultRef}
        role="status"
        tabIndex={-1}
        className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-950 outline-none"
      >
        <h2 className="text-xl font-semibold">Anfrage erfasst</h2>
        <p className="mt-3 leading-7">{state.message}</p>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-5" noValidate>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[-10000px] top-auto size-px overflow-hidden"
      >
        <label htmlFor="website-confirmation">Website bestätigen</label>
        <input
          id="website-confirmation"
          name="websiteConfirmation"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      {state.status === "error" ? (
        <div role="alert" className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
          {state.message}
        </div>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          id="lead-company"
          name="companyName"
          label="Unternehmen"
          autoComplete="organization"
          maxLength={200}
          state={state}
        />
        <TextField
          id="lead-contact"
          name="contactName"
          label="Kontaktperson"
          autoComplete="name"
          maxLength={160}
          state={state}
        />
        <TextField
          id="lead-email"
          name="email"
          label="Geschäftliche E-Mail"
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={320}
          state={state}
        />
        <TextField
          id="lead-phone"
          name="phone"
          label="Telefon (optional)"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={32}
          placeholder="+41 79 123 45 67"
          required={false}
          state={state}
        />
        <SelectField
          id="lead-size"
          name="companySizeCode"
          label="Unternehmensgrösse"
          placeholder="Grösse wählen"
          options={companySizes}
          state={state}
        />
        <SelectField
          id="lead-need"
          name="hiringNeedCode"
          label="Einstellungsbedarf"
          placeholder="Bedarf wählen"
          options={hiringNeeds}
          state={state}
        />
        <SelectField
          id="lead-interest"
          name="interestCode"
          label="Interesse"
          placeholder="Thema wählen"
          options={interests}
          defaultValue={initialInterest}
          state={state}
        />
        <SelectField
          id="lead-callback"
          name="callbackWindowCode"
          label="Gewünschtes Rückruffenster (optional)"
          placeholder="Kein Wunsch"
          options={callbackWindows}
          required={false}
          state={state}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="lead-message">Worum geht es?</Label>
        <Textarea
          id="lead-message"
          name="message"
          required
          minLength={20}
          maxLength={2_000}
          rows={6}
          defaultValue={state.values?.message}
          aria-invalid={hasError(state.fieldErrors, "message") || undefined}
          aria-describedby="lead-message-help lead-message-error"
          placeholder="Beschreibe kurz, welche Rollen oder welchen Ablauf du besprechen möchtest. Bitte keine besonders schützenswerten Personendaten eintragen."
        />
        <p id="lead-message-help" className="text-xs leading-5 text-muted-foreground">
          20 bis 2&apos;000 Zeichen. Keine Bewerbungsunterlagen oder sensiblen Personendaten.
        </p>
        <FieldError id="lead-message-error" errors={state.fieldErrors?.message} />
      </div>

      <div className="rounded-xl border bg-muted/30 p-4">
        <label className="flex items-start gap-3 text-sm leading-6">
          <input
            type="checkbox"
            name="acceptedContactPurpose"
            value="yes"
            required
            className="mt-1 size-4 shrink-0 accent-primary"
            aria-invalid={hasError(state.fieldErrors, "acceptedContactPurpose") || undefined}
            aria-describedby="lead-purpose-notice lead-purpose-error"
          />
          <span>
            Ich bitte SwissTalentHub, mich zu dieser Anfrage zu kontaktieren.
            Dies ist keine Einwilligung in allgemeine Marketing-E-Mails.
          </span>
        </label>
        <p id="lead-purpose-notice" className="mt-3 text-xs leading-5 text-muted-foreground">
          {privacyNotice}
        </p>
        <FieldError id="lead-purpose-error" errors={state.fieldErrors?.acceptedContactPurpose} />
      </div>

      <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-fit">
        {pending ? "Anfrage wird sicher erfasst …" : "Demo anfragen"}
      </Button>
    </form>
  );
}

type LeadState = LeadActionState;

function TextField({
  id,
  name,
  label,
  state,
  required = true,
  type = "text",
  ...inputProps
}: Readonly<{
  id: string;
  name: Extract<LeadActionField, "companyName" | "contactName" | "email" | "phone">;
  label: string;
  state: LeadState;
  required?: boolean;
  type?: React.HTMLInputTypeAttribute;
}> & Pick<React.ComponentProps<"input">, "autoComplete" | "inputMode" | "maxLength" | "placeholder">) {
  const errorId = `${id}-error`;
  const invalid = hasError(state.fieldErrors, name);
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        {...inputProps}
        id={id}
        name={name}
        type={type}
        required={required}
        defaultValue={state.values?.[name]}
        className="h-11"
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
      />
      <FieldError id={errorId} errors={state.fieldErrors?.[name]} />
    </div>
  );
}

function SelectField({
  id,
  name,
  label,
  placeholder,
  options,
  state,
  defaultValue,
  required = true,
}: Readonly<{
  id: string;
  name: Extract<LeadActionField, "companySizeCode" | "hiringNeedCode" | "interestCode" | "callbackWindowCode">;
  label: string;
  placeholder: string;
  options: readonly (readonly [string, string])[];
  state: LeadState;
  defaultValue?: string;
  required?: boolean;
}>) {
  const errorId = `${id}-error`;
  const invalid = hasError(state.fieldErrors, name);
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={name}
        required={required}
        defaultValue={state.values?.[name] ?? defaultValue ?? ""}
        className="h-11 rounded-md border border-input bg-background px-3 text-sm"
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
      >
        <option value="">{placeholder}</option>
        {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select>
      <FieldError id={errorId} errors={state.fieldErrors?.[name]} />
    </div>
  );
}

function FieldError({ id, errors }: Readonly<{ id: string; errors?: readonly string[] }>) {
  return <p id={id} className="text-xs text-destructive">{errors?.[0] ?? ""}</p>;
}

function hasError(
  errors: LeadState["fieldErrors"],
  field: LeadActionField,
) {
  return Boolean(errors?.[field]?.length);
}
