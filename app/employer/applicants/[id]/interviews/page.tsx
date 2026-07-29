import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmployerInterviewProposalForm } from "@/components/employer/interview-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getEmployerContext } from "@/lib/auth/employer-context";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { requireEmployerCompanyContext } from "@/lib/employer/context";
import { isRecruitingFeatureAvailableV1 } from "@/lib/recruiting/feature-gates";
import {
  INTERVIEW_STATUS_LABELS_V1,
  listEmployerInterviews,
} from "@/lib/recruiting/interviews";
import { formatInTimeZone } from "@/lib/recruiting/time-zones";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Interviewplanung",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function EmployerInterviewListPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const [{ id }, current, context] = await Promise.all([
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
  const result = await listEmployerInterviews(
    id,
    access,
    { database: getDatabase(), environment },
    new Date(),
  );
  if (result === null) notFound();
  const featureEnabled = isRecruitingFeatureAvailableV1(
    environment,
    "interview_scheduler",
  );
  if (!featureEnabled && result.interviews.length === 0) notFound();

  return (
    <section aria-labelledby="employer-interviews-title" className="grid gap-7">
      <Link
        href={`/employer/applicants/${id}`}
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        Zurück zur Bewerbung
      </Link>
      <header>
        <p className="eyebrow">Bewerbungsprozess</p>
        <h1
          id="employer-interviews-title"
          className="mt-2 text-3xl font-semibold tracking-tight"
        >
          Interviews planen
        </h1>
        <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
          {result.application.jobTitle}. Vorschläge sind noch keine Zusage;
          erst eine ausdrückliche Annahme erzeugt den Kalendereintrag.
        </p>
      </header>

      {!featureEnabled ? (
        <Alert>
          <AlertTitle>Neue Interviewaktionen pausiert</AlertTitle>
          <AlertDescription>
            Die Historie bleibt sichtbar. Bestehende Termine können weiterhin
            sicher abgesagt oder exportiert werden.
          </AlertDescription>
        </Alert>
      ) : current.membershipRole === "VIEWER" ? null : (
        <EmployerInterviewProposalForm
          applicationId={id}
          defaultSubject={`Interview: ${result.application.jobTitle}`}
          idempotencyKey={randomUUID()}
        />
      )}

      {result.interviews.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            Noch kein Interview vorgeschlagen.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {result.interviews.map((interview) => (
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
                <p className="text-sm">
                  {interview.scheduledStartAt === null
                    ? "Noch keine Zeit bestätigt"
                    : formatInTimeZone(
                        interview.scheduledStartAt,
                        interview.timeZone,
                      )}
                </p>
                <Link
                  href={`/employer/applicants/${id}/interviews/${interview.id}`}
                  className={buttonVariants({ variant: "outline" })}
                >
                  Interview öffnen
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
