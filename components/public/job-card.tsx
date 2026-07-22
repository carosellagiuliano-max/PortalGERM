import Link from "next/link";
import {
  BadgeCheckIcon,
  BanknoteIcon,
  BriefcaseBusinessIcon,
  MapPinIcon,
} from "lucide-react";

import { BoostedBadge } from "@/components/billing/boosted-badge";
import { FairScoreBadge } from "@/components/public/fair-score";
import { PublicJobActions } from "@/components/public/apply-save-actions";
import { ResponseSignal } from "@/components/public/response-signal";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PublicJobCardModel } from "@/lib/public/types";
import { formatDate, formatSalaryRange, formatWorkload } from "@/lib/utils/format";

const JOB_TYPE_LABELS: Readonly<Record<PublicJobCardModel["jobType"], string>> = {
  PERMANENT: "Festanstellung",
  TEMPORARY: "Befristet",
  FREELANCE: "Freelance",
  INTERNSHIP: "Praktikum",
  APPRENTICESHIP: "Lehrstelle",
  HOLIDAY_JOB: "Ferienjob",
};

const REMOTE_LABELS: Readonly<Record<PublicJobCardModel["remoteType"], string>> = {
  ONSITE: "Vor Ort",
  HYBRID: "Hybrid",
  REMOTE: "Remote",
};

const SALARY_PERIOD_LABELS = {
  YEARLY: "Jahr",
  MONTHLY: "Monat",
  HOURLY: "Stunde",
} as const;

export function JobCard({ job }: Readonly<{ job: PublicJobCardModel }>) {
  const salary = job.salaryMin !== null && job.salaryMax !== null && job.salaryPeriod !== null
    ? formatSalaryRange(job.salaryMin, job.salaryMax, SALARY_PERIOD_LABELS[job.salaryPeriod])
    : null;

  return (
    <Card className="h-full transition-shadow hover:shadow-md">
      <CardHeader>
        <div className="mb-2 flex flex-wrap gap-2">
          {job.activeBoost ? <BoostedBadge /> : null}
          <FairScoreBadge score={job.fairScore} />
          <Badge variant="outline">{JOB_TYPE_LABELS[job.jobType]}</Badge>
        </div>
        <CardTitle as="h3" className="text-lg">
          <Link className="underline-offset-4 hover:text-primary hover:underline" href={`/jobs/${job.slug}`}>
            {job.title}
          </Link>
        </CardTitle>
        <Link
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          href={`/companies/${job.company.slug}`}
        >
          {job.company.name}
          <BadgeCheckIcon className="size-4 text-primary" aria-label="Verifiziertes Unternehmen" />
        </Link>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <p className="line-clamp-3 leading-6 text-muted-foreground">{job.description}</p>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <MapPinIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <dt className="sr-only">Arbeitsort</dt>
            <dd>{job.city?.name ?? job.canton?.name ?? job.locationLabel ?? "Schweiz"} · {REMOTE_LABELS[job.remoteType]}</dd>
          </div>
          <div className="flex items-center gap-2">
            <BriefcaseBusinessIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <dt className="sr-only">Pensum</dt>
            <dd>{formatWorkload(job.workloadMin, job.workloadMax)}</dd>
          </div>
          {salary === null ? null : (
            <div className="flex items-center gap-2 sm:col-span-2">
              <BanknoteIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
              <dt className="sr-only">Lohn</dt>
              <dd>{salary}</dd>
            </div>
          )}
        </dl>
        <div className="mt-auto border-t pt-4 text-xs">
          <ResponseSignal response={job.response} compact />
          <p className="mt-2 text-muted-foreground">Publiziert am {formatDate(job.publishedAt)}</p>
        </div>
        <PublicJobActions jobSlug={job.slug} />
      </CardContent>
    </Card>
  );
}

export { JOB_TYPE_LABELS, REMOTE_LABELS, SALARY_PERIOD_LABELS };
