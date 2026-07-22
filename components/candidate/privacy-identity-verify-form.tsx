"use client";

import { useActionState } from "react";

import {
  completeCandidatePrivacyChallengeAction,
} from "@/app/candidate/privacy/requests/[id]/verify/actions";
import type { CandidatePrivacyVerifyState } from "@/app/candidate/privacy/requests/[id]/verify/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PrivacyIdentityVerifyForm({
  requestId,
  version,
  idempotencyKey,
}: Readonly<{
  requestId: string;
  version: number;
  idempotencyKey: string;
}>) {
  const [state, action, pending] = useActionState(
    completeCandidatePrivacyChallengeAction,
    initialCandidatePrivacyVerifyState(idempotencyKey),
  );
  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="version" value={version} />
      <input
        type="hidden"
        name="idempotencyKey"
        value={state.nextIdempotencyKey}
      />
      <label className="grid gap-2 text-sm font-medium" htmlFor="privacy-password">
        Aktuelles Passwort
        <Input
          id="privacy-password"
          name="password"
          type="password"
          autoComplete="current-password"
          minLength={1}
          maxLength={200}
          required
          disabled={pending || state.status === "success"}
        />
      </label>
      <Button type="submit" className="w-fit" disabled={pending || state.status === "success"}>
        {pending ? "Wird sicher geprüft …" : "Identität bestätigen"}
      </Button>
      {state.status === "idle" ? null : (
        <Alert variant={state.status === "error" ? "destructive" : "default"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}

function initialCandidatePrivacyVerifyState(
  idempotencyKey: string,
): CandidatePrivacyVerifyState {
  return Object.freeze({
    status: "idle",
    message: "",
    nextIdempotencyKey: idempotencyKey,
  });
}
