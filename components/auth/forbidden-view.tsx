import Link from "next/link";
import { ShieldXIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";

export function ForbiddenView() {
  return (
    <section className="page-shell grid min-h-[60vh] place-items-center py-16 text-center">
      <meta name="robots" content="noindex, nofollow, noarchive" />
      <div className="max-w-lg">
        <span className="mx-auto grid size-12 place-items-center rounded-xl bg-destructive/10 text-destructive">
          <ShieldXIcon className="size-6" aria-hidden="true" />
        </span>
        <p className="eyebrow mt-5">403</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Zugriff nicht erlaubt
        </h1>
        <p className="mt-4 leading-7 text-muted-foreground">
          Dein Konto ist angemeldet, besitzt aber nicht die erforderliche Rolle für
          diesen Bereich. Es wurden keine geschützten Daten geladen.
        </p>
        <Link href="/" className={buttonVariants({ className: "mt-7" })}>
          Zur Startseite
        </Link>
      </div>
    </section>
  );
}
