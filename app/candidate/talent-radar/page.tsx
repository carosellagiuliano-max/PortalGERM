import type { Metadata } from "next";
import Link from "next/link";
import { CirclePauseIcon, EyeIcon, EyeOffIcon, LockKeyholeIcon, ShieldCheckIcon } from "lucide-react";

import { AnonymousPreview } from "@/components/candidate/AnonymousPreview";
import { RadarVisibilityForm } from "@/components/candidate/RadarVisibilityForm";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getOwnedCandidateProfileWorkspace,
  TALENT_RADAR_VISIBILITY_NOTICE_V1,
} from "@/lib/candidate/profile";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import { listCandidateRadarRequests } from "@/lib/talentradar/candidate-request-view";

export const metadata: Metadata = {
  title: "Talent Radar",
  robots: { index: false, follow: false, noarchive: true },
};
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function CandidateTalentRadarPage() {
  const user = await requireCandidatePage();
  const database = getDatabase();
  const [workspace, contactRequests] = await Promise.all([
    getOwnedCandidateProfileWorkspace(database, user.id),
    listCandidateRadarRequests(database, user.id),
  ]);
  const status = radarStatusContent(workspace.radarState);
  const StatusIcon = status.icon;

  return (
    <section aria-labelledby="talent-radar-title" className="grid max-w-5xl gap-7">
      <div>
        <p className="eyebrow">Privatsphäre & Sichtbarkeit</p>
        <h1 id="talent-radar-title" className="mt-2 text-3xl font-semibold tracking-tight">
          Anonymer Talent Radar
        </h1>
        <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
          Du entscheidest ausdrücklich, ob dein sicher reduzierter SwissJobPass
          auffindbar ist. Diese Wahl ist unabhängig von Marketing und
          Nutzungsbedingungen.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <CardTitle as="h2" className="flex items-center gap-2">
              <StatusIcon className="size-5 text-primary" aria-hidden="true" />
              {status.title}
            </CardTitle>
            <Badge variant={workspace.radarState === "CURRENT" ? "secondary" : "outline"}>
              {status.badge}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5">
          <p className="leading-7 text-muted-foreground">{status.description}</p>
          <div className="rounded-xl border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
            {TALENT_RADAR_VISIBILITY_NOTICE_V1.text}
            <p className="mt-2 font-medium text-foreground">
              Einwilligungsversion: {TALENT_RADAR_VISIBILITY_NOTICE_V1.noticeVersion}
            </p>
          </div>
          <RadarVisibilityForm consentGranted={workspace.radarConsentGranted} />
          {workspace.radarState === "INCOMPLETE" ? (
            <Link href="/candidate/jobpass" className={buttonVariants({ variant: "outline", className: "w-fit" })}>
              SwissJobPass vervollständigen
            </Link>
          ) : null}
        </CardContent>
      </Card>

      <AnonymousPreview
        preview={workspace.preview}
        consentGranted={workspace.radarConsentGranted}
      />

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-2">
            <LockKeyholeIcon className="size-5 text-primary" aria-hidden="true" />
            Kontaktanfragen bleiben getrennt
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm leading-6 text-muted-foreground">
          <p>
            Arbeitgeber sehen hier nie automatisch deine Identität. Kandidateneigene
            Kontaktanfragen kannst du einzeln annehmen oder ablehnen. Auch nach dem
            Annehmen bleibt der Nachrichtenverlauf anonym.
          </p>
          <p>
            Eine Identitätsfreigabe erfolgt separat, feldweise und erst nach deiner
            exakten Vorschau und Bestätigung.
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background p-4">
            <span className="font-medium text-foreground">
              {contactRequests.length === 0
                ? "Keine Kontaktanfragen"
                : `${contactRequests.length} Kontaktanfrage${contactRequests.length === 1 ? "" : "n"}`}
            </span>
            <Link
              href="/candidate/talent-radar/requests"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Kontaktanfragen ansehen
            </Link>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-xl border bg-muted/20 p-5 text-sm leading-6">
        <p className="flex items-center gap-2 font-semibold">
          <ShieldCheckIcon className="size-4 text-primary" aria-hidden="true" />
          Datenschutzfreundlich vorbereitet
        </p>
        <p className="mt-1 text-muted-foreground">
          DSG-freundliches MVP — Orientierung, keine Rechtsberatung. Identität
          bleibt anonym, bis du sie freigibst. Du kannst die Sichtbarkeit jederzeit
          deaktivieren.
        </p>
      </div>
    </section>
  );
}

function radarStatusContent(state: "CURRENT" | "PAUSED" | "OFF" | "INCOMPLETE") {
  return {
    CURRENT: {
      title: "Anonym sichtbar im Talent Radar",
      badge: "Aktiv",
      description:
        "Dein vollständiger SwissJobPass und die aktuelle Einwilligung erfüllen die Suchvoraussetzungen. Arbeitgeber erhalten ausschliesslich die anonyme Projektion.",
      icon: EyeIcon,
    },
    PAUSED: {
      title: "Talent Radar pausiert",
      badge: "Pausiert",
      description:
        "Die Einwilligung ist vorhanden, die sichere Projektion ist aber derzeit zurückgezogen. Speichere und bestätige den SwissJobPass erneut.",
      icon: CirclePauseIcon,
    },
    OFF: {
      title: "Nicht im Talent Radar",
      badge: "Aus",
      description:
        "Es besteht keine aktuelle Sichtbarkeitseinwilligung. Deine Profilprojektion ist für die Suche zurückgezogen.",
      icon: EyeOffIcon,
    },
    INCOMPLETE: {
      title: "Einwilligung vorgemerkt — Profil unvollständig",
      badge: "Noch nicht sichtbar",
      description:
        "Deine Absicht ist protokolliert, aber ein Entwurf wird nicht in der Arbeitgeber-Suche ausgegeben. Ergänze die Pflichtangaben und schliesse den SwissJobPass ausdrücklich ab.",
      icon: CirclePauseIcon,
    },
  }[state];
}
