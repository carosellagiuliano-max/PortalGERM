"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangleIcon, RotateCcwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { normalizeErrorReference } from "@/lib/utils/error-reference";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
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
    if (supportReference === null) {
      return;
    }
    console.error(
      JSON.stringify({
        level: "error",
        event: "route_error_boundary_shown",
        ...(errorReference === undefined
          ? { incidentId: supportReference, referenceSource: "client_incident" }
          : { errorReference, referenceSource: "next_error_digest" }),
      }),
    );
  }, [errorReference, supportReference]);

  return (
    <section
      ref={errorRegionRef}
      aria-labelledby="route-error-title"
      className="page-shell grid min-h-[60vh] place-items-center py-16 text-center outline-none"
      role="alert"
      tabIndex={-1}
    >
      <div className="max-w-lg">
        <AlertTriangleIcon className="mx-auto size-10 text-destructive" aria-hidden="true" />
        <h1
          id="route-error-title"
          className="mt-5 text-3xl font-semibold tracking-tight"
        >
          Etwas ist schiefgelaufen.
        </h1>
        <p className="mt-4 leading-7 text-muted-foreground">
          Bitte versuche es erneut. Falls der Fehler bleibt, hilft die Referenz bei der
          sicheren Diagnose.
        </p>
        <p className="mt-3 break-all font-mono text-xs text-muted-foreground">
          Referenz: {supportReference ?? "wird erstellt"}
        </p>
        <Button className="mt-7" onClick={reset}>
          <RotateCcwIcon data-icon="inline-start" />
          Erneut versuchen
        </Button>
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
