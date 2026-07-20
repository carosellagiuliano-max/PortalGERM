"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { INITIAL_AUTH_ACTION_STATE } from "@/components/auth/auth-action-state";
import { PasswordFields } from "@/components/auth/candidate-registration-form";
import { FormFeedback, SubmitButton } from "@/components/auth/form-parts";
import { resetPasswordAction } from "@/lib/auth/server-actions";

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(
    resetPasswordAction,
    INITIAL_AUTH_ACTION_STATE,
  );
  const [token, setToken] = useState("");
  const [tokenResolved, setTokenResolved] = useState(false);
  const fragmentToken = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (fragmentToken.current === undefined) {
      const fragment = new URLSearchParams(
        window.location.hash.replace(/^#/u, ""),
      );
      const tokenValues = fragment.getAll("token");
      const fragmentKeys = [...fragment.keys()];
      fragmentToken.current =
        tokenValues.length === 1 &&
        fragmentKeys.length === 1 &&
        fragmentKeys[0] === "token"
          ? (tokenValues[0] ?? "")
          : "";
    }
    if (window.location.hash !== "") {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    }
    const hydrationUpdate = window.setTimeout(() => {
      setToken(fragmentToken.current ?? "");
      setTokenResolved(true);
    }, 0);
    return () => window.clearTimeout(hydrationUpdate);
  }, []);

  return (
    <form action={formAction} className="grid gap-5" noValidate>
      <input type="hidden" name="token" value={token} />
      <FormFeedback state={state} />
      {tokenResolved && token.length === 0 ? (
        <p className="text-sm text-destructive" role="alert">
          Der Link ist ungültig, abgelaufen oder wurde bereits verwendet.
        </p>
      ) : null}
      <PasswordFields state={state} prefix="reset" />
      <SubmitButton
        pending={pending}
        disabled={!tokenResolved || token.length === 0}
        idleLabel="Passwort sicher ändern"
        pendingLabel="Passwort wird geändert …"
      />
    </form>
  );
}
