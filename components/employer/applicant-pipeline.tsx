import { ApplicantCard } from "@/components/employer/applicant-card";
import type { listEmployerApplications } from "@/lib/employer/applications";

type Applications = Awaited<
  ReturnType<typeof listEmployerApplications>
>["applications"];

const columns = [
  "SUBMITTED",
  "IN_REVIEW",
  "SHORTLISTED",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "REJECTED",
  "WITHDRAWN",
] as const;

export function ApplicantPipeline({
  applications,
  nowEpochMilliseconds,
}: Readonly<{
  applications: Applications;
  nowEpochMilliseconds: number;
}>) {
  if (applications.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
        Keine Bewerbungen für diese Filter.
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-4">
      {columns.map((status) => {
        const rows = applications.filter(
          (application) => application.status === status,
        );
        return (
          <section
            key={status}
            aria-labelledby={`pipeline-${status}`}
            className="min-w-0 rounded-xl bg-muted/35 p-3"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 id={`pipeline-${status}`} className="font-medium">
                {label(status)}
              </h2>
              <span className="text-xs tabular-nums text-muted-foreground">
                {rows.length}
              </span>
            </div>
            <div className="grid gap-3">
              {rows.map((application) => (
                <ApplicantCard
                  key={application.id}
                  application={application}
                  nowEpochMilliseconds={nowEpochMilliseconds}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function label(status: string) {
  return (
    {
      SUBMITTED: "Eingegangen",
      IN_REVIEW: "In Prüfung",
      SHORTLISTED: "Vorauswahl",
      INTERVIEW: "Interview",
      OFFER: "Angebot",
      HIRED: "Eingestellt",
      REJECTED: "Abgelehnt",
      WITHDRAWN: "Zurückgezogen",
    } as Record<string, string>
  )[status] ?? status;
}
