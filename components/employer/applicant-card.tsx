import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import type { listEmployerApplications } from "@/lib/employer/applications";

type Application = Awaited<ReturnType<typeof listEmployerApplications>>["applications"][number];

export function ApplicantCard({
  application,
  nowEpochMilliseconds,
}: Readonly<{ application: Application; nowEpochMilliseconds: number }>) {
  const snapshot = application.submissionSnapshot;
  const elapsedDays = Math.max(
    0,
    Math.floor(
      (nowEpochMilliseconds - application.submittedAt.getTime()) / 86_400_000,
    ),
  );
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle as="h3">
          {snapshot ? `${snapshot.candidateFirstName} ${snapshot.candidateLastName}` : "Kandidat:in"}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          <Badge>{statusLabel(application.status)}</Badge>
          <Badge variant="outline">
            {application.job.currentRevision?.title ?? "Unbenannte Stelle"}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Eingang {new Intl.DateTimeFormat("de-CH").format(application.submittedAt)} · {elapsedDays} Tage vergangen
          {snapshot ? ` · Ziel ${snapshot.responseTargetDays} Tage` : ""}
        </p>
        <p className="text-xs text-muted-foreground">
          Letztes Ereignis: {application.events[0]?.toStatus ? statusLabel(application.events[0].toStatus) : "Eingang"}
        </p>
        <Link href={`/employer/applicants/${application.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Bewerbung öffnen
        </Link>
      </CardContent>
    </Card>
  );
}
function statusLabel(status: string) { return ({ SUBMITTED: "Eingegangen", IN_REVIEW: "In Prüfung", SHORTLISTED: "Vorauswahl", INTERVIEW: "Interview", OFFER: "Angebot", HIRED: "Eingestellt", REJECTED: "Abgelehnt", WITHDRAWN: "Zurückgezogen" } as Record<string, string>)[status] ?? status; }
