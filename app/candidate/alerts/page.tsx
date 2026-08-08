import type { Metadata } from "next";
import { BellRingIcon, ShieldCheckIcon } from "lucide-react";

import {
  AlertDeliveryConsentCard,
  AlertList,
} from "@/components/candidate/alert-list";
import { AlertForm } from "@/components/candidate/alert-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { resolveJobAlertDeliveryAvailability } from "@/lib/candidate/job-alert-delivery-runtime";
import { getCandidateJobAlertPageData } from "@/lib/candidate/job-alerts";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "Jobabos",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};

export default async function CandidateAlertsPage() {
  const user = await requireCandidatePage();
  const environment = getServerEnvironment();
  const database = getDatabase();
  const now = new Date();
  const [data, deliveryAvailability] = await Promise.all([
    getCandidateJobAlertPageData(user.id, database, now),
    resolveJobAlertDeliveryAvailability(database, environment, now),
  ]);

  return (
    <section aria-labelledby="alerts-title" className="grid max-w-5xl gap-7">
      <header>
        <p className="eyebrow">Jobabos</p>
        <h1
          id="alerts-title"
          className="mt-2 text-3xl font-semibold tracking-tight"
        >
          Passende Stellen im Blick behalten
        </h1>
        <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
          Kombiniere Ort, Pensum, Lohntransparenz und Arbeitsmodell. Tägliche
          und wöchentliche Termine folgen Europe/Zurich um 08:00 Uhr.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.45fr)]">
        <Card>
          <CardHeader>
            <span className="mb-2 grid size-11 place-items-center rounded-lg bg-secondary text-secondary-foreground">
              <BellRingIcon className="size-5" aria-hidden="true" />
            </span>
            <CardTitle as="h2">Neues Jobabo</CardTitle>
            <CardDescription>
              Die Aktivierung und die Service-Zustellung sind bewusst getrennte
              Entscheidungen.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertForm
              deliveryAvailability={deliveryAvailability}
              deliveryConsentGranted={data.deliveryConsentGranted}
              references={data.references}
            />
          </CardContent>
        </Card>

        <div className="grid content-start gap-5">
          <AlertDeliveryConsentCard
            availability={deliveryAvailability}
            granted={data.deliveryConsentGranted}
          />
          <Card>
            <CardHeader>
              <span
                className={
                  deliveryAvailability.canActivate
                    ? "mb-2 grid size-11 place-items-center rounded-lg bg-emerald-100 text-emerald-800"
                    : "mb-2 grid size-11 place-items-center rounded-lg bg-amber-100 text-amber-900"
                }
              >
                <ShieldCheckIcon className="size-5" aria-hidden="true" />
              </span>
              <CardTitle as="h2">
                {deliveryTitle(deliveryAvailability.mode)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm leading-6 text-muted-foreground">
              {deliveryCopy(deliveryAvailability.mode)} Du kannst gespeicherte
              Jobabos jederzeit mit einem Klick pausieren.
            </CardContent>
          </Card>
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold">Deine Jobabos</h2>
        <div className="mt-4">
          <AlertList
            availability={deliveryAvailability}
            data={data}
          />
        </div>
      </div>
    </section>
  );
}

function deliveryTitle(
  mode: "LOCAL_MOCK" | "PROVIDER_CONTRACT" | "EXTERNAL" | "UNAVAILABLE",
) {
  switch (mode) {
    case "LOCAL_MOCK":
      return "Transparenter lokaler Testmodus";
    case "PROVIDER_CONTRACT":
      return "Isolierter Providervertrag";
    case "EXTERNAL":
      return "Freigegebener Zustellpfad";
    case "UNAVAILABLE":
      return "Zustellung derzeit gesperrt";
  }
}

function deliveryCopy(
  mode: "LOCAL_MOCK" | "PROVIDER_CONTRACT" | "EXTERNAL" | "UNAVAILABLE",
) {
  switch (mode) {
    case "LOCAL_MOCK":
      return "Fällige Jobabos können lokal als klar gekennzeichneter Mock-Eintrag erzeugt werden. Es wird keine echte E-Mail versendet.";
    case "PROVIDER_CONTRACT":
      return "Provider, Worker und Scheduler sind für den isolierten Vertrag freigegeben. Das ist keine echte Empfängerzustellung.";
    case "EXTERNAL":
      return "Provider, Worker und Scheduler sind aktuell freigegeben. Eine E-Mail gilt trotzdem erst mit Providerbestätigung als übergeben und nicht schon beim Speichern des Jobabos.";
    case "UNAVAILABLE":
      return "Es gibt aktuell keinen vollständig freigegebenen und erreichbaren Provider-, Worker- und Scheduler-Pfad. Filter können pausiert gespeichert, aber nicht aktiviert oder als zustellbar bezeichnet werden.";
  }
}
