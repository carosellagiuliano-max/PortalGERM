import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <section className="page-shell grid min-h-[60vh] place-items-center py-16 text-center">
      <div className="max-w-lg">
        <p className="eyebrow">404</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Diese Seite ist nicht verfügbar.
        </h1>
        <p className="mt-4 leading-7 text-muted-foreground">
          Der Pfad existiert nicht oder gehört zu einer späteren Produktphase.
        </p>
        <Button className="mt-7" render={<Link href="/" />}>
          <ArrowLeftIcon data-icon="inline-start" />
          Zur Foundation
        </Button>
      </div>
    </section>
  );
}
