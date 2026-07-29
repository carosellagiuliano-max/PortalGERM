import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "@/components/shared/app-link";
import { notFound } from "next/navigation";

import { EmployerInterviewActions } from "@/components/employer/interview-actions";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getEmployerContext } from "@/lib/auth/employer-context";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { requireEmployerCompanyContext } from "@/lib/employer/context";
import { isRecruitingFeatureAvailableV1 } from "@/lib/recruiting/feature-gates";
import {
  getEmployerInterview,
  INTERVIEW_STATUS_LABELS_V1,
} from "@/lib/recruiting/interviews";
import { formatInTimeZone } from "@/lib/recruiting/time-zones";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Interviewdetail",
  robots: { index: false, follow: false, noarchive: true },
};

const TERMINAL = new Set(["DECLINED", "CANCELLED", "COMPLETED"]);

export default async function EmployerInterviewDetailPage({
  params,
}: Readonly<{
  params: Promise<{ id: string; interviewId: string }>;
}>) {
  const [route, current, context] = await Promise.all([
    params,
    requireEmployerCompanyContext(),
    getEmployerContext(),
  ]);
  if (context === null) notFound();
  const environment = getServerEnvironment();
  const access = {
    companyId: current.companyId,
    membershipId: current.membershipId,
    userId: context.user.id,
    membershipRole: current.membershipRole,
  } as const;
  const interview = await getEmployerInterview(
    route.id,
    route.interviewId,
    access,
    { database: getDatabase(), environment },
    new Date(),
  );
  if (interview === null) notFound();
  const featureEnabled = isRecruitingFeatureAvailableV1(
    environment,
    "interview_scheduler",
  );
  const candidateUserId = interview.participants.find(
    (participant) => participant.kind === "CANDIDATE",
  )?.userId;
  const candidateProposals = interview.proposals
    .filter(
      (proposal) =>
        proposal.version === interview.activeProposalVersion &&
        proposal.status === "OPEN" &&
        proposal.createdByUserId === candidateUserId,
    )
    .map((proposal) => ({
      id: proposal.id,
      label: `${formatInTimeZone(proposal.startsAt, proposal.timeZone)} – ${formatTime(
        proposal.endsAt,
        proposal.timeZone,
      )}`,
    }));
  const canMutate =
    current.membershipRole !== "VIEWER" && !TERMINAL.has(interview.status);
  const canCancel =
    current.membershipRole !== "VIEWER" &&
    interview.status !== "CANCELLED" &&
    interview.status !== "COMPLETED";
  const hasCalendar =
    interview.scheduledStartAt !== null &&
    interview.calendarArtifacts.length > 0;

  return (
    <section aria-labelledby="employer-interview-title" className="grid gap-6">
      <Link
        href={`/employer/applicants/${route.id}/interviews`}
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        Zurück zur Interviewplanung
      </Link>
      <header className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <p className="eyebrow">Interview</p>
          <h1
            id="employer-interview-title"
            className="mt-2 text-3xl font-semibold tracking-tight"
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

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="grid gap-5">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Bestätigte Zeit</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <p>
                {interview.scheduledStartAt === null
                  ? "Noch kein verbindlicher Termin"
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
              <CardTitle as="h2">Vorschläge</CardTitle>
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
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle as="h2">Nachweisbarer Verlauf</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {interview.events.map((event) => (
                <p key={event.id} className="text-sm text-muted-foreground">
                  {formatInTimeZone(event.createdAt, interview.timeZone)} ·{" "}
                  {event.kind}
                </p>
              ))}
            </CardContent>
          </Card>
        </div>

        <aside>
          <EmployerInterviewActions
            applicationId={route.id}
            interviewId={interview.id}
            version={interview.version}
            proposals={candidateProposals}
            canRespond={canMutate}
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
