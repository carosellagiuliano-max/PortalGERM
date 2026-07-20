import Link from "next/link";
import {
  ArrowRightIcon,
  BriefcaseBusinessIcon,
  ShieldCheckIcon,
  UserRoundIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const entrances = [
  {
    title: "Für Kandidat:innen",
    description:
      "Erstelle ein sicheres Konto und starte mit deinem privaten SwissJobPass-Entwurf – ohne automatische Talent-Radar-Freigabe.",
    href: "/register/candidate",
    action: "Kandidatenkonto erstellen",
    icon: UserRoundIcon,
  },
  {
    title: "Für Arbeitgeber",
    description:
      "Registriere deinen persönlichen Zugang. Firmenansprüche werden kontrolliert geprüft und niemals allein per Domain vergeben.",
    href: "/register/employer",
    action: "Arbeitgeberkonto erstellen",
    icon: BriefcaseBusinessIcon,
  },
  {
    title: "Sicher getrennte Bereiche",
    description:
      "Serverseitige Sitzungen, Rollen und Firmenmitgliedschaften schützen Kandidaten-, Arbeitgeber- und Adminbereiche.",
    href: "/login",
    action: "Sicher anmelden",
    icon: ShieldCheckIcon,
  },
] as const;

export default function HomePage() {
  return (
    <>
      <section className="page-shell grid gap-10 py-16 sm:py-24 lg:grid-cols-[minmax(0,1.15fr)_minmax(19rem,0.85fr)] lg:items-center">
        <div className="max-w-3xl">
          <Badge variant="secondary" className="mb-5">
            Phase 06 · sichere Konten und Rollen
          </Badge>
          <p className="eyebrow mb-4">SwissTalentHub</p>
          <h1 className="text-balance text-4xl leading-[1.08] font-semibold tracking-[-0.035em] sm:text-5xl lg:text-6xl">
            Sicher starten – als Talent oder Arbeitgeber.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
            Registrierung, Anmeldung und geschützte Portale sind jetzt miteinander
            verbunden. Jede Rolle sieht nur ihren eigenen Bereich; Firmenzugriffe werden
            zusätzlich über aktive Mitgliedschaften abgesichert.
          </p>
          <div className="mt-8 flex flex-col gap-3 min-[420px]:flex-row">
            <Link href="/register" className={buttonVariants({ size: "lg", className: "h-11" })}>
              Konto erstellen <ArrowRightIcon data-icon="inline-end" />
            </Link>
            <Link
              href="/login"
              className={buttonVariants({ variant: "outline", size: "lg", className: "h-11" })}
            >
              Anmelden
            </Link>
          </div>
        </div>

        <Card id="status" className="border-primary/15 bg-card shadow-sm">
          <CardHeader>
            <div className="mb-2 flex items-center gap-2 text-primary">
              <ShieldCheckIcon className="size-5" aria-hidden="true" />
              <span className="text-sm font-semibold">Sicherheitsprinzip</span>
            </div>
            <CardTitle as="h2" className="text-xl">
              Zugriff wird serverseitig entschieden
            </CardTitle>
            <CardDescription className="leading-6">
              Die schnelle Weiterleitung vor einer Seite ersetzt nie die verbindliche
              Prüfung von Sitzung, Rolle und Firmenkontext im Servercode.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3 text-sm leading-6 text-muted-foreground">
              <li>Generische Antworten schützen vor Konto-Ausspähung.</li>
              <li>Passwörter und Sitzungstoken werden nie im Klartext gespeichert.</li>
              <li>Firmenabgleiche vergeben keinen automatischen Eigentümerzugriff.</li>
            </ul>
          </CardContent>
        </Card>
      </section>

      <section id="zugang" className="border-y bg-muted/35 py-16 sm:py-20">
        <div className="page-shell">
          <p className="eyebrow">Dein Einstieg</p>
          <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
            Ein Konto, ein klar geschützter Bereich.
          </h2>
          <div className="mt-9 grid gap-5 md:grid-cols-3">
            {entrances.map(({ title, description, href, action, icon: Icon }) => (
              <Card key={href} className="h-full">
                <CardHeader>
                  <span className="mb-3 grid size-10 place-items-center rounded-lg bg-accent text-accent-foreground">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <CardTitle as="h3">{title}</CardTitle>
                  <CardDescription className="leading-6">{description}</CardDescription>
                </CardHeader>
                <CardContent className="mt-auto">
                  <Link href={href} className={buttonVariants({ variant: "outline", className: "w-full" })}>
                    {action}
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
