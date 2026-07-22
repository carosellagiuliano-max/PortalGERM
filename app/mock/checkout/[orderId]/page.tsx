import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldCheckIcon } from "lucide-react";
import { z } from "zod";

import { MockPaymentForm } from "@/components/billing/mock-payment-form";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireEmployerBillingPage } from "@/lib/billing/employer-page-access";
import { getCompanyOrder } from "@/lib/billing/employer-read-model";
import { getDatabase } from "@/lib/db/client";
import { formatChfFromRappen, formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = {
  title: "Lokaler Mock-Checkout",
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function MockCheckoutPage({
  params,
}: Readonly<{ params: Promise<{ orderId: string }> }>) {
  const { context } = await requireEmployerBillingPage();
  const parsed = z.uuid().safeParse((await params).orderId);
  if (!parsed.success) notFound();
  const now = new Date();
  const order = await getCompanyOrder(getDatabase(), context.companyId, parsed.data);
  if (
    order === null ||
    order.provider !== "MOCK" ||
    order.status !== "PENDING" ||
    (order.expiresAt !== null && order.expiresAt.getTime() <= now.getTime()) ||
    order.lines.length !== 1
  ) notFound();
  const line = order.lines[0]!;
  if (line.planVersionId !== null && context.membershipRole !== "OWNER") notFound();
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto grid min-h-screen w-full max-w-2xl content-center gap-6 px-4 py-10">
      <header className="text-center"><div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary"><ShieldCheckIcon aria-hidden="true" /></div><p className="eyebrow">Lokaler Zahlungsadapter</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Mock-Checkout</h1><p className="mt-3 text-muted-foreground">Es wird keine reale Zahlung und keine externe Verbindung ausgelöst.</p></header>
      <Card><CardHeader><div className="flex flex-wrap items-center gap-2"><CardTitle as="h2">{line.descriptionSnapshot}</CardTitle><Badge variant="secondary">MOCK</Badge></div><CardDescription>Bestellung läuft {order.expiresAt === null ? "ohne Ablaufzeit" : `bis ${formatDateTime(order.expiresAt)}`}.</CardDescription></CardHeader><CardContent className="grid gap-5"><address className="rounded-lg bg-muted p-3 not-italic leading-6"><strong>{order.billingLegalNameSnapshot}</strong><br />{order.billingStreetSnapshot}<br />{order.billingPostalCodeSnapshot} {order.billingCitySnapshot}<br />Schweiz</address><dl className="grid gap-2 text-sm"><Row label="Netto" value={formatChfFromRappen(order.netTotalRappen)} /><Row label={`MWST ${(line.taxRateBasisPoints / 100).toLocaleString("de-CH")} %`} value={formatChfFromRappen(order.vatTotalRappen)} /><Row label="Total inkl. MWST" value={formatChfFromRappen(order.totalRappen)} strong /></dl><div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-start sm:justify-between"><Link href="/employer/billing" className={buttonVariants({ variant: "outline" })}>Abbrechen</Link><MockPaymentForm orderId={order.id} idempotencyKey={`mock-confirm:${order.id}`} /></div></CardContent></Card>
      <p className="text-center text-xs text-muted-foreground">Privater, nicht indexierbarer Demo-Bereich · Referrer deaktiviert</p>
    </main>
  );
}
function Row({ label, value, strong = false }: Readonly<{ label: string; value: string; strong?: boolean }>) { return <div className={`flex justify-between gap-4 ${strong ? "border-t pt-3 text-base font-semibold" : ""}`}><dt>{label}</dt><dd className="tabular-nums">{value}</dd></div>; }
