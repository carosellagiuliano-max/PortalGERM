"use client";

import Link from "next/link";
import { useState } from "react";
import { ActivityIcon, LogInIcon, MenuIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const navigation = [
  { href: "/register/candidate", label: "Für Kandidat:innen" },
  { href: "/register/employer", label: "Für Arbeitgeber" },
] as const;

export function AppHeader() {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);

  return (
    <header className="border-b bg-background/95 backdrop-blur">
      <div className="page-shell flex min-h-16 items-center justify-between gap-4 py-3">
        <Link
          href="/"
          className="inline-flex min-w-0 items-center gap-3 rounded-md font-semibold tracking-tight"
          aria-label="SwissTalentHub Startseite"
        >
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"
          >
            <ActivityIcon className="size-5" />
          </span>
          <span className="truncate">SwissTalentHub</span>
        </Link>

        <nav aria-label="Hauptnavigation" className="hidden items-center gap-1 md:flex">
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={buttonVariants({ variant: "ghost" })}
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/login"
            className={buttonVariants({ variant: "outline" })}
          >
            <LogInIcon data-icon="inline-start" />
            Anmelden
          </Link>
        </nav>

        <Sheet
          open={mobileNavigationOpen}
          onOpenChange={setMobileNavigationOpen}
        >
          <SheetTrigger
            render={
              <Button
                variant="outline"
                size="icon"
                className="md:hidden"
                aria-label="Navigation öffnen"
              />
            }
          >
            <MenuIcon />
          </SheetTrigger>
          <SheetContent side="right" className="w-[min(22rem,88vw)]">
            <SheetHeader>
              <SheetTitle>Navigation</SheetTitle>
              <SheetDescription>
                Registrieren, anmelden oder direkt den passenden sicheren Einstieg wählen.
              </SheetDescription>
            </SheetHeader>
            <nav aria-label="Mobile Navigation" className="grid gap-2 px-4">
              {navigation.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileNavigationOpen(false)}
                  className={buttonVariants({
                    variant: "ghost",
                    className: "justify-start",
                  })}
                >
                  {item.label}
                </Link>
              ))}
              <Link
                href="/login"
                onClick={() => setMobileNavigationOpen(false)}
                className={buttonVariants({
                  variant: "outline",
                  className: "justify-start",
                })}
              >
                <LogInIcon data-icon="inline-start" />
                Anmelden
              </Link>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
