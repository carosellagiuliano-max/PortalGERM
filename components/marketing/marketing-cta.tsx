import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";

export function MarketingCta({
  eyebrow,
  title,
  description,
  href,
  action,
}: Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  action: string;
}>) {
  return (
    <section className="page-shell py-14 sm:py-20">
      <div className="rounded-2xl bg-primary px-6 py-9 text-primary-foreground sm:px-10 sm:py-11">
        <p className="text-xs font-semibold tracking-[0.16em] uppercase opacity-80">
          {eyebrow}
        </p>
        <div className="mt-3 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {title}
            </h2>
            <p className="mt-3 leading-7 opacity-85">{description}</p>
          </div>
          <Link
            href={href}
            className={buttonVariants({
              size: "lg",
              variant: "secondary",
              className: "h-11 shrink-0",
            })}
          >
            {action}
            <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
