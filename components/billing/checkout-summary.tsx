import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CheckoutPreview } from "@/lib/billing/employer-read-model";
import { formatChfFromRappen } from "@/lib/utils/format";

export function CheckoutSummary({ preview }: Readonly<{ preview: CheckoutPreview }>) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle as="h2">{preview.name}</CardTitle>
            <Badge variant="secondary">Mock</Badge>
          </div>
          <CardDescription>{preview.description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {preview.transitionLabel === null ? null : (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm">
              {preview.transitionLabel}
            </p>
          )}
          {preview.planLimits === null ? null : (
            <div className="rounded-lg border p-3">
              <h3 className="font-medium">Gespeicherte Ziel-Limiten</h3>
              <ul className="mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
                <li>{preview.planLimits.activeJobs} aktive Jobs</li>
                <li>{preview.planLimits.seats} Sitzplätze</li>
                <li>{preview.planLimits.talentContacts} Talent-Kontakte</li>
                <li>{preview.planLimits.jobBoosts} inkludierte Boosts</li>
              </ul>
            </div>
          )}
          <dl className="grid gap-2 text-sm">
            {preview.quantity > 1 ? (
              <SummaryRow
                label={`${preview.quantity} × Einzelpreis`}
                value={formatChfFromRappen(preview.unitNetRappen)}
              />
            ) : null}
            <SummaryRow label="Netto" value={formatChfFromRappen(preview.netRappen)} />
            <SummaryRow
              label={`MWST ${(preview.taxRateBasisPoints / 100).toLocaleString("de-CH")} %`}
              value={formatChfFromRappen(preview.vatRappen)}
            />
            <SummaryRow
              label="Total inkl. MWST"
              value={formatChfFromRappen(preview.totalRappen)}
              strong
            />
          </dl>
          <p className="text-xs leading-5 text-muted-foreground">
            Alle Beträge werden serverseitig in Rappen berechnet. Die MWST wird
            pro Rechnungszeile gerundet. Dies ist ein lokaler Mock-Zahlungsvorgang.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Rechnung an</CardTitle>
          <CardDescription>
            Diese Angaben werden beim Erstellen der Bestellung unveränderlich gespeichert.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {preview.profile === null ? null : (
            <address className="not-italic leading-6">
              <strong>{preview.profile.legalName}</strong>
              <br />
              {preview.profile.street}
              <br />
              {preview.profile.postalCode} {preview.profile.city}
              <br />
              Schweiz
              <br />
              <span className="text-muted-foreground">
                {preview.profile.billingContactEmail}
              </span>
            </address>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  strong = false,
}: Readonly<{ label: string; value: string; strong?: boolean }>) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${strong ? "border-t pt-3 text-base" : ""}`}>
      <dt className={strong ? "font-semibold" : "text-muted-foreground"}>{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
