import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AdminActionForm,
  adminInputClass,
} from "@/components/admin/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getAdminOrderDetail } from "@/lib/billing/admin-billing";
import { getDatabase } from "@/lib/db/client";
import { formatChfFromRappen, formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Bestellung prüfen" };

export default async function AdminOrderDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const [{ id }, user] = await Promise.all([params, requireAdminPage()]);
  const order = await getAdminOrderDetail(
    {
      actor: {
        userId: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
      },
      correlationId: crypto.randomUUID(),
      database: getDatabase(),
      now: new Date(),
    },
    id,
  );
  if (order === null) notFound();
  return (
    <div className="grid gap-6">
      <header>
        <div className="flex flex-wrap gap-2">
          <Badge>{order.status}</Badge>
          <Badge variant="outline">{order.provider}</Badge>
        </div>
        <h1 className="mt-3 text-3xl font-semibold">
          Bestellung {order.id.slice(0, 8)}
        </h1>
        <p className="mt-2 text-muted-foreground">
          <Link
            className="hover:underline"
            href={`/admin/companies/${order.company.id}`}
          >
            {order.company.name}
          </Link>{" "}
          · erstellt {formatDateTime(order.createdAt)}
        </p>
      </header>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-5">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Unveränderliche Positionen</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              {order.lines.map((line) => (
                <div key={line.id} className="rounded-lg border p-3">
                  <div className="flex justify-between gap-3">
                    <span className="font-medium">
                      {line.descriptionSnapshot}
                    </span>
                    <span className="tabular-nums">
                      {formatChfFromRappen(line.totalRappen)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {line.quantity} ×{" "}
                    {formatChfFromRappen(line.unitNetRappen)} · MWST{" "}
                    {(line.taxRateBasisPoints / 100).toFixed(2)} % ·{" "}
                    {line.fulfillmentContext}
                  </p>
                  {line.subscriptionSnapshot === null ? null : (
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <dt className="text-muted-foreground">Policy</dt>
                        <dd>{line.subscriptionSnapshot.policyVersion}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Wechsel</dt>
                        <dd>{line.subscriptionSnapshot.changeKind}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Periodenstart</dt>
                        <dd>
                          {formatDateTime(
                            line.subscriptionSnapshot.fulfillmentPeriodStart,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Periodenende</dt>
                        <dd>
                          {formatDateTime(
                            line.subscriptionSnapshot.fulfillmentPeriodEnd,
                          )}
                        </dd>
                      </div>
                    </dl>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle as="h2">Payment Events</CardTitle>
            </CardHeader>
            <CardContent>
              {order.paymentEvents.length === 0 ? (
                <p className="text-muted-foreground">
                  Noch kein Provider-Event.
                </p>
              ) : (
                <ol className="grid gap-2">
                  {order.paymentEvents.map((event) => (
                    <li key={event.id} className="rounded-lg border p-3">
                      <div className="flex justify-between">
                        <strong>{event.kind}</strong>
                        <span>{formatDateTime(event.createdAt)}</span>
                      </div>
                      <p className="mt-1 break-all text-xs text-muted-foreground">
                        {event.providerReference ?? "ohne Provider-Referenz"} ·{" "}
                        {event.idempotencyKey}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
        <aside className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Summen</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <div className="flex justify-between">
                <span>Netto</span>
                <span>{formatChfFromRappen(order.netTotalRappen)}</span>
              </div>
              <div className="flex justify-between">
                <span>MWST</span>
                <span>{formatChfFromRappen(order.vatTotalRappen)}</span>
              </div>
              <div className="flex justify-between border-t pt-2 font-semibold">
                <span>Total</span>
                <span>{formatChfFromRappen(order.totalRappen)}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle as="h2">Rechnungssnapshot</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <p>{order.billingLegalNameSnapshot}</p>
              <p>{order.billingStreetSnapshot}</p>
              <p>
                {order.billingPostalCodeSnapshot} {order.billingCitySnapshot}
              </p>
              <p>{order.billingCountryCodeSnapshot}</p>
              <p className="mt-2 text-muted-foreground">
                {order.billingContactEmailSnapshot}
              </p>
            </CardContent>
          </Card>
          {order.status === "PENDING" && order.provider === "MOCK" ? (
            <AdminActionForm
              operation="order-cancel"
              label="Bestellung stornieren"
              destructive
              hidden={{
                orderId: order.id,
                companyId: order.company.id,
                expectedStatus: "PENDING",
                idempotencyKey: crypto.randomUUID(),
              }}
            >
              <label className="grid gap-1 text-sm">
                Pflichtgrund
                <input
                  name="reasonCode"
                  defaultValue="CUSTOMER_REQUESTED_CANCELLATION"
                  pattern="[A-Z][A-Z0-9_]{1,63}"
                  required
                  className={adminInputClass}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                Nur ausstehende Bestellungen können storniert werden. Ein
                externer Refund wird damit nicht behauptet.
              </p>
            </AdminActionForm>
          ) : null}
          {order.invoice === null ? null : (
            <Link
              className="rounded-lg border bg-card p-3 font-medium text-primary"
              href={`/admin/invoices/${order.invoice.id}`}
            >
              Rechnung {order.invoice.number} ansehen →
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}
