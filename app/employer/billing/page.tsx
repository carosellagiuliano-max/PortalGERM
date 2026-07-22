import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, BriefcaseBusinessIcon, FileTextIcon, GaugeIcon, WalletCardsIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CancelSubscriptionDialog } from "@/components/billing/cancel-subscription-dialog";
import { CreditSourceOverview } from "@/components/billing/credit-source-overview";
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
import { getEmployerBillingOverview } from "@/lib/billing/employer-read-model";
import { getDatabase } from "@/lib/db/client";
import { formatChfFromRappen, formatDate } from "@/lib/utils/format";

export const metadata: Metadata = {
  title: "Billing und Abonnement",
  robots: { index: false, follow: false, noarchive: true },
};
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function EmployerBillingPage() {
  const { context } = await requireEmployerBillingPage();
  const now = new Date();
  const overview = await getEmployerBillingOverview(
    getDatabase(),
    context.companyId,
    now,
  );
  if (overview === null) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Billing ist vorübergehend nicht verfügbar.</AlertTitle>
        <AlertDescription>
          Die versionierten Planrechte konnten nicht eindeutig aufgelöst werden.
          Es werden vorsichtshalber keine Käufe angeboten.
        </AlertDescription>
      </Alert>
    );
  }
  const isOwner = context.membershipRole === "OWNER";
  return (
    <section aria-labelledby="billing-title" className="grid gap-7">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Firma · Billing</p>
          <h1 id="billing-title" className="mt-2 text-3xl font-semibold tracking-tight">
            Plan, Rechnungen und Guthaben
          </h1>
          <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
            Transparente CHF-Beträge, unveränderliche Rechnungen und getrennte
            Guthabenquellen. Zahlungen laufen im MVP ausschliesslich lokal als Mock.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/employer/billing/profile" className={buttonVariants({ variant: "outline" })}>
            Rechnungsprofil
          </Link>
          <Link href="/employer/billing/usage" className={buttonVariants({ variant: "outline" })}>
            Nutzung im Detail
          </Link>
        </div>
      </header>

      {!overview.profileComplete ? (
        <Alert>
          <AlertTitle>Rechnungsprofil vervollständigen</AlertTitle>
          <AlertDescription>
            Vor einem Checkout benötigt Billing den rechtlichen Firmennamen, die
            Rechnungsadresse und eine Kontakt-E-Mail. <Link href="/employer/billing/profile">Jetzt ergänzen</Link>.
          </AlertDescription>
        </Alert>
      ) : null}

      {overview.plan.pendingChange === null ? null : (
        <Alert>
          <AlertTitle>Planänderung vorgemerkt</AlertTitle>
          <AlertDescription>
            {overview.plan.pendingChange.kind === "CANCEL"
              ? `Das Abonnement endet am ${formatDate(overview.plan.pendingChange.effectiveAt)}.`
              : `Der Wechsel zu ${overview.plan.pendingChange.targetPlanName ?? "dem Zielplan"} wird am ${formatDate(overview.plan.pendingChange.effectiveAt)} wirksam.`}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<WalletCardsIcon aria-hidden="true" />}
          label="Aktueller Plan"
          value={overview.plan.name}
          detail={overview.plan.status === "CANCELLING"
            ? `Kündigt per ${formatDate(overview.plan.cancellationEffectiveAt ?? overview.plan.periodEnd!)}`
            : overview.plan.status === "FREE"
              ? "Kostenloser Basisplan"
              : "Aktiver Monatsplan"}
        />
        <MetricCard
          icon={<BriefcaseBusinessIcon aria-hidden="true" />}
          label="Aktive Jobs"
          value={`${overview.usage.activeJobs.used} / ${overview.usage.activeJobs.limit}`}
          detail="serverseitig wirksame Auslastung"
        />
        <MetricCard
          icon={<GaugeIcon aria-hidden="true" />}
          label="Monatlicher Nettopreis"
          value={formatChfFromRappen(overview.plan.monthlyNetRappen)}
          detail={overview.plan.periodEnd === null
            ? "keine bezahlte Periode"
            : `aktuelle Periode bis ${formatDate(overview.plan.periodEnd)}`}
        />
        <MetricCard
          icon={<FileTextIcon aria-hidden="true" />}
          label="Offene Rechnungen"
          value={`${overview.openInvoiceCount}`}
          detail={formatChfFromRappen(overview.openInvoiceTotalRappen)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Nächste Schritte</CardTitle>
          <CardDescription>
            Planänderungen benötigen die Owner-Rolle. Admins dürfen das Rechnungsprofil
            pflegen und freigegebene Einmalprodukte kaufen.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {isOwner && overview.plan.pendingChange === null ? <PlanActions currentCode={overview.plan.code} /> : !isOwner ? (
            <Badge variant="outline">Planänderung nur durch Inhaber:in</Badge>
          ) : null}
          {overview.usage.talentRadarAccess ? (
            <Link href="/employer/billing/checkout?product=contact-pack-10" className={buttonVariants({ variant: "outline" })}>
              Contact Pack kaufen
            </Link>
          ) : isOwner ? (
            <Link href="/employer/billing/checkout?plan=pro" className={buttonVariants({ variant: "outline" })}>
              Talent Radar mit Pro freischalten
            </Link>
          ) : (
            <Link href="/pricing" className={buttonVariants({ variant: "outline" })}>
              Planoptionen ansehen
            </Link>
          )}
          <Link href="/employer/jobs" className={buttonVariants({ variant: "outline" })}>
            Boost auf einer Stelle auswählen
          </Link>
          <Link href="/employer/billing/invoices" className={buttonVariants({ variant: "outline" })}>
            Rechnungen ansehen
          </Link>
          {isOwner && overview.plan.status === "ACTIVE" && overview.plan.periodEnd !== null && overview.plan.pendingChange === null ? (
            <CancelSubscriptionDialog
              periodEnd={overview.plan.periodEnd}
              idempotencyKey={randomUUID()}
              retentionOptions={overview.cancellationRetentionOptions}
            />
          ) : null}
        </CardContent>
      </Card>

      <CreditSourceOverview usage={overview.usage} />

      <Card>
        <CardHeader>
          <CardTitle as="h2">Letzte Bestellungen</CardTitle>
          <CardDescription>Status und unveränderlicher Rechnungsbetrag.</CardDescription>
        </CardHeader>
        <CardContent>
          {overview.recentOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch keine Bestellungen.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] text-left text-sm">
                <thead className="text-muted-foreground"><tr><th className="pb-2">Datum</th><th className="pb-2">Produkt / Plan</th><th className="pb-2">Status</th><th className="pb-2 text-right">Total</th><th className="pb-2"><span className="sr-only">Aktion</span></th></tr></thead>
                <tbody>
                  {overview.recentOrders.map((order) => (
                    <tr key={order.id} className="border-t">
                      <td className="py-3">{formatDate(order.createdAt)}</td>
                      <td className="py-3 font-medium">{order.label}</td>
                      <td className="py-3"><Badge variant={order.status === "PAID" ? "default" : "outline"}>{orderStatusLabel(order.status)}</Badge></td>
                      <td className="py-3 text-right tabular-nums">{formatChfFromRappen(order.totalRappen)}</td>
                      <td className="py-3 text-right">
                        {order.status === "PAID" ? <Link href={`/employer/billing/success?order=${encodeURIComponent(order.id)}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>Details</Link> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function MetricCard({ icon, label, value, detail }: Readonly<{ icon: React.ReactNode; label: string; value: string; detail: string }>) {
  return <Card><CardHeader><div className="mb-2 flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</div><CardDescription>{label}</CardDescription><CardTitle as="h2" className="text-2xl">{value}</CardTitle></CardHeader><CardContent><p className="text-xs text-muted-foreground">{detail}</p></CardContent></Card>;
}

function PlanActions({ currentCode }: Readonly<{ currentCode: string }>) {
  if (currentCode === "FREE_BASIC") {
    return <><Link href="/employer/billing/checkout?plan=starter" className={buttonVariants()}>Starter wählen <ArrowRightIcon aria-hidden="true" /></Link><Link href="/employer/billing/checkout?plan=pro" className={buttonVariants({ variant: "outline" })}>Pro wählen</Link></>;
  }
  if (currentCode === "STARTER") {
    return <Link href="/employer/billing/checkout?plan=pro" className={buttonVariants()}>Auf Pro upgraden <ArrowRightIcon aria-hidden="true" /></Link>;
  }
  if (currentCode === "PRO") {
    return <Link href="/employer/billing/checkout?plan=starter" className={buttonVariants({ variant: "outline" })}>Zu Starter per Periodenende</Link>;
  }
  return <Link href="/employers/demo" className={buttonVariants()}>Planberatung anfragen</Link>;
}

function orderStatusLabel(status: string) {
  return ({ DRAFT: "Entwurf", PENDING: "Zahlung offen", PAID: "Bezahlt", FAILED: "Fehlgeschlagen", CANCELLED: "Abgebrochen", EXPIRED: "Abgelaufen" } as Record<string, string>)[status] ?? status;
}
