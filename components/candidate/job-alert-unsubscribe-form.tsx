"use client";

import { useActionState } from "react";
import { CheckCircle2Icon, PauseCircleIcon } from "lucide-react";

import {
  INITIAL_UNSUBSCRIBE_ACTION_STATE,
  unsubscribeJobAlertAction,
} from "@/app/alerts/unsubscribe/[token]/actions";
import { Button } from "@/components/ui/button";

export function JobAlertUnsubscribeForm({ token }: Readonly<{ token: string }>) {
  const [state, action, pending] = useActionState(
    unsubscribeJobAlertAction.bind(null, token),
    INITIAL_UNSUBSCRIBE_ACTION_STATE,
  );

  if (state.status === "complete") {
    return (
      <div role="status" className="rounded-xl bg-emerald-50 p-5 text-emerald-950">
        <CheckCircle2Icon className="size-6" aria-hidden="true" />
        <h2 className="mt-3 text-lg font-semibold">Anfrage verarbeitet</h2>
        <p className="mt-2 leading-7">{state.message}</p>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-4">
      <p className="leading-7 text-muted-foreground">
        Bestätige die Pause für das Jobabo, das zu diesem Link gehört. Diese
        Aktion widerruft nicht deine globale Service-Einwilligung und zeigt
        keine Konto- oder Profildaten an.
      </p>
      <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-fit">
        <PauseCircleIcon aria-hidden="true" />
        {pending ? "Wird sicher verarbeitet …" : "Dieses Jobabo pausieren"}
      </Button>
    </form>
  );
}
