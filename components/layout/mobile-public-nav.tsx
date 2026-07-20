"use client";

import Link from "next/link";
import { useState } from "react";
import { LogInIcon, MenuIcon, XIcon } from "lucide-react";

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

type PublicNavigationItem = Readonly<{ href: string; label: string }>;

export function MobilePublicNav({
  navigation,
}: Readonly<{ navigation: readonly PublicNavigationItem[] }>) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="outline"
            size="icon"
            className="size-11 lg:hidden"
            aria-label="Navigation öffnen"
          />
        }
      >
        <MenuIcon aria-hidden="true" />
      </SheetTrigger>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-[min(24rem,92vw)] overflow-y-auto"
      >
        <SheetClose
          render={
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 size-11"
              aria-label="Navigation schliessen"
            />
          }
        >
          <XIcon aria-hidden="true" />
        </SheetClose>
        <SheetHeader className="pr-14">
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription>
            Jobs, Unternehmen und Orientierung entdecken oder ein sicheres Konto
            öffnen.
          </SheetDescription>
        </SheetHeader>
        <nav aria-label="Mobile Navigation" className="grid gap-1 px-4 pb-5">
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={buttonVariants({
                variant: "ghost",
                className: "h-11 justify-start px-3",
              })}
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/login"
            onClick={() => setOpen(false)}
            className={buttonVariants({
              variant: "outline",
              className: "mt-2 h-11 justify-start px-3",
            })}
          >
            <LogInIcon data-icon="inline-start" aria-hidden="true" />
            Login
          </Link>
          <Link
            href="/register/candidate"
            onClick={() => setOpen(false)}
            className={buttonVariants({ className: "mt-1 h-11 justify-start px-3" })}
          >
            Kostenlos starten
          </Link>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
