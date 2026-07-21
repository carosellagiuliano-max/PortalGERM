"use client";

import { useActionState } from "react";

import Link from "next/link";
import { FilePlus2Icon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  INITIAL_EMPLOYER_JOB_FORM_STATE,
  type EmployerJobFormState,
  type EmployerJobListItem,
} from "@/lib/employer/job-contracts";

type JobAction = (state: EmployerJobFormState, formData: FormData) => Promise<EmployerJobFormState>;

export type JobsTableActions = Readonly<{
  submit: JobAction;
  pause: JobAction;
  pauseAndRevise: JobAction;
  clonePaused: JobAction;
  cloneRejected: JobAction;
  duplicate: JobAction;
  reactivate: JobAction;
  close: JobAction;
}>;

export function JobsTable({
  jobs,
  actions,
  idempotencyKeys,
}: Readonly<{
  jobs: readonly EmployerJobListItem[];
  actions: JobsTableActions;
  idempotencyKeys: Readonly<Record<string, Readonly<Record<string, string>>>>;
}>) {
  if (jobs.length === 0) {
    return (
      <Card>
        <CardContent className="grid justify-items-center gap-4 py-12 text-center">
          <FilePlus2Icon className="size-8 text-primary" aria-hidden="true" />
          <div><h2 className="font-semibold">Noch kein Job inseriert</h2><p className="mt-1 text-sm text-muted-foreground">Der erste Entwurf wird direkt im geführten Wizard gespeichert.</p></div>
          <Link href="/employer/jobs/new" className={buttonVariants()}>Inserat erfassen</Link>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[70rem] text-left text-sm">
        <thead className="border-b bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-4 py-3">Titel</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Standort</th><th className="px-4 py-3">Bewerbungen</th><th className="px-4 py-3">Views</th><th className="px-4 py-3">Saves</th><th className="px-4 py-3">Fair-Job-Score</th><th className="px-4 py-3">Boost</th><th className="px-4 py-3">Aktionen</th></tr></thead>
        <tbody className="divide-y">{jobs.map((job) => <JobRow key={job.id} job={job} actions={actions} keys={idempotencyKeys[job.id] ?? {}} />)}</tbody>
      </table>
    </div>
  );
}

function JobRow({ job, actions, keys }: Readonly<{ job: EmployerJobListItem; actions: JobsTableActions; keys: Readonly<Record<string, string>> }>) {
  const [submitState, submitAction, submitPending] = useActionState(actions.submit, INITIAL_EMPLOYER_JOB_FORM_STATE);
  const [pauseState, pauseAction, pausePending] = useActionState(actions.pause, INITIAL_EMPLOYER_JOB_FORM_STATE);
  const [pauseEditState, pauseEditAction, pauseEditPending] = useActionState(actions.pauseAndRevise, INITIAL_EMPLOYER_JOB_FORM_STATE);
  const [clonePausedState, clonePausedAction, clonePausedPending] = useActionState(actions.clonePaused, INITIAL_EMPLOYER_JOB_FORM_STATE);
  const [cloneRejectedState, cloneRejectedAction, cloneRejectedPending] = useActionState(actions.cloneRejected, INITIAL_EMPLOYER_JOB_FORM_STATE);
  const [duplicateState, duplicateAction, duplicatePending] = useActionState(actions.duplicate, INITIAL_EMPLOYER_JOB_FORM_STATE);
  const [reactivateState, reactivateAction, reactivatePending] = useActionState(actions.reactivate, INITIAL_EMPLOYER_JOB_FORM_STATE);
  const [closeState, closeAction, closePending] = useActionState(actions.close, INITIAL_EMPLOYER_JOB_FORM_STATE);
  const states = [submitState, pauseState, pauseEditState, clonePausedState, cloneRejectedState, duplicateState, reactivateState, closeState];
  return (
    <tr className="align-top">
      <td className="px-4 py-4"><Link href={`/employer/jobs/${job.id}`} className="font-medium text-primary hover:underline">{job.title}</Link>{job.capabilities.assignmentRole === null ? null : <p className="mt-1 text-xs text-muted-foreground">Zuweisung: {job.capabilities.assignmentRole}</p>}</td>
      <td className="px-4 py-4"><Badge variant={job.status === "REJECTED" ? "destructive" : "outline"}>{job.status}</Badge></td>
      <td className="px-4 py-4 text-muted-foreground">{job.location}</td>
      <td className="px-4 py-4">{job.applications}</td><td className="px-4 py-4">{job.views}</td><td className="px-4 py-4">{job.saves}</td>
      <td className="px-4 py-4">{job.score === null ? "Noch kein Snapshot" : `${job.score.points}/${job.score.maxPoints}`}</td>
      <td className="px-4 py-4">{job.boostStatus ?? "—"}</td>
      <td className="px-4 py-4">
        <div className="flex max-w-[24rem] flex-wrap gap-2">
          <Link href={`/employer/jobs/${job.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Öffnen</Link>
          {job.capabilities.mutateDraft && (job.status === "DRAFT" || job.status === "CHANGES_REQUESTED") ? <>
            <Link href={`/employer/jobs/${job.id}?step=1`} className={buttonVariants({ variant: "outline", size: "sm" })}>Bearbeiten</Link>
            <RowActionForm action={submitAction} job={job} keyValue={submitState.nextIdempotencyKey ?? keys.submit ?? job.id} label="Einreichen" pending={submitPending} />
          </> : null}
          {job.capabilities.manageLifecycle && job.status === "PUBLISHED" ? <>
            <RowActionForm action={pauseAction} job={job} keyValue={pauseState.nextIdempotencyKey ?? keys.pause ?? job.id} label="Pausieren" pending={pausePending} />
            <RowActionForm action={pauseEditAction} job={job} keyValue={pauseEditState.nextIdempotencyKey ?? keys.pauseEdit ?? job.id} label="Für Bearbeitung öffnen" pending={pauseEditPending} />
          </> : null}
          {job.capabilities.manageLifecycle && job.status === "PAUSED" ? <>
            <RowActionForm action={reactivateAction} job={job} keyValue={reactivateState.nextIdempotencyKey ?? keys.reactivate ?? job.id} label="Reaktivieren" pending={reactivatePending} />
            <RowActionForm action={clonePausedAction} job={job} keyValue={clonePausedState.nextIdempotencyKey ?? keys.clonePaused ?? job.id} label="Für Bearbeitung öffnen" pending={clonePausedPending} />
          </> : null}
          {job.capabilities.manageLifecycle && job.status === "REJECTED" ? <RowActionForm action={cloneRejectedAction} job={job} keyValue={cloneRejectedState.nextIdempotencyKey ?? keys.cloneRejected ?? job.id} label="Für Bearbeitung öffnen" pending={cloneRejectedPending} /> : null}
          {(job.capabilities.manageLifecycle || job.capabilities.mutateDraft) && job.status !== "REMOVED" ? <RowActionForm action={duplicateAction} job={job} keyValue={duplicateState.nextIdempotencyKey ?? keys.duplicate ?? job.id} label="Duplizieren" pending={duplicatePending} /> : null}
          {job.capabilities.manageLifecycle && (job.status === "PUBLISHED" || job.status === "PAUSED" || job.status === "EXPIRED") ? <RowActionForm action={closeAction} job={job} keyValue={closeState.nextIdempotencyKey ?? keys.close ?? job.id} label="Schliessen" pending={closePending} destructive /> : null}
        </div>
        {states.flatMap((state) => state.status === "idle" || state.message === undefined ? [] : [state.message]).map((message, index) => <p key={`${message}-${index}`} className="mt-2 max-w-sm text-xs text-muted-foreground" role="status">{message}</p>)}
      </td>
    </tr>
  );
}

function RowActionForm({ action, job, keyValue, label, pending, destructive = false }: Readonly<{ action: (formData: FormData) => void; job: EmployerJobListItem; keyValue: string; label: string; pending: boolean; destructive?: boolean }>) {
  if (job.revisionVersion === null) return null;
  return <form action={action}><input type="hidden" name="jobId" value={job.id} /><input type="hidden" name="expectedJobVersion" value={job.version} /><input type="hidden" name="expectedRevisionVersion" value={job.revisionVersion} /><input type="hidden" name="idempotencyKey" value={keyValue} /><Button type="submit" size="sm" variant={destructive ? "destructive" : "outline"} disabled={pending}>{pending ? "…" : label}</Button></form>;
}
