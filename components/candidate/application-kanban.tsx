import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  APPLICATION_STATUS_LABELS_V1,
} from "@/lib/applications/contracts";
import type { CandidateApplicationListItem } from "@/lib/applications/queries";
import { APPLICATION_STATUSES } from "@/lib/policies/status/application";

import {
  ApplicationEmptyState,
  formatApplicationResponseLabel,
} from "./application-list";

export function ApplicationKanban({
  applications,
}: Readonly<{ applications: readonly CandidateApplicationListItem[] }>) {
  if (applications.length === 0) return <ApplicationEmptyState />;

  return (
    <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-4">
      {APPLICATION_STATUSES.map((status) => {
        const items = applications.filter((application) => application.status === status);
        return (
          <section
            key={status}
            aria-labelledby={`application-column-${status}`}
            className="grid content-start gap-3 rounded-xl border bg-muted/20 p-3"
          >
            <header className="flex items-center justify-between gap-2 px-1">
              <h2 id={`application-column-${status}`} className="text-sm font-semibold">
                {APPLICATION_STATUS_LABELS_V1[status]}
              </h2>
              <Badge variant="outline">{items.length}</Badge>
            </header>
            {items.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                Keine Bewerbung
              </p>
            ) : (
              items.map((application) => (
                <Card key={application.id} size="sm">
                  <CardHeader>
                    <CardTitle as="h3" className="text-sm">
                      <Link
                        href={`/candidate/applications/${application.id}`}
                        className="underline-offset-4 hover:text-primary hover:underline"
                      >
                        {application.jobTitle}
                      </Link>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-1 text-xs text-muted-foreground">
                    <span>{application.companyName}</span>
                    <Badge variant="outline" className="w-fit">
                      {APPLICATION_STATUS_LABELS_V1[application.status]}
                    </Badge>
                    <span>Eingereicht {formatDate(application.submittedAt)}</span>
                    <span>Aktualisiert {formatDate(application.lastUpdatedAt)}</span>
                    <span>{formatApplicationResponseLabel(application)}</span>
                    <Link
                      href={`/candidate/applications/${application.id}#candidate-note`}
                      className="mt-1 font-medium text-foreground underline underline-offset-4"
                    >
                      {application.hasCandidateNote ? "Notiz bearbeiten" : "Notiz hinzufügen"}
                    </Link>
                  </CardContent>
                </Card>
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}

const dateFormatter = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "short",
  timeZone: "Europe/Zurich",
});

function formatDate(value: Date) {
  return dateFormatter.format(value);
}
