import type { Metadata } from "next";

import { ApplicantPipeline } from "@/components/employer/applicant-pipeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getEmployerContext } from "@/lib/auth/employer-context";
import { getDatabase } from "@/lib/db/client";
import {
  listEmployerApplications,
  normalizeEmployerApplicationFilter,
} from "@/lib/employer/applications";
import { requireEmployerCompanyContext } from "@/lib/employer/context";

export const metadata: Metadata = { title: "Bewerber:innen" };
export const dynamic = "force-dynamic";

export default async function EmployerApplicantsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{
    job?: string | string[];
    status?: string | string[];
    q?: string | string[];
  }>;
}>) {
  const [current, context, raw] = await Promise.all([
    requireEmployerCompanyContext(),
    getEmployerContext(),
    searchParams,
  ]);
  const now = new Date();
  const filter = normalizeEmployerApplicationFilter({
    jobId: raw.job,
    status: raw.status,
    query: raw.q,
  });
  const data = await listEmployerApplications(
    {
      companyId: current.companyId,
      membershipId: current.membershipId,
      userId: context!.user.id,
      membershipRole: current.membershipRole,
    },
    getDatabase(),
    filter,
    now,
  );

  return (
    <section
      aria-labelledby="applicants-title"
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-7"
    >
      <header className="min-w-0">
        <p className="eyebrow">Pipeline</p>
        <h1
          id="applicants-title"
          className="mt-2 text-3xl font-semibold tracking-tight"
        >
          Bewerber:innen
        </h1>
        <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
          Direkte Bewerbungen im aktuellen Firmen- und
          Job-Zuweisungskontext. Es gibt kein automatisches Ranking.
        </p>
      </header>

      <form
        method="get"
        className="grid min-w-0 gap-3 rounded-xl border bg-card p-4 md:grid-cols-[1fr_14rem_14rem_auto] md:items-end"
      >
        <div className="grid min-w-0 gap-1">
          <Label htmlFor="applicant-search">Name</Label>
          <Input
            id="applicant-search"
            name="q"
            type="search"
            defaultValue={filter.query ?? ""}
            maxLength={100}
          />
        </div>
        <div className="grid min-w-0 gap-1">
          <Label htmlFor="applicant-job">Job</Label>
          <select
            id="applicant-job"
            name="job"
            defaultValue={filter.jobId ?? ""}
            className="h-8 min-w-0 rounded-lg border bg-background px-2 text-sm"
          >
            <option value="">Alle Jobs</option>
            {data.jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.currentRevision?.title ?? "Unbenannt"}
              </option>
            ))}
          </select>
        </div>
        <div className="grid min-w-0 gap-1">
          <Label htmlFor="applicant-status">Status</Label>
          <select
            id="applicant-status"
            name="status"
            defaultValue={filter.status ?? ""}
            className="h-8 min-w-0 rounded-lg border bg-background px-2 text-sm"
          >
            <option value="">Alle</option>
            {[
              "SUBMITTED",
              "IN_REVIEW",
              "SHORTLISTED",
              "INTERVIEW",
              "OFFER",
              "HIRED",
              "REJECTED",
              "WITHDRAWN",
            ].map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </div>
        <Button type="submit">Filtern</Button>
      </form>

      <ApplicantPipeline
        applications={data.applications}
        nowEpochMilliseconds={now.getTime()}
      />
    </section>
  );
}
