import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  CompanyForm,
  CompanyOnboardingForm,
  type CompanyFormInitialValues,
} from "@/components/employer/company-form";
import { VerificationPanel } from "@/components/employer/verification-panel";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireEmployerPage } from "@/lib/auth/route-guards";
import { buildCatalogUpgradePrompt } from "@/lib/billing/upgrade-prompt";
import { getDatabase } from "@/lib/db/client";
import {
  EmployerCompanyDomainError,
  getEmployerCompanyWorkspace,
} from "@/lib/employer/company";
import { requireEmployerCompanyContext } from "@/lib/employer/context";

export const metadata: Metadata = {
  title: "Firmenprofil und Verifizierung",
  robots: { index: false, follow: false, noarchive: true },
};
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function EmployerCompanyPage() {
  const database = getDatabase();
  const now = new Date();
  const [user, context] = await Promise.all([
    requireEmployerPage(),
    requireEmployerCompanyContext(),
  ]);
  const workspace = await loadCompanyWorkspace({
    companyId: context.companyId,
    membershipId: context.membershipId,
    actorUserId: user.id,
  }, database);
  const enhancedProfileUpgradePrompt = await buildCatalogUpgradePrompt(
    {
      reason: "ENHANCED_PROFILE_NOT_INCLUDED",
      suggestedPlanSlug: "pro",
      actorRole: workspace.membershipRole,
    },
    { database, now },
  );
  const initial: CompanyFormInitialValues = Object.freeze({
    expectedUpdatedAt: workspace.company.updatedAt.toISOString(),
    name: workspace.company.name,
    uid: workspace.company.uid ?? "",
    industry: workspace.company.industry ?? "",
    size: workspace.company.size ?? "",
    website: workspace.company.website ?? "",
    logoStorageKey: workspace.company.logoStorageKey ?? "",
    coverStorageKey: workspace.company.coverStorageKey ?? "",
    linkedinUrl: workspace.company.linkedinUrl ?? "",
    facebookUrl: workspace.company.facebookUrl ?? "",
    instagramUrl: workspace.company.instagramUrl ?? "",
    about: workspace.company.about ?? "",
    values: workspace.company.values.join("\n"),
    benefits: workspace.company.benefits.join("\n"),
    locations: workspace.locations.map((location) =>
      Object.freeze({
        id: location.id,
        cantonId: location.cantonId,
        cityId: location.cityId,
        address: location.address ?? "",
        postalCode: location.postalCode ?? "",
        isPrimary: location.isPrimary,
      }),
    ),
  });

  return (
    <section aria-labelledby="company-title" className="grid gap-7">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Firma · {workspace.membershipRole}</p>
          <h1
            id="company-title"
            className="mt-2 text-3xl font-semibold tracking-tight"
          >
            {workspace.company.name}
          </h1>
          <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
            Pflege das öffentliche Firmenprofil, schliesse das Onboarding ab und
            verwalte den davon getrennten Verifizierungsprozess.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={workspace.company.status === "ACTIVE" ? "default" : "outline"}>
            {workspace.company.status === "ACTIVE" ? "Profil aktiv" : "Profilentwurf"}
          </Badge>
          <Badge variant={workspace.verification.verified ? "default" : "secondary"}>
            {workspace.verification.verified ? "Verifiziert" : "Nicht verifiziert"}
          </Badge>
          {workspace.company.status === "ACTIVE" && workspace.verification.verified ? (
            <Link
              href={`/companies/${workspace.company.slug}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Öffentliches Profil
            </Link>
          ) : null}
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Firmenprofil</CardTitle>
          <CardDescription>
            Grundangaben, Social Links, sichere Storage-Metadaten sowie bis zu zehn
            Firmenstandorte.
          </CardDescription>
          <CardAction>
            <Badge variant="outline">
              {workspace.canManage ? "Bearbeitbar" : "Schreibgeschützt"}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <CompanyForm
            initial={initial}
            canManage={workspace.canManage}
            enhancedProfileAllowed={workspace.enhancedProfileAllowed}
            enhancedProfileUpgradePrompt={enhancedProfileUpgradePrompt}
            cantons={workspace.cantons}
            cities={workspace.cities}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Firmen-Onboarding</CardTitle>
          <CardDescription>
            Nur der atomare Übergang von Entwurf zu aktiv macht das Profil
            öffentlich sichtbar. Er erzeugt kein Verifizierungsabzeichen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {workspace.company.status === "DRAFT" ? (
            <CompanyOnboardingForm
              expectedUpdatedAt={workspace.company.updatedAt.toISOString()}
              missing={workspace.onboardingMissing}
              canManage={workspace.canManage}
            />
          ) : (
            <p className="text-sm leading-6 text-muted-foreground">
              Das Firmenprofil ist aktiv. Der Prüfstatus unten bleibt davon unabhängig
              und kann nicht über den Onboarding-Abschluss verändert werden.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Firmenverifizierung</CardTitle>
          <CardDescription>
            Nachweise bleiben innerhalb eines offenen Prüfzyklus. Ein neuer Zyklus
            ist erst nach Ablehnung oder Widerruf möglich.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VerificationPanel
            current={workspace.verification.current}
            history={workspace.verification.history}
            canManage={workspace.canManage}
            idempotencyKey={randomUUID()}
          />
        </CardContent>
      </Card>
    </section>
  );
}

async function loadCompanyWorkspace(
  scope: Readonly<{
    companyId: string;
    membershipId: string;
    actorUserId: string;
  }>,
  database: ReturnType<typeof getDatabase>,
) {
  try {
    return await getEmployerCompanyWorkspace(database, scope);
  } catch (error) {
    if (
      error instanceof EmployerCompanyDomainError &&
      error.code === "NOT_FOUND"
    ) {
      notFound();
    }
    throw error;
  }
}
