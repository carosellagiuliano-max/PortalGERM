import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ExternalTrackerActions } from "@/components/candidate/external-application-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import {
  EXTERNAL_APPLICATION_STATUS_LABELS_V1,
  EXTERNAL_APPLICATION_TRANSITIONS_V1,
  getExternalApplicationTracker,
} from "@/lib/recruiting/external-tracker";
import { isRecruitingFeatureAvailableV1 } from "@/lib/recruiting/feature-gates";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Externer Bewerbungsverlauf",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function ExternalApplicationDetailPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string | string[] }>;
}>) {
  const environment = getServerEnvironment();
  const featureEnabled = isRecruitingFeatureAvailableV1(
    environment,
    "external_application_tracker",
  );
  const [user, route, notices] = await Promise.all([
    requireCandidatePage(),
    params,
    searchParams,
  ]);
  const tracker = await getExternalApplicationTracker(user.id, route.id, {
    database: getDatabase(),
    environment,
  });
  if (tracker === null || tracker.snapshot === null) notFound();

  return (
    <section aria-labelledby="external-detail-title" className="grid gap-6">
      <Link
        href="/candidate/applications/external"
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        Zurück zu externen Verläufen
      </Link>
      {first(notices.created) === "1" ? (
        <Alert>
          <AlertTitle>Als begonnen gespeichert – nicht als eingereicht</AlertTitle>
          <AlertDescription>
            Der Snapshot ist unveränderbar. Weitere Status sind stets deine
            eigene Bestätigung und keine Aussage des Arbeitgebers.
          </AlertDescription>
        </Alert>
      ) : null}
      <header className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <p className="eyebrow">{tracker.snapshot.companyName}</p>
          <h1 id="external-detail-title" className="mt-2 text-3xl font-semibold">
            {tracker.snapshot.jobTitle}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Snapshot vom {formatDate(tracker.snapshot.capturedAt)} · Quelle:
            CANDIDATE_CONFIRMED
          </p>
        </div>
        <Badge variant="secondary">
          {EXTERNAL_APPLICATION_STATUS_LABELS_V1[tracker.status]}
        </Badge>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Von dir bestätigter Verlauf</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {tracker.events.map((event) => (
              <div key={event.id} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">
                  {event.toStatus === null
                    ? event.reasonCode ?? event.kind
                    : EXTERNAL_APPLICATION_STATUS_LABELS_V1[event.toStatus]}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDate(event.createdAt)} · von dir bestätigt
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <aside className="grid gap-5">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Eigene Angaben</CardTitle>
            </CardHeader>
            <CardContent>
              <ExternalTrackerActions
                trackerId={tracker.id}
                version={tracker.version}
                nextStatuses={EXTERNAL_APPLICATION_TRANSITIONS_V1[tracker.status]}
                statusIdempotencyKey={randomUUID()}
                reminderIdempotencyKey={randomUUID()}
                featureEnabled={featureEnabled}
              />
            </CardContent>
          </Card>
          <a
            href={tracker.snapshot.applicationUrl}
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "outline" })}
          >
            Arbeitgeberseite öffnen
          </a>
        </aside>
      </div>
    </section>
  );
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Zurich",
  }).format(value);
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
