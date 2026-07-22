import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2Icon } from "lucide-react";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { requireEmployerBillingPage } from "@/lib/billing/employer-page-access";
import { getCompanyOrder } from "@/lib/billing/employer-read-model";
import { getDatabase } from "@/lib/db/client";
import { formatChfFromRappen, formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Mock-Zahlung erfolgreich" };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function BillingSuccessPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ order?: string | string[] }> }>) {
  const { context } = await requireEmployerBillingPage();
  const raw = (await searchParams).order;
  const parsed = z.uuid().safeParse(typeof raw === "string" ? raw : "");
  if (!parsed.success) notFound();
  const order = await getCompanyOrder(getDatabase(), context.companyId, parsed.data);
  if (order === null || order.status !== "PAID" || order.invoice === null) notFound();
  const snapshot = order.lines[0]?.subscriptionSnapshot ?? null;
  const downgradeEffectiveAt =
    snapshot?.changeKind === "DOWNGRADE"
      ? snapshot.fulfillmentPeriodStart
      : null;
  return (
    <section aria-labelledby="billing-success-title" className="mx-auto grid w-full max-w-3xl gap-6">
      <Card><CardHeader><div className="mb-2 flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><CheckCircle2Icon aria-hidden="true" /></div><div className="flex flex-wrap items-center gap-2"><h1 id="billing-success-title" className="text-2xl font-semibold">Zahlung erfolgreich (Mock)</h1><Badge>Bezahlt</Badge></div><CardDescription>{downgradeEffectiveAt === null ? "Bestellung, Rechnung und Auslieferung wurden atomar verbucht." : `Bestellung und Rechnung sind verbucht. Der Planwechsel ist per ${formatDate(downgradeEffectiveAt)} vorgemerkt.`}</CardDescription></CardHeader><CardContent className="grid gap-5"><dl className="grid gap-2 text-sm"><Row label="Bestellung" value={order.lines.map((line) => line.descriptionSnapshot).join(", ")} /><Row label="Zahlungsdatum" value={order.paidAt === null ? "–" : formatDate(order.paidAt)} /><Row label="Rechnung" value={order.invoice.number} /><Row label="Total inkl. MWST" value={formatChfFromRappen(order.totalRappen)} strong /></dl>{snapshot === null ? null : <div className="rounded-lg bg-muted p-4"><h2 className="font-semibold">{downgradeEffectiveAt === null ? "Neue, beim Kauf gespeicherte Planlimiten" : `Ziel-Limiten ab ${formatDate(downgradeEffectiveAt)}`}</h2>{downgradeEffectiveAt === null ? null : <p className="mt-1 text-sm text-muted-foreground">Bis zu diesem Termin bleiben der aktuelle Plan und seine Limiten wirksam.</p>}<ul className="mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2"><li>{snapshot.activeJobLimitSnapshot} aktive Jobs</li><li>{snapshot.seatLimitSnapshot} Sitzplätze</li><li>{snapshot.talentContactAllowanceSnapshot} Talent-Kontakte</li><li>{snapshot.jobBoostAllowanceSnapshot} inkludierte Boosts</li></ul></div>}<div className="flex flex-wrap gap-2"><Link href={`/employer/billing/invoices/${encodeURIComponent(order.invoice.id)}`} className={buttonVariants()}>Rechnung ansehen</Link><Link href="/employer/billing" className={buttonVariants({ variant: "outline" })}>Zur Billing-Übersicht</Link></div></CardContent></Card>
    </section>
  );
}
function Row({ label, value, strong = false }: Readonly<{ label: string; value: string; strong?: boolean }>) { return <div className={`flex justify-between gap-4 ${strong ? "border-t pt-3 font-semibold" : ""}`}><dt className="text-muted-foreground">{label}</dt><dd className="text-right">{value}</dd></div>; }
