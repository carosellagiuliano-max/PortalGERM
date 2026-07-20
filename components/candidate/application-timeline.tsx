import { CheckCircle2Icon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { APPLICATION_STATUS_LABELS_V1 } from "@/lib/applications/contracts";
import type { CandidateApplicationDetail } from "@/lib/applications/queries";

export function ApplicationTimeline({
  events,
}: Readonly<{ events: CandidateApplicationDetail["timeline"] }>) {
  return (
    <ol className="grid gap-0">
      {events.map((event, index) => (
        <li key={event.id} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3">
          <div className="flex flex-col items-center">
            <span className="grid size-6 place-items-center rounded-full bg-primary/10 text-primary">
              <CheckCircle2Icon className="size-4" aria-hidden="true" />
            </span>
            {index === events.length - 1 ? null : (
              <span className="min-h-8 w-px grow bg-border" aria-hidden="true" />
            )}
          </div>
          <div className="pb-6">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{eventLabel(event)}</p>
              <Badge variant="outline">{event.actorLabel}</Badge>
            </div>
            <time
              dateTime={event.createdAt.toISOString()}
              className="mt-1 block text-xs text-muted-foreground"
            >
              {dateTimeFormatter.format(event.createdAt)}
            </time>
          </div>
        </li>
      ))}
    </ol>
  );
}

function eventLabel(event: CandidateApplicationDetail["timeline"][number]) {
  if (event.toStatus !== null) {
    return `Status: ${APPLICATION_STATUS_LABELS_V1[event.toStatus]}`;
  }
  if (event.kind === "CANDIDATE_NOTE_UPDATED") return "Private Notiz aktualisiert";
  return "Bewerbung aktualisiert";
}

const dateTimeFormatter = new Intl.DateTimeFormat("de-CH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Zurich",
});
