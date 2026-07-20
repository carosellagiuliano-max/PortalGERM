import { JobCard } from "@/components/public/job-card";
import type { PublicJobCardModel } from "@/lib/public/types";

export function JobGrid({
  jobs,
  emptyText = "Für diese Auswahl sind aktuell keine publizierten Stellen verfügbar.",
}: Readonly<{
  jobs: readonly PublicJobCardModel[];
  emptyText?: string;
}>) {
  if (jobs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-muted/25 px-5 py-12 text-center text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {jobs.map((job) => <JobCard key={job.id} job={job} />)}
    </div>
  );
}
