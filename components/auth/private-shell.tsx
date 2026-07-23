import Link from "next/link";
import { LogOutIcon } from "lucide-react";

import { SessionRefresh } from "@/components/auth/session-refresh";
import { SkipLink } from "@/components/layout/skip-link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PrivateNavigationItem = Readonly<{ href: string; label: string }>;

export function PrivateShell({
  area,
  navigation,
  navigationVariant = "top",
  identity,
  contextControl,
  children,
}: Readonly<{
  area: string;
  navigation: readonly PrivateNavigationItem[];
  navigationVariant?: "top" | "sidebar";
  identity?: Readonly<{ displayName: string; secondaryLabel?: string }>;
  contextControl?: React.ReactNode;
  children: React.ReactNode;
}>) {
  const initials = identity?.displayName
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "ST";

  return (
    <>
      <SkipLink />
      <main id="main-content" tabIndex={-1} className="page-shell py-6 sm:py-9">
        <SessionRefresh />
        <div className="mb-7 flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="eyebrow">Geschützter Bereich</p>
            <p className="mt-1 text-lg font-semibold">{area}</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {contextControl}
            {identity === undefined ? null : (
              <div className="flex min-w-0 items-center gap-3 rounded-lg border bg-card px-3 py-2">
                <Avatar size="lg">
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{identity.displayName}</p>
                  {identity.secondaryLabel === undefined ? null : (
                    <p className="truncate text-xs text-muted-foreground">
                      {identity.secondaryLabel}
                    </p>
                  )}
                </div>
              </div>
            )}
            {navigationVariant === "top" ? <LogoutButton /> : null}
          </div>
        </div>
        {navigationVariant === "sidebar" ? (
          <div className="grid min-w-0 gap-7 lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start">
            <nav
              aria-label={`${area} Navigation`}
              data-e2e-horizontal-scroll="true"
              className="flex gap-2 overflow-x-auto pb-2 lg:sticky lg:top-6 lg:grid lg:overflow-visible lg:rounded-xl lg:border lg:bg-card lg:p-3"
            >
              <NavigationLinks navigation={navigation} vertical />
              <div className="hidden border-t pt-3 lg:block">
                <LogoutButton className="w-full" />
              </div>
              <div className="lg:hidden">
                <LogoutButton className="h-9 whitespace-nowrap" />
              </div>
            </nav>
            <div className="min-w-0">{children}</div>
          </div>
        ) : (
          <>
            <nav
              aria-label={`${area} Navigation`}
              data-e2e-horizontal-scroll="true"
              className="mb-8 flex gap-2 overflow-x-auto pb-2"
            >
              <NavigationLinks navigation={navigation} />
            </nav>
            {children}
          </>
        )}
      </main>
    </>
  );
}

function NavigationLinks({
  navigation,
  vertical = false,
}: Readonly<{
  navigation: readonly PrivateNavigationItem[];
  vertical?: boolean;
}>) {
  return navigation.map((item) => (
    <Link
      key={item.href}
      href={item.href}
      className={cn(
        buttonVariants({ variant: "ghost" }),
        "h-9 whitespace-nowrap",
        vertical && "lg:w-full lg:justify-start",
      )}
    >
      {item.label}
    </Link>
  ));
}

function LogoutButton({ className }: Readonly<{ className?: string }>) {
  return (
    <form action="/logout" method="post">
      <Button
        type="submit"
        variant="outline"
        className={cn("h-10 w-full sm:w-auto", className)}
      >
        <LogOutIcon data-icon="inline-start" />
        Sicher abmelden
      </Button>
    </form>
  );
}
