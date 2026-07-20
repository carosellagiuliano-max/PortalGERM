"use client";

import { useActionState } from "react";

import { sendCandidateMessageAction } from "@/app/candidate/messages/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { INITIAL_CANDIDATE_MESSAGE_ACTION_STATE } from "@/lib/candidate/message-action-state";

export function CandidateMessageComposeForm({
  conversationId,
  initialIdempotencyKey,
}: Readonly<{
  conversationId: string;
  initialIdempotencyKey: string;
}>) {
  const [state, action, pending] = useActionState(
    sendCandidateMessageAction,
    INITIAL_CANDIDATE_MESSAGE_ACTION_STATE,
  );
  const idempotencyKey = state.nextIdempotencyKey ?? initialIdempotencyKey;

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <Textarea
        key={idempotencyKey}
        name="body"
        required
        minLength={1}
        maxLength={5_000}
        rows={6}
        aria-label="Nachricht"
        placeholder="Schreibe eine sachliche Nachricht …"
      />
      {state.status === "idle" ? null : (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={
            state.status === "error"
              ? "text-sm text-destructive"
              : "text-sm text-emerald-700"
          }
        >
          {state.message}
        </p>
      )}
      <Button type="submit" className="w-fit" disabled={pending}>
        {pending ? "Wird gesendet …" : "Nachricht senden"}
      </Button>
    </form>
  );
}
