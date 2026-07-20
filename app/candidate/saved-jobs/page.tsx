import type { Metadata } from "next";

import { SavedJobList } from "@/components/candidate/saved-job-list";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { listCandidateSavedJobs } from "@/lib/candidate/saved-jobs";
import { getDatabase } from "@/lib/db/client";

export const metadata: Metadata = { title: "Gespeicherte Jobs" };

export default async function CandidateSavedJobsPage() {
  const user = await requireCandidatePage();
  const jobs = await listCandidateSavedJobs(user.id, getDatabase());
  return (
    <div className="grid gap-6">
      <header>
        <p className="text-sm font-medium text-primary">Deine Merkliste</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Gespeicherte Jobs
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Offene Stellen bleiben direkt erreichbar. Bei geschlossenen oder
          abgelaufenen Inseraten zeigen wir passende aktuelle Alternativen.
        </p>
      </header>
      <SavedJobList jobs={jobs} />
    </div>
  );
}
