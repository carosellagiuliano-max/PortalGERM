import type { Metadata } from "next";
import Link from "@/components/shared/app-link";

import { Badge } from "@/components/ui/badge";
import { getRedactedOperationsOverview } from "@/lib/admin/operations-read";
import { listOpenSystemTasks } from "@/lib/admin/system-governance";
import { requireAdminCapabilityPage } from "@/lib/auth/route-guards";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { getNotificationDeliverySummary } from "@/lib/notifications/admin-read";
import { getRedactedDocumentVaultSummary } from "@/lib/documents/admin-read";
import { resolveDocumentRuntime } from "@/lib/documents/runtime-policy";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Systemstatus" };

export default async function AdminSystemPage() {
  const admin = await requireAdminCapabilityPage([
    "ADMIN_COCKPIT_READ",
    "ADMIN_OPS_READ",
  ]);
  const now = new Date();
  const database = getDatabase();
  const dependencies = {
    actor: {
      userId: admin.id,
      email: admin.email,
      role: admin.role,
      status: admin.status,
      capabilities: admin.capabilities,
    },
    correlationId: "admin-system-read",
    database,
    now,
  } as const;
  const [tasks, delivery, documents, operations] = await Promise.all([
    listOpenSystemTasks(dependencies),
    getNotificationDeliverySummary(dependencies),
    getRedactedDocumentVaultSummary(dependencies),
    getRedactedOperationsOverview(dependencies),
  ]);
  if (
    tasks === null ||
    delivery === null ||
    documents === null ||
    operations === null
  )
    return null;
  const environment = getServerEnvironment();
  const documentRuntime = resolveDocumentRuntime(environment);

  const overdue = tasks.filter((task) => task.dueAt <= now).length;
  return (
    <div className="grid min-w-0 gap-8" data-e2e-phase23-ops="true">
      <header>
        <p className="eyebrow">Operations</p>
        <h1 className="mt-2 text-3xl font-semibold">Systemstatus</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Redigierte Betriebsübersicht für Queue, Worker und Provider-Ledger.
          Sie ersetzt kein externes Monitoring, keinen Incident Owner und keine
          Produktionsfreigabe.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <StatusCard label="Liveness" value="HTTP-Prüfung" href="/health/live" />
        <StatusCard
          label="Readiness"
          value="DB + Migration"
          href="/health/ready"
        />
        <article className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Systemaufgaben</p>
          <p className="mt-2 text-2xl font-semibold">{tasks.length} offen</p>
          <p className="mt-1 text-sm">{overdue} überfällig</p>
        </article>
      </section>

      <section aria-labelledby="worker-runtime-heading">
        <h2 id="worker-runtime-heading" className="text-xl font-semibold">
          Worker Runtime
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Runtime {environment.WORKER_RUNTIME}; Umgebung{" "}
          {operations.environment}. Payloads, Subjects, Secrets und freie
          Fehlertexte werden nicht angezeigt. Alle Mutationen bleiben bis Phase
          25 ausserhalb der Local/CI-CLI gesperrt.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            "PENDING",
            "LEASED",
            "RETRY",
            "PAUSED",
            "SUCCEEDED",
            "DEAD_LETTER",
          ].map((status) => (
            <article className="rounded-lg border bg-card p-4" key={status}>
              <p className="text-sm text-muted-foreground">{status}</p>
              <p className="mt-2 text-2xl font-semibold">
                {operations.queue.statuses[status] ?? 0}
              </p>
            </article>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Älteste offene Arbeit:{" "}
          {operations.queue.oldestOpenAt === null
            ? "keine"
            : formatDateTime(operations.queue.oldestOpenAt)}
        </p>

        <div className="mt-6 grid gap-3 lg:grid-cols-2">
          <article className="rounded-lg border bg-card p-4">
            <h3 className="font-medium">Letzte Worker-Läufe</h3>
            {operations.workerRuns.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Noch kein Worker-Lauf in dieser Umgebung.
              </p>
            ) : (
              <ul className="mt-3 grid gap-3">
                {operations.workerRuns.map((run) => (
                  <li className="rounded-md border p-3 text-sm" key={run.id}>
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <strong>{run.workerId}</strong>
                      <Badge variant="outline">{run.status}</Badge>
                    </span>
                    <span className="mt-1 block text-muted-foreground">
                      Build {run.deploymentDigest} · Heartbeat{" "}
                      {formatDateTime(run.heartbeatAt)}
                    </span>
                    <span className="mt-1 block">
                      {run.claimedCount} Claims · {run.succeededCount}{" "}
                      erfolgreich · {run.failedCount} fehlgeschlagen
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="rounded-lg border bg-card p-4">
            <h3 className="font-medium">Dead Letter Queue</h3>
            {operations.deadLetters.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Keine terminalen Work Items.
              </p>
            ) : (
              <ul className="mt-3 grid gap-3">
                {operations.deadLetters.map((letter) => (
                  <li className="rounded-md border p-3 text-sm" key={letter.id}>
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <strong>
                        {letter.workItem.handlerKey}{" "}
                        {letter.workItem.handlerVersion}
                      </strong>
                      <Badge variant="destructive">DLQ</Badge>
                    </span>
                    <span className="mt-1 block text-muted-foreground">
                      {letter.failureClass} / {letter.reasonCode} · Attempt{" "}
                      {letter.terminalAttempt} ·{" "}
                      {formatDateTime(letter.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </div>
      </section>

      <section aria-labelledby="handler-ledger-heading">
        <h2 id="handler-ledger-heading" className="text-xl font-semibold">
          Handler-Aktivierungsledger
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {operations.handlerActivations.map((activation) => (
            <article
              className="rounded-lg border bg-card p-4"
              key={activation.id}
            >
              <span className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">
                  {activation.handlerKey} {activation.handlerVersion}
                </h3>
                <Badge
                  variant={
                    activation.killSwitchEngaged ? "destructive" : "outline"
                  }
                >
                  {activation.killSwitchEngaged
                    ? "KILL SWITCH"
                    : activation.mode}
                </Badge>
              </span>
              <p className="mt-2 text-sm text-muted-foreground">
                Owner {activation.owner} · Batch {activation.batchSize} ·
                Parallelität {activation.maxConcurrency}
              </p>
              <p className="mt-1 break-words text-xs text-muted-foreground">
                Runbook: {activation.runbookRef}
              </p>
            </article>
          ))}
          {operations.absentHandlers.map((handler) => (
            <article
              className="min-w-0 rounded-lg border border-dashed p-4"
              key={`${handler.handlerKey}:${handler.handlerVersion}`}
            >
              <span className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <h3 className="min-w-0 font-medium [overflow-wrap:anywhere]">
                  {handler.handlerKey} {handler.handlerVersion}
                </h3>
                <Badge variant="outline">DISABLED</Badge>
              </span>
              <p className="mt-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {handler.owner} · {handler.execution}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Provider-Grenzen</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Kein Provider wird implizit aktiviert und es gibt keinen
          Real→Mock-Fallback. Der E-Mail-Adapter bleibt ohne externe Freigaben
          höchstens Sandbox.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <article className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium">E-Mail</h3>
              <Badge variant="outline">
                {environment.EMAIL_PROVIDER_MODE === "disabled"
                  ? "DISABLED"
                  : "SANDBOX"}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Provider {environment.EMAIL_PROVIDER_MODE}; Dispatch{" "}
              {environment.NOTIFICATION_DISPATCH}. Keine LIVE-Zustellung und
              kein autonomer Worker werden behauptet.
            </p>
          </article>
          <article className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium">Dokumenten-Vault</h3>
              <Badge variant="outline">
                {documentRuntime.available ? "SANDBOX" : "DISABLED"}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Storage {environment.DOCUMENT_STORAGE_MODE}; Scanner{" "}
              {environment.DOCUMENT_SCANNER_MODE}; Clean Reads{" "}
              {environment.DOCUMENT_CLEAN_READS ? "TEST" : "OFF"}. Kein
              LIVE-Provider und kein Real→Mock-Fallback.
            </p>
          </article>
          {operations.providerActivations.map((activation) => (
            <article
              className="rounded-lg border bg-card p-4"
              key={activation.id}
            >
              <div className="flex min-w-0 items-center justify-between gap-3">
                <h3 className="min-w-0 font-medium [overflow-wrap:anywhere]">
                  {activation.useCase}
                </h3>
                <Badge
                  variant={
                    activation.killSwitchEngaged ? "destructive" : "outline"
                  }
                >
                  {activation.killSwitchEngaged
                    ? "KILL SWITCH"
                    : activation.mode}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {activation.adapterKey} {activation.adapterVersion} ·{" "}
                {activation.health} · Owner {activation.owner}
              </p>
              <p className="mt-1 break-words text-xs text-muted-foreground">
                Runbook: {activation.runbookRef}
              </p>
            </article>
          ))}
          {operations.providerActivations.length === 0 ? (
            <article className="rounded-lg border border-dashed p-4 sm:col-span-2">
              <Badge variant="outline">DISABLED</Badge>
              <p className="mt-2 text-sm text-muted-foreground">
                In dieser Umgebung existiert keine aktuelle
                Provider-Aktivierung. Konfiguration allein aktiviert nichts.
              </p>
            </article>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="capacity-heading">
        <h2 id="capacity-heading" className="text-xl font-semibold">
          Kapazität und Backpressure
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Nur aggregierte Queuewerte; keine individuelle Mitarbeitendenleistung.
          Ohne gemessene Samples bleibt die Produktionskapazität unbewiesen.
        </p>
        {operations.capacitySamples.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            Noch keine Kapazitätsmessung für diese Umgebung.
          </p>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {operations.capacitySamples.map((sample) => (
              <li
                className="rounded-lg border bg-card p-4"
                key={`${sample.handlerKey}:${sample.handlerVersion}`}
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <strong>
                    {sample.handlerKey} {sample.handlerVersion}
                  </strong>
                  <Badge
                    variant={
                      sample.state === "PAUSED" ? "destructive" : "outline"
                    }
                  >
                    {sample.state}
                  </Badge>
                </span>
                <span className="mt-2 block text-sm text-muted-foreground">
                  p95 Arrival {sample.arrivalP95PerMinute.toFixed(2)}/min ·
                  nachhaltig {sample.sustainablePerMinute.toFixed(2)}/min ·
                  Auslastung {(sample.utilizationBasisPoints / 100).toFixed(1)}{" "}
                  %
                </span>
                <span className="mt-1 block text-sm">
                  Backlog {sample.backlogCount} · ältestes Item{" "}
                  {Math.round(sample.oldestAgeMilliseconds / 1_000)} s
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Unit Cost{" "}
                  {sample.unitCostMicros === null
                    ? "unbekannt"
                    : `${sample.unitCostMicros.toString()} µCHF`}{" "}
                  · {sample.unitCostSource ?? "keine Quelle"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="document-vault-heading">
        <h2 id="document-vault-heading" className="text-xl font-semibold">
          Dokumenten-Vault (redigiert)
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Ausschliesslich Zustandszähler. Dateinamen, Object Keys, Hashes,
          Scannerpayloads und Inhalte werden hier nicht ausgegeben.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">
              Aktive Upload-Intents
            </p>
            <p className="mt-2 text-2xl font-semibold">
              {documents.pendingIntents}
            </p>
          </article>
          {Object.entries(documents.statuses).map(([status, count]) => (
            <article className="rounded-lg border bg-card p-4" key={status}>
              <p className="text-sm text-muted-foreground">{status}</p>
              <p className="mt-2 text-2xl font-semibold">{count}</p>
            </article>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <article className="rounded-lg border bg-card p-4">
            <h3 className="font-medium">Scanner-Outcomes</h3>
            <ul className="mt-2 grid gap-1 text-sm text-muted-foreground">
              {Object.entries(documents.scanOutcomes).length === 0 ? (
                <li>Keine Scan-Evidenz.</li>
              ) : (
                Object.entries(documents.scanOutcomes).map(
                  ([outcome, count]) => (
                    <li key={outcome}>
                      {outcome}: {count}
                    </li>
                  ),
                )
              )}
            </ul>
          </article>
          <article className="rounded-lg border bg-card p-4">
            <h3 className="font-medium">Reconciliation-Outcomes</h3>
            <ul className="mt-2 grid gap-1 text-sm text-muted-foreground">
              {documents.lifecycle.length === 0 ? (
                <li>Noch kein Command-Lauf.</li>
              ) : (
                documents.lifecycle.map((item) => (
                  <li key={`${item.kind}:${item.status}`}>
                    {item.kind} / {item.status}: {item.count}
                  </li>
                ))
              )}
            </ul>
          </article>
        </div>
      </section>

      <section aria-labelledby="notification-delivery-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="notification-delivery-heading"
            className="text-xl font-semibold"
          >
            Benachrichtigungszustellung
          </h2>
          <Link
            className="text-sm font-medium text-primary"
            href="/admin/system/notification-reconciliation"
          >
            Unklare Provider-Outcomes abgleichen →
          </Link>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Redigierte Zähler ohne Empfänger, Payload, Token oder Template-Inhalt.
          Production-Replay bleibt bis zum Phase-25-Step-up gesperrt.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Object.entries(delivery.statuses).map(([status, count]) => (
            <article className="rounded-lg border bg-card p-4" key={status}>
              <p className="text-sm text-muted-foreground">
                {deliveryStatusLabel(status)}
              </p>
              <p className="mt-2 text-2xl font-semibold">{count}</p>
            </article>
          ))}
          <article className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Hard Bounces</p>
            <p className="mt-2 text-2xl font-semibold">{delivery.bounced}</p>
          </article>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Älteste offene Nachricht:{" "}
          {delivery.oldestQueuedAt === null
            ? "keine"
            : formatDateTime(delivery.oldestQueuedAt)}
        </p>
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Offene Systemaufgaben</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Outcomes werden im Business Cockpit auditierbar abgeschlossen.
            </p>
          </div>
          <Link
            className="text-sm font-medium text-primary"
            href="/admin/business-cockpit"
          >
            Cockpit öffnen →
          </Link>
        </div>
        {tasks.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Keine offenen Systemaufgaben.
          </p>
        ) : (
          <ul className="mt-4 grid gap-3">
            {tasks.map((task) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4"
                key={task.id}
              >
                <span>
                  <strong>{task.kind}</strong> · {task.reasonCode}
                  <span className="block text-sm text-muted-foreground">
                    {task.company?.name ?? "Plattform"} ·{" "}
                    {task.owner?.name ?? "nicht zugewiesen"}
                  </span>
                </span>
                <span className="text-sm">
                  <Badge
                    variant={task.dueAt <= now ? "destructive" : "outline"}
                  >
                    {task.status}
                  </Badge>{" "}
                  fällig {formatDateTime(task.dueAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        Reales Staging, Pager/Incident Owner, automatische Backup-Retention,
        bestätigte SLO/RPO/RTO und ein auf demselben Artefaktdigest gelaufener
        Gesamtdrill bleiben separate Go-live-Gates.
      </section>
    </div>
  );
}

function deliveryStatusLabel(status: string) {
  return (
    {
      PENDING: "Ausstehend",
      LEASED: "In Verarbeitung",
      RETRY: "Wiederholung geplant",
      DELIVERED: "Angenommen",
      SUPPRESSED: "Unterdrückt / Bounce",
      DEAD_LETTER: "DLQ",
      PAUSED: "Provider degradiert / pausiert",
    }[status] ?? status
  );
}

function StatusCard({
  href,
  label,
  value,
}: Readonly<{ href: string; label: string; value: string }>) {
  return (
    <article className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold">{value}</p>
      <Link
        className="mt-3 inline-block text-sm font-medium text-primary"
        href={href}
      >
        Endpoint prüfen →
      </Link>
    </article>
  );
}
