"use client";

import { useActionState } from "react";
import { FlagIcon } from "lucide-react";

import { submitPublicReportAction } from "@/app/(public)/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { INITIAL_PUBLIC_REPORT_STATE } from "@/lib/abuse/public-report-state";

export function ReportForm({
  targetType,
  slug,
}: Readonly<{ targetType: "JOB" | "COMPANY"; slug: string }>) {
  const [state, action, pending] = useActionState(
    submitPublicReportAction,
    INITIAL_PUBLIC_REPORT_STATE,
  );

  return (
    <details className="rounded-xl border bg-muted/20 p-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
        <FlagIcon className="size-4" aria-hidden="true" /> Inhalt melden
      </summary>
      <form action={action} className="mt-4 grid gap-4" noValidate>
        <input type="hidden" name="targetType" value={targetType} />
        <input type="hidden" name="slug" value={slug} />
        {state.status === "idle" ? null : (
          <p role="status" className={state.status === "success" ? "rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900" : "rounded-lg bg-destructive/10 p-3 text-sm text-destructive"}>
            {state.message}
          </p>
        )}
        {state.status === "success" ? null : (
          <>
            <label className="grid gap-1.5 text-sm font-medium">
              Grund
              <select name="reasonCode" required defaultValue="" className="h-10 rounded-lg border border-input bg-background px-3 text-sm">
                <option value="" disabled>Grund wählen</option>
                <option value="MISLEADING">Irreführende Angaben</option>
                <option value="SCAM_OR_FRAUD">Betrug oder verdächtiges Angebot</option>
                <option value="DISCRIMINATION">Diskriminierender Inhalt</option>
                <option value="OUTDATED">Nicht mehr aktuell</option>
                <option value="OTHER">Anderer Grund</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Beschreibung
              <Textarea name="description" required minLength={20} maxLength={1_500} rows={5} placeholder="Was sollten wir prüfen? Bitte keine sensiblen persönlichen Daten eintragen." />
            </label>
            <Button type="submit" variant="outline" disabled={pending}>
              {pending ? "Meldung wird erfasst …" : "Meldung absenden"}
            </Button>
          </>
        )}
      </form>
    </details>
  );
}
