"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { SendIcon } from "lucide-react";

import { sendContactRequestAction } from "@/app/employer/talent-radar/actions";
import { UpgradeDialog } from "@/components/billing/upgrade-dialog";
import {
  INITIAL_TALENT_RADAR_ACTION_STATE,
} from "@/components/employer/TalentRadar/action-state";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ContactDialog({
  opaqueCandidateId,
  signedSearchSession,
  idempotencyKey,
}: Readonly<{
  opaqueCandidateId: string;
  signedSearchSession: string;
  idempotencyKey: string;
}>) {
  const [state, action, pending] = useActionState(
    sendContactRequestAction,
    INITIAL_TALENT_RADAR_ACTION_STATE,
  );
  const [messageLength, setMessageLength] = useState(0);
  const activeIdempotencyKey = state.nextIdempotencyKey ?? idempotencyKey;

  return (
    <>
      <Dialog>
        <DialogTrigger render={<Button type="button" className="w-full sm:w-auto" />}>
          <SendIcon aria-hidden="true" /> Kontakt anfragen
        </DialogTrigger>
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Kontaktanfrage senden</DialogTitle>
            <DialogDescription>
              Die Anfrage kostet genau einen Talent-Kontakt-Credit. Es werden
              keine Identitätsdaten angefordert oder angezeigt.
            </DialogDescription>
          </DialogHeader>

          {state.status === "success" && state.requestId !== undefined ? (
            <div className="grid gap-4">
              <p role="status" className="text-sm text-emerald-700">
                {state.message}
              </p>
              <Link
                href={`/employer/talent-radar/requests/${state.requestId}`}
                className={buttonVariants()}
              >
                Anfrage ansehen
              </Link>
            </div>
          ) : (
            <form action={action} className="grid gap-4">
              <input type="hidden" name="opaqueCandidateId" value={opaqueCandidateId} />
              <input type="hidden" name="signedSearchSession" value={signedSearchSession} />
              <input type="hidden" name="idempotencyKey" value={activeIdempotencyKey} />

              <div className="grid gap-1.5">
                <Label htmlFor={`contact-subject-${idempotencyKey}`}>
                  Betreff
                </Label>
                <Input
                  id={`contact-subject-${idempotencyKey}`}
                  name="subject"
                  required
                  minLength={1}
                  maxLength={200}
                  autoComplete="off"
                  placeholder="Interesse an einem vertraulichen Austausch"
                />
              </div>

              <div className="grid gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor={`contact-message-${idempotencyKey}`}>
                    Nachricht
                  </Label>
                  <span className="text-xs text-muted-foreground">
                    {messageLength}/500
                  </span>
                </div>
                <Textarea
                  id={`contact-message-${idempotencyKey}`}
                  name="messagePreview"
                  required
                  minLength={1}
                  maxLength={500}
                  rows={7}
                  placeholder="Beschreibe Rolle, Zweck und nächsten Schritt – ohne nach persönlichen Daten zu fragen."
                  onChange={(event) => setMessageLength(Array.from(event.currentTarget.value).length)}
                />
              </div>

              <p className="text-xs leading-5 text-muted-foreground">
                Die Kandidatin oder der Kandidat entscheidet separat über
                Annahme und eine mögliche Identitätsfreigabe. Nicht angenommene,
                abgelehnte oder abgelaufene Anfragen werden nicht automatisch
                zurückerstattet.
              </p>

              {state.status === "error" ? (
                <p role="alert" className="text-sm text-destructive">{state.message}</p>
              ) : null}

              <DialogFooter>
                <DialogClose render={<Button type="button" variant="outline" />}>
                  Abbrechen
                </DialogClose>
                <Button type="submit" disabled={pending}>
                  {pending ? "Wird sicher gesendet …" : "1 Credit einsetzen"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {state.upgradePrompt === undefined ? null : (
        <UpgradeDialog
          prompt={state.upgradePrompt}
          defaultOpen
          triggerLabel="Kontakt-Credits ansehen"
        />
      )}
    </>
  );
}
