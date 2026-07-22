import Link from "next/link";
import { LockKeyholeIcon, RadarIcon, ShieldCheckIcon } from "lucide-react";

import { UpgradeDialog } from "@/components/billing/upgrade-dialog";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { UpgradePrompt } from "@/lib/billing/upgrade-prompt";

type LockedReason =
  | "ROLE"
  | "COMPANY_INACTIVE"
  | "COMPANY_UNVERIFIED"
  | "TALENT_RADAR_NOT_INCLUDED";

const reasonCopy: Readonly<Record<LockedReason, string>> = Object.freeze({
  ROLE:
    "Talent Radar steht aktiven Inhaber:innen, Admins und Recruiter:innen zur Verfügung.",
  COMPANY_INACTIVE:
    "Talent Radar kann erst mit einem aktiven Unternehmen verwendet werden.",
  COMPANY_UNVERIFIED:
    "Talent Radar bleibt gesperrt, bis die aktuelle Firmenverifizierung abgeschlossen ist.",
  TALENT_RADAR_NOT_INCLUDED:
    "Talent Radar ist in den aktuell wirksamen Planrechten nicht enthalten.",
});

export function LockedPreview({
  reason,
  upgradePrompt,
}: Readonly<{
  reason: LockedReason;
  upgradePrompt?: UpgradePrompt;
}>) {
  return (
    <section aria-labelledby="talent-radar-title" className="grid gap-7">
      <header>
        <p className="eyebrow">Datenschutzfreundliche Talentsuche</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1
            id="talent-radar-title"
            className="text-3xl font-semibold tracking-tight"
          >
            Talent Radar
          </h1>
          <Badge variant="outline">
            <LockKeyholeIcon aria-hidden="true" /> Gesperrt
          </Badge>
        </div>
        <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
          Identitäten der Kandidat:innen bleiben anonym, bis sie freigegeben
          werden.
        </p>
      </header>

      <div className="relative overflow-hidden rounded-2xl border bg-muted/30 p-4 sm:p-6">
        <div
          aria-hidden="true"
          className="grid select-none gap-4 opacity-35 blur-[3px] md:grid-cols-2"
        >
          {["Softwareentwicklung · ZH", "Pflege · BE"].map((label) => (
            <Card key={label}>
              <CardHeader>
                <CardTitle>{label}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                <div className="h-3 w-3/4 rounded bg-muted-foreground/30" />
                <div className="h-3 w-1/2 rounded bg-muted-foreground/30" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="relative mt-[-2rem] shadow-lg sm:mx-auto sm:max-w-xl">
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2">
              <ShieldCheckIcon className="size-5 text-primary" aria-hidden="true" />
              Zugriff geschützt
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-muted-foreground">{reasonCopy[reason]}</p>
            {upgradePrompt === undefined ? (
              <Link href="/employer/company" className={buttonVariants({ className: "w-fit" })}>
                Firmenstatus prüfen
              </Link>
            ) : (
              <UpgradeDialog
                prompt={upgradePrompt}
                triggerLabel="Talent Radar freischalten"
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-2">
            <RadarIcon className="size-5 text-primary" aria-hidden="true" />
            So funktioniert Talent Radar
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-muted-foreground sm:grid-cols-3">
          <p>1. Suche ausschließlich mit groben, geschlossenen Filtern.</p>
          <p>2. Sende eine kreditfinanzierte Kontaktanfrage.</p>
          <p>3. Identität erscheint nur nach separater Freigabe.</p>
        </CardContent>
      </Card>
    </section>
  );
}
