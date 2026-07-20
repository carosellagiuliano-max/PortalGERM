import type { Metadata } from "next";
import Link from "next/link";
import { BriefcaseBusinessIcon, UserRoundIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Registrieren",
  description: "Kandidaten- oder Arbeitgeberkonto bei SwissTalentHub erstellen.",
};

const accountTypes = [
  {
    href: "/register/candidate",
    title: "Ich suche eine Stelle",
    description:
      "Erstelle dein Kandidatenkonto und beginne anschliessend mit deinem privaten SwissJobPass.",
    action: "Als Kandidat:in registrieren",
    icon: UserRoundIcon,
  },
  {
    href: "/register/employer",
    title: "Ich stelle Talente ein",
    description:
      "Registriere dich als Arbeitgeber. Ein möglicher Firmenanspruch wird vor der Freigabe sicher geprüft.",
    action: "Als Arbeitgeber registrieren",
    icon: BriefcaseBusinessIcon,
  },
] as const;

export default function RegisterPage() {
  return (
    <section className="page-shell py-12 sm:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">Konto erstellen</p>
        <h1 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Wie möchtest du SwissTalentHub nutzen?
        </h1>
        <p className="mt-4 leading-7 text-muted-foreground">
          Wähle den passenden Einstieg. Deine Rolle schützt später die jeweils privaten
          Bereiche und Daten.
        </p>
      </div>
      <div className="mx-auto mt-9 grid max-w-4xl gap-5 md:grid-cols-2">
        {accountTypes.map(({ href, title, description, action, icon: Icon }) => (
          <Card key={href} className="h-full">
            <CardHeader>
              <span className="mb-3 grid size-11 place-items-center rounded-lg bg-secondary text-secondary-foreground">
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <CardTitle as="h2" className="text-xl">
                {title}
              </CardTitle>
              <CardDescription className="leading-6">{description}</CardDescription>
            </CardHeader>
            <CardContent className="mt-auto">
              <Link href={href} className={buttonVariants({ size: "lg", className: "h-11 w-full" })}>
                {action}
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="mt-8 text-center text-sm text-muted-foreground">
        Schon registriert?{" "}
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Zur Anmeldung
        </Link>
      </p>
    </section>
  );
}
