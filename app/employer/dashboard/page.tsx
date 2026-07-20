import type { Metadata } from "next";
import Link from "next/link";
import { Building2Icon, ShieldCheckIcon } from "lucide-react";

import { CompanyContextSwitcher } from "@/components/auth/company-context-switcher";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getEmployerContext } from "@/lib/auth/employer-context";

export const metadata: Metadata = { title: "Arbeitgeberübersicht" };

export default async function EmployerDashboardPage() {
  const context = await getEmployerContext();
  const memberships = context?.memberships ?? [];
  const current = context?.current ?? null;

  return (
    <section aria-labelledby="employer-dashboard-title">
      <p className="eyebrow">Übersicht</p>
      <h1 id="employer-dashboard-title" className="mt-2 text-3xl font-semibold tracking-tight">
        Willkommen im Arbeitgeberportal
      </h1>
      <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">
        Dein persönlicher Zugang ist aktiv. Firmenkontext und Mitgliedschaft werden bei
        jedem Aufruf serverseitig erneut geprüft.
      </p>
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2">
              <Building2Icon className="size-5 text-primary" aria-hidden="true" />
              Unternehmensbereich
            </CardTitle>
          </CardHeader>
          <CardContent>
            {memberships.length === 0 ? (
              <div className="grid gap-4">
                <p className="leading-6 text-muted-foreground">
                  Für dein Konto ist noch kein aktiver Firmenzugang verfügbar. Wenn du
                  nach der Registrierung zu einer Prüfung weitergeleitet wurdest, kannst
                  du dort den aktuellen sicheren Status sehen.
                </p>
                <Link
                  href="/employer/company/claim-pending"
                  className={buttonVariants({ variant: "outline", className: "w-fit" })}
                >
                  Firmenzugang prüfen
                </Link>
              </div>
            ) : memberships.length > 1 ? (
              <CompanyContextSwitcher
                companies={memberships}
                currentCompanyId={current?.companyId}
              />
            ) : (
              <div className="grid gap-2">
                <p className="font-medium">{current?.companyName}</p>
                <p className="leading-6 text-muted-foreground">
                  {current?.companyStatus === "DRAFT"
                    ? "Das Unternehmensprofil befindet sich im sicheren Onboarding."
                    : "Dieser Firmenkontext wurde aus deiner aktiven Mitgliedschaft geladen."}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2">
              <ShieldCheckIcon className="size-5 text-primary" aria-hidden="true" />
              Sicher getrennte Mandanten
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="leading-6 text-muted-foreground">
              Ein globaler Arbeitgeber- oder Recruiter-Status gewährt keinen Zugriff auf
              fremde Unternehmen. Die operativen Funktionen folgen in späteren Phasen.
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
