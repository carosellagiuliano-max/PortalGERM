import Link from "next/link";

import { cn } from "@/lib/utils";

function BrandGlyph({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3.5 17.5 9 10l3 3.6 4.5-6.9 4 10.8" />
      <circle cx={16.5} cy={3.6} r={1.2} fill="currentColor" stroke="none" />
    </svg>
  );
}

export function BrandLink({ className }: Readonly<{ className?: string }>) {
  return (
    <Link
      href="/"
      className={cn(
        "inline-flex min-h-11 min-w-0 items-center gap-3 rounded-md font-semibold tracking-tight",
        className,
      )}
      aria-label="SwissTalentHub Startseite"
    >
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm ring-1 ring-inset ring-white/15"
      >
        <BrandGlyph className="size-5" />
      </span>
      <span className="truncate">SwissTalentHub</span>
    </Link>
  );
}
