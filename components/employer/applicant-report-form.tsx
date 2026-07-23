"use client";

import { FlagIcon } from "lucide-react";
import { useActionState } from "react";

import { reportEmployerApplicantAction } from "@/app/employer/applicants/actions";
import { EmployerActionFeedback } from "@/components/employer/action-form-parts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { INITIAL_EMPLOYER_ACTION_STATE } from "@/lib/employer/action-state";

export function EmployerApplicantReportForm({
  applicationId,
}: Readonly<{ applicationId: string }>) {
  const [state, action, pending] = useActionState(
    reportEmployerApplicantAction,
    INITIAL_EMPLOYER_ACTION_STATE,
  );
  return (
    <details className="rounded-xl border bg-card p-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
        <FlagIcon className="size-4" aria-hidden="true" /> Kandidatenprofil melden
      </summary>
      <form action={action} className="mt-4 grid gap-3" noValidate>
        <input type="hidden" name="applicationId" value={applicationId} />
        <EmployerActionFeedback state={state} />
        {state.status === "success" ? null : (
          <>
            <label className="grid gap-1 text-sm font-medium">
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
            <label className="grid gap-1 text-sm font-medium">
              Beschreibung
              <Textarea
                name="description"
                required
                minLength={20}
                maxLength={1_500}
                rows={4}
                placeholder="Beschreibe sachlich, was geprüft werden soll."
              />
            </label>
            <Button type="submit" variant="outline" disabled={pending}>
              {pending ? "Wird gemeldet …" : "Sicher melden"}
            </Button>
          </>
        )}
      </form>
    </details>
  );
}
