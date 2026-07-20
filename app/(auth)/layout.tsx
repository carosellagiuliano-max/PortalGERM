import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { BrandLink } from "@/components/layout/brand-link";
import { SkipLink } from "@/components/layout/skip-link";
import { buttonVariants } from "@/components/ui/button";

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <SkipLink />
      <div className="flex min-h-screen flex-col bg-muted/25">
        <header className="border-b bg-background/95">
          <div className="page-shell flex min-h-16 items-center justify-between gap-3 py-2">
            <BrandLink />
            <Link
              href="/"
              aria-label="Zur Startseite"
              className={buttonVariants({
                variant: "ghost",
                className: "h-11 px-3",
              })}
            >
              <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
              <span className="hidden min-[400px]:inline">Zur Startseite</span>
            </Link>
          </div>
        </header>
        <main id="main-content" className="flex-1" tabIndex={-1}>
          {children}
        </main>
      </div>
    </>
  );
}
