import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function MarketingFeatureCard({
  icon: Icon,
  title,
  description,
  href,
  action,
}: Readonly<{
  icon: LucideIcon;
  title: string;
  description: string;
} & (
  | { href: string; action: string }
  | { href?: never; action?: never }
)>) {
  return (
    <Card className="h-full">
      <CardHeader>
        <span className="mb-2 grid size-10 place-items-center rounded-lg bg-secondary text-secondary-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <CardTitle as="h3">{title}</CardTitle>
        <CardDescription className="leading-6">{description}</CardDescription>
      </CardHeader>
      {href !== undefined && action !== undefined ? (
        <CardContent className="mt-auto">
          <Link
            href={href}
            className={buttonVariants({ variant: "outline", className: "w-full" })}
          >
            {action}
          </Link>
        </CardContent>
      ) : null}
    </Card>
  );
}
