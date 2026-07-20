import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import type { CandidateApplicationPage } from "@/lib/applications/queries";
import { cn } from "@/lib/utils";

type ApplicationPaginationProps = Readonly<{
  pagination: Pick<
    CandidateApplicationPage,
    "page" | "totalPages" | "total" | "from" | "to"
  >;
  view: "list" | "kanban";
  filter: Readonly<{ status?: string; query?: string }>;
}>;

export function ApplicationPagination({
  pagination,
  view,
  filter,
}: ApplicationPaginationProps) {
  if (pagination.totalPages <= 1) return null;

  return (
    <nav
      aria-label="Bewerbungsseiten"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3"
    >
      <p className="text-sm text-muted-foreground">
        Bewerbungen {pagination.from}–{pagination.to} von {pagination.total} · Seite{" "}
        {pagination.page} von {pagination.totalPages}
      </p>
      <div className="flex items-center gap-2">
        {pagination.page > 1 ? (
          <Link
            href={candidateApplicationPageHref({
              page: pagination.page - 1,
              view,
              filter,
            })}
            rel="prev"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ChevronLeftIcon aria-hidden="true" /> Zurück
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "pointer-events-none opacity-50",
            )}
          >
            <ChevronLeftIcon aria-hidden="true" /> Zurück
          </span>
        )}
        {pagination.page < pagination.totalPages ? (
          <Link
            href={candidateApplicationPageHref({
              page: pagination.page + 1,
              view,
              filter,
            })}
            rel="next"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Weiter <ChevronRightIcon aria-hidden="true" />
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "pointer-events-none opacity-50",
            )}
          >
            Weiter <ChevronRightIcon aria-hidden="true" />
          </span>
        )}
      </div>
    </nav>
  );
}

export function candidateApplicationPageHref(input: Readonly<{
  page: number;
  view: "list" | "kanban";
  filter: Readonly<{ status?: string; query?: string }>;
}>) {
  const parameters = new URLSearchParams({ view: input.view });
  if (input.filter.status !== undefined) {
    parameters.set("status", input.filter.status);
  }
  if (input.filter.query !== undefined) {
    parameters.set("q", input.filter.query);
  }
  if (input.page > 1) parameters.set("page", String(input.page));
  return `/candidate/applications?${parameters.toString()}`;
}
