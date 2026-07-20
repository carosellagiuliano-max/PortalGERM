import Link from "next/link";
import { SparklesIcon } from "lucide-react";

import { getCurrentCandidateMatchForJob } from "@/lib/jobs/public-match";
import type { PublicJobDetailModel } from "@/lib/public/types";

const FACTOR_LABELS: Readonly<Record<string, string>> = {
  SKILLS: "Fähigkeiten",
  LANGUAGES: "Sprachen",
  REGION: "Region",
  WORKLOAD: "Pensum",
  SALARY: "Lohn",
  JOB_TYPE: "Anstellungsart",
  REMOTE: "Arbeitsmodell",
  AVAILABILITY: "Verfügbarkeit",
};

export async function CandidateMatch({ job }: Readonly<{ job: PublicJobDetailModel }>) {
  const match = await getCurrentCandidateMatchForJob(job);
  if (match === null) {
    return (
      <section className="rounded-xl border bg-card p-5" aria-labelledby="match-title">
        <div className="flex gap-3"><SparklesIcon className="mt-0.5 size-5 text-primary" aria-hidden="true" /><div><h2 id="match-title" className="font-semibold">Optionaler Profilabgleich</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Angemeldete Kandidat:innen können diese Stelle mit ihrem privaten Profil vergleichen. Profildaten werden nicht öffentlich angezeigt.</p><Link href={`/login?next=/jobs/${job.slug}`} className="mt-3 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">Sicher anmelden</Link></div></div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border bg-card p-5" aria-labelledby="match-title">
      <p className="eyebrow">Privater Profilabgleich</p>
      <h2 id="match-title" className="mt-2 text-xl font-semibold">{match.score === null ? "Noch nicht genügend Angaben" : `${match.score}% Übereinstimmung`}</h2>
      <p className="mt-2 text-sm text-muted-foreground">Aussagekraft {match.confidence}% · nur für dich sichtbar</p>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
        {Object.entries(match.factorScores).map(([factor, score]) => (
          <div key={factor} className="rounded-lg bg-muted/45 p-2.5"><dt className="text-muted-foreground">{FACTOR_LABELS[factor] ?? factor}</dt><dd className="mt-1 font-medium">{score === null ? "Keine Angabe" : `${Math.round(score * 100)}%`}</dd></div>
        ))}
      </dl>
    </section>
  );
}
