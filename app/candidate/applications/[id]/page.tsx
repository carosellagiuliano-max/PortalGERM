import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeftIcon,
  BriefcaseBusinessIcon,
  MessageSquareIcon,
  ShieldCheckIcon,
} from "lucide-react";

import { CandidateApplicationActions } from "@/components/candidate/application-actions";
import { ApplicationTimeline } from "@/components/candidate/application-timeline";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { APPLICATION_STATUS_LABELS_V1 } from "@/lib/applications/contracts";
import { getCandidateApplicationDetail } from "@/lib/applications/queries";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "Bewerbungsdetails",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};

type ApplicationDetailPageProps = Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<{ submitted?: string | string[]; duplicate?: string | string[] }>;
}>;

export default async function CandidateApplicationDetailPage({
  params,
  searchParams,
}: ApplicationDetailPageProps) {
  const [user, route, notices] = await Promise.all([
    requireCandidatePage(),
    params,
    searchParams,
  ]);
  const application = await getCandidateApplicationDetail(
    user.id,
    route.id,
    getDatabase(),
  );
  if (application === null) notFound();

  return (
    <section aria-labelledby="application-detail-title" className="grid gap-6">
      <div>
        <Link
          href="/candidate/applications"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          <ArrowLeftIcon aria-hidden="true" /> Alle Bewerbungen
        </Link>
      </div>

      {first(notices.submitted) === "1" ? (
        <Alert>
          <ShieldCheckIcon aria-hidden="true" />
          <AlertTitle>Bewerbung sicher eingereicht</AlertTitle>
          <AlertDescription>
            Identität, Empfänger, Stelle und ausgewählte Unterlagen wurden als
            unveränderbarer Einreichungsnachweis festgehalten.
          </AlertDescription>
        </Alert>
      ) : null}
      {first(notices.duplicate) === "1" ? (
        <Alert>
          <ShieldCheckIcon aria-hidden="true" />
          <AlertTitle>Bereits eingereicht</AlertTitle>
          <AlertDescription>
            Für diese Stelle besteht bereits eine Bewerbung. Wir haben keine
            zweite Bewerbung erzeugt.
          </AlertDescription>
        </Alert>
      ) : null}

      <header className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div>
          <p className="eyebrow">{application.companyName}</p>
          <h1 id="application-detail-title" className="mt-2 text-3xl font-semibold tracking-tight">
            {application.jobTitle}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Eingereicht am {dateTimeFormatter.format(application.submittedAt)}
          </p>
        </div>
        <Badge className="mt-1" variant={application.status === "REJECTED" ? "destructive" : "secondary"}>
          {APPLICATION_STATUS_LABELS_V1[application.status]}
        </Badge>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Verlauf</CardTitle>
              <CardDescription>
                Ausschliesslich sichere Statusereignisse – keine internen Arbeitgebernotizen.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ApplicationTimeline events={application.timeline} />
            </CardContent>
          </Card>

          {application.status === "REJECTED" ? (
            <Card>
              <CardHeader>
                <CardTitle as="h2">Rückmeldung zur Absage</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm leading-6">
                <p>{rejectionReasonLabel(application.rejectionReason)}</p>
                {application.rejectionNote === null ? null : (
                  <p className="text-muted-foreground">{application.rejectionNote}</p>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card id="candidate-note" className="scroll-mt-6">
            <CardHeader>
              <CardTitle as="h2">Aktionen</CardTitle>
              <CardDescription>
                Notizen sind privat. Rückzug und Meldung erfordern eine bewusste Eingabe.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CandidateApplicationActions
                applicationId={application.id}
                candidateNote={application.candidateNote}
                status={application.status}
                noteIdempotencyKey={`note:${randomUUID()}`}
                withdrawIdempotencyKey={`withdraw:${randomUUID()}`}
              />
            </CardContent>
          </Card>
        </div>

        <aside className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Stellenkontext</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <p className="text-sm leading-6 text-muted-foreground">
                {application.jobContext.label}
              </p>
              {application.jobContext.current ? (
                <Link
                  href={`/jobs/${application.jobContext.slug}`}
                  className={buttonVariants({ variant: "outline" })}
                >
                  <BriefcaseBusinessIcon aria-hidden="true" /> Stelle öffnen
                </Link>
              ) : null}
            </CardContent>
          </Card>

          {application.conversationId === null ? null : (
            <Card>
              <CardHeader>
                <CardTitle as="h2">Nachrichten</CardTitle>
              </CardHeader>
              <CardContent>
                <Link
                  href={`/candidate/messages/${application.conversationId}`}
                  className={buttonVariants({ className: "w-full" })}
                >
                  <MessageSquareIcon aria-hidden="true" /> Unterhaltung öffnen
                </Link>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </section>
  );
}

function rejectionReasonLabel(reason: string | null) {
  const labels: Readonly<Record<string, string>> = {
    NOT_A_MATCH: "Das Profil passt derzeit nicht ausreichend zur Stelle.",
    POSITION_FILLED: "Die Stelle wurde anderweitig besetzt.",
    REQUIREMENTS_NOT_MET: "Die Muss-Anforderungen wurden nicht vollständig erfüllt.",
    OTHER_REVIEWED: "Die Bewerbung wurde geprüft und nicht weiter berücksichtigt.",
  };
  return reason === null ? "Die Bewerbung wurde nach Prüfung abgelehnt." : labels[reason] ?? "Die Bewerbung wurde nach Prüfung abgelehnt.";
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const dateTimeFormatter = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Zurich",
});
