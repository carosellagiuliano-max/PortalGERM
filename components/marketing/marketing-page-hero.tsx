import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";

type MarketingAction = Readonly<{
  href: string;
  label: string;
}>;

export function MarketingPageHero({
  eyebrow,
  title,
  description,
  primaryAction,
  secondaryAction,
}: Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  primaryAction: MarketingAction;
  secondaryAction?: MarketingAction;
}>) {
  return (
    <section className="page-shell py-14 sm:py-20">
      <div className="max-w-4xl">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-4 text-balance text-4xl leading-tight font-semibold tracking-[-0.035em] sm:text-5xl">
          {title}
        </h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-muted-foreground">
          {description}
        </p>
        <div className="mt-8 flex flex-col gap-3 min-[420px]:flex-row min-[420px]:flex-wrap">
          <Link
            href={primaryAction.href}
            className={buttonVariants({ size: "lg", className: "h-11" })}
          >
            {primaryAction.label}
            <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
          </Link>
          {secondaryAction === undefined ? null : (
            <Link
              href={secondaryAction.href}
              className={buttonVariants({
                size: "lg",
                variant: "outline",
                className: "h-11",
              })}
            >
              {secondaryAction.label}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
