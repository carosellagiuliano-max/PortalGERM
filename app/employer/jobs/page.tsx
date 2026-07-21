import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";

import { JobsTable } from "@/components/employer/jobs-table";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getDatabase } from "@/lib/db/client";
import { requireEmployerCompanyContext } from "@/lib/employer/context";
import { listEmployerJobs, type EmployerJobActor } from "@/lib/employer/jobs";
import {
  closeEmployerJobAction,
  createEmployerJobRevisionFromPausedAction,
  createEmployerJobRevisionFromRejectedAction,
  duplicateEmployerJobAction,
  pauseAndCreateEmployerJobRevisionAction,
  pauseEmployerJobAction,
  reactivateEmployerJobAction,
  submitEmployerJobForReviewAction,
} from "./[id]/actions";

export const metadata: Metadata = { title: "Arbeitgeber Jobs", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function EmployerJobsPage() {
  const [context, user] = await Promise.all([requireEmployerCompanyContext(), getCurrentUser()]);
  if (user === null) return null;
  const actor: EmployerJobActor = { userId: user.id, email: user.email, membershipId: context.membershipId, membershipRole: context.membershipRole, companyId: context.companyId };
  const jobs = await listEmployerJobs(actor, getDatabase());
  const idempotencyKeys = Object.fromEntries(jobs.map((job) => [job.id, {
    submit: randomUUID(),
    pause: randomUUID(),
    pauseEdit: randomUUID(),
    clonePaused: randomUUID(),
    cloneRejected: randomUUID(),
    duplicate: randomUUID(),
    reactivate: randomUUID(),
    close: randomUUID(),
  }]));
  return (
    <section aria-labelledby="employer-jobs-title" className="grid gap-7">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="eyebrow">Jobs</p><h1 id="employer-jobs-title" className="mt-2 text-3xl font-semibold tracking-tight">Inserate & Revisionen</h1><p className="mt-3 max-w-3xl leading-7 text-muted-foreground">Sichere Firmen- und Zuweisungssicht mit Status, Evidenz und optimistischen Versionsprüfungen.</p></div>
        {context.membershipRole === "VIEWER" ? null : <Link href="/employer/jobs/new" className={buttonVariants()}>Inserat erfassen</Link>}
      </header>
      <JobsTable jobs={jobs} actions={{ submit: submitEmployerJobForReviewAction, pause: pauseEmployerJobAction, pauseAndRevise: pauseAndCreateEmployerJobRevisionAction, clonePaused: createEmployerJobRevisionFromPausedAction, cloneRejected: createEmployerJobRevisionFromRejectedAction, duplicate: duplicateEmployerJobAction, reactivate: reactivateEmployerJobAction, close: closeEmployerJobAction }} idempotencyKeys={idempotencyKeys} />
    </section>
  );
}
