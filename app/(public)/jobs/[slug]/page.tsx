import { randomUUID } from "node:crypto";

import { cache, Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeftIcon,
  BadgeCheckIcon,
  BanknoteIcon,
  BriefcaseBusinessIcon,
  CalendarDaysIcon,
  LanguagesIcon,
  MapPinIcon,
} from "lucide-react";

import { CandidateMatch } from "@/components/public/candidate-match";
import {
  ApplyIntentConfirmation,
  JobIntentAuthenticationLinks,
  PublicJobActions,
  SaveIntentConfirmation,
} from "@/components/public/apply-save-actions";
import { FairScoreBreakdown } from "@/components/public/fair-score";
import { JobCard, JOB_TYPE_LABELS, REMOTE_LABELS, SALARY_PERIOD_LABELS } from "@/components/public/job-card";
import { ReportForm } from "@/components/public/report-form";
import { ResponseSignal } from "@/components/public/response-signal";
import { ShareButton } from "@/components/public/share-button";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getServerEnvironment } from "@/lib/config/env";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  buildJobIntentNextPath,
  verifyJobIntent,
  type SignedJobIntentPayloadV1,
} from "@/lib/auth/signed-intent";
import { getApplicationConfirmationView } from "@/lib/applications/confirmation";
import { getDatabase } from "@/lib/db/client";
import { buildPublicJobPostingJsonLd, serializeJsonLd } from "@/lib/jobs/job-json-ld";
import { getPublicJobBySlug, listRelatedPublicJobs } from "@/lib/jobs/public-read-model";
import type { PublicJobDetailModel } from "@/lib/public/types";
import { getPublicDataContext } from "@/lib/public/environment";
import { formatDate, formatSalaryRange, formatWorkload } from "@/lib/utils/format";

const getJob = cache((slug: string) => getPublicJobBySlug(slug));
const APPLICATION_EFFORT_LABELS: Readonly<Record<PublicJobDetailModel["applicationEffort"], string>> = {
  SIMPLE: "Kurz",
  MEDIUM: "Mittel",
  LONG: "Umfangreich",
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const job = await getJob(slug);
  if (job === null) return { title: "Stelle nicht gefunden" };
  const description = job.description.slice(0, 155);
  const indexable = getPublicDataContext().publicIndexingAllowed && job.dataProvenance === "LIVE";
  return {
    title: `${job.title} bei ${job.company.name}`,
    description,
    alternates: { canonical: `/jobs/${job.slug}` },
    openGraph: { title: job.title, description, type: "website" },
    referrer: "no-referrer",
    robots: indexable
      ? { index: true, follow: true }
      : { index: false, follow: false, noarchive: true, nosnippet: true },
  };
}

