import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmployerJobWizard } from "@/components/employer/job-wizard/job-wizard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getCheckoutPreview } from "@/lib/billing/employer-read-model";
import { getDatabase } from "@/lib/db/client";
import { requireEmployerCompanyContext } from "@/lib/employer/context";
import { getEmployerJobCatalog, getEmployerJobDetail, type EmployerJobActor } from "@/lib/employer/jobs";
import {
  closeEmployerJobAction,
  createEmployerJobRevisionFromPausedAction,
  createEmployerJobRevisionFromRejectedAction,
  employerJobAiSuggestionAction,
  pauseAndCreateEmployerJobRevisionAction,
  pauseEmployerJobAction,
  reactivateEmployerJobAction,
  runEmployerJobReportingCheckAction,
  saveEmployerJobStepAction,
  submitEmployerJobForReviewAction,
} from "./actions";

export const metadata: Metadata = { title: "Inserat verwalten", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

export default async function EmployerJobDetailPage({ params, searchParams }: PageProps) {
  const [context, user, route, query] = await Promise.all([requireEmployerCompanyContext(), getCurrentUser(), params, searchParams]);
  if (user === null) return null;
  const actor: EmployerJobActor = { userId: user.id, email: user.email, membershipId: context.membershipId, membershipRole: context.membershipRole, companyId: context.companyId };
  const database = getDatabase();
  const detail = await getEmployerJobDetail(actor, route.id, database);
  if (detail === null) notFound();
  if (detail.access === "SUMMARY") {
    return (
      <section aria-labelledby="job-summary-title" className="grid gap-6">
        <div><Link href="/employer/jobs" className={buttonVariants({ variant: "ghost", size: "sm" })}>← Alle Jobs</Link></div>
        <header><p className="eyebrow">Sichere Job-Zusammenfassung</p><h1 id="job-summary-title" className="mt-2 text-3xl font-semibold tracking-tight">{detail.title}</h1><p className="mt-2 text-muted-foreground">{detail.location}</p></header>
        <Alert><AlertTitle>Inhalt nach Rollenmatrix begrenzt</AlertTitle><AlertDescription>{detail.capabilities.assignmentRole === "PIPELINE" ? "Diese PIPELINE-Zuweisung sieht nur die Job-Zusammenfassung und erhält keinen Revisionsinhalt." : "Viewer erhalten eine geschlossene operative Zusammenfassung ohne private Revisions- oder Bewerbungsdaten."}</AlertDescription></Alert>
        <Card><CardHeader><CardTitle as="h2">Kennzahlen</CardTitle></CardHeader><CardContent className="grid grid-cols-3 gap-3"><Metric label="Bewerbungen" value={detail.applications} /><Metric label="Views" value={detail.views} /><Metric label="Saves" value={detail.saves} /></CardContent></Card>
      </section>
    );
  }
  const now = new Date();
  const [catalog, additionalJobPreview] = await Promise.all([
    getEmployerJobCatalog(actor, database),
    detail.status === "APPROVED" &&
      (context.membershipRole === "OWNER" || context.membershipRole === "ADMIN")
      ? getCheckoutPreview(
          database,
          context.companyId,
          {
            product: "additional-job-30d",
            quantity: 1,
            targetJobId: detail.id,
          },
          now,
        )
      : Promise.resolve(null),
  ]);
  if (catalog === null) notFound();
  const additionalJobCheckoutHref = additionalJobPreview?.ok === true
    ? `/employer/billing/checkout?product=additional-job-30d&job=${detail.id}`
    : null;
  const step = parseStep(query.step);
  return (
    <section aria-labelledby="job-detail-title" className="grid gap-6">
      <div><Link href="/employer/jobs" className={buttonVariants({ variant: "ghost", size: "sm" })}>← Alle Jobs</Link></div>
      {first(query.created) === "1" ? <Alert><AlertTitle>Entwurf angelegt</AlertTitle><AlertDescription>Der Job und – bei Recruitern – die EDITOR-Selbstzuweisung wurden gemeinsam gespeichert.</AlertDescription></Alert> : null}
      {first(query.duplicated) === "1" ? <Alert><AlertTitle>Inserat dupliziert</AlertTitle><AlertDescription>Es wurde ein eigenständiger Entwurf mit neuer Job- und Revisionsidentität erstellt. Prüf- und Score-Evidenz wurde nicht übernommen.</AlertDescription></Alert> : null}
      {first(query.submitted) === "1" ? <Alert><AlertTitle>Zur Prüfung eingereicht</AlertTitle><AlertDescription>Die Revision und ihr Fair-Job-Score-Snapshot sind jetzt unveränderbare Moderationsevidenz.</AlertDescription></Alert> : null}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="eyebrow">Job-Revision</p><h1 id="job-detail-title" className="mt-2 text-3xl font-semibold tracking-tight">{detail.revision?.title ?? "Unbenanntes Inserat"}</h1><p className="mt-2 text-sm text-muted-foreground">Job v{detail.version} · Current {detail.currentRevisionId?.slice(0, 8) ?? "—"} · Published {detail.publishedRevisionId?.slice(0, 8) ?? "—"}</p></div><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{detail.status}</Badge>{detail.capabilities.manageLifecycle && detail.status === "PUBLISHED" ? <Link href={`/employer/jobs/${detail.id}/boost`} className={buttonVariants({ size: "sm" })}>Job boosten</Link> : null}</div></header>
      <EmployerJobWizard
        job={detail}
        catalog={catalog}
        additionalJobCheckoutHref={additionalJobCheckoutHref}
        step={step}
        actions={{ saveStep: saveEmployerJobStepAction, reportingCheck: runEmployerJobReportingCheckAction, aiSuggestion: employerJobAiSuggestionAction, submit: submitEmployerJobForReviewAction, pause: pauseEmployerJobAction, pauseAndRevise: pauseAndCreateEmployerJobRevisionAction, clonePaused: createEmployerJobRevisionFromPausedAction, cloneRejected: createEmployerJobRevisionFromRejectedAction, reactivate: reactivateEmployerJobAction, close: closeEmployerJobAction }}
        idempotencyKeys={{ step1: randomUUID(), step2: randomUUID(), step3: randomUUID(), reporting: randomUUID(), submit: randomUUID(), pause: randomUUID(), pauseEdit: randomUUID(), clonePaused: randomUUID(), cloneRejected: randomUUID(), reactivate: randomUUID(), close: randomUUID() }}
      />
      <Card><CardHeader><CardTitle as="h2">Audit-Nachweis (letzte 10)</CardTitle></CardHeader><CardContent className="grid gap-2">{detail.auditEvents.length === 0 ? <p className="text-sm text-muted-foreground">Noch kein Job-Audit im aktuellen Firmenkontext.</p> : detail.auditEvents.map((event, index) => <div key={`${event.action}-${event.createdAt.toISOString()}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"><span>{event.action}</span><span className="text-muted-foreground">{event.result} · {formatDate(event.createdAt)}</span></div>)}</CardContent></Card>
    </section>
  );
}

function parseStep(value: string | string[] | undefined) { const number = Number(first(value)); return Number.isInteger(number) && number >= 1 && number <= 5 ? number : 1; }
function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }
function Metric({ label, value }: Readonly<{ label: string; value: number }>) { return <div className="rounded-lg bg-muted/50 p-4 text-center"><p className="text-2xl font-semibold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>; }
function formatDate(value: Date) { return new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Zurich" }).format(value); }
