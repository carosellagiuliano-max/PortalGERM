import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { EmployerBillingUsage } from "@/lib/billing/employer-read-model";
import { formatDate } from "@/lib/utils/format";

export function CreditSourceOverview({
  usage,
}: Readonly<{ usage: EmployerBillingUsage }>) {
  const expiringSoon = usage.purchasedAndGranted.some(
    (credit) => credit.expiringSoon,
  );
  return (
    <section aria-labelledby="credit-sources-title" className="grid gap-5">
      <div>
        <h2 id="credit-sources-title" className="text-xl font-semibold">
          Guthaben nach Finanzierungsquelle
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Plan-Kontingente, gekaufte Packs und Admin-Gutschriften werden getrennt
          ausgewiesen und nie zu einem irreführenden Gesamtlimit vermischt.
        </p>
      </div>
      {expiringSoon ? (
        <Alert>
          <AlertTitle>Zusätzliches Guthaben läuft bald ab</AlertTitle>
          <AlertDescription>
            Mindestens ein gekauftes Pack oder eine Admin-Gutschrift läuft innerhalb
            der nächsten 30 Tage ab. Das genaue Datum steht bei der jeweiligen Quelle.
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <IncludedCreditCard
          label="Talent-Radar-Kontakte in dieser Planperiode"
          usage={usage.includedContacts}
        />
        <IncludedCreditCard
          label="Inkludierte Job Boosts in dieser Planperiode"
          usage={usage.includedBoosts}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle as="h3">Gekaufte Packs und Admin-Gutschriften</CardTitle>
          <CardDescription>
            Jede aktive Quelle behält ihren eigenen Typ, Restbestand und Ablauf.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {usage.purchasedAndGranted.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Keine zusätzlichen aktiven Guthaben.
            </p>
          ) : (
            <ul className="grid gap-3">
              {usage.purchasedAndGranted.map((credit) => (
                <li
                  key={credit.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div>
                    <p className="font-medium">{creditTypeLabel(credit.creditType)}</p>
                    <p className="text-xs text-muted-foreground">
                      {credit.fundingSource === "PURCHASED_PACK"
                        ? "Gekauftes Pack"
                        : "Admin-Gutschrift"}
                      {" · gültig bis "}
                      {formatDate(credit.validTo)}
                    </p>
                  </div>
                  <p className="font-semibold tabular-nums">
                    {credit.remaining} verfügbar
                  </p>
                  {credit.expiringSoon ? (
                    <p className="w-full text-xs font-medium text-amber-700">
                      Läuft innerhalb der nächsten 30 Tage ab.
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 grid gap-2 rounded-lg bg-muted p-3 text-sm sm:grid-cols-2">
            <p>
              Aktuell finanzierbare Talent-Kontakte:{" "}
              <strong>{usage.totalFundable.talentContacts}</strong>
            </p>
            <p>
              Aktuell finanzierbare Job Boosts:{" "}
              <strong>{usage.totalFundable.jobBoosts}</strong>
            </p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h3">Letzte Guthabenbewegungen</CardTitle>
          <CardDescription>
            Unveränderliche Ledger-Historie, neueste Einträge zuerst.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {usage.ledgerHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Noch keine Guthabenbewegungen.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] text-left text-sm">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="pb-2">Datum</th>
                    <th className="pb-2">Typ</th>
                    <th className="pb-2">Quelle</th>
                    <th className="pb-2">Bewegung</th>
                    <th className="pb-2 text-right">Menge</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.ledgerHistory.map((entry) => (
                    <tr key={entry.id} className="border-t">
                      <td className="py-3">{formatDate(entry.createdAt)}</td>
                      <td className="py-3">{creditTypeLabel(entry.creditType)}</td>
                      <td className="py-3">{fundingLabel(entry.fundingSource)}</td>
                      <td className="py-3">{ledgerKindLabel(entry.kind)}</td>
                      <td className="py-3 text-right font-medium tabular-nums">
                        {entry.amount > 0 ? "+" : ""}
                        {entry.amount}
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

function IncludedCreditCard({
  label,
  usage,
}: Readonly<{
  label: string;
  usage: Readonly<{ used: number; remaining: number; granted: number }>;
}>) {
  const percent = usage.granted > 0
    ? Math.min(100, Math.round((usage.used / usage.granted) * 100))
    : 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3">{label}</CardTitle>
        <CardDescription>Inkludiertes aktuelles Periodenkontingent</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <Progress
          value={percent}
          aria-label={`${label}: ${usage.used} von ${usage.granted} verwendet`}
        >
          <span className="text-sm font-medium">Verwendet</span>
          <span className="ml-auto text-sm text-muted-foreground tabular-nums">
            {usage.used} / {usage.granted}
          </span>
        </Progress>
        <p className="text-muted-foreground">
          Noch {usage.remaining} inkludiert verfügbar.
        </p>
      </CardContent>
    </Card>
  );
}

function creditTypeLabel(value: string) {
  return value === "TALENT_CONTACT"
    ? "Talent-Kontakt"
    : value === "JOB_BOOST"
      ? "Job Boost"
      : value;
}

function fundingLabel(value: string) {
  return (
    {
      PLAN_ALLOWANCE: "Plan",
      PURCHASED_PACK: "Pack",
      ADMIN_GRANT: "Admin",
    } as Record<string, string>
  )[value] ?? value;
}

function ledgerKindLabel(value: string) {
  return (
    {
      GRANT: "Gutschrift",
      CONSUME: "Verwendet",
      EXPIRE: "Abgelaufen",
      REVERSAL: "Korrektur",
    } as Record<string, string>
  )[value] ?? value;
}
