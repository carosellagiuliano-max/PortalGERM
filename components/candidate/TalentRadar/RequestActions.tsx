"use client";

import { useActionState } from "react";
import { CheckIcon, XIcon } from "lucide-react";

import {
  acceptCandidateRadarRequestAction,
  declineCandidateRadarRequestAction,
  type CandidateRadarActionState,
} from "@/app/candidate/talent-radar/requests/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const INITIAL_STATE: CandidateRadarActionState = Object.freeze({
  status: "idle",
  message: "",
});

export function CandidateRadarRequestActions({
  requestId,
  companyName,
  acceptIdempotencyKey,
  declineIdempotencyKey,
}: Readonly<{
  requestId: string;
  companyName: string;
  acceptIdempotencyKey: string;
  declineIdempotencyKey: string;
}>) {
  const [acceptState, acceptAction, accepting] = useActionState(
    acceptCandidateRadarRequestAction,
    INITIAL_STATE,
  );
  const [declineState, declineAction, declining] = useActionState(
    declineCandidateRadarRequestAction,
    INITIAL_STATE,
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Dialog>
        <DialogTrigger render={<Button type="button" className="w-full" />}>
          <CheckIcon aria-hidden="true" /> Kontaktanfrage annehmen
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kontaktanfrage annehmen?</DialogTitle>
            <DialogDescription>
              Dadurch entsteht ein anonymer Nachrichtenverlauf mit {companyName}.
              Deine Identität wird dabei nicht freigegeben.
            </DialogDescription>
          </DialogHeader>
          <form action={acceptAction} className="grid gap-4">
            <input type="hidden" name="requestId" value={requestId} />
            <input
              type="hidden"
              name="idempotencyKey"
              value={acceptIdempotencyKey}
            />
            <label className="flex items-start gap-2 text-sm leading-6">
              <input
                type="checkbox"
                name="confirmed"
                value="true"
                required
                className="mt-1 size-4 accent-primary"
              />
              <span>
                Ich möchte die Kontaktanfrage annehmen und anonym schreiben.
              </span>
            </label>
            <ActionMessage state={acceptState} />
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                Abbrechen
              </DialogClose>
              <Button type="submit" disabled={accepting}>
                {accepting ? "Wird angenommen …" : "Verbindlich annehmen"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog>
        <DialogTrigger
          render={<Button type="button" variant="outline" className="w-full" />}
        >
          <XIcon aria-hidden="true" /> Ablehnen
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kontaktanfrage ablehnen?</DialogTitle>
            <DialogDescription>
              Die Anfrage wird beendet. Es entsteht kein Gespräch und es werden
              keine Identitätsdaten freigegeben.
            </DialogDescription>
          </DialogHeader>
          <form action={declineAction} className="grid gap-4">
            <input type="hidden" name="requestId" value={requestId} />
            <input
              type="hidden"
              name="idempotencyKey"
              value={declineIdempotencyKey}
            />
            <label className="flex items-start gap-2 text-sm leading-6">
              <input
                type="checkbox"
                name="confirmed"
                value="true"
                required
                className="mt-1 size-4 accent-primary"
              />
              <span>Ich möchte diese Kontaktanfrage ablehnen.</span>
            </label>
            <ActionMessage state={declineState} />
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                Abbrechen
              </DialogClose>
              <Button type="submit" variant="destructive" disabled={declining}>
                {declining ? "Wird abgelehnt …" : "Verbindlich ablehnen"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ActionMessage({ state }: Readonly<{ state: CandidateRadarActionState }>) {
  if (state.status === "idle") return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {state.message}
    </p>
  );
}
