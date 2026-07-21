import Link from "next/link";
import { LockKeyholeIcon, RadarIcon, ShieldCheckIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function TalentRadarLockedPreview({
  entitled,
  allowance,
}: Readonly<{ entitled: boolean; allowance: number }>) {
  return (
    <section aria-labelledby="talent-radar-title" className="grid gap-7">
      <header>
        <p className="eyebrow">Vorschau</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 id="talent-radar-title" className="text-3xl font-semibold tracking-tight">Talent Radar</h1>
          <Badge variant="outline"><LockKeyholeIcon aria-hidden="true" /> Phase 14</Badge>
        </div>
        <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
          Diese Ansicht ist bewusst nur illustrativ. Es werden hier weder Kandidat:innen noch Radar-Profile abgefragt.
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle as="h2" className="flex items-center gap-2"><RadarIcon className="size-5 text-primary" aria-hidden="true" /> Geplanter Ablauf</CardTitle></CardHeader>
          <CardContent className="grid gap-3 text-muted-foreground">
            <p>1. Datenschutzfreundliche Filter ohne direkte Identität.</p>
            <p>2. Kontaktanfrage mit transparenter Credit-Finanzierung.</p>
            <p>3. Identität erst nach dokumentierter Zustimmung.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle as="h2" className="flex items-center gap-2"><ShieldCheckIcon className="size-5 text-primary" aria-hidden="true" /> Dein Planstatus</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-muted-foreground">
              {entitled
                ? `Talent Radar ist im Plan enthalten (${allowance} Kontakte pro aktuellem Planzeitraum). Die private Suche wird mit Phase 14 verfügbar.`
                : "Talent Radar ist im aktuellen Plan nicht enthalten."}
            </p>
            <Link href="/pricing" className={buttonVariants({ variant: entitled ? "outline" : "default", className: "w-fit" })}>
              {entitled ? "Leistungsumfang ansehen" : "Pläne vergleichen"}
            </Link>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
