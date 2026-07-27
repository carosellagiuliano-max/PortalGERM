import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { listAdminOrders } from "@/lib/billing/admin-billing";
import { getDatabase } from "@/lib/db/client";
import { formatChfFromRappen, formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Bestellungen" };

export default async function AdminOrdersPage() {
  const user = await requireAdminPage();
  const orders = await listAdminOrders({ actor: { userId: user.id, email: user.email, role: user.role, status: user.status, capabilities: user.capabilities }, correlationId: crypto.randomUUID(), database: getDatabase(), now: new Date() });
  if (orders === null) return null;
  return <div className="grid gap-6"><header><p className="eyebrow">Billing Operations</p><h1 className="mt-2 text-3xl font-semibold">Bestellungen</h1><p className="mt-2 text-muted-foreground">Providerstatus, unveränderliche Quote und Fulfillment bleiben gemeinsam nachvollziehbar.</p></header>{orders.length === 0 ? <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Noch keine Bestellungen vorhanden. Bestätigte Mock-Checkouts erscheinen hier mit ihrem unveränderlichen Beleg.</p> : <div className="overflow-x-auto rounded-xl border" data-e2e-horizontal-scroll="true" role="region" aria-label="Bestellungstabelle" tabIndex={0}><table className="w-full min-w-[56rem] text-left text-sm"><thead className="bg-muted/60 text-muted-foreground"><tr><th className="p-3">Datum</th><th className="p-3">Firma</th><th className="p-3">Inhalt</th><th className="p-3">Status</th><th className="p-3 text-right">Netto</th><th className="p-3 text-right">Total</th><th className="sticky right-0 border-l bg-muted p-3">Beleg</th></tr></thead><tbody className="divide-y">{orders.map((order) => <tr key={order.id}><td className="p-3 whitespace-nowrap">{formatDateTime(order.createdAt)}</td><td className="p-3"><Link className="font-medium hover:underline" href={`/admin/companies/${order.company.id}`}>{order.company.name}</Link></td><td className="p-3">{order.lines.map((line) => line.descriptionSnapshot).join(", ")}</td><td className="p-3"><Badge variant="outline">{order.status}</Badge></td><td className="p-3 text-right tabular-nums">{formatChfFromRappen(order.netTotalRappen)}</td><td className="p-3 text-right tabular-nums">{formatChfFromRappen(order.totalRappen)}</td><td className="sticky right-0 border-l bg-background p-3 shadow-[-6px_0_8px_-8px_rgba(15,23,42,0.35)]"><Link className="whitespace-nowrap font-medium text-primary" href={`/admin/orders/${order.id}`}>Prüfen</Link></td></tr>)}</tbody></table></div>}</div>;
}
