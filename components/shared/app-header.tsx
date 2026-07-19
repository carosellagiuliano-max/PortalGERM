"use client";

import Link from "next/link";
import { ActivityIcon, MenuIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const navigation = [
  { href: "/#foundation", label: "Grundlage" },
  { href: "/#status", label: "Projektstatus" },
  { href: "/health/live", label: "Live-Status" },
] as const;

export function AppHeader() {
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
            <Button key={item.href} variant="ghost" render={<Link href={item.href} />}>
              {item.label}
            </Button>
          ))}
        </nav>

        <Sheet>
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
                Aktuell sind nur die Foundation und technischen Statuspfade aktiv.
              </SheetDescription>
            </SheetHeader>
            <nav aria-label="Mobile Navigation" className="grid gap-2 px-4">
              {navigation.map((item) => (
                <SheetClose
                  key={item.href}
                  render={
                    <Link
                      href={item.href}
                      className={buttonVariants({
                        variant: "ghost",
                        className: "justify-start",
                      })}
                    />
                  }
                >
                  {item.label}
                </SheetClose>
              ))}
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
