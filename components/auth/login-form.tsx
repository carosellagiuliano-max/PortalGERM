"use client";

import Link from "next/link";
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
import { loginAction } from "@/lib/auth/server-actions";

export function LoginForm({ next }: Readonly<{ next?: string }>) {
  const [state, formAction, pending] = useActionState(
    loginAction,
    INITIAL_AUTH_ACTION_STATE,
  );

  return (
    <form action={formAction} className="grid gap-5" noValidate>
      {next === undefined ? null : <input type="hidden" name="next" value={next} />}
      <FormFeedback state={state} />
      <div className="grid gap-2">
        <Label htmlFor="login-email">E-Mail-Adresse</Label>
        <Input
          key={inputDefaultKeyFromState(state, "email")}
          id="login-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          maxLength={320}
          className="h-11"
          defaultValue={valueFromState(state, "email")}
          aria-invalid={state.fieldErrors?.email?.length ? true : undefined}
          aria-describedby={state.fieldErrors?.email?.length ? "email-error" : undefined}
        />
        <FieldError state={state} field="email" />
      </div>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor="login-password">Passwort</Label>
          <Link
            href="/forgot-password"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Passwort vergessen?
          </Link>
        </div>
        <Input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
          className="h-11"
          aria-invalid={state.fieldErrors?.password?.length ? true : undefined}
          aria-describedby={
            state.fieldErrors?.password?.length ? "password-error" : undefined
          }
        />
        <FieldError state={state} field="password" />
      </div>
      <SubmitButton
        pending={pending}
        idleLabel="Sicher anmelden"
        pendingLabel="Anmeldung läuft …"
      />
    </form>
  );
}
