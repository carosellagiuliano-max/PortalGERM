import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, ShieldCheckIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Kandidatenübersicht" };

export default function CandidateDashboardPage() {
  return (
    <section aria-labelledby="candidate-dashboard-title">
      <p className="eyebrow">Übersicht</p>
      <h1 id="candidate-dashboard-title" className="mt-2 text-3xl font-semibold tracking-tight">
        Willkommen in deinem Kandidatenportal
      </h1>
      <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
        Dein Konto ist geschützt. Als Nächstes kannst du deinen SwissJobPass schrittweise
        vorbereiten; weitere Bewerbungsfunktionen folgen in den nächsten Produktphasen.
      </p>
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle as="h2">SwissJobPass starten</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="leading-6 text-muted-foreground">
              Baue dein Profil kontrolliert auf. Eine Talent-Radar-Freigabe geschieht nie
              automatisch bei der Registrierung.
            </p>
            <Link href="/candidate/jobpass" className={buttonVariants({ className: "w-fit" })}>
              Zum SwissJobPass <ArrowRightIcon data-icon="inline-end" />
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2">
              <ShieldCheckIcon className="size-5 text-primary" aria-hidden="true" />
              Deine Privatsphäre
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="leading-6 text-muted-foreground">
              Kontodaten, spätere Bewerbungen und Sichtbarkeit werden getrennt verwaltet.
              Du behältst die Kontrolle über jede Freigabe.
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
