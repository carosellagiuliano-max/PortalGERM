import { randomUUID } from "node:crypto";

import type { Metadata } from "next";

import { reconcileNotificationProviderOutcomeAction } from "@/app/admin/system/notification-reconciliation/actions";
import { StepUpGrantControl } from "@/components/security/step-up-grant-control";
import { Badge } from "@/components/ui/badge";
import { requireAdminCapabilityPage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import { listNotificationOutcomeReconciliationCases } from "@/lib/notifications/outcome-reconciliation";
import {
  notificationOutcomeReconciliationStepUpAction,
  type NotificationOutcomeReconciliationResolution,
} from "@/lib/notifications/outcome-reconciliation-policy";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = {
  title: "E-Mail-Ausgänge abgleichen",
};

export default async function NotificationOutcomeReconciliationPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ result?: string }> }>) {
  const [admin, query] = await Promise.all([
    requireAdminCapabilityPage(["ADMIN_OPS_READ", "ADMIN_SYSTEM_TASK_MANAGE"]),
    searchParams,
  ]);
  const now = new Date();
  const cases = await listNotificationOutcomeReconciliationCases({
    actor: {
      capabilities: admin.capabilities,
      email: admin.email,
      role: admin.role,
      status: admin.status,
      userId: admin.id,
    },
    correlationId: "notification-reconciliation-read",
    database: getDatabase(),
    now,
  });
  if (cases === null) return null;

  return (
    <div className="grid min-w-0 gap-6">
      <header>
        <p className="eyebrow">Operations · Provider Evidence</p>
        <h1 className="mt-2 text-3xl font-semibold">
          Unklare E-Mail-Ausgänge abgleichen
        </h1>
        <p className="mt-2 max-w-4xl text-muted-foreground">
          Hier erscheinen ausschließlich Sendungen, deren letzter, begrenzter
          Provider-Versuch kein autoritatives Ergebnis lieferte. Keine Aktion
          erzeugt neue Inhalte oder eine neue Effect-ID. Ohne extern belegte
          Entscheidung bleibt die Sendung pausiert.
        </p>
      </header>

      {query.result ? (
        <p className="rounded-lg border bg-card p-3 text-sm" role="status">
          Ergebnis: <strong>{resultLabel(query.result)}</strong>
        </p>
      ) : null}

      <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
        <strong>Vier-Augen-Evidence außerhalb der Plattform prüfen:</strong>{" "}
        Nutze Provider-Dashboard oder signierten Supportbeleg. Speichere hier
        nur dessen SHA-256-Digest und eine nicht sensible Ticket-/Belegreferenz.
        „Angenommen“ sendet nie erneut; „definitiv nicht angenommen“ gibt nur
        den unveränderten, noch nicht abgelaufenen Request frei.
      </section>

      {cases.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Keine Ausgänge warten auf diesen exakten Abgleich.
        </p>
      ) : (
        <ul className="grid gap-5">
          {cases.map((item) => (
            <li
              className="grid gap-4 rounded-lg border bg-card p-4"
              key={item.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">Outbox {item.id}</p>
                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                    Effect {item.providerDedupeKey}
                  </p>
                </div>
                <Badge
                  variant={
                    item.materialState === "AVAILABLE"
                      ? "outline"
                      : "destructive"
                  }
                >
                  Material {item.materialState}
                </Badge>
              </div>
              <dl className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
                <Evidence
                  label="Provider"
                  value={item.providerClass ?? "unbekannt"}
                />
                <Evidence label="Zweck" value={item.purpose} />
                <Evidence label="Versuche" value={String(item.attemptCount)} />
                <Evidence
                  label="Pausiert"
                  value={formatDateTime(item.pausedAt)}
                />
                <Evidence
                  label="Material gültig bis"
                  value={
                    item.materialExpiresAt === null
                      ? "keine gültige Frist"
                      : formatDateTime(item.materialExpiresAt)
                  }
                />
                <Evidence
                  label="Activation-ID"
                  value={item.providerActivationId ?? "fehlt"}
                />
                <Evidence
                  label="Request-Digest"
                  value={item.providerRequestDigest ?? "fehlt"}
                />
              </dl>

              {item.materialState === "AVAILABLE" ? (
                <div className="grid gap-4 xl:grid-cols-3">
                  <ResolutionForm
                    outboxId={item.id}
                    resolution="ACCEPTED"
                    title="Provider hat angenommen"
                  />
                  <ResolutionForm
                    outboxId={item.id}
                    resolution="DEFINITIVELY_NOT_ACCEPTED"
                    title="Provider hat sicher nicht angenommen"
                  />
                  <ResolutionForm
                    outboxId={item.id}
                    resolution="UNKNOWN"
                    title="Weiterhin unbekannt"
                  />
                </div>
              ) : (
                <p className="text-sm text-destructive" role="alert">
                  Das eingefrorene Request-Material ist nicht mehr verfügbar.
                  Der Pfad bleibt absichtlich fail-closed; es darf weder ein
                  neuer Inhalt noch eine neue Effect-ID erzeugt werden.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResolutionForm({
  outboxId,
  resolution,
  title,
}: Readonly<{
  outboxId: string;
  resolution: NotificationOutcomeReconciliationResolution;
  title: string;
}>) {
  const action = notificationOutcomeReconciliationStepUpAction(resolution);
  return (
    <form
      action={reconcileNotificationProviderOutcomeAction}
      className="grid content-start gap-3 rounded-lg border p-3"
    >
      <h2 className="font-medium">{title}</h2>
      <input name="outboxId" type="hidden" value={outboxId} />
      <input name="resolution" type="hidden" value={resolution} />
      <input name="idempotencyKey" type="hidden" value={randomUUID()} />
      <label className="grid gap-1 text-sm">
        Evidence-Referenz
        <input
          className="h-10 rounded-md border bg-background px-3"
          name="evidenceReference"
          placeholder="incident:INC-1234"
          required
        />
      </label>
      <label className="grid gap-1 text-sm">
        SHA-256 des Belegs
        <input
          className="h-10 rounded-md border bg-background px-3 font-mono text-xs"
          inputMode="text"
          maxLength={64}
          minLength={64}
          name="evidenceDigest"
          pattern="[a-f0-9]{64}"
          placeholder="64 Kleinbuchstaben/Ziffern"
          required
        />
      </label>
      {resolution === "ACCEPTED" ? (
        <label className="grid gap-1 text-sm">
          Provider-Receipt
          <input
            className="h-10 rounded-md border bg-background px-3 font-mono text-xs"
            name="providerReceipt"
            required
          />
        </label>
      ) : null}
      <label className="grid gap-1 text-sm">
        Grundcode
        <input
          className="h-10 rounded-md border bg-background px-3 font-mono text-xs"
          defaultValue={reasonCodeForResolution(resolution)}
          name="reasonCode"
          pattern="[A-Z][A-Z0-9_]{1,63}"
          required
        />
      </label>
      <StepUpGrantControl
        action={action}
        purpose="NOTIFICATION_RECONCILIATION"
        resourceId={outboxId}
        securityHref="/admin/security/authenticators"
      />
      <button
        className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        type="submit"
      >
        Resolution verbindlich anwenden
      </button>
    </form>
  );
}

function Evidence({
  label,
  value,
}: Readonly<{ label: string; value: string }>) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="break-all font-mono text-xs">{value}</dd>
    </div>
  );
}

function reasonCodeForResolution(
  resolution: NotificationOutcomeReconciliationResolution,
) {
  return resolution === "ACCEPTED"
    ? "PROVIDER_ACCEPTANCE_VERIFIED"
    : resolution === "DEFINITIVELY_NOT_ACCEPTED"
      ? "PROVIDER_REJECTION_VERIFIED"
      : "PROVIDER_OUTCOME_STILL_UNKNOWN";
}

function resultLabel(value: string) {
  const labels: Record<string, string> = {
    ACCEPTED: "Als angenommen terminalisiert; keine zweite Sendewirkung.",
    DEFINITIVELY_NOT_ACCEPTED:
      "Unveränderter Request zur idempotenten Wiederholung freigegeben.",
    UNKNOWN: "Evidence protokolliert; Ausgang bleibt pausiert.",
    FORBIDDEN: "Berechtigung verweigert.",
    STEP_UP_REQUIRED: "Frische, exakt gebundene Sicherheitsbestätigung fehlt.",
    CONFLICT: "Zustand oder Evidence hat sich geändert.",
    PROVIDER_CONTRACT_UNAVAILABLE:
      "Aktueller Provider-Aktivierungsvertrag ist nicht verwendbar.",
    MATERIAL_EXPIRED: "Das 23-Stunden-Fenster ist abgelaufen.",
    MATERIAL_INVALID:
      "Das eingefrorene Material ist unvollständig oder ungültig.",
    WRITE_FAILED: "Der atomare Abgleich ist fehlgeschlagen.",
    INVALID_INPUT: "Eingaben sind ungültig.",
    NOT_FOUND: "Ausgang wurde nicht gefunden.",
  };
  return labels[value] ?? value;
}
