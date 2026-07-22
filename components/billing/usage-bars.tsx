import Link from "next/link";

import { CreditSourceOverview } from "@/components/billing/credit-source-overview";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Progress,
  ProgressLabel,
} from "@/components/ui/progress";
import type { EmployerBillingUsage } from "@/lib/billing/employer-read-model";

export function UsageBars({
  usage,
  canManagePlan,
  canStartPlanChange,
}: Readonly<{
  usage: EmployerBillingUsage;
  canManagePlan: boolean;
  canStartPlanChange: boolean;
}>) {
  const pendingPlanChange = canManagePlan && !canStartPlanChange;
  const upgradeHref = pendingPlanChange
    ? "/employer/billing"
    : canManagePlan && usage.activeJobs.limit <= 3
      ? "/employer/billing/checkout?plan=pro"
      : "/pricing";
  const upgradeLabel = pendingPlanChange
    ? "Vorgemerkte Planänderung ansehen"
    : canManagePlan
      ? "Plan upgraden"
      : "Planoptionen ansehen";
  const warning = [
    usage.activeJobs.limit > 0 ? usage.activeJobs.used / usage.activeJobs.limit : 0,
    usage.seats.limit > 0 ? usage.seats.used / usage.seats.limit : 0,
    usage.includedContacts.granted > 0
      ? usage.includedContacts.used / usage.includedContacts.granted
      : 0,
    usage.includedBoosts.granted > 0
      ? usage.includedBoosts.used / usage.includedBoosts.granted
      : 0,
  ].some((ratio) => ratio >= 0.8);
  return (
    <div className="grid gap-5">
      {warning ? (
        <Alert>
          <AlertTitle>Mindestens eine Planlimite ist zu 80 % erreicht.</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>Ein Upgrade schafft zusätzlichen Spielraum für dein Recruiting-Team.</span>
            <Link href={upgradeHref} className={buttonVariants({ size: "sm" })}>
              {upgradeLabel}
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <UsageCard label="Aktive Jobs" used={usage.activeJobs.used} limit={usage.activeJobs.limit} />
        <UsageCard
          label="Team-Sitzplätze"
          used={usage.seats.used}
          limit={usage.seats.limit}
          note={usage.seats.pendingInvitations > 0
            ? `Davon ${usage.seats.pendingInvitations} durch offene Einladung reserviert.`
            : undefined}
        />
      </div>
      <CreditSourceOverview usage={usage} />
    </div>
  );
}

function UsageCard({
  label,
  used,
  limit,
  remaining,
  note,
}: Readonly<{
  label: string;
  used: number;
  limit: number;
  remaining?: number;
  note?: string;
}>) {
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <Card>
      <CardHeader><CardTitle as="h2">{label}</CardTitle></CardHeader>
      <CardContent className="grid gap-2">
        <Progress value={percent} aria-label={`${label}: ${used} von ${limit}`}>
          <ProgressLabel>Verwendet</ProgressLabel>
          <span className="ml-auto text-sm text-muted-foreground tabular-nums">
            {used} / {limit}
          </span>
        </Progress>
        {remaining === undefined ? null : <p className="text-xs text-muted-foreground">Noch {remaining} inkludiert verfügbar.</p>}
        {note === undefined ? null : <p className="text-xs text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  );
}