export default async function JobDetailPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const job = await getJob(slug);
  if (job === null) notFound();
  const related = await listRelatedPublicJobs(job, { limit: 4 });
  const appUrl = getServerEnvironment().APP_URL;
  const jsonLd = buildPublicJobPostingJsonLd(job, appUrl);
  const emitJsonLd = getPublicDataContext().publicIndexingAllowed && job.dataProvenance === "LIVE";
  const salary = job.salaryMin !== null && job.salaryMax !== null && job.salaryPeriod !== null
    ? formatSalaryRange(job.salaryMin, job.salaryMax, SALARY_PERIOD_LABELS[job.salaryPeriod])
    : null;
  const intentValue = firstValue(query.intent);
  const environment = getServerEnvironment();
  const intent = verifyJobIntent(
    intentValue,
    { now: new Date(), jobSlug: job.slug },
    environment.secrets.session,
  );
  const currentUser = intent === null ? null : await getCurrentUser();
  const confirmation =
    intent?.action === "APPLY" && currentUser?.role === "CANDIDATE"
      ? await getApplicationConfirmationView(
          {
            candidateUserId: currentUser.id,
            jobSlug: job.slug,
            now: new Date(),
            environment:
              environment.APP_ENV === "production" || environment.APP_ENV === "staging"
                ? "production"
                : "non-production",
          },
          getDatabase(),
        )
      : null;

  return (
    <div>
      {emitJsonLd ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} /> : null}
      <div className="page-shell py-10 sm:py-14">
        <Link href="/jobs" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"><ArrowLeftIcon className="size-4" aria-hidden="true" /> Zur Stellensuche</Link>

        <section className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          <div>
            <div className="flex flex-wrap gap-2">
              {job.activeBoost ? <Badge>Geboostet</Badge> : null}
              <Badge variant="secondary">Fair-Job-Score {job.fairScore ?? "–"}/100</Badge>
              <Badge variant="outline">{JOB_TYPE_LABELS[job.jobType]}</Badge>
            </div>
            <h1 className="mt-5 text-balance text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">{job.title}</h1>
            <Link href={`/companies/${job.company.slug}`} className="mt-4 inline-flex items-center gap-2 text-lg font-medium underline-offset-4 hover:text-primary hover:underline">{job.company.name}<BadgeCheckIcon className="size-5 text-primary" aria-label="Verifiziertes Unternehmen" /></Link>
            <dl className="mt-7 grid gap-3 text-sm sm:grid-cols-2">
              <Fact icon={MapPinIcon} label="Arbeitsort" value={`${job.city?.name ?? job.canton?.name ?? job.locationLabel ?? "Schweiz"} · ${REMOTE_LABELS[job.remoteType]}`} />
              <Fact icon={BriefcaseBusinessIcon} label="Pensum" value={formatWorkload(job.workloadMin, job.workloadMax)} />
              <Fact icon={BanknoteIcon} label="Lohn" value={salary ?? "Nicht transparent ausgewiesen"} />
              <Fact icon={CalendarDaysIcon} label="Publiziert" value={formatDate(job.publishedAt)} />
              <Fact icon={CalendarDaysIcon} label="Start" value={job.startByArrangement ? "Nach Vereinbarung" : job.startDate === null ? "Nicht angegeben" : formatDate(job.startDate)} />
              <Fact icon={BriefcaseBusinessIcon} label="Bewerbungsaufwand" value={APPLICATION_EFFORT_LABELS[job.applicationEffort]} />
            </dl>
          </div>

          <aside className="rounded-xl border bg-card p-5 shadow-sm lg:sticky lg:top-24">
            <p className="text-sm font-medium">Interessiert?</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Speichere die Stelle privat oder starte die Bewerbung. Nach einer
              Anmeldung bleibt immer eine ausdrückliche Bestätigung erforderlich.
            </p>
            <div className="mt-5"><PublicJobActions jobSlug={job.slug} /></div>
            <div className="mt-3"><ShareButton title={job.title} /></div>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">Gültig bis {formatDate(job.expiresAt)}</p>
          </aside>
        </section>

        {firstValue(query.saved) === "1" ? (
          <p className="mt-6 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-950" role="status">
            Die Stelle wurde in deiner privaten Merkliste gespeichert.
          </p>
        ) : null}
        {firstValue(query.candidateRequired) === "1" ? (
          <p className="mt-6 rounded-lg bg-amber-50 p-4 text-sm text-amber-950" role="status">
            Für Speichern und interne Bewerbungen ist ein Kandidatenkonto erforderlich.
          </p>
        ) : null}
        <IntentResumePanel
          intent={intent}
          signedIntent={intentValue}
          currentUser={currentUser}
          confirmation={confirmation}
        />

        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          <article className="grid gap-8">
            <ContentSection title="Die Stelle"><p className="whitespace-pre-line leading-7 text-muted-foreground">{job.description}</p></ContentSection>
            <TwoColumnLists job={job} />
            {job.inclusionStatement === null ? null : <ContentSection title="Zusammenarbeit & Inklusion"><p className="leading-7 text-muted-foreground">{job.inclusionStatement}</p></ContentSection>}
            <FairScoreBreakdown
              score={job.fairScore}
              version={job.fairScoreVersion}
              factors={job.fairBreakdown}
            />
            <ApplicationProcess job={job} />
          </article>
          <aside className="grid gap-5">
            <Suspense fallback={<div className="h-48 animate-pulse rounded-xl border bg-muted/35" aria-label="Profilabgleich wird geladen" />}><CandidateMatch job={job} /></Suspense>
            <Card>
              <CardHeader><CardTitle as="h2">Antwortsignal</CardTitle></CardHeader>
              <CardContent className="text-sm leading-6"><ResponseSignal response={job.response} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle as="h2">Arbeitgeber</CardTitle></CardHeader>
              <CardContent>
                <p className="flex items-center gap-2 font-medium">{job.company.name}<BadgeCheckIcon className="size-4 text-primary" aria-label="Verifiziertes Unternehmen" /></p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Öffentliches Firmenprofil und weitere aktuelle Stellen ansehen.</p>
                <Link href={`/companies/${job.company.slug}`} className={buttonVariants({ variant: "outline", className: "mt-4 w-full" })}>Firmenprofil öffnen</Link>
              </CardContent>
            </Card>
            <ReportForm targetType="JOB" slug={job.slug} />
          </aside>
        </div>
      </div>

      {related.length > 0 ? (
        <section className="border-t bg-muted/25 py-14" aria-labelledby="related-jobs-title"><div className="page-shell"><h2 id="related-jobs-title" className="text-2xl font-semibold">Ähnliche Stellen</h2><div className="mt-6 grid gap-5 lg:grid-cols-2">{related.map((item) => <JobCard key={item.id} job={item} />)}</div></div></section>
      ) : null}
    </div>
  );
}

