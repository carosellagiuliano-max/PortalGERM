"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const BOOSTED_DISCLOSURE =
  "Dieser Job wird vom Arbeitgeber für mehr Sichtbarkeit hervorgehoben.";

export function BoostedBadge() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            aria-label={`Geboostet. ${BOOSTED_DISCLOSURE}`}
            className="cursor-help"
            tabIndex={0}
          />
        }
      >
        Geboostet
      </TooltipTrigger>
      <TooltipContent>{BOOSTED_DISCLOSURE}</TooltipContent>
    </Tooltip>
  );
}
