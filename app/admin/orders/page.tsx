import type { Metadata } from "next";
import Link from "@/components/shared/app-link";

import { Badge } from "@/components/ui/badge";
import {
  ResponsiveTable,
  ResponsiveTableCell,
} from "@/components/ui/responsive-table";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { listAdminOrders } from "@/lib/billing/admin-billing";
import { getDatabase } from "@/lib/db/client";
import { formatChfFromRappen, formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Bestellungen" };

export default async function AdminOrdersPage() {
  const user = await requireAdminPage();
  const orders = await listAdminOrders({
    actor: {
      userId: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      capabilities: user.capabilities,
    },
    correlationId: crypto.randomUUID(),
    database: getDatabase(),
    now: new Date(),
  });
  if (orders === null) return null;

  return (
    <div className="grid gap-6">
      <header>
        <p className="eyebrow">Billing Operations</p>
        <h1 className="mt-2 text-3xl font-semibold">Bestellungen</h1>
        <p className="mt-2 text-muted-foreground">
          Providerstatus, unveränderliche Quote und Fulfillment bleiben
          gemeinsam nachvollziehbar.
        </p>
      </header>
      {orders.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Noch keine Bestellungen vorhanden. Bestätigte Mock-Checkouts
          erscheinen hier mit ihrem unveränderlichen Beleg.
        </p>
      ) : (
        <ResponsiveTable label="Bestellungen und Belege">
          <thead className="bg-muted/60 text-muted-foreground">
            <tr>
              <th className="p-3">Datum</th>
              <th className="p-3">Firma</th>
              <th className="p-3">Inhalt</th>
              <th className="p-3">Status</th>
              <th className="p-3 text-right">Netto</th>
              <th className="p-3 text-right">Total</th>
              <th className="sticky right-0 border-l bg-muted p-3">Beleg</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {orders.map((order) => (
              <tr key={order.id}>
                <ResponsiveTableCell
                  className="p-3 whitespace-nowrap"
                  label="Datum"
                  primary
                >
                  {formatDateTime(order.createdAt)}
                </ResponsiveTableCell>
                <ResponsiveTableCell className="p-3" label="Firma">
                  <Link
                    className="font-medium hover:underline"
                    href={`/admin/companies/${order.company.id}`}
                  >
                    {order.company.name}
                  </Link>
                </ResponsiveTableCell>
                <ResponsiveTableCell className="p-3" label="Inhalt">
                  {order.lines
                    .map((line) => line.descriptionSnapshot)
                    .join(", ")}
                </ResponsiveTableCell>
                <ResponsiveTableCell className="p-3" label="Status">
                  <Badge variant="outline">{order.status}</Badge>
                </ResponsiveTableCell>
                <ResponsiveTableCell
                  className="p-3 text-right tabular-nums"
                  label="Netto"
                >
                  {formatChfFromRappen(order.netTotalRappen)}
                </ResponsiveTableCell>
                <ResponsiveTableCell
                  className="p-3 text-right tabular-nums"
                  label="Total"
                >
                  {formatChfFromRappen(order.totalRappen)}
                </ResponsiveTableCell>
                <ResponsiveTableCell
                  className="sticky right-0 border-l bg-background p-3 shadow-[-6px_0_8px_-8px_rgba(15,23,42,0.35)]"
                  label="Aktion"
                  actions
                >
                  <Link
                    className="whitespace-nowrap font-medium text-primary"
                    href={`/admin/orders/${order.id}`}
                  >
                    Prüfen
                  </Link>
                </ResponsiveTableCell>
              </tr>
            ))}
          </tbody>
        </ResponsiveTable>
      )}
    </div>
  );
}
