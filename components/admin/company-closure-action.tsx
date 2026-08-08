import { randomUUID } from "node:crypto";

import {
  AdminActionForm,
  adminInputClass,
} from "@/components/admin/action-form";
import { formatDateTime } from "@/lib/utils/format";

type CompanyClosureBlocker = Readonly<{
  status: string;
  currentPeriodEnd: Date;
}>;

export function CompanyClosureAction({
  companyId,
  blockingSubscription,
}: Readonly<{
  companyId: string;
  blockingSubscription: CompanyClosureBlocker | null;
}>) {
  if (blockingSubscription !== null) {
    return (
      <p
        role="status"
        className="rounded-lg border border-amber-500/60 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/20 dark:text-amber-100"
      >
        Der endgültige Abschluss ist gesperrt: Das bezahlte Abo mit Status {" "}
        {blockingSubscription.status} läuft bis {" "}
        {formatDateTime(blockingSubscription.currentPeriodEnd)}. Kläre zuerst
        Kündigung, Leistung und Abrechnung im Billing.
      </p>
    );
  }

  return (
    <AdminActionForm
      operation="company-close"
      label="Firma endgültig schliessen"
      destructive
      className="border-destructive/50"
      hidden={{
        companyId,
        expectedStatus: "SUSPENDED",
        idempotencyKey: randomUUID(),
      }}
    >
      <p className="text-sm text-muted-foreground">
        Dieser Status ist endgültig. Profile, Nachweise und Auditdaten bleiben
        zur Nachvollziehbarkeit erhalten; veröffentlichte Jobs werden sicher
        pausiert.
      </p>
      <label className="grid gap-1 text-sm">
        Pflichtgrund
        <input
          name="reasonCode"
          defaultValue="COMPANY_OFFBOARDING_COMPLETED"
          pattern="[A-Z][A-Z0-9_]{1,63}"
          required
          className={adminInputClass}
        />
      </label>
      <label className="grid gap-1 text-sm">
        Zur Bestätigung FIRMA_SCHLIESSEN eingeben
        <input
          name="confirmationCode"
          pattern="FIRMA_SCHLIESSEN"
          autoComplete="off"
          required
          className={adminInputClass}
        />
      </label>
    </AdminActionForm>
  );
}