type JobDetailSearchParams = Promise<{
  intent?: string | string[];
  saved?: string | string[];
  candidateRequired?: string | string[];
}>;

type PageProps = Readonly<{
  params: Promise<{ slug: string }>;
  searchParams: JobDetailSearchParams;
}>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function IntentResumePanel({
  intent,
  signedIntent,
  currentUser,
  confirmation,
}: Readonly<{
  intent: SignedJobIntentPayloadV1 | null;
  signedIntent: string | undefined;
  currentUser: Awaited<ReturnType<typeof getCurrentUser>>;
  confirmation: Awaited<ReturnType<typeof getApplicationConfirmationView>> | null;
}>) {
  if (intent === null || signedIntent === undefined) return null;
  const next = buildJobIntentNextPath(intent.jobSlug, signedIntent);
  let content: React.ReactNode;
  if (currentUser === null) {
    content = (
      <div className="grid gap-4">
        <p className="text-sm leading-6 text-muted-foreground">
          Melde dich an oder erstelle ein Kandidatenkonto. Die Aktion wird danach
          nicht automatisch ausgeführt.
        </p>
        <JobIntentAuthenticationLinks next={next} />
      </div>
    );
  } else if (currentUser.role !== "CANDIDATE") {
    content = (
      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
        Diese Aktion ist ausschliesslich mit einem Kandidatenkonto möglich.
      </p>
    );
  } else if (intent.action === "SAVE") {
    content = <SaveIntentConfirmation signedIntent={signedIntent} />;
  } else if (confirmation === null || !confirmation.ok) {
    content = (
      <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
        Die Bewerbung kann aus diesem Link nicht fortgesetzt werden. Bitte starte
        erneut über die aktuelle Stellenanzeige.
      </p>
    );
  } else if (confirmation.value.externalApplyHref !== null) {
    content = (
      <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
        Diese Stelle nutzt eine externe Bewerbungsseite. Starte die Bewerbung erneut
        über den oberen Button, damit das aktuelle Ziel geprüft wird.
      </p>
    );
  } else {
    content = (
      <ApplyIntentConfirmation
        signedIntent={signedIntent}
        idempotencyKey={randomUUID()}
        projection={confirmation.value.projection}
        identityComplete={confirmation.value.identityComplete}
        documents={confirmation.value.documents.map((document) => ({
          id: document.id,
          safeFilename: document.safeFilename,
          mimeType: document.mimeType,
          sizeBytes: document.sizeBytes,
        }))}
      />
    );
  }
  return (
    <section className="mt-8 rounded-xl border bg-card p-5 shadow-sm" aria-labelledby="resume-intent-title">
      <p className="text-sm font-medium text-primary">Sicher fortsetzen</p>
      <h2 id="resume-intent-title" className="mt-1 text-xl font-semibold">
        {intent.action === "SAVE" ? "Stelle speichern" : "Bewerbung prüfen"}
      </h2>
      <div className="mt-4">{content}</div>
    </section>
  );
}

