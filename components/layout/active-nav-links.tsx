"use client";

import { usePathname } from "next/navigation";

import Link from "@/components/shared/app-link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/index";

export type ActiveNavigationItem = Readonly<{ href: string; label: string }>;

function matches(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Resolves the single entry the visitor is currently in.
 *
 * Portal sections nest: `/admin` is both the dashboard and a prefix of
 * `/admin/jobs`. Marking every prefix match would highlight two entries at
 * once, so the longest matching href wins and exactly one link is ever
 * current.
 */
export function resolveActiveHref(
  pathname: string,
  items: readonly ActiveNavigationItem[],
): string | undefined {
  let active: string | undefined;
  for (const { href } of items) {
    if (!matches(pathname, href)) continue;
    if (active === undefined || href.length > active.length) active = href;
  }
  return active;
}

/**
 * Renders a navigation list and marks the current section. The state is never
 * signalled by colour alone: `aria-current` carries it for assistive
 * technology, the label switches to a heavier weight, and a solid indicator
 * bar is drawn, so the cue survives greyscale and colour-vision deficiency.
 */
export function ActiveNavLinks({
  items,
  orientation = "horizontal",
  itemClassName,
  onNavigate,
}: Readonly<{
  items: readonly ActiveNavigationItem[];
  orientation?: "horizontal" | "vertical";
  itemClassName?: string;
  onNavigate?: () => void;
}>) {
  const pathname = usePathname() ?? "";
  const activeHref = resolveActiveHref(pathname, items);

  return items.map((item) => {
    const active = item.href === activeHref;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
        className={cn(
          buttonVariants({ variant: "ghost" }),
          "relative",
          itemClassName,
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
  });
}
