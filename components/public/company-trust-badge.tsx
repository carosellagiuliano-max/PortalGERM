import { BadgeCheckIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { PublicCompanyTrustBadge } from "@/lib/public/types";

export function CompanyTrustBadge({
  trust,
  showDetails = false,
}: Readonly<{
  trust: PublicCompanyTrustBadge;
  showDetails?: boolean;
}>) {
  const validUntil = formatTrustDate(trust.validUntil);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Badge
        variant="secondary"
        title={`${trust.scopeLabel}; gültig bis ${validUntil}`}
      >
        <BadgeCheckIcon aria-hidden="true" />
        {trust.label}
      </Badge>
      {showDetails ? (
        <span className="text-xs text-muted-foreground">
          {trust.scopeLabel} · geprüft am {formatTrustDate(trust.verifiedAt)} ·
          gültig bis {validUntil}
        </span>
      ) : null}
    </span>
  );
}

function formatTrustDate(value: Date) {
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeZone: "Europe/Zurich",
  }).format(new Date(value));
}
