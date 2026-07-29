import type { Metadata } from "next";
import Link from "@/components/shared/app-link";
import { notFound } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { isRecruitingFeatureAvailableV1 } from "@/lib/recruiting/feature-gates";
import {
  INTERVIEW_STATUS_LABELS_V1,
  listCandidateInterviews,
} from "@/lib/recruiting/interviews";
import { formatInTimeZone } from "@/lib/recruiting/time-zones";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Interviewtermine",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function CandidateInterviewsPage() {
  const [user, environment] = await Promise.all([
    requireCandidatePage(),
    Promise.resolve(getServerEnvironment()),
  ]);
  const interviews = await listCandidateInterviews(user.id, {
    database: getDatabase(),
    environment,
  });
  const featureEnabled = isRecruitingFeatureAvailableV1(
    environment,
    "interview_scheduler",
  );
  if (!featureEnabled && interviews.length === 0) notFound();

  return (
    <section aria-labelledby="candidate-interviews-title" className="grid gap-7">
      <header>
        <p className="eyebrow">Terminplanung</p>
        <h1
          id="candidate-interviews-title"
          className="mt-2 text-3xl font-semibold tracking-tight"
        >
          Interviews
        </h1>
        <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
          Vorschläge, verbindlich bestätigte Zeiten, Gegenvorschläge und
          Absagen werden getrennt vom älteren Bewerbungsstatus geführt.
        </p>
      </header>

      {!featureEnabled ? (
        <Alert>
          <AlertTitle>Neue Terminaktionen pausiert</AlertTitle>
          <AlertDescription>
            Vorhandene Termine bleiben lesbar und können weiterhin sicher
            abgesagt oder als Kalenderdatei exportiert werden.
          </AlertDescription>
        </Alert>
      ) : null}

      {interviews.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="font-medium">Noch keine Interviewtermine.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Sobald ein Arbeitgeber Zeiten vorschlägt, erscheinen sie hier.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {interviews.map((interview) => (
            <Card key={interview.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <CardTitle as="h2">{interview.subject}</CardTitle>
                  <Badge variant="secondary">
                    {INTERVIEW_STATUS_LABELS_V1[interview.status]}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3">
                <p className="text-sm text-muted-foreground">
                  {interview.application.submissionSnapshot
                    ?.recipientCompanyName ?? "Arbeitgeber"}
                  {" · "}
                  {interview.application.submittedJobRevision.title}
                </p>
                <p className="text-sm">
                  {interview.scheduledStartAt === null
                    ? "Noch keine Zeit bestätigt"
                    : formatInTimeZone(
                        interview.scheduledStartAt,
                        interview.timeZone,
                      )}
                </p>
                <Link
                  href={`/candidate/interviews/${interview.id}`}
                  className={buttonVariants({ variant: "outline" })}
                >
                  Termin öffnen
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
