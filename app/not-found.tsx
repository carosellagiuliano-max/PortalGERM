import Link from "next/link";
import { ArrowLeftIcon, LogInIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <section className="page-shell grid min-h-[60vh] place-items-center py-16 text-center">
      <div className="max-w-lg">
        <p className="eyebrow">404</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Diese Seite ist nicht verfügbar.
        </h1>
        <p className="mt-4 leading-7 text-muted-foreground">
          Der Pfad existiert nicht, wurde verschoben oder ist für diesen Einstieg nicht
          vorgesehen. Über die Startseite findest du den passenden Bereich.
        </p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Die öffentliche Jobsuche folgt als nächster Produktschritt; bis dahin führen wir
          dich nicht auf einen leeren oder toten Suchpfad.
        </p>
        <div className="mt-7 flex flex-col justify-center gap-3 min-[420px]:flex-row">
          <Link href="/" className={buttonVariants()}>
            <ArrowLeftIcon data-icon="inline-start" />
            Zur Startseite
          </Link>
          <Link
            href="/login"
            className={buttonVariants({ variant: "outline" })}
          >
            <LogInIcon data-icon="inline-start" />
            Zur Anmeldung
          </Link>
        </div>
      </div>
    </section>
  );
}
