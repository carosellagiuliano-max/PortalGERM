import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ExternalTrackerResumeForm } from "@/components/candidate/external-application-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import {
  EXTERNAL_APPLICATION_RESUME_POLICY_V1,
  verifyExternalApplicationResumeIntent,
} from "@/lib/recruiting/external-application-intent";
import {
  EXTERNAL_APPLICATION_STATUS_LABELS_V1,
  listExternalApplicationTrackers,
  previewExternalApplicationResume,
} from "@/lib/recruiting/external-tracker";
import { isRecruitingFeatureAvailableV1 } from "@/lib/recruiting/feature-gates";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Externe Bewerbungsverläufe",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function ExternalApplicationsPage() {
  const environment = getServerEnvironment();
  const featureEnabled = isRecruitingFeatureAvailableV1(
    environment,
    "external_application_tracker",
  );
  const user = await requireCandidatePage();
  const cookieStore = await cookies();
  const intent = verifyExternalApplicationResumeIntent(
    cookieStore.get(EXTERNAL_APPLICATION_RESUME_POLICY_V1.cookieName)?.value,
    new Date(),
    environment.secrets.session,
  );
  const [trackers, resume] = await Promise.all([
    listExternalApplicationTrackers(user.id, {
      database: getDatabase(),
      environment,
    }),
    !featureEnabled || intent === null
      ? null
      : previewExternalApplicationResume(
          { jobId: intent.jobId, jobRevisionId: intent.jobRevisionId },
          { database: getDatabase(), environment },
        ),
  ]);
  if (!featureEnabled && trackers.length === 0) notFound();

  return (
    <section aria-labelledby="external-title" className="grid gap-7">
      <header>
        <p className="eyebrow">Freiwilliger Verlauf</p>
        <h1 id="external-title" className="mt-2 text-3xl font-semibold tracking-tight">
          Externe Bewerbungen
        </h1>
        <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
          Hier erfasst du ausschliesslich eigene Angaben. Ein Klick auf eine
          Arbeitgeberseite ist niemals eine eingereichte Bewerbung und
          SwissTalentHub liest weder ATS noch private E-Mails.
        </p>
      </header>

      {!featureEnabled ? (
        <Alert>
          <AlertTitle>Verlaufserfassung pausiert</AlertTitle>
          <AlertDescription>
            Deine vorhandene Historie bleibt lesbar. Neue Übernahmen,
            Statusänderungen und Erinnerungen sind ausgeschaltet.
          </AlertDescription>
        </Alert>
      ) : null}

      {resume === null ? null : (
        <Alert>
          <AlertTitle>Externe Stelle wiederaufnehmen</AlertTitle>
          <AlertDescription>
            <div className="mt-2 grid gap-3">
              <p>
                {resume.jobTitle} · {resume.companyName}. Erst deine bewusste
                Bestätigung erzeugt einen Verlauf mit unveränderbarem Snapshot.
              </p>
              <ExternalTrackerResumeForm idempotencyKey={randomUUID()} />
            </div>
          </AlertDescription>
        </Alert>
      )}

      {trackers.length === 0 ? (
        <Card>
          <CardContent className="grid gap-3 py-8 text-center">
            <p className="font-medium">Noch kein freiwilliger externer Verlauf.</p>
            <p className="text-sm text-muted-foreground">
              Öffne bei einer externen Stelle den Bewerbungslink. Beim späteren
              Zurückkehren kannst du den Verlauf bewusst übernehmen.
            </p>
            <Link href="/jobs" className={buttonVariants({ variant: "outline" })}>
              Jobs ansehen
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {trackers.map((tracker) => (
            <Card key={tracker.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <CardTitle as="h2">
                    {tracker.snapshot?.jobTitle ?? "Externe Bewerbung"}
                  </CardTitle>
                  <Badge variant="secondary">
                    {EXTERNAL_APPLICATION_STATUS_LABELS_V1[tracker.status]}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3">
                <p className="text-sm text-muted-foreground">
                  {tracker.snapshot?.companyName ?? "Unternehmen"} · Quelle:
                  von dir bestätigt
                </p>
                <Link
                  href={`/candidate/applications/external/${tracker.id}`}
                  className={buttonVariants({ variant: "outline" })}
                >
                  Verlauf öffnen
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
