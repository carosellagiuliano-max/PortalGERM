import type { Metadata } from "next";
import Link from "next/link";
import { LayoutGridIcon, ListIcon, SearchIcon } from "lucide-react";

import { ApplicationKanban } from "@/components/candidate/application-kanban";
import { ApplicationList } from "@/components/candidate/application-list";
import {
  ApplicationPagination,
  candidateApplicationPageHref,
} from "@/components/candidate/application-pagination";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  APPLICATION_STATUS_LABELS_V1,
} from "@/lib/applications/contracts";
import {
  listCandidateApplications,
  normalizeApplicationListFilter,
  normalizeCandidateApplicationPage,
} from "@/lib/applications/queries";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import { APPLICATION_STATUSES } from "@/lib/policies/status/application";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "Bewerbungen",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};

type ApplicationsPageProps = Readonly<{
  searchParams: Promise<{
    status?: string | string[];
    q?: string | string[];
    view?: string | string[];
    page?: string | string[];
  }>;
}>;

export default async function CandidateApplicationsPage({
  searchParams,
}: ApplicationsPageProps) {
  const [user, rawSearchParams] = await Promise.all([
    requireCandidatePage(),
    searchParams,
  ]);
  const filter = normalizeApplicationListFilter({
    status: rawSearchParams.status,
    query: rawSearchParams.q,
  });
  const requestedPage = normalizeCandidateApplicationPage(rawSearchParams.page);
  const applicationPage = await listCandidateApplications(
    user.id,
    filter,
    getDatabase(),
    { page: requestedPage },
  );
  const applications = applicationPage.items;
  const view = first(rawSearchParams.view) === "kanban" ? "kanban" : "list";

  return (
    <section aria-labelledby="applications-title" className="grid gap-7">
      <header>
        <p className="eyebrow">Bewerbungscenter</p>
        <h1 id="applications-title" className="mt-2 text-3xl font-semibold tracking-tight">
          Deine Bewerbungen
        </h1>
        <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
          Verfolge den aktuellen Status, deine private Notiz und die erste
          Reaktionszeit des Unternehmens an einem Ort.
        </p>
      </header>

      <form method="get" className="grid gap-4 rounded-xl border bg-card p-4 md:grid-cols-[minmax(0,1fr)_15rem_auto] md:items-end">
        <input type="hidden" name="view" value={view} />
        <div className="grid gap-1.5">
          <Label htmlFor="application-search">Suche</Label>
          <Input
            id="application-search"
            name="q"
            type="search"
            maxLength={100}
            defaultValue={filter.query ?? ""}
            placeholder="Stelle oder Unternehmen"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="application-status">Status</Label>
          <select
            id="application-status"
            name="status"
            defaultValue={filter.status ?? ""}
            className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
          >
            <option value="">Alle Status</option>
            {APPLICATION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {APPLICATION_STATUS_LABELS_V1[status]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit">
          <SearchIcon aria-hidden="true" /> Filtern
        </Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {applicationPage.total}{" "}
          {applicationPage.total === 1 ? "Bewerbung" : "Bewerbungen"}
          {applicationPage.total > 0
            ? ` · angezeigt ${applicationPage.from}–${applicationPage.to}`
            : null}
        </p>
        <nav aria-label="Ansicht wählen" className="flex rounded-lg border p-1">
          <Link
            href={candidateApplicationPageHref({
              page: applicationPage.page,
              view: "list",
              filter,
            })}
            aria-current={view === "list" ? "page" : undefined}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              view === "list" && "bg-muted",
            )}
          >
            <ListIcon aria-hidden="true" /> Liste
          </Link>
          <Link
            href={candidateApplicationPageHref({
              page: applicationPage.page,
              view: "kanban",
              filter,
            })}
            aria-current={view === "kanban" ? "page" : undefined}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              view === "kanban" && "bg-muted",
            )}
          >
            <LayoutGridIcon aria-hidden="true" /> Kanban
          </Link>
        </nav>
      </div>

      {view === "kanban" ? (
        <ApplicationKanban applications={applications} />
      ) : (
        <ApplicationList applications={applications} />
      )}

      <ApplicationPagination
        pagination={applicationPage}
        view={view}
        filter={filter}
      />
    </section>
  );
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
