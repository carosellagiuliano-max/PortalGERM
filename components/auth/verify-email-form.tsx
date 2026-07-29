"use client";

import Link from "@/components/shared/app-link";
import {
  useActionState,
  useEffect,
  useState,
} from "react";

import { INITIAL_AUTH_ACTION_STATE } from "@/components/auth/auth-action-state";
import {
  FieldError,
  FormFeedback,
  SubmitButton,
  formControlClassName,
} from "@/components/auth/form-parts";
import { Label } from "@/components/ui/label";
import {
  consumeEmailVerificationAction,
  resendEmailVerificationAction,
} from "@/lib/auth/identity-actions";

export function VerifyEmailForm({
  next,
}: Readonly<{ next?: string }>) {
  const [verifyState, verifyAction, verifying] = useActionState(
    consumeEmailVerificationAction,
    INITIAL_AUTH_ACTION_STATE,
  );
  const [resendState, resendAction, resending] = useActionState(
    resendEmailVerificationAction,
    INITIAL_AUTH_ACTION_STATE,
  );
  const [token, setToken] = useState("");
  const [tokenResolved, setTokenResolved] = useState(false);

  useEffect(() => {
    const pendingUpdates = new Set<number>();
    const resolveFragment = () => {
      const fragment = new URLSearchParams(
        window.location.hash.replace(/^#/u, ""),
      );
      const tokens = fragment.getAll("token");
      const keys = [...fragment.keys()];
      const fragmentToken =
        tokens.length === 1 && keys.length === 1 && keys[0] === "token"
          ? (tokens[0] ?? "")
          : "";
      if (window.location.hash !== "") {
        window.history.replaceState(
          window.history.state,
          "",
          `${window.location.pathname}${window.location.search}`,
        );
      }
      const update = window.setTimeout(() => {
        setToken(fragmentToken);
        setTokenResolved(true);
        pendingUpdates.delete(update);
      }, 0);
      pendingUpdates.add(update);
    };
    resolveFragment();
    window.addEventListener("hashchange", resolveFragment);
    return () => {
      window.removeEventListener("hashchange", resolveFragment);
      for (const update of pendingUpdates) window.clearTimeout(update);
    };
  }, []);

  return (
    <div className="grid gap-8">
      <form action={verifyAction} className="grid gap-4" noValidate>
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="next" value={next ?? ""} />
        <FormFeedback state={verifyState} />
        {tokenResolved && token.length === 0 ? (
          <p className="text-sm text-muted-foreground" role="status">
            Öffne den einmaligen Link aus deiner Bestätigungsnachricht. Du
            kannst unten eine neue Nachricht anfordern.
          </p>
        ) : null}
        <SubmitButton
          pending={verifying}
          disabled={!tokenResolved || token.length === 0}
          idleLabel="E-Mail jetzt bestätigen"
          pendingLabel="Bestätigung wird geprüft …"
        />
        {verifyState.status === "success" &&
        typeof verifyState.values?.continuePath === "string" ? (
          <Link
            href={verifyState.values.continuePath}
            className="inline-flex min-h-11 items-center justify-center rounded-md border px-4 font-medium focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Sicher weiter
          </Link>
        ) : null}
      </form>

      <div className="border-t pt-6">
        <h2 className="text-base font-semibold">Neuen Link anfordern</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Die Antwort ist für bekannte und unbekannte Adressen bewusst gleich.
          Ein älterer Link wird durch den neuen ersetzt.
        </p>
        <form action={resendAction} className="mt-4 grid gap-4" noValidate>
          <FormFeedback state={resendState} />
          <div className="grid gap-2">
            <Label htmlFor="verification-email">E-Mail-Adresse</Label>
            <input
              id="verification-email"
              name="email"
              type="email"
              autoComplete="email"
              defaultValue={
                typeof resendState.values?.email === "string"
                  ? resendState.values.email
                  : ""
              }
              aria-invalid={
                resendState.fieldErrors?.email === undefined
                  ? undefined
                  : true
              }
              aria-describedby={
                resendState.fieldErrors?.email === undefined
                  ? undefined
                  : "email-error"
              }
              className={formControlClassName(
                resendState.fieldErrors?.email !== undefined,
              )}
            />
            <FieldError state={resendState} field="email" />
          </div>
          <SubmitButton
            pending={resending}
            idleLabel="Bestätigungslink anfordern"
            pendingLabel="Anfrage wird geprüft …"
          />
        </form>
      </div>
    </div>
  );
}
