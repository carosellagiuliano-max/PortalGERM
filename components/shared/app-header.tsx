import Link from "next/link";
import { LogInIcon } from "lucide-react";

import { BrandLink } from "@/components/layout/brand-link";
import { MobilePublicNav } from "@/components/layout/mobile-public-nav";
import { buttonVariants } from "@/components/ui/button";

const navigation = [
  { href: "/jobs", label: "Jobs" },
  { href: "/companies", label: "Unternehmen" },
  { href: "/salary-radar", label: "Lohn-Radar" },
  { href: "/guide", label: "Ratgeber" },
  { href: "/register/employer", label: "Für Arbeitgeber" },
] as const;

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="page-shell flex min-h-16 items-center justify-between gap-4 py-2">
        <BrandLink />

        <nav aria-label="Hauptnavigation" className="hidden items-center gap-0.5 lg:flex">
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={buttonVariants({
                variant: "ghost",
                className: "h-11 px-2.5",
              })}
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/login"
            className={buttonVariants({
              variant: "outline",
              className: "h-11 px-3",
            })}
          >
            <LogInIcon data-icon="inline-start" aria-hidden="true" />
            Login
          </Link>
          <Link
            href="/register/candidate"
            className={buttonVariants({ className: "h-11 px-3" })}
          >
            Kostenlos starten
          </Link>
        </nav>

        <MobilePublicNav navigation={navigation} />
      </div>
    </header>
  );
}
