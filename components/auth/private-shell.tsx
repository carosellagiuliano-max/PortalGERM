import Link from "next/link";
import { LogOutIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { SessionRefresh } from "@/components/auth/session-refresh";
import { cn } from "@/lib/utils";

export type PrivateNavigationItem = Readonly<{ href: string; label: string }>;

export function PrivateShell({
  area,
  navigation,
  children,
}: Readonly<{
  area: string;
  navigation: readonly PrivateNavigationItem[];
  children: React.ReactNode;
}>) {
  return (
    <div className="page-shell py-6 sm:py-9">
      <SessionRefresh />
      <div className="mb-7 flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow">Geschützter Bereich</p>
          <p className="mt-1 text-lg font-semibold">{area}</p>
        </div>
        <form action="/logout" method="post">
          <Button type="submit" variant="outline" className="h-10 w-full sm:w-auto">
            <LogOutIcon data-icon="inline-start" />
            Sicher abmelden
          </Button>
        </form>
      </div>
      <nav
        aria-label={`${area} Navigation`}
        className="mb-8 flex gap-2 overflow-x-auto pb-2"
      >
        {navigation.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(buttonVariants({ variant: "ghost" }), "h-9")}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
