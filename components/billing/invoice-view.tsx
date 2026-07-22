import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatChfFromRappen, formatDate } from "@/lib/utils/format";

type InvoiceViewModel = Readonly<{
  number: string;
  status: string;
  displayStatus: string;
  billingLegalNameSnapshot: string;
  billingContactEmailSnapshot: string;
  billingStreetSnapshot: string;
  billingPostalCodeSnapshot: string;
  billingCitySnapshot: string;
  billingCountryCodeSnapshot: string;
  billingUidSnapshot: string | null;
  billingVatNumberSnapshot: string | null;
  netTotalRappen: number;
  vatTotalRappen: number;
  totalRappen: number;
  dueAt: Date;
  issuedAt: Date | null;
  paidAt: Date | null;
  lines: readonly Readonly<{
    id: string;
    descriptionSnapshot: string;
    quantity: number;
    unitNetRappen: number;
    netRappen: number;
    taxRateBasisPoints: number;
    vatRappen: number;
    totalRappen: number;
  }>[];
}>;

export function InvoiceView({ invoice }: Readonly<{ invoice: InvoiceViewModel }>) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle as="h2">Rechnung {invoice.number}</CardTitle>
            <CardDescription>
              Ausgestellt {invoice.issuedAt === null ? "–" : formatDate(invoice.issuedAt)} · fällig {formatDate(invoice.dueAt)}
            </CardDescription>
          </div>
          <Badge
            variant={invoice.displayStatus === "PAID"
              ? "default"
              : invoice.displayStatus === "OVERDUE"
                ? "destructive"
                : "outline"}
          >
            {invoiceStatusLabel(invoice.displayStatus)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-8">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rechnung an</p>
            <address className="not-italic leading-6">
              <strong>{invoice.billingLegalNameSnapshot}</strong><br />
              {invoice.billingStreetSnapshot}<br />
              {invoice.billingPostalCodeSnapshot} {invoice.billingCitySnapshot}<br />
              {invoice.billingCountryCodeSnapshot === "CH" ? "Schweiz" : invoice.billingCountryCodeSnapshot}<br />
              {invoice.billingContactEmailSnapshot}
            </address>
          </div>
          <div className="sm:text-right">
            {invoice.billingUidSnapshot === null ? null : <p>UID: {invoice.billingUidSnapshot}</p>}
            {invoice.billingVatNumberSnapshot === null ? null : <p>MWST-Nr.: {invoice.billingVatNumberSnapshot}</p>}
            {invoice.paidAt === null ? null : <p className="mt-2 text-emerald-700">Bezahlt am {formatDate(invoice.paidAt)}</p>}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="text-muted-foreground"><tr><th className="pb-2">Position</th><th className="pb-2 text-right">Menge</th><th className="pb-2 text-right">Einzel netto</th><th className="pb-2 text-right">MWST</th><th className="pb-2 text-right">Total</th></tr></thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr key={line.id} className="border-t">
                  <td className="py-3">{line.descriptionSnapshot}</td>
                  <td className="py-3 text-right tabular-nums">{line.quantity}</td>
                  <td className="py-3 text-right tabular-nums">{formatChfFromRappen(line.unitNetRappen)}</td>
                  <td className="py-3 text-right tabular-nums">{formatChfFromRappen(line.vatRappen)} ({(line.taxRateBasisPoints / 100).toLocaleString("de-CH")} %)</td>
                  <td className="py-3 text-right font-medium tabular-nums">{formatChfFromRappen(line.totalRappen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="ml-auto grid w-full max-w-sm gap-2 text-sm">
          <TotalRow label="Netto" value={invoice.netTotalRappen} />
          <TotalRow label="MWST" value={invoice.vatTotalRappen} />
          <TotalRow label="Total inkl. MWST" value={invoice.totalRappen} strong />
        </dl>
      </CardContent>
    </Card>
  );
}

function TotalRow({ label, value, strong = false }: Readonly<{ label: string; value: number; strong?: boolean }>) {
  return <div className={`flex justify-between gap-4 ${strong ? "border-t pt-3 text-base font-semibold" : ""}`}><dt>{label}</dt><dd className="tabular-nums">{formatChfFromRappen(value)}</dd></div>;
}
function invoiceStatusLabel(status: string) {
  return ({ DRAFT: "Entwurf", ISSUED: "Offen", PAID: "Bezahlt", VOID: "Storniert", OVERDUE: "Überfällig" } as Record<string, string>)[status] ?? status;
}
