import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import { Clock3Icon, LockKeyholeIcon, MailCheckIcon } from "lucide-react";

import { LeadForm } from "@/components/marketing/lead-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SALES_LEAD_INTAKE_POLICY_V1,
  normalizeLeadInterestQuery,
} from "@/lib/sales/lead-policy";

export const metadata: Metadata = {
  title: "Arbeitgeber-Demo anfragen",
  description: "Eine unverbindliche Arbeitgeber-Demo oder ein Paketgespräch bei SwissTalentHub anfragen.",
  alternates: { canonical: "/employers/demo" },
};
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DemoSearchParams = Promise<{ interest?: string | string[] }>;

export default async function EmployerDemoPage({
  searchParams,
}: Readonly<{ searchParams: DemoSearchParams }>) {
  const query = await searchParams;
  const initialInterest = normalizeLeadInterestQuery(query.interest);

  return (
    <section className="page-shell py-14 sm:py-20" aria-labelledby="demo-title">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:items-start">
        <div>
          <p className="eyebrow">Demo anfragen</p>
          <h1 id="demo-title" className="mt-3 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Lass uns deinen Recruiting-Bedarf einordnen.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-muted-foreground">
            Die Anfrage ist unverbindlich und erzeugt weder ein Abo noch eine Bestellung.
            Im aktuellen Mock-MVP wird eine interne Benachrichtigung protokolliert; es
            findet kein automatischer Versand an externe Dienste statt.
          </p>
          <div className="mt-8 grid gap-4">
            <TrustCard icon={Clock3Icon} title="Internes Ziel, keine Garantie">
              Eine erste Antwort wird innerhalb eines Werktags angestrebt. Ein
              Feiertagskalender ist in dieser Planungsregel noch nicht modelliert.
            </TrustCard>
            <TrustCard icon={LockKeyholeIcon} title="Zweckgebundene Angaben">
              Kontaktangaben und Nachricht werden nur für diese Vertriebsanfrage erfasst.
            </TrustCard>
            <TrustCard icon={MailCheckIcon} title="Nachvollziehbarer Mock">
              Die interne Demo-Mail wird dedupliziert als Mock-Protokoll gespeichert und
              behauptet keine reale Zustellung.
            </TrustCard>
          </div>
        </div>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle as="h2" className="text-2xl">Anfrage erfassen</CardTitle>
          </CardHeader>
          <CardContent>
            <LeadForm
              idempotencyKey={`lead-${randomUUID()}`}
              initialInterest={initialInterest}
              privacyNotice={SALES_LEAD_INTAKE_POLICY_V1.notice.text}
            />
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function TrustCard({
  icon: Icon,
  title,
  children,
}: Readonly<{
  icon: typeof Clock3Icon;
  title: string;
  children: React.ReactNode;
}>) {
  return (
    <div className="flex gap-3 rounded-xl border bg-muted/25 p-4">
      <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
