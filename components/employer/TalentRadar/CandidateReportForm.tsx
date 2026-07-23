"use client";

import { FlagIcon } from "lucide-react";
import { useActionState } from "react";

import { reportRadarCandidateAction } from "@/app/employer/talent-radar/actions";
import {
  INITIAL_TALENT_RADAR_ACTION_STATE,
} from "@/components/employer/TalentRadar/action-state";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function CandidateReportForm({
  opaqueCandidateId,
  signedSearchSession,
}: Readonly<{
  opaqueCandidateId: string;
  signedSearchSession: string;
}>) {
  const [state, action, pending] = useActionState(
    reportRadarCandidateAction,
    INITIAL_TALENT_RADAR_ACTION_STATE,
  );

  return (
    <details className="rounded-lg border bg-background p-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
        <FlagIcon className="size-4" aria-hidden="true" /> Profil melden
      </summary>
      <form action={action} className="mt-3 grid min-w-64 gap-3" noValidate>
        <input
          type="hidden"
          name="opaqueCandidateId"
          value={opaqueCandidateId}
        />
        <input
          type="hidden"
          name="signedSearchSession"
          value={signedSearchSession}
        />
        {state.status === "idle" ? null : (
          <p
            role={state.status === "error" ? "alert" : "status"}
            className={
              state.status === "success"
                ? "text-xs text-emerald-700"
                : "text-xs text-destructive"
            }
          >
            {state.message}
          </p>
        )}
        {state.status === "success" ? null : (
          <>
            <label className="grid gap-1 text-xs font-medium">
              Grund
              <select
                name="reasonCode"
                required
                defaultValue=""
                className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
              >
                <option value="" disabled>Grund wählen</option>
                <option value="MISLEADING">Irreführende Angaben</option>
                <option value="SCAM_OR_FRAUD">Betrug oder Täuschung</option>
                <option value="DISCRIMINATION">Diskriminierung</option>
                <option value="OTHER">Anderer Grund</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs font-medium">
              Beschreibung
              <Textarea
                name="description"
                required
                minLength={20}
                maxLength={1_500}
                rows={4}
                placeholder="Was soll das Moderationsteam prüfen?"
              />
            </label>
            <Button type="submit" size="sm" variant="outline" disabled={pending}>
              {pending ? "Wird gemeldet …" : "Sicher melden"}
            </Button>
          </>
        )}
      </form>
    </details>
  );
}
