"use client";

import { useActionState } from "react";

import {
  INITIAL_AUTH_ACTION_STATE,
  inputDefaultKeyFromState,
  valueFromState,
} from "@/components/auth/auth-action-state";
import {
  FieldError,
  FormFeedback,
  NativeCheckboxField,
  SubmitButton,
} from "@/components/auth/form-parts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerCandidateAction } from "@/lib/auth/server-actions";

export function CandidateRegistrationForm() {
  const [state, formAction, pending] = useActionState(
    registerCandidateAction,
    INITIAL_AUTH_ACTION_STATE,
  );

  return (
    <form action={formAction} className="grid gap-5" noValidate>
      <FormFeedback state={state} />
      <TextField
        id="candidate-name"
        name="name"
        label="Vor- und Nachname"
        autoComplete="name"
        state={state}
        maxLength={160}
      />
      <TextField
        id="candidate-email"
        name="email"
        label="E-Mail-Adresse"
        type="email"
        inputMode="email"
        autoComplete="email"
        state={state}
        maxLength={320}
      />
      <PasswordFields state={state} prefix="candidate" />
      <NativeCheckboxField
        id="candidate-terms"
        name="acceptedTerms"
        state={state}
        required
        label={
          <>
            Ich akzeptiere die aktuellen Nutzungsbedingungen und den dazugehörigen
            Datenschutzhinweis.
          </>
        }
        description="Die Zustimmung wird mit der serverseitig aktuellen Version und ihrem unveränderbaren Nachweis protokolliert."
      />
      <NativeCheckboxField
        id="candidate-marketing"
        name="marketingConsent"
        state={state}
        label="Ich möchte gelegentlich Produktneuigkeiten per E-Mail erhalten (optional)."
        description="Diese freiwillige Einwilligung ist getrennt von den Nutzungsbedingungen und kann später widerrufen werden."
      />
      <p className="rounded-lg bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
        Talent Radar ist nicht Teil dieser Registrierung. Du entscheidest darüber
        später separat in der SwissJobPass-Vorschau.
      </p>
      <SubmitButton
        pending={pending}
        idleLabel="Konto erstellen"
        pendingLabel="Konto wird erstellt …"
      />
    </form>
  );
}

function TextField({
  id,
  name,
  label,
  state,
  type = "text",
  ...inputProps
}: Readonly<{
  id: string;
  name: string;
  label: string;
  state: typeof INITIAL_AUTH_ACTION_STATE;
  type?: React.HTMLInputTypeAttribute;
}> &
  Pick<
    React.ComponentProps<"input">,
    "autoComplete" | "inputMode" | "maxLength"
  >) {
  const hasError = Boolean(state.fieldErrors?.[name]?.length);
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        key={inputDefaultKeyFromState(state, name)}
        {...inputProps}
        id={id}
        name={name}
        type={type}
        required
        className="h-11"
        defaultValue={valueFromState(state, name)}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? `${name}-error` : undefined}
      />
      <FieldError state={state} field={name} />
    </div>
  );
}

export function PasswordFields({
  state,
  prefix,
}: Readonly<{
  state: typeof INITIAL_AUTH_ACTION_STATE;
  prefix: string;
}>) {
  const passwordError = Boolean(state.fieldErrors?.password?.length);
  const confirmationError = Boolean(
    state.fieldErrors?.passwordConfirmation?.length,
  );
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="grid content-start gap-2">
        <Label htmlFor={`${prefix}-password`}>Passwort</Label>
        <Input
          id={`${prefix}-password`}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          maxLength={128}
          className="h-11"
          aria-invalid={passwordError || undefined}
          aria-describedby={`${prefix}-password-help${
            passwordError ? " password-error" : ""
          }`}
        />
        <p
          id={`${prefix}-password-help`}
          className="text-xs leading-5 text-muted-foreground"
        >
          Mindestens 10 Zeichen sowie Gross-/Kleinbuchstabe, Zahl und Symbol.
        </p>
        <FieldError state={state} field="password" />
      </div>
      <div className="grid content-start gap-2">
        <Label htmlFor={`${prefix}-password-confirmation`}>
          Passwort bestätigen
        </Label>
        <Input
          id={`${prefix}-password-confirmation`}
          name="passwordConfirmation"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          maxLength={128}
          className="h-11"
          aria-invalid={confirmationError || undefined}
          aria-describedby={
            confirmationError ? "passwordConfirmation-error" : undefined
          }
        />
        <FieldError state={state} field="passwordConfirmation" />
      </div>
    </div>
  );
}
