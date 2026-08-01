"use client";

import { usePathname } from "next/navigation";

import Link from "@/components/shared/app-link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/index";

export type PublicNavigationItem = Readonly<{ href: string; label: string }>;

/**
 * Marks the section the visitor is currently in. The state is never signalled
 * by colour alone: `aria-current` carries it for assistive technology, the
 * label switches to a heavier weight, and a solid indicator bar is drawn, so
 * the cue survives greyscale and colour-vision deficiency.
 */
function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PublicNavLink({
  item,
  orientation = "horizontal",
  onNavigate,
}: Readonly<{
  item: PublicNavigationItem;
  orientation?: "horizontal" | "vertical";
  onNavigate?: () => void;
}>) {
  const pathname = usePathname() ?? "";
  const active = isActivePath(pathname, item.href);

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
      className={cn(
        buttonVariants({ variant: "ghost" }),
        "relative h-11",
        orientation === "horizontal" ? "px-2.5" : "justify-start px-3",
        active
          ? "font-semibold text-foreground"
          : "font-medium text-muted-foreground hover:text-foreground",
        active &&
          (orientation === "horizontal"
            ? "after:absolute after:inset-x-2.5 after:bottom-1 after:h-0.5 after:rounded-full after:bg-primary after:content-['']"
            : "bg-secondary before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-full before:bg-primary before:content-['']"),
      )}
    >
      {item.label}
    </Link>
  );
}
