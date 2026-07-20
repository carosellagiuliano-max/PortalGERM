import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2Icon, EyeIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react";

import { AnonymousPreview } from "@/components/candidate/AnonymousPreview";
import {
  CompleteProfileForm,
  JobPassForm,
  type JobPassFormInitialValues,
} from "@/components/candidate/JobPassForm";
import { ProfileCompletion } from "@/components/candidate/ProfileCompletion";
import { PrivacyDeleteRequestForm } from "@/components/candidate/privacy-request-forms";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getOwnedCandidateProfileWorkspace,
  TALENT_RADAR_VISIBILITY_NOTICE_V1,
} from "@/lib/candidate/profile";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";

export const metadata: Metadata = {
  title: "SwissJobPass",
  robots: { index: false, follow: false, noarchive: true },
};
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function CandidateJobPassPage() {
  const user = await requireCandidatePage();
  const workspace = await getOwnedCandidateProfileWorkspace(
    getDatabase(),
    user.id,
  );
  const { profile } = workspace;
  const preference = profile.preference;
  const initial: JobPassFormInitialValues = Object.freeze({
    revision: profile.updatedAt.toISOString(),
    firstName: profile.firstName ?? "",
    lastName: profile.lastName ?? "",
    publicDisplayName: profile.publicDisplayName ?? "",
    email: profile.user.email,
    phone: profile.phone ?? "",
    cantonId: profile.cantonId ?? "",
    cityLabel: profile.cityLabel ?? "",
    summary: profile.summary ?? "",
    desiredTitles: preference?.desiredTitles.join("\n") ?? "",
    skillIds: Object.freeze(profile.skills.map(({ skillId }) => skillId)),
    languages: Object.freeze(
      profile.languages.map(({ code, level }) =>
        Object.freeze({ code: code.trim().toLowerCase(), level }),
      ),
    ),
    categoryIds: Object.freeze(
      preference?.categories.map(({ categoryId }) => categoryId) ?? [],
    ),
    workloadMin: numberValue(preference?.workloadMin),
    workloadMax: numberValue(preference?.workloadMax),
    desiredSalaryMin: numberValue(preference?.salaryMinChf),
    desiredSalaryMax: numberValue(preference?.salaryMaxChf),
    desiredSalaryPeriod: preference?.salaryPeriod ?? "",
    jobTypes: Object.freeze(preference?.desiredJobTypes ?? []),
    remotePreference: preference?.remotePreference ?? "",
    mobilityRadiusKm: numberValue(preference?.mobilityRadiusKm),
    availabilityDate: preference?.availableFrom?.toISOString().slice(0, 10) ?? "",
    workPermitType: profile.workPermitType ?? "",
    radarVisible: workspace.radarConsentGranted,
    currentDocument:
      profile.documents[0] === undefined
        ? null
        : Object.freeze({
            safeFilename: profile.documents[0].safeFilename,
            mimeType: profile.documents[0].mimeType,
            sizeBytes: profile.documents[0].sizeBytes,
          }),
  });

  return (
    <section aria-labelledby="jobpass-title" className="grid max-w-5xl gap-7">
      <div>
        <p className="eyebrow">Kandidatenprofil</p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 id="jobpass-title" className="text-3xl font-semibold tracking-tight">
              Dein SwissJobPass
            </h1>
            <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
              Baue dein Profil schrittweise auf. Speichern hält einen Entwurf fest;
              erst der separate Abschluss aktiviert den vollständigen Profilstatus.
            </p>
          </div>
          <Badge variant={profile.onboardingStatus === "COMPLETE" ? "secondary" : "outline"}>
            {profile.onboardingStatus === "COMPLETE" ? (
              <CheckCircle2Icon aria-hidden="true" />
            ) : null}
            {profile.onboardingStatus === "COMPLETE" ? "Abgeschlossen" : "Entwurf"}
          </Badge>
        </div>
      </div>

      <ProfileCompletion
        progress={workspace.progress}
        requirements={workspace.requirements}
        onboardingStatus={profile.onboardingStatus}
      />

      <Card>
        <CardHeader>
          <CardTitle as="h2">Profil bearbeiten</CardTitle>
        </CardHeader>
        <CardContent>
          <JobPassForm
            initial={initial}
            cantons={workspace.cantons}
            skills={workspace.skills}
            categories={workspace.categories}
            radarNotice={TALENT_RADAR_VISIBILITY_NOTICE_V1.text}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Profilstatus</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5">
          {profile.onboardingStatus === "COMPLETE" ? (
            <div className="flex gap-3 rounded-xl border border-emerald-600/25 bg-emerald-500/5 p-4">
              <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden="true" />
              <div>
                <p className="font-semibold">SwissJobPass ist abgeschlossen</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Du kannst ihn weiterhin bearbeiten. Entfernst du eine erforderliche
                  Angabe, wird er sicher als Entwurf wieder geöffnet und eine aktive
                  Radar-Projektion sofort zurückgezogen.
                </p>
              </div>
            </div>
          ) : (
            <CompleteProfileForm missing={workspace.requirements.missing} />
          )}
        </CardContent>
      </Card>

      <AnonymousPreview
        preview={workspace.preview}
        consentGranted={workspace.radarConsentGranted}
      />

      <div className="grid gap-4 rounded-xl border bg-muted/20 p-5 sm:grid-cols-2">
        <div className="flex gap-3">
          <EyeIcon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p className="font-semibold">Sichtbarkeit separat kontrollieren</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Auf der Statusseite siehst du, ob die sichere Projektion aktiv,
              vorgemerkt oder ausgeschaltet ist.
            </p>
            <Link href="/candidate/talent-radar" className={buttonVariants({ variant: "outline", className: "mt-3" })}>
              Talent-Radar-Status
            </Link>
          </div>
        </div>
        <div className="flex gap-3">
          <Trash2Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Datenschutzanfragen</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Eine Konto-Löschung wird als typisierter, nachvollziehbarer Fall
              erfasst. Das MVP löscht nicht ungeprüft sofort; Aufbewahrungspflichten
              und aktive Vorgänge werden im Fall geprüft.
            </p>
            <PrivacyDeleteRequestForm
              idempotencyKey={randomUUID()}
              fieldId="jobpass-delete-confirmation"
              className="mt-3"
            />
            <Link href="/candidate/privacy" className={buttonVariants({ variant: "outline", className: "mt-2 w-fit" })}>
              Fälle ansehen
            </Link>
          </div>
        </div>
      </div>

      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <ShieldCheckIcon className="size-4" aria-hidden="true" />
        Datenschutzfreundlich vorbereitet. Du kannst die Sichtbarkeit jederzeit deaktivieren.
      </p>
    </section>
  );
}

function numberValue(value: number | null | undefined) {
  return value == null ? "" : String(value);
}
