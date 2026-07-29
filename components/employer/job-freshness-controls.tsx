"use client";

import { useActionState } from "react";

import type { EmployerJobFormState } from "@/lib/employer/jobs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const INITIAL_STATE: EmployerJobFormState = Object.freeze({ status: "idle" });

export function JobFreshnessControls({
  jobId,
  jobVersion,
  revisionVersion,
  state,
  dueAt,
  confirmIdempotencyKey,
  filledIdempotencyKey,
  confirmAction,
  filledAction,
}: Readonly<{
  jobId: string;
  jobVersion: number;
  revisionVersion: number;
  state: string;
  dueAt: string;
  confirmIdempotencyKey: string;
  filledIdempotencyKey: string;
  confirmAction: (
    state: EmployerJobFormState,
    formData: FormData,
  ) => Promise<EmployerJobFormState>;
  filledAction: (
    state: EmployerJobFormState,
    formData: FormData,
  ) => Promise<EmployerJobFormState>;
}>) {
  const [confirmState, runConfirm, confirmPending] = useActionState(
    confirmAction,
    INITIAL_STATE,
  );
  const [filledState, runFilled, filledPending] = useActionState(
    filledAction,
    INITIAL_STATE,
  );
  const formattedDue = new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(dueAt));

  return (
    <Card aria-labelledby="job-freshness-title">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle id="job-freshness-title" as="h2">
            Aktualität der Stelle
          </CardTitle>
          <Badge variant={state === "ACTIVE" ? "outline" : "secondary"}>
            {state}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Späteste nächste Bestätigung: {formattedDue}. Ohne Bestätigung wird
          die Stelle zu diesem Zeitpunkt automatisch aus Suche, Alerts,
          Empfehlungen und Sitemap entfernt.
        </p>
        <ActionStatus state={confirmState} />
        <ActionStatus state={filledState} />
        <div className="flex flex-col gap-3 sm:flex-row">
          <form action={runConfirm}>
            <CommandFields
              jobId={jobId}
              jobVersion={jobVersion}
              revisionVersion={revisionVersion}
              idempotencyKey={
                confirmState.nextIdempotencyKey ?? confirmIdempotencyKey
              }
            />
            <Button type="submit" disabled={confirmPending || filledPending}>
              {confirmPending
                ? "Wird bestätigt …"
                : "Stelle ist weiterhin offen"}
            </Button>
          </form>
          <form action={runFilled}>
            <CommandFields
              jobId={jobId}
              jobVersion={jobVersion}
              revisionVersion={revisionVersion}
              idempotencyKey={
                filledState.nextIdempotencyKey ?? filledIdempotencyKey
              }
            />
            <Button
              type="submit"
              variant="outline"
              disabled={confirmPending || filledPending}
            >
              {filledPending ? "Wird geschlossen …" : "Stelle ist besetzt"}
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}

function CommandFields({
  jobId,
  jobVersion,
  revisionVersion,
  idempotencyKey,
}: Readonly<{
  jobId: string;
  jobVersion: number;
  revisionVersion: number;
  idempotencyKey: string;
}>) {
  return (
    <>
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="expectedJobVersion" value={jobVersion} />
      <input
        type="hidden"
        name="expectedRevisionVersion"
        value={revisionVersion}
      />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
    </>
  );
}

function ActionStatus({ state }: Readonly<{ state: EmployerJobFormState }>) {
  if (state.status === "idle" || state.message === undefined) return null;
  return (
    <p
      role="status"
      className={
        state.status === "success"
          ? "rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"
          : "rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
      }
    >
      {state.message}
    </p>
  );
}
