import type { Metadata } from "next";
import { BellRingIcon, ShieldCheckIcon } from "lucide-react";

import { AlertDeliveryConsentCard, AlertList } from "@/components/candidate/alert-list";
import { AlertForm } from "@/components/candidate/alert-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { getCandidateJobAlertPageData } from "@/lib/candidate/job-alerts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "Jobabos",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};

export default async function CandidateAlertsPage() {
  const user = await requireCandidatePage();
  const data = await getCandidateJobAlertPageData(user.id);

  return (
    <section aria-labelledby="alerts-title" className="grid max-w-5xl gap-7">
      <header>
        <p className="eyebrow">Jobabos</p>
        <h1 id="alerts-title" className="mt-2 text-3xl font-semibold tracking-tight">
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
              Die Aktivierung und die Service-Zustellung sind bewusst getrennte Entscheidungen.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertForm
              deliveryConsentGranted={data.deliveryConsentGranted}
              references={data.references}
            />
          </CardContent>
        </Card>

        <div className="grid content-start gap-5">
          <AlertDeliveryConsentCard granted={data.deliveryConsentGranted} />
          <Card>
            <CardHeader>
              <span className="mb-2 grid size-11 place-items-center rounded-lg bg-emerald-100 text-emerald-800">
                <ShieldCheckIcon className="size-5" aria-hidden="true" />
              </span>
              <CardTitle as="h2">Transparenter MVP-Modus</CardTitle>
            </CardHeader>
            <CardContent className="text-sm leading-6 text-muted-foreground">
              Job-Alerts werden im MVP nur als lokaler Mock-Eintrag erzeugt,
              ohne externe Tracking-Pixel. Du kannst sie jederzeit mit einem
              Klick pausieren.
            </CardContent>
          </Card>
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold">Deine Jobabos</h2>
        <div className="mt-4">
          <AlertList data={data} />
        </div>
      </div>
    </section>
  );
}