function Fact({ icon: Icon, label, value }: Readonly<{ icon: typeof MapPinIcon; label: string; value: string }>) {
  return <div className="flex gap-3 rounded-lg bg-muted/35 p-3"><Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" /><div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 font-medium">{value}</dd></div></div>;
}

function ContentSection({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return <section><h2 className="text-2xl font-semibold">{title}</h2><div className="mt-4">{children}</div></section>;
}

function TwoColumnLists({ job }: Readonly<{ job: PublicJobDetailModel }>) {
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <ContentSection title="Deine Aufgaben"><BulletList values={job.tasks} /></ContentSection>
      <ContentSection title="Das bringst du mit"><BulletList values={job.requirements} /></ContentSection>
      {job.benefits.length === 0 ? null : <ContentSection title="Das wird geboten"><BulletList values={job.benefits.map((benefit) => benefit.description)} /></ContentSection>}
      {job.skills.length === 0 ? null : <ContentSection title="Fähigkeiten"><div className="flex flex-wrap gap-2">{job.skills.map((skill) => <Badge key={skill.id} variant={skill.required ? "secondary" : "outline"}>{skill.name}{skill.required ? " · erforderlich" : ""}</Badge>)}</div></ContentSection>}
      {job.languages.length === 0 ? null : <ContentSection title="Sprachen"><div className="flex flex-wrap gap-2">{job.languages.map((language) => <Badge key={`${language.code}-${language.minLevel}`} variant="outline"><LanguagesIcon aria-hidden="true" /> {language.code.toUpperCase()} ab {language.minLevel}</Badge>)}</div></ContentSection>}
    </div>
  );
}

function BulletList({ values }: Readonly<{ values: readonly string[] }>) {
  return values.length === 0 ? <p className="text-muted-foreground">Keine zusätzlichen Angaben.</p> : <ul className="grid gap-2 leading-7 text-muted-foreground">{values.map((value, index) => <li key={`${index}-${value}`} className="flex gap-2"><span className="text-primary" aria-hidden="true">•</span><span>{value}</span></li>)}</ul>;
}

function ApplicationProcess({ job }: Readonly<{ job: PublicJobDetailModel }>) {
  const documentLabels: Readonly<Record<string, string>> = { CV: "Lebenslauf", COVER_LETTER: "Motivationsschreiben", CERTIFICATES: "Zeugnisse", REFERENCES: "Referenzen", PORTFOLIO: "Portfolio", OTHER: "Weitere Unterlagen" };
  const documents = job.requiredDocumentKinds.filter((kind) => kind !== "NONE").map((kind) => documentLabels[kind] ?? kind);
  return (
    <ContentSection title="Bewerbungsprozess">
      {job.applicationProcessSteps.length > 0 ? <ol className="grid gap-3">{job.applicationProcessSteps.map((step, index) => <li key={`${index}-${step}`} className="flex gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">{index + 1}</span><span className="pt-0.5 leading-6 text-muted-foreground">{step}</span></li>)}</ol> : <p className="text-muted-foreground">Der genaue Ablauf wird direkt mit dem Unternehmen abgestimmt.</p>}
      <p className="mt-4 text-sm text-muted-foreground"><strong className="text-foreground">Benötigte Unterlagen:</strong> {documents.length === 0 ? "Keine Pflichtunterlagen angegeben" : documents.join(", ")}</p>
    </ContentSection>
  );
}
