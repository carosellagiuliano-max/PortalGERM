import Link from "next/link";
import { BookmarkMinusIcon, ExternalLinkIcon } from "lucide-react";

import { removeSavedJobAction } from "@/app/candidate/saved-jobs/actions";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SavedJobListItem } from "@/lib/candidate/saved-jobs";
import { formatDate } from "@/lib/utils/format";

export function SavedJobList({
  jobs,
}: Readonly<{ jobs: readonly SavedJobListItem[] }>) {
  if (jobs.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="font-medium">Noch keine Stellen gespeichert</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Merke dir interessante Stellen und finde sie hier später wieder.
          </p>
          <Link href="/jobs" className={buttonVariants({ className: "mt-5" })}>
            Jobs suchen
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-5">
      {jobs.map((item) => (
        <Card key={item.savedJobId}>
          <CardHeader className="gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={item.current ? "secondary" : "outline"}>
                  {item.job.contextLabel}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Gespeichert am {formatDate(item.savedAt)}
                </span>
              </div>
              <CardTitle as="h2" className="mt-3 text-lg">
                {item.current ? (
                  <Link
                    href={`/jobs/${item.job.slug}`}
                    className="underline-offset-4 hover:text-primary hover:underline"
                  >
                    {item.job.title}
                  </Link>
                ) : (
                  item.job.title
                )}
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {item.job.companyName}
              </p>
            </div>
            <form action={removeSavedJobAction}>
              <input type="hidden" name="savedJobId" value={item.savedJobId} />
              <Button type="submit" variant="outline">
                <BookmarkMinusIcon aria-hidden="true" /> Entfernen
              </Button>
            </form>
          </CardHeader>
          {item.current || item.alternatives.length === 0 ? null : (
            <CardContent className="border-t pt-4">
              <p className="text-sm font-medium">Ähnliche aktuelle Stellen</p>
              <ul className="mt-3 grid gap-2">
                {item.alternatives.map((alternative) => (
                  <li key={alternative.slug}>
                    <Link
                      href={`/jobs/${alternative.slug}`}
                      className="flex items-start justify-between gap-3 rounded-lg bg-muted/35 p-3 text-sm underline-offset-4 hover:bg-muted hover:underline"
                    >
                      <span>
                        <strong className="block">{alternative.title}</strong>
                        <span className="text-muted-foreground">
                          {alternative.companyName}
                        </span>
                      </span>
                      <ExternalLinkIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}
