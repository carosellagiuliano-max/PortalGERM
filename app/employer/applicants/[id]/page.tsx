import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ApplicantDetailActions } from "@/components/employer/applicant-detail-actions";
import { EmployerApplicantReportForm } from "@/components/employer/applicant-report-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getEmployerContext } from "@/lib/auth/employer-context";
import { getDatabase } from "@/lib/db/client";
import { getEmployerApplicationDetail } from "@/lib/employer/applications";
import { requireEmployerCompanyContext } from "@/lib/employer/context";

export const metadata: Metadata = { title: "Bewerbungsdetail" };
export const dynamic = "force-dynamic";

export default async function EmployerApplicantDetailPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const [{ id }, current, context] = await Promise.all([params, requireEmployerCompanyContext(), getEmployerContext()]);
  const application = await getEmployerApplicationDetail(id, { companyId: current.companyId, membershipId: current.membershipId, userId: context!.user.id, membershipRole: current.membershipRole }, getDatabase());
  if (application === null) notFound();
  const snapshot = application.submissionSnapshot;
  return <section aria-labelledby="application-title" className="grid gap-7"><header><p className="eyebrow">Bewerbungsdetail</p><h1 id="application-title" className="mt-2 text-3xl font-semibold tracking-tight">{snapshot ? `${snapshot.candidateFirstName} ${snapshot.candidateLastName}` : "Kandidat:in"}</h1><div className="mt-3 flex flex-wrap gap-2"><Badge>{application.status}</Badge><Badge variant="outline">{application.job.currentRevision?.title ?? "Unbenannte Stelle"}</Badge></div></header><div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]"><div className="grid gap-5"><Card><CardHeader><CardTitle as="h2">Übermittelte Bewerbung</CardTitle></CardHeader><CardContent className="grid gap-3"><p><strong>E-Mail:</strong> {snapshot?.candidateEmail ?? "Nicht verfügbar"}</p><p className="whitespace-pre-wrap text-muted-foreground">{application.coverLetter ?? "Kein Motivationsschreiben übermittelt."}</p><div><p className="font-medium">Dokument-Metadaten</p>{application.submissionDocuments.length === 0 ? <p className="text-sm text-muted-foreground">Keine Dokumente.</p> : application.submissionDocuments.map((document) => <p key={document.id} className="text-sm text-muted-foreground">{document.safeFilenameSnapshot} · {document.mimeTypeSnapshot} · {Math.ceil(document.sizeBytesSnapshot / 1024)} KB · kein Download im Mock-MVP</p>)}</div></CardContent></Card><Card><CardHeader><CardTitle as="h2">Verlauf und Nachrichten</CardTitle></CardHeader><CardContent className="grid gap-3">{application.events.map((event) => <p key={event.id} className="text-sm"><span className="text-muted-foreground">{new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short" }).format(event.createdAt)}</span> · {event.kind}{event.toStatus ? ` → ${event.toStatus}` : ""}</p>)}{application.conversation?.messages.map((message) => <div key={message.id} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{message.sender.name ?? "Teammitglied"} · {new Intl.DateTimeFormat("de-CH", { dateStyle: "short", timeStyle: "short" }).format(message.createdAt)}</p><p className="mt-2 whitespace-pre-wrap">{message.body}</p></div>)}</CardContent></Card><Card><CardHeader><CardTitle as="h2">Private Arbeitgebernotizen</CardTitle></CardHeader><CardContent className="grid gap-3">{application.employerNotes.length === 0 ? <p className="text-muted-foreground">Noch keine private Notiz.</p> : application.employerNotes.map((note) => <div key={note.id} className="rounded-lg bg-muted/50 p-3"><p className="whitespace-pre-wrap">{note.body}</p><p className="mt-2 text-xs text-muted-foreground">{new Intl.DateTimeFormat("de-CH", { dateStyle: "medium", timeStyle: "short" }).format(note.createdAt)}</p></div>)}</CardContent></Card></div><aside className="grid content-start gap-5"><ApplicantDetailActions applicationId={application.id} currentStatus={application.status} keys={{ transition: randomUUID(), note: randomUUID(), message: randomUUID() }} /><EmployerApplicantReportForm applicationId={application.id} /></aside></div></section>;
}
