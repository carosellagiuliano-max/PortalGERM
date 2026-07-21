import { randomUUID } from "node:crypto";

import { cache, Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeftIcon,
  BadgeCheckIcon,
} from "lucide-react";

import { CandidateMatch } from "@/components/public/candidate-match";
import {
  ApplyIntentConfirmation,
  JobIntentAuthenticationLinks,
  PublicJobActions,
  SaveIntentConfirmation,
} from "@/components/public/apply-save-actions";
import { FairScoreBreakdown } from "@/components/public/fair-score";
import { JobCard } from "@/components/public/job-card";
import { ReportForm } from "@/components/public/report-form";
import { ResponseSignal } from "@/components/public/response-signal";
import { ShareButton } from "@/components/public/share-button";
import {
  JobContentSections,
  JobFacts,
  JobTypeBadge,
} from "@/components/shared/job-content-sections";
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
import { getPublicDataContext } from "@/lib/public/environment";
import { formatDate } from "@/lib/utils/format";

const getJob = cache((slug: string) => getPublicJobBySlug(slug));

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
              <JobTypeBadge jobType={job.jobType} />
            </div>
            <h1 className="mt-5 text-balance text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">{job.title}</h1>
            <Link href={`/companies/${job.company.slug}`} className="mt-4 inline-flex items-center gap-2 text-lg font-medium underline-offset-4 hover:text-primary hover:underline">{job.company.name}<BadgeCheckIcon className="size-5 text-primary" aria-label="Verifiziertes Unternehmen" /></Link>
            <JobFacts
              facts={{
                locationLabel: job.city?.name ?? job.canton?.name ?? job.locationLabel ?? "Schweiz",
                remoteType: job.remoteType,
                workloadMin: job.workloadMin,
                workloadMax: job.workloadMax,
                salaryMin: job.salaryMin,
                salaryMax: job.salaryMax,
                salaryPeriod: job.salaryPeriod,
                startDate: job.startDate,
                startByArrangement: job.startByArrangement,
                applicationEffort: job.applicationEffort,
                dateFact: {
                  label: "Publiziert",
                  value: job.publishedAt,
                  missingValue: "Nicht publiziert",
                },
              }}
            />
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
            <JobContentSections
              content={{
                description: job.companyIntro ?? job.description,
                additionalDescription:
                  job.companyIntro !== null && job.description !== "" && job.description !== job.companyIntro
                    ? job.description
                    : null,
                tasks: job.tasks,
                requirements: job.requirements,
                niceToHave: job.niceToHave,
                offer: job.offer,
                benefits: job.benefits,
                skills: job.skills,
                languages: job.languages,
                inclusionStatement: job.inclusionStatement,
                applicationProcessSteps: job.applicationProcessSteps,
                requiredDocumentKinds: job.requiredDocumentKinds,
              }}
            />
            <FairScoreBreakdown
              score={job.fairScore}
              version={job.fairScoreVersion}
              factors={job.fairBreakdown}
            />
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
