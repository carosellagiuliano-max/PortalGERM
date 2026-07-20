import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import type { CandidateConversationPage } from "@/lib/candidate/messages";
import { cn } from "@/lib/utils";

type MessagePaginationProps = Readonly<{
  pagination: Pick<
    CandidateConversationPage,
    "page" | "totalPages" | "total" | "from" | "to"
  >;
}>;

export function MessagePagination({ pagination }: MessagePaginationProps) {
  if (pagination.totalPages <= 1) return null;

  return (
    <nav
      aria-label="Nachrichtenseiten"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3"
    >
      <p className="text-sm text-muted-foreground">
        Gespräche {pagination.from}–{pagination.to} von {pagination.total} · Seite{" "}
        {pagination.page} von {pagination.totalPages}
      </p>
      <div className="flex items-center gap-2">
        {pagination.page > 1 ? (
          <Link
            href={candidateMessagePageHref(pagination.page - 1)}
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
            href={candidateMessagePageHref(pagination.page + 1)}
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

function candidateMessagePageHref(page: number) {
  return page > 1 ? `/candidate/messages?page=${page}` : "/candidate/messages";
}
