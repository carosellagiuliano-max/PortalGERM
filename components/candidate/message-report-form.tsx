"use client";

import { FlagIcon } from "lucide-react";
import { useActionState } from "react";

import { reportCandidateMessageAction } from "@/app/candidate/messages/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { INITIAL_CANDIDATE_MESSAGE_ACTION_STATE } from "@/lib/candidate/message-action-state";

export function CandidateMessageReportForm({
  messageId,
}: Readonly<{ messageId: string }>) {
  const [state, action, pending] = useActionState(
    reportCandidateMessageAction,
    INITIAL_CANDIDATE_MESSAGE_ACTION_STATE,
  );
  return (
    <details className="mt-3 rounded-lg border bg-background/70 p-3 text-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium">
        <FlagIcon className="size-3.5" aria-hidden="true" /> Nachricht melden
      </summary>
      <form action={action} className="mt-3 grid gap-3" noValidate>
        <input type="hidden" name="messageId" value={messageId} />
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
                <option value="MISLEADING">Irreführende Nachricht</option>
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
