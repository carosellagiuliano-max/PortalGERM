import { CircleHelpIcon, ShieldCheckIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { PublicJobDetailModel } from "@/lib/public/types";

export function FairScoreBadge({ score }: Readonly<{ score: number | null }>) {
  if (score === null) return null;
  return (
    <Badge variant="secondary" title="Transparenz- und Qualitätsmerkmale des Inserats">
      <ShieldCheckIcon aria-hidden="true" /> Fair-Job-Score {score}/100
    </Badge>
  );
}

export function FairScoreBreakdown({
  score,
  version,
  factors,
}: Readonly<{
  score: number | null;
  version: string | null;
  factors: PublicJobDetailModel["fairBreakdown"];
}>) {
  if (score === null || factors.length === 0) return null;

  return (
    <section aria-labelledby="fair-score-title" className="rounded-xl border bg-secondary/35 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Fair-Job-Score</p>
          <h2 id="fair-score-title" className="mt-2 text-xl font-semibold">
            {score} von 100 Punkten
          </h2>
        </div>
        <span
          className="grid size-12 shrink-0 place-items-center rounded-full bg-primary font-semibold text-primary-foreground"
          aria-hidden="true"
        >
          {score}
        </span>
      </div>
      <p className="mt-3 flex gap-2 text-sm leading-6 text-muted-foreground">
        <CircleHelpIcon className="mt-1 size-4 shrink-0" aria-hidden="true" />
        Der Score bewertet die Transparenz des Inserats, nicht das Unternehmen oder die
        Eignung einzelner Personen.
      </p>
      {version === null ? null : (
        <p className="mt-2 text-xs text-muted-foreground">Berechnungsversion: {version}</p>
      )}
      <dl className="mt-5 grid gap-3 sm:grid-cols-2">
        {factors.map((factor) => (
          <div key={factor.key} className="rounded-lg bg-background/75 p-3">
            <dt className="text-sm text-muted-foreground">{factor.label}</dt>
            <dd className="mt-1 font-semibold tabular-nums">
              {factor.points}/{factor.maxPoints}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
