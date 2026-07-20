import { CheckCircle2Icon, CircleDashedIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import type {
  CandidateOnboardingEvaluation,
  CandidateProfileProgress,
} from "@/lib/candidate/profile";

export function ProfileCompletion({
  progress,
  requirements,
  onboardingStatus,
}: Readonly<{
  progress: CandidateProfileProgress;
  requirements: CandidateOnboardingEvaluation;
  onboardingStatus: "DRAFT" | "COMPLETE";
}>) {
  const complete = onboardingStatus === "COMPLETE";
  return (
    <div className="grid gap-3 rounded-xl border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {complete ? (
            <CheckCircle2Icon
              className="size-5 text-emerald-600"
              aria-hidden="true"
            />
          ) : (
            <CircleDashedIcon
              className="size-5 text-primary"
              aria-hidden="true"
            />
          )}
          <p className="font-semibold">
            {complete
              ? "SwissJobPass abgeschlossen"
              : "SwissJobPass in Bearbeitung"}
          </p>
        </div>
        <Badge variant={requirements.complete ? "secondary" : "outline"}>
          {requirements.complete
            ? "Abschluss möglich"
            : `${requirements.missing.length} Pflichtbereiche offen`}
        </Badge>
      </div>
      <Progress
        value={progress.percentage}
        aria-label="Profilfortschritt"
        aria-valuetext={`${progress.percentage}%`}
      >
        <ProgressLabel>Profilfortschritt</ProgressLabel>
        <span className="text-sm font-medium tabular-nums" aria-hidden="true">
          {progress.percentage}%
        </span>
      </Progress>
      <p className="text-xs leading-5 text-muted-foreground">
        {progress.completed} von {progress.total} Profilbereichen ausgefüllt.
        Der Prozentwert dient nur zur Orientierung; der Abschluss folgt der
        festen Pflichtfeldregel.
      </p>
    </div>
  );
}
