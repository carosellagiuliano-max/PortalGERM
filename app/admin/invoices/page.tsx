import type { Metadata } from "next";
import Link from "@/components/shared/app-link";

import { Badge } from "@/components/ui/badge";
import {
  ResponsiveTable,
  ResponsiveTableCell,
} from "@/components/ui/responsive-table";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { listAdminInvoices } from "@/lib/billing/admin-billing";
import { getDatabase } from "@/lib/db/client";
import {
  formatChfFromRappen,
  formatDate,
  formatDateTime,
} from "@/lib/utils/format";

export const metadata: Metadata = { title: "Rechnungen" };

export default async function AdminInvoicesPage() {
  const user = await requireAdminPage();
  const now = new Date();
  const invoices = await listAdminInvoices({
    actor: {
      userId: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      capabilities: user.capabilities,
    },
    correlationId: crypto.randomUUID(),
    database: getDatabase(),
    now,
  });
  if (invoices === null) return null;

  return (
    <div className="grid gap-6">
      <header>
        <p className="eyebrow">Billing Operations</p>
        <h1 className="mt-2 text-3xl font-semibold">Rechnungen</h1>
        <p className="mt-2 text-muted-foreground">
          HTML-Belege aus unveränderlichen Adress-, Steuer- und
          Positionssnapshots.
        </p>
      </header>
      {invoices.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Noch keine Rechnungen vorhanden. Ausgestellte Mock-Rechnungen
          erscheinen hier mit ihrem unveränderlichen Snapshot.
        </p>
      ) : (
        <ResponsiveTable label="Rechnungen und Belege">
          <thead className="bg-muted/60 text-muted-foreground">
            <tr>
              <th className="p-3">Nummer</th>
              <th className="p-3">Firma</th>
              <th className="p-3">Ausgestellt</th>
              <th className="p-3">Fällig</th>
              <th className="p-3">Status</th>
              <th className="p-3 text-right">Netto</th>
              <th className="p-3 text-right">Total</th>
              <th className="sticky right-0 border-l bg-muted p-3">Beleg</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {invoices.map((invoice) => {
              const overdue =
                invoice.status === "ISSUED" &&
                invoice.dueAt.getTime() <= now.getTime();
              return (
                <tr key={invoice.id}>
                  <ResponsiveTableCell
                    className="p-3 font-medium"
                    label="Nummer"
                    primary
                  >
                    {invoice.number}
                  </ResponsiveTableCell>
                  <ResponsiveTableCell className="p-3" label="Firma">
                    <Link
                      className="hover:underline"
                      href={`/admin/companies/${invoice.company.id}`}
                    >
                      {invoice.company.name}
                    </Link>
                  </ResponsiveTableCell>
                  <ResponsiveTableCell
                    className="p-3 whitespace-nowrap"
                    label="Ausgestellt"
                  >
                    {invoice.issuedAt === null
                      ? formatDateTime(invoice.createdAt)
                      : formatDateTime(invoice.issuedAt)}
                  </ResponsiveTableCell>
                  <ResponsiveTableCell
                    className="p-3 whitespace-nowrap"
                    label="Fällig"
                  >
                    {formatDate(invoice.dueAt)}
                  </ResponsiveTableCell>
                  <ResponsiveTableCell className="p-3" label="Status">
                    <Badge variant={overdue ? "destructive" : "outline"}>
                      {overdue ? "ÜBERFÄLLIG" : invoice.status}
                    </Badge>
                  </ResponsiveTableCell>
                  <ResponsiveTableCell
                    className="p-3 text-right tabular-nums"
                    label="Netto"
                  >
                    {formatChfFromRappen(invoice.netTotalRappen)}
                  </ResponsiveTableCell>
                  <ResponsiveTableCell
                    className="p-3 text-right tabular-nums"
                    label="Total"
                  >
                    {formatChfFromRappen(invoice.totalRappen)}
                  </ResponsiveTableCell>
                  <ResponsiveTableCell
                    className="sticky right-0 border-l bg-background p-3 shadow-[-6px_0_8px_-8px_rgba(15,23,42,0.35)]"
                    label="Aktion"
                    actions
                  >
                    <Link
                      className="whitespace-nowrap font-medium text-primary"
                      href={`/admin/invoices/${invoice.id}`}
                    >
                      Anzeigen
                    </Link>
                  </ResponsiveTableCell>
                </tr>
              );
            })}
          </tbody>
        </ResponsiveTable>
      )}
    </div>
  );
}
