import Link from "next/link";
import { ActivityIcon } from "lucide-react";

import { cn } from "@/lib/utils";

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
        className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"
      >
        <ActivityIcon className="size-5" />
      </span>
      <span className="truncate">SwissTalentHub</span>
    </Link>
  );
}
