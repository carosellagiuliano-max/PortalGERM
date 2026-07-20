import Link from "next/link";
import { ArrowLeftIcon, SearchIcon } from "lucide-react";

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
          Mit der öffentlichen Jobsuche findest du aktuelle Stellen nach Beruf, Region und
          Pensum.
        </p>
        <div className="mt-7 flex flex-col justify-center gap-3 min-[420px]:flex-row">
          <Link href="/" className={buttonVariants()}>
            <ArrowLeftIcon data-icon="inline-start" />
            Zur Startseite
          </Link>
          <Link
            href="/jobs"
            className={buttonVariants({ variant: "outline" })}
          >
            <SearchIcon data-icon="inline-start" />
            Jobs durchsuchen
          </Link>
        </div>
      </div>
    </section>
  );
}
