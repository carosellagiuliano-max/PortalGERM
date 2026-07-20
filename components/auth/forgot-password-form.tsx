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
  SubmitButton,
} from "@/components/auth/form-parts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { forgotPasswordAction } from "@/lib/auth/server-actions";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(
    forgotPasswordAction,
    INITIAL_AUTH_ACTION_STATE,
  );
  const hasError = Boolean(state.fieldErrors?.email?.length);

  return (
    <form action={formAction} className="grid gap-5" noValidate>
      <FormFeedback state={state} />
      <div className="grid gap-2">
        <Label htmlFor="forgot-email">E-Mail-Adresse</Label>
        <Input
          key={inputDefaultKeyFromState(state, "email")}
          id="forgot-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          maxLength={320}
          className="h-11"
          defaultValue={valueFromState(state, "email")}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? "email-error" : undefined}
        />
        <FieldError state={state} field="email" />
      </div>
      <SubmitButton
        pending={pending}
        idleLabel="Zurücksetzlink anfordern"
        pendingLabel="Anfrage wird geprüft …"
      />
    </form>
  );
}
