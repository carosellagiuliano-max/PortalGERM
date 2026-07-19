import {
  BlocksIcon,
  CheckCircle2Icon,
  DatabaseIcon,
  ShieldCheckIcon,
  WrenchIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const foundations = [
  {
    title: "Reproduzierbare Toolchain",
    description:
      "Node, npm und alle Pakete sind exakt gepinnt. Windows und CI verwenden dieselben portablen Scripts.",
    icon: WrenchIcon,
  },
  {
    title: "PostgreSQL und Prisma",
    description:
      "Die Migrations- und Client-Pipeline ist vorbereitet. Fachmodelle beginnen bewusst erst in Phase 02.",
    icon: DatabaseIcon,
  },
  {
    title: "Sichere Konfiguration",
    description:
      "Env- und Keyring-Verträge validieren Länge, Rotation, Wiederverwendung und produktionsnahe Schutzregeln.",
    icon: ShieldCheckIcon,
  },
] as const;

export default function FoundationPage() {
  return (
    <>
      <section className="page-shell grid gap-10 py-16 sm:py-24 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)] lg:items-center">
        <div className="max-w-3xl">
          <Badge variant="secondary" className="mb-5">
            Phase 01 · technische Foundation
          </Badge>
          <p className="eyebrow mb-4">SwissTalentHub</p>
          <h1 className="text-balance text-4xl leading-[1.08] font-semibold tracking-[-0.035em] sm:text-5xl lg:text-6xl">
            Eine belastbare Grundlage, bevor Produktfunktionen entstehen.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
            Dieses Repository befindet sich bewusst in der Foundation-Phase. Jobsuche,
            Anmeldung, Portale und Billing sind noch nicht verfügbar und werden hier
            nicht vorgetäuscht.
          </p>
        </div>

        <Card id="status" className="border-primary/15 bg-card shadow-sm">
          <CardHeader>
            <div className="mb-2 flex items-center gap-2 text-primary">
              <CheckCircle2Icon className="size-5" />
              <span className="text-sm font-semibold">Aktueller Umfang</span>
            </div>
            <CardTitle as="h2">Technischer Foundation-Umfang</CardTitle>
            <CardDescription>
              Technische Nachweise werden mit reproduzierbaren Befehlen geprüft und im
              Repository dokumentiert.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3 text-sm text-muted-foreground">
              <li className="flex gap-3">
                <BlocksIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                App-Shell, UI-Primitives und klare Fehlerzustände
              </li>
              <li className="flex gap-3">
                <DatabaseIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                PostgreSQL-, Prisma- und Test-Harness
              </li>
              <li className="flex gap-3">
                <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                Env-Gates, Sicherheitsheader und redigierte Logs
              </li>
            </ul>
          </CardContent>
        </Card>
      </section>

      <section id="foundation" className="border-y bg-muted/35 py-16 sm:py-20">
        <div className="page-shell">
          <p className="eyebrow">Was Phase 01 liefert</p>
          <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
            Weniger Show, mehr überprüfbare Basis.
          </h2>
          <div className="mt-9 grid gap-5 md:grid-cols-3">
            {foundations.map(({ title, description, icon: Icon }) => (
              <Card key={title} className="h-full">
                <CardHeader>
                  <span className="mb-3 grid size-10 place-items-center rounded-lg bg-accent text-accent-foreground">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <CardTitle as="h3">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="leading-6 text-muted-foreground">{description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
