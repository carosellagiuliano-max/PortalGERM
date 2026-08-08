"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { HomeIcon, RotateCcwIcon, SearchIcon } from "lucide-react";

import Link from "@/components/shared/app-link";
import { Button, buttonVariants } from "@/components/ui/button";
import { normalizeErrorReference } from "@/lib/utils/error-reference";
import { createLogger } from "@/lib/utils/logger";

const logger = createLogger();

/**
 * Keeps a search failure local to `/jobs`: users get a safe recovery path
 * while the server-side cause remains fail-closed and correlatable.
 */
export default function JobsErrorPage({
  error,
  unstable_retry,
}: Readonly<{
  error: Error & { digest?: string };
  unstable_retry: () => void;
}>) {
  const errorRegionRef = useRef<HTMLElement>(null);
  const [incidentStore] = useState(createIncidentStore);
  const incidentId = useSyncExternalStore(
    incidentStore.subscribe,
    incidentStore.getSnapshot,
    incidentStore.getServerSnapshot,
  );
  const errorReference = normalizeErrorReference(error.digest);
  const supportReference = errorReference ?? incidentId;

  useEffect(() => {
    errorRegionRef.current?.focus();
  }, []);

  useEffect(() => {
    if (supportReference === null) return;
    logger.error(
      "public_jobs_error_boundary_shown",
      errorReference === undefined
        ? {
            incidentId: supportReference,
            referenceSource: "client_incident",
          }
        : {
            errorReference,
            referenceSource: "next_error_digest",
          },
    );
  }, [errorReference, supportReference]);

  return (
    <section
      ref={errorRegionRef}
      aria-labelledby="jobs-error-title"
      className="page-shell grid min-h-[60vh] place-items-center py-12 text-center outline-none sm:py-16"
      role="alert"
      tabIndex={-1}
    >
      <div className="max-w-xl rounded-2xl border bg-card p-6 shadow-sm sm:p-10">
        <SearchIcon className="mx-auto size-10 text-primary" aria-hidden="true" />
        <h1
          id="jobs-error-title"
          className="mt-5 text-balance text-3xl font-semibold tracking-tight"
        >
          Die Stellensuche ist gerade nicht verfügbar.
        </h1>
        <p className="mt-4 leading-7 text-muted-foreground">
          Deine Eingaben wurden nicht veröffentlicht oder gespeichert. Versuche die
          Suche erneut oder öffne sie ohne Filter.
        </p>
        <p className="mt-3 break-all font-mono text-xs text-muted-foreground">
          Referenz: {supportReference ?? "wird erstellt"}
        </p>
        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row sm:flex-wrap">
          <Button type="button" onClick={unstable_retry}>
            <RotateCcwIcon data-icon="inline-start" />
            Suche erneut laden
          </Button>
          <Link
            href="/jobs"
            className={buttonVariants({ variant: "outline" })}
          >
            <SearchIcon data-icon="inline-start" />
            Suche ohne Filter
          </Link>
          <Link href="/" className={buttonVariants({ variant: "ghost" })}>
            <HomeIcon data-icon="inline-start" />
            Zur Startseite
          </Link>
        </div>
      </div>
    </section>
  );
}

function createIncidentStore() {
  let incidentId: string | null = null;

  return {
    subscribe: () => () => undefined,
    getSnapshot: () => {
      incidentId ??= globalThis.crypto.randomUUID();
      return incidentId;
    },
    getServerSnapshot: () => null,
  };
}
