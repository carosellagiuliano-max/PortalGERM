import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CurrentUser } from "@/lib/auth/current-user";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";

import { PreferenceRow } from "./preference-row";
import { SecurityEmailChangeForm } from "./security-email-change-form";

export async function NotificationSettingsPage({
  user,
  database,
  environment,
}: Readonly<{
  user: CurrentUser;
  database: DatabaseClient;
  environment: ServerEnvironment;
}>) {
  if (
    environment.IDENTITY_VERIFICATION_ENFORCEMENT &&
    (user.emailVerifiedAt === null ||
      user.identityAssurance !== "VERIFIED_EMAIL")
  ) {
    return (
      <main className="page-shell grid gap-8 py-8 sm:py-12">
        <header className="max-w-3xl">
          <p className="eyebrow">Identität &amp; Zustellung</p>
          <h1 className="mt-2 text-3xl font-semibold">E-Mail bestätigen</h1>
          <p className="mt-3 text-muted-foreground">
            Dein Konto ist angemeldet, aber noch nicht vollständig
            freigeschaltet. Bestätige zuerst deine aktuelle Login-Adresse.
          </p>
        </header>
        <Card>
          <CardHeader>
            <CardTitle>Bestätigung ausstehend</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="break-all text-sm text-muted-foreground">
              Aktuelle Adresse: {user.email}
            </p>
            <Link
              href="/verify-email"
              className="inline-flex min-h-11 w-fit items-center rounded-md bg-primary px-4 font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Bestätigungsseite öffnen
            </Link>
            <p className="text-sm text-muted-foreground">
              Optionale Präferenzen und die Änderung der Login-Adresse werden
              erst nach der Bestätigung freigeschaltet.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }
  const [preferences, pendingChange] = await Promise.all([
    database.notificationPreference.findMany({
      where: {
        userId: user.id,
        purpose: { in: ["JOB_ALERT", "COMMERCIAL_OPTIONAL"] },
        channel: "EMAIL",
      },
      select: { purpose: true, enabled: true, version: true },
    }),
    database.pendingEmailChange.findFirst({
      where: { userId: user.id, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: { targetEmail: true },
    }),
  ]);
  const preference = new Map(
    preferences.map((row) => [row.purpose, row] as const),
  );
  return (
    <main className="page-shell grid gap-8 py-8 sm:py-12">
      <header className="max-w-3xl">
        <p className="eyebrow">Identität &amp; Zustellung</p>
        <h1 className="mt-2 text-3xl font-semibold">Benachrichtigungen</h1>
        <p className="mt-3 text-muted-foreground">
          Pflichtnachrichten zu Sicherheit, Bewerbung, Abrechnung und
          Datenschutz bleiben aktiv. Optionale Zwecke kannst du getrennt
          steuern.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Optionale E-Mail-Zwecke</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <PreferenceRow
            purpose="JOB_ALERT"
            title="Jobabos und passende Stellen"
            description="Optionale Digest-E-Mails für selbst eingerichtete Jobabos."
            enabled={preference.get("JOB_ALERT")?.enabled ?? false}
            version={preference.get("JOB_ALERT")?.version ?? 0}
            activationAvailable={environment.OPTIONAL_EMAIL}
          />
          <PreferenceRow
            purpose="COMMERCIAL_OPTIONAL"
            title="Optionale Produktinformationen"
            description="Freiwillige Hinweise zu Produktneuigkeiten und Angeboten."
            enabled={
              preference.get("COMMERCIAL_OPTIONAL")?.enabled ?? false
            }
            version={preference.get("COMMERCIAL_OPTIONAL")?.version ?? 0}
            activationAvailable={environment.OPTIONAL_EMAIL}
          />
          <div className="rounded-xl border border-dashed p-4">
            <p className="font-semibold">Pflichtnachrichten</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Verifikation, Sicherheitswarnungen, Bewerbungsstatus, Rechnungen
              und Datenschutzfälle sind keine Marketingpräferenz und können
              hier nicht ausgeschaltet werden.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Login-E-Mail ändern</CardTitle>
        </CardHeader>
        <CardContent>
          <SecurityEmailChangeForm
            currentEmail={user.email}
            enabled={environment.LOGIN_EMAIL_CHANGE}
            pendingTarget={pendingChange?.targetEmail ?? null}
            stepUpRequired={
              environment.PRIVILEGED_STEP_UP_MODE === "enforce"
            }
            userId={user.id}
            securityHref={
              user.role === "CANDIDATE"
                ? "/candidate/settings/security"
                : "/employer/settings/security"
            }
          />
        </CardContent>
      </Card>
    </main>
  );
}
