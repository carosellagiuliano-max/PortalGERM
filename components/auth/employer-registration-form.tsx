"use client";

import { useActionState } from "react";

import {
  INITIAL_AUTH_ACTION_STATE,
  inputDefaultKeyFromState,
  valueFromState,
} from "@/components/auth/auth-action-state";
import { PasswordFields } from "@/components/auth/candidate-registration-form";
import {
  FieldError,
  FormFeedback,
  NativeCheckboxField,
  SubmitButton,
  formControlClassName,
} from "@/components/auth/form-parts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerEmployerAction } from "@/lib/auth/server-actions";

const cantons = [
  ["AG", "Aargau"], ["AR", "Appenzell Ausserrhoden"],
  ["AI", "Appenzell Innerrhoden"], ["BL", "Basel-Landschaft"],
  ["BS", "Basel-Stadt"], ["BE", "Bern"], ["FR", "Fribourg"],
  ["GE", "Genève"], ["GL", "Glarus"], ["GR", "Graubünden"],
  ["JU", "Jura"], ["LU", "Luzern"], ["NE", "Neuchâtel"],
  ["NW", "Nidwalden"], ["OW", "Obwalden"], ["SH", "Schaffhausen"],
  ["SZ", "Schwyz"], ["SO", "Solothurn"], ["SG", "St. Gallen"],
  ["TG", "Thurgau"], ["TI", "Ticino"], ["UR", "Uri"],
  ["VS", "Valais"], ["VD", "Vaud"], ["ZG", "Zug"], ["ZH", "Zürich"],
] as const;

const companySizes = [
  ["1-9", "1–9 Mitarbeitende"],
  ["10-49", "10–49 Mitarbeitende"],
  ["50-249", "50–249 Mitarbeitende"],
  ["250-999", "250–999 Mitarbeitende"],
  ["1000+", "1'000 oder mehr Mitarbeitende"],
] as const;

export type EmployerRegistrationClaimContext = Readonly<{
  claim: string;
  intent: string;
  companyName: string;
  cantonCode: string;
}>;

export function EmployerRegistrationForm({
  claimContext,
}: Readonly<{ claimContext?: EmployerRegistrationClaimContext }>) {
  const [state, formAction, pending] = useActionState(
    registerEmployerAction,
    INITIAL_AUTH_ACTION_STATE,
  );

  return (
    <form action={formAction} className="grid gap-5" noValidate>
      {claimContext === undefined ? null : (
        <>
          <input type="hidden" name="claim" value={claimContext.claim} />
          <input type="hidden" name="intent" value={claimContext.intent} />
        </>
      )}
      <FormFeedback state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        <EmployerTextField
          id="employer-name"
          name="name"
          label="Kontaktperson"
          autoComplete="name"
          state={state}
          maxLength={160}
        />
        <EmployerTextField
          id="employer-email"
          name="email"
          label="Geschäftliche E-Mail"
          type="email"
          inputMode="email"
          autoComplete="email"
          state={state}
          maxLength={320}
        />
      </div>
      <PasswordFields state={state} prefix="employer" />
      <div className="border-t pt-5">
        <h2 className="text-base font-semibold">Unternehmen</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Diese Angaben helfen, mögliche bestehende Firmenkonten sicher zu erkennen.
        </p>
      </div>
      <EmployerTextField
        id="company-name"
        name="companyName"
        label="Unternehmensname"
        autoComplete="organization"
        state={state}
        maxLength={200}
        defaultValue={claimContext?.companyName}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <EmployerTextField
          id="company-uid"
          name="uid"
          label="Schweizer UID (optional)"
          state={state}
          maxLength={32}
          required={false}
          placeholder="CHE-123.456.789"
        />
        <NativeSelectField
          id="company-canton"
          name="cantonCode"
          label="Kanton"
          state={state}
          options={cantons}
          placeholder="Kanton wählen"
          defaultValue={claimContext?.cantonCode}
        />
      </div>
      <NativeSelectField
        id="company-size"
        name="companySize"
        label="Unternehmensgrösse"
        state={state}
        options={companySizes}
        placeholder="Grösse wählen"
      />
      <div className="rounded-lg border border-primary/15 bg-secondary/45 p-3 text-sm leading-6 text-secondary-foreground">
        {claimContext === undefined
          ? "Name, UID und E-Mail-Domain dienen ausschliesslich als Abgleichsignale. Sie verleihen nicht automatisch Eigentum oder Zugriff. Bei einem möglichen Treffer prüft das SwissTalentHub-Team den Anspruch, bevor eine Rolle vergeben wird."
          : "Die ausgewählte Firma wurde sicher vorausgefüllt. Deine Registrierung erzeugt nur einen Prüfauftrag. Eigentum, Mitgliedschaft oder Zugriff werden nicht automatisch vergeben."}
      </div>
      <NativeCheckboxField
        id="employer-terms"
        name="acceptedTerms"
        state={state}
        required
        label="Ich akzeptiere die aktuellen Nutzungsbedingungen und den dazugehörigen Datenschutzhinweis."
        description="Die Zustimmung wird mit der serverseitig aktuellen Version und ihrem unveränderbaren Nachweis protokolliert."
      />
      <NativeCheckboxField
        id="employer-marketing"
        name="marketingConsent"
        state={state}
        label="Ich möchte gelegentlich Produktneuigkeiten per E-Mail erhalten (optional)."
        description="Diese Einwilligung ist freiwillig, separat und später widerrufbar."
      />
      <SubmitButton
        pending={pending}
        idleLabel="Arbeitgeberkonto erstellen"
        pendingLabel="Konto wird erstellt …"
      />
    </form>
  );
}

function EmployerTextField({
  id,
  name,
  label,
  state,
  type = "text",
  required = true,
  ...inputProps
}: Readonly<{
  id: string;
  name: string;
  label: string;
  state: typeof INITIAL_AUTH_ACTION_STATE;
  type?: React.HTMLInputTypeAttribute;
  required?: boolean;
  defaultValue?: string;
}> &
  Pick<
    React.ComponentProps<"input">,
    "autoComplete" | "inputMode" | "maxLength" | "placeholder"
  >) {
  const hasError = Boolean(state.fieldErrors?.[name]?.length);
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        key={inputDefaultKeyFromState(state, name)}
        {...inputProps}
        id={id}
        name={name}
        type={type}
        required={required}
        className="h-11"
        defaultValue={valueFromState(state, name) ?? inputProps.defaultValue}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? `${name}-error` : undefined}
      />
      <FieldError state={state} field={name} />
    </div>
  );
}

function NativeSelectField({
  id,
  name,
  label,
  state,
  options,
  placeholder,
  defaultValue,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  state: typeof INITIAL_AUTH_ACTION_STATE;
  options: readonly (readonly [string, string])[];
  placeholder: string;
  defaultValue?: string;
}>) {
  const hasError = Boolean(state.fieldErrors?.[name]?.length);
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={name}
        required
        defaultValue={valueFromState(state, name) ?? defaultValue ?? ""}
        className={formControlClassName(hasError)}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? `${name}-error` : undefined}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
      <FieldError state={state} field={name} />
    </div>
  );
}
