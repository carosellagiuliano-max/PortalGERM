import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "@/components/shared/app-link";
import { notFound } from "next/navigation";

import { CandidateInterviewActions } from "@/components/candidate/interview-actions";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { isRecruitingFeatureAvailableV1 } from "@/lib/recruiting/feature-gates";
import {
  getCandidateInterview,
  INTERVIEW_STATUS_LABELS_V1,
} from "@/lib/recruiting/interviews";
import { formatInTimeZone } from "@/lib/recruiting/time-zones";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Interviewdetail",
  robots: { index: false, follow: false, noarchive: true },
};

const TERMINAL = new Set(["DECLINED", "CANCELLED", "COMPLETED"]);

export default async function CandidateInterviewDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const [user, { id }] = await Promise.all([requireCandidatePage(), params]);
  const environment = getServerEnvironment();
  const interview = await getCandidateInterview(user.id, id, {
    database: getDatabase(),
    environment,
  });
  if (interview === null) notFound();
  const featureEnabled = isRecruitingFeatureAvailableV1(
    environment,
    "interview_scheduler",
  );
  const openCompanyProposals = interview.proposals
    .filter(
      (proposal) =>
        proposal.version === interview.activeProposalVersion &&
        proposal.status === "OPEN" &&
        proposal.createdByUserId !== user.id,
    )
    .map((proposal) => ({
      id: proposal.id,
      label: `${formatInTimeZone(proposal.startsAt, proposal.timeZone)} – ${formatTime(
        proposal.endsAt,
        proposal.timeZone,
      )}`,
    }));
  const canRespond = !TERMINAL.has(interview.status);
  const canCancel =
    interview.status !== "CANCELLED" && interview.status !== "COMPLETED";
  const hasCalendar =
    interview.scheduledStartAt !== null &&
    interview.calendarArtifacts.length > 0;

  return (
    <section
      aria-labelledby="candidate-interview-title"
      className="grid min-w-0 gap-6"
    >
      <Link
        href="/candidate/interviews"
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        Zurück zu Interviews
      </Link>
      <header className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <p className="eyebrow">
            {interview.application.submissionSnapshot?.recipientCompanyName ??
              "Arbeitgeber"}
          </p>
          <h1
            id="candidate-interview-title"
            className="mt-2 break-words text-3xl font-semibold tracking-tight"
          >
            {interview.subject}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {interview.application.submittedJobRevision.title}
          </p>
        </div>
        <Badge variant="secondary">
          {INTERVIEW_STATUS_LABELS_V1[interview.status]}
        </Badge>
      </header>

      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="grid min-w-0 gap-5">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Termin</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <p>
                {interview.scheduledStartAt === null
                  ? "Noch nicht verbindlich bestätigt"
                  : formatInTimeZone(
                      interview.scheduledStartAt,
                      interview.timeZone,
                    )}
              </p>
              <p className="text-sm text-muted-foreground">
                Zeitzone: {interview.timeZone}
              </p>
              {interview.location === null ? null : (
                <p className="break-words text-sm text-muted-foreground">
                  Ort: {interview.location}
                </p>
              )}
              {hasCalendar ? (
                <a
                  href={`/api/recruiting/interviews/${interview.id}/calendar`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Kalenderdatei herunterladen
                </a>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Vorschläge und Verlauf</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {interview.proposals.map((proposal) => (
                <div key={proposal.id} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">
                    {formatInTimeZone(proposal.startsAt, proposal.timeZone)}
                    {" – "}
                    {formatTime(proposal.endsAt, proposal.timeZone)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Version {proposal.version} · {proposal.status}
                  </p>
                </div>
              ))}
              {interview.events.map((event) => (
                <p key={event.id} className="text-sm text-muted-foreground">
                  {formatInTimeZone(event.createdAt, interview.timeZone)} ·{" "}
                  {event.kind}
                </p>
              ))}
            </CardContent>
          </Card>
        </div>

        <aside className="min-w-0">
          <CandidateInterviewActions
            interviewId={interview.id}
            version={interview.version}
            proposals={openCompanyProposals}
            canRespond={canRespond}
            canCancel={canCancel}
            featureEnabled={featureEnabled}
            keys={{
              response: randomUUID(),
              reschedule: randomUUID(),
              cancel: randomUUID(),
            }}
          />
        </aside>
      </div>
    </section>
  );
}

function formatTime(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("de-CH", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(value);
}
