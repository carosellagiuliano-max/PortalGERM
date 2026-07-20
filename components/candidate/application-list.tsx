import Link from "next/link";
import { Clock3Icon, MessageSquareIcon, StickyNoteIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  APPLICATION_STATUS_LABELS_V1,
} from "@/lib/applications/contracts";
import type { CandidateApplicationListItem } from "@/lib/applications/queries";

export function ApplicationList({
  applications,
}: Readonly<{ applications: readonly CandidateApplicationListItem[] }>) {
  if (applications.length === 0) return <ApplicationEmptyState />;

  return (
    <div className="grid gap-4">
      {applications.map((application) => (
        <Card key={application.id}>
          <CardHeader>
            <CardTitle as="h2">
              <Link
                href={`/candidate/applications/${application.id}`}
                className="underline-offset-4 hover:text-primary hover:underline"
              >
                {application.jobTitle}
              </Link>
            </CardTitle>
            <CardDescription>
              {application.companyName} · Eingereicht {formatDate(application.submittedAt)}
            </CardDescription>
            <CardAction>
              <Badge variant={statusBadgeVariant(application.status)}>
                {APPLICATION_STATUS_LABELS_V1[application.status]}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <span>Aktualisiert {formatDate(application.lastUpdatedAt)}</span>
              <span className="inline-flex items-center gap-1.5">
                <Clock3Icon className="size-3.5" aria-hidden="true" />
                {formatApplicationResponseLabel(application)}
              </span>
              {application.hasCandidateNote ? (
                <span className="inline-flex items-center gap-1.5">
                  <StickyNoteIcon className="size-3.5" aria-hidden="true" />
                  Private Notiz vorhanden
                </span>
              ) : null}
              {application.conversationId === null ? null : (
                <span className="inline-flex items-center gap-1.5">
                  <MessageSquareIcon className="size-3.5" aria-hidden="true" />
                  Unterhaltung verfügbar
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/candidate/applications/${application.id}#candidate-note`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <StickyNoteIcon aria-hidden="true" />
                {application.hasCandidateNote ? "Notiz bearbeiten" : "Notiz hinzufügen"}
              </Link>
              <Link
                href={`/candidate/applications/${application.id}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Details ansehen
              </Link>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ApplicationEmptyState() {
  return (
    <Card>
      <CardContent className="py-10 text-center">
        <p className="font-medium">Noch keine Bewerbungen — Jobs suchen</p>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          Passe Suche oder Statusfilter an – oder entdecke veröffentlichte Stellen.
        </p>
        <Link href="/jobs" className={buttonVariants({ className: "mt-5" })}>
          Jobs suchen
        </Link>
      </CardContent>
    </Card>
  );
}

export function statusBadgeVariant(
  status: CandidateApplicationListItem["status"],
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "HIRED" || status === "OFFER") return "default";
  if (status === "REJECTED") return "destructive";
  if (status === "WITHDRAWN") return "outline";
  return "secondary";
}

export function formatApplicationResponseLabel(
  application: CandidateApplicationListItem,
) {
  const duration = formatDuration(application.employerResponseMinutes);
  return application.employerHasResponded
    ? `Erste Reaktion nach ${duration}`
    : `Seit ${duration} ohne Statusreaktion`;
}

function formatDuration(totalMinutes: number) {
  if (totalMinutes < 60) return `${Math.max(1, totalMinutes)} Min.`;
  if (totalMinutes < 1_440) return `${Math.floor(totalMinutes / 60)} Std.`;
  return `${Math.floor(totalMinutes / 1_440)} Tg.`;
}

const dateFormatter = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "medium",
  timeZone: "Europe/Zurich",
});

function formatDate(value: Date) {
  return dateFormatter.format(value);
}
