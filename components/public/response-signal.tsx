import { Clock3Icon } from "lucide-react";

import type { PublicResponseEvidence } from "@/lib/public/types";

export function ResponseSignal({
  response,
  compact = false,
}: Readonly<{
  response: PublicResponseEvidence;
  compact?: boolean;
}>) {
  if (!response.known) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Clock3Icon className="size-3.5" aria-hidden="true" />
        Antwortverhalten noch nicht belastbar
      </span>
    );
  }

  const percentage = Math.round((response.onTimeRateBps ?? 0) / 100);
  return (
    <span className="inline-flex items-center gap-1.5 text-emerald-800">
      <Clock3Icon className="size-3.5" aria-hidden="true" />
      {percentage}% antworten innert {response.targetDays} Tagen
      {!compact && response.sampleSizeBucket !== null
        ? ` · Basis ${response.sampleSizeBucket}`
        : ""}
    </span>
  );
}
