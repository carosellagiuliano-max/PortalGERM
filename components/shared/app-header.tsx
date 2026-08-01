import Link from "@/components/shared/app-link";
import { LogInIcon } from "lucide-react";

import { BrandLink } from "@/components/layout/brand-link";
import { MobilePublicNav } from "@/components/layout/mobile-public-nav";
import { ActiveNavLinks } from "@/components/layout/active-nav-links";
import { buttonVariants } from "@/components/ui/button";
import { getPublicDataContext } from "@/lib/public/environment";

const navigation = [
  { href: "/jobs", label: "Jobs" },
  { href: "/companies", label: "Unternehmen" },
  { href: "/salary-radar", label: "Lohn-Radar" },
  { href: "/guide", label: "Ratgeber" },
  { href: "/pricing", label: "Preise" },
  { href: "/employers", label: "Für Arbeitgeber" },
] as const;

export function AppHeader() {
  const visibleNavigation = getPublicDataContext().liveOnly
    ? navigation.filter(({ href }) => href !== "/salary-radar")
    : navigation;

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="page-shell flex min-h-16 items-center justify-between gap-4 py-2">
        <BrandLink />

        <nav aria-label="Hauptnavigation" className="hidden items-center gap-0.5 xl:flex">
          <ActiveNavLinks
            items={visibleNavigation}
            itemClassName="h-11 px-2.5"
          />
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

        <MobilePublicNav navigation={visibleNavigation} />
      </div>
    </header>
  );
}
