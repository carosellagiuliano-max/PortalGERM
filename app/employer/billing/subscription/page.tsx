import type { Metadata } from "next";
import Link from "@/components/shared/app-link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireEmployerBillingPage } from "@/lib/billing/employer-page-access";
import { getPaidCheckoutAvailability } from "@/lib/billing/paid-checkout-read-model";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";

export const metadata: Metadata = {
  title: "Bezahltes Abonnement",
  robots: { index: false, follow: false, noarchive: true },
};
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function EmployerSubscriptionPaymentPage() {
  await requireEmployerBillingPage(true);
  const environment = getServerEnvironment();
  const now = new Date();
  const [starter, pro] = await Promise.all([
    getPaidCheckoutAvailability(getDatabase(), environment, "STARTER", now),
    getPaidCheckoutAvailability(getDatabase(), environment, "PRO", now),
  ]);
  const checkoutReady =
    starter.activation.active &&
    pro.activation.active &&
    starter.stepUpReady &&
    pro.stepUpReady;

  return (
    <section aria-labelledby="paid-subscription-title" className="grid gap-7">
      <header>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">Real-Payment-Vertrag</Badge>
          <Badge variant={checkoutReady ? "default" : "secondary"}>
            {checkoutReady ? "Sandbox bereit" : "Serverseitig gesperrt"}
          </Badge>
        </div>
        <h1
          id="paid-subscription-title"
          className="mt-3 text-3xl font-semibold tracking-tight"
        >
          Bezahltes Abonnement
        </h1>
        <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
          Kartendaten werden ausschliesslich auf der gehosteten Seite des
          Zahlungsanbieters erfasst. SwissTalentHub autorisiert Betrag,
          CHF-Währung, Firma und Plan erneut auf dem Server.
        </p>
      </header>

      {!checkoutReady ? (
        <Alert>
          <AlertTitle>Noch kein realer Kauf möglich</AlertTitle>
          <AlertDescription>
            Diese Sperre ist beabsichtigt: Ohne gültigen WTP-Entscheid,
            Sandbox-Providerfreigabe und frische, aktionsgebundene
            Sicherheitsbestätigung wird keine Checkout-Session erzeugt.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <ActivationCard availability={starter} />
        <ActivationCard availability={pro} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Was bereits technisch abgesichert ist</CardTitle>
          <CardDescription>
            Die Aktivierung bleibt von der technischen Implementierung getrennt.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 text-sm text-muted-foreground">
            <li>Serverautorisierter CHF-/MWST-/Tenant-Snapshot</li>
            <li>Einmalige Step-up-Evidenz pro exaktem Checkout</li>
            <li>Signierte, durable Webhook-Inbox mit Replay-Schutz</li>
            <li>Abgleich von Attempt, Order, Rechnung und Ledger</li>
            <li>Refund, Chargeback, Dunning und Service-Recovery mit Audit</li>
          </ul>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/employer/billing"
          className={buttonVariants({ variant: "outline" })}
        >
          Zur Billing-Übersicht
        </Link>
        <Link
          href="/employer/billing/checkout"
          className={buttonVariants({ variant: "ghost" })}
        >
          Lokale Demo ansehen
        </Link>
      </div>
    </section>
  );
}

function ActivationCard({
  availability,
}: Readonly<{
  availability: Awaited<ReturnType<typeof getPaidCheckoutAvailability>>;
}>) {
  const reason = availability.activation.active
    ? "Step-up-Orchestrierung folgt mit Phase 25B."
    : activationReason(availability.activation.reason);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle as="h2">{availability.packageCode}</CardTitle>
          <Badge variant="outline">Kein Kauf-CTA</Badge>
        </div>
        <CardDescription>{reason}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <Gate label="WTP-Scope" ready={availability.wtpDecisionPresent} />
        <Gate
          label="Provider-Konfiguration"
          ready={availability.providerConfigured}
        />
        <Gate
          label="Provider-Ledger"
          ready={availability.providerLedgerPresent}
        />
        <Gate label="Self-Service-Flag" ready={availability.selfServiceFlag} />
        <Gate label="Action-bound Step-up" ready={availability.stepUpReady} />
      </CardContent>
    </Card>
  );
}

function Gate({ label, ready }: Readonly<{ label: string; ready: boolean }>) {
  return (
    <p className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <Badge variant={ready ? "default" : "secondary"}>
        {ready ? "vorhanden" : "fehlt"}
      </Badge>
    </p>
  );
}

function activationReason(reason: string) {
  const copy: Record<string, string> = {
    PAID_SELF_SERVICE_DISABLED: "Der Self-Service-Kill-Switch ist aus.",
    SANDBOX_COHORT_REQUIRED: "Die Testkohorte ist nicht freigegeben.",
    ENVIRONMENT_FORBIDDEN: "Diese Umgebung darf keinen Checkout starten.",
    WTP_DECISION_MISSING: "Ein dokumentierter WTP-GO-Entscheid fehlt.",
    WTP_SCOPE_MISMATCH: "Der WTP-Entscheid gilt für ein anderes Paket.",
    WTP_NOT_GO: "Der jüngste WTP-Entscheid ist kein GO.",
    WTP_NOT_YET_EFFECTIVE: "Der WTP-Entscheid ist noch nicht wirksam.",
    WTP_EXPIRED: "Der WTP-Entscheid ist abgelaufen.",
    WTP_MODE_FORBIDDEN: "Der WTP-Entscheid erlaubt diesen Modus nicht.",
    PROVIDER_INACTIVE: "Der Provider ist im Operations-Ledger nicht aktiv.",
    PROVIDER_NOT_SANDBOX: "Nur der Sandbox-Modus ist zulässig.",
  };
  return copy[reason] ?? "Eine zwingende Freigabe fehlt.";
}
