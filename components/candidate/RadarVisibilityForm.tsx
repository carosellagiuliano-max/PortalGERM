"use client";

import { useActionState } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";

import { setTalentRadarVisibilityAction } from "@/app/candidate/jobpass/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { CandidateProfileActionState } from "@/lib/candidate/profile";

const INITIAL_PROFILE_ACTION_STATE: CandidateProfileActionState = Object.freeze({
  status: "idle",
  message: "",
});

export function RadarVisibilityForm({
  consentGranted,
}: Readonly<{ consentGranted: boolean }>) {
  const [state, action, pending] = useActionState(
    setTalentRadarVisibilityAction,
    INITIAL_PROFILE_ACTION_STATE,
  );
  const target = !consentGranted;

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="granted" value={String(target)} />
      {state.status === "idle" ? null : (
        <Alert
          variant={state.status === "error" ? "destructive" : "default"}
          aria-live="polite"
        >
          <AlertTitle>
            {state.status === "success" ? "Sichtbarkeit aktualisiert" : "Bitte prüfen"}
          </AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      <Button
        type="submit"
        size="lg"
        variant={consentGranted ? "destructive" : "default"}
        className="h-11 w-full sm:w-fit"
        disabled={pending}
      >
        {consentGranted ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
        {pending
          ? "Wahl wird protokolliert …"
          : consentGranted
            ? "Talent Radar deaktivieren"
            : "Talent Radar ausdrücklich aktivieren"}
      </Button>
    </form>
  );
}
