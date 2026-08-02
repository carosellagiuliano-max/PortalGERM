import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PrivacyCaseActionForm } from "@/components/admin/privacy-case-action-form";
import { StepUpGrantControl } from "@/components/security/step-up-grant-control";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  hasAdminCapability,
  PHASE_14_PRIVACY_ADMIN_CAPABILITIES,
} from "@/lib/admin/capabilities";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import { createPostgresPrivacyCaseService } from "@/lib/privacy/privacy-case-service";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Datenschutzfall" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

const INPUT_CLASS =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm";
const TEXTAREA_CLASS =
  "min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm";

export default async function AdminPrivacyRequestDetailPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<{ justification?: string }>;
}>) {
  const [{ id }, query, admin] = await Promise.all([
    params,
    searchParams,
    requireAdminPage(),
  ]);
  const actor = {
    userId: admin.id,
    capabilities: PHASE_14_PRIVACY_ADMIN_CAPABILITIES.filter((capability) =>
      hasAdminCapability(
        {
          userId: admin.id,
          role: admin.role,
          status: admin.status,
          capabilities: admin.capabilities,
        },
        capability,
      ),
    ),
  } as const;
  const service = createPostgresPrivacyCaseService(getDatabase());
  const detail = await service.getAdminDetail(
    actor,
    {
      requestId: id,
      ...(query.justification === undefined
        ? {}
        : { justificationCode: query.justification }),
    },
    new Date(),
  );
  if (!detail.ok) notFound();
  const privacyCase = detail.privacyCase;
  const executions = await getDatabase().privacyExecution.findMany({
    where: { privacyRequestId: privacyCase.id },
    orderBy: { createdAt: "desc" },
    include: {
      processorOutcomes: { orderBy: { processorKey: "asc" } },
      erasureProofs: { orderBy: [{ processorKey: "asc" }, { entityKey: "asc" }] },
    },
  });
  const executionApprovals = await getDatabase().privilegedApproval.findMany({
    where: {
      kind: "PRIVACY",
      targetType: "PRIVACY_REQUEST",
      targetId: privacyCase.id,
      status: { in: ["PENDING", "CONSUMED"] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const activeApproval = executionApprovals[0] ?? null;
  const canProcess = hasAdminCapability(
    {
      userId: admin.id,
      role: admin.role,
      status: admin.status,
      capabilities: admin.capabilities,
    },
    "PRIVACY_CASE_PROCESS",
  );
  const canApprove = hasAdminCapability(
    {
      userId: admin.id,
      role: admin.role,
      status: admin.status,
      capabilities: admin.capabilities,
    },
    "PRIVACY_EXECUTION_APPROVE",
  );
  const base = {
    requestId: privacyCase.id,
    version: privacyCase.version,
  } as const;
  const terminal = ["COMPLETED", "REJECTED", "CANCELLED"].includes(
    privacyCase.status,
  );

  return (
    <div className="grid gap-6">
      <header>
        <div className="flex flex-wrap gap-2">
          <Badge>{privacyCase.type}</Badge>
          <Badge variant="outline">{privacyCase.status}</Badge>
          <Badge variant="secondary">Version {privacyCase.version}</Badge>
        </div>
        <h1 className="mt-3 break-all font-mono text-2xl">{privacyCase.id}</h1>
        <p className="mt-2 text-muted-foreground">
          Erstellt {formatDateTime(privacyCase.createdAt)} · internes Ziel {formatDateTime(privacyCase.dueAt)}
        </p>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="grid gap-5">
          <Card>
            <CardHeader><CardTitle as="h2">Fallkontext</CardTitle></CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <p>Anfragende User-ID: <span className="font-mono">{privacyCase.requesterUserId}</span></p>
              <p>Notice: {privacyCase.noticeVersion}</p>
              <p>Zuweisung: {privacyCase.assignment.assignedAdminUserId ?? "noch nicht zugewiesen"}</p>
              <p>Identität verifiziert: {privacyCase.verification.verifiedAt ? formatDateTime(privacyCase.verification.verifiedAt) : "nein"}</p>
              {privacyCase.verification.challenge ? (
                <p>
                  Challenge: {privacyCase.verification.challenge.attempts}/5 Versuche · gültig bis {formatDateTime(privacyCase.verification.challenge.expiresAt)} · {privacyCase.verification.challenge.verifiedAt ? "Kandidat:in bestätigt" : "offen"}
                </p>
              ) : null}
            </CardContent>
          </Card>

          {executions.map((execution) => (
            <Card key={execution.id}>
              <CardHeader>
                <CardTitle as="h2">
                  Processor-Vollzug · {execution.kind} · {execution.status}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <p>
                  Checkpoint {execution.checkpoint}/{execution.requiredProcessors.length}
                  {" · "}Versuche {execution.attemptCount}
                </p>
                <ol className="grid gap-2">
                  {execution.processorOutcomes.map((outcome) => (
                    <li className="rounded-lg border p-3" key={outcome.id}>
                      <p className="font-medium">
                        {outcome.processorKey} · {outcome.status}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {outcome.outcomeCode ?? "offen"} · Versuch {outcome.attemptCount}
                        {outcome.nextRetryAt ? ` · Retry ${formatDateTime(outcome.nextRetryAt)}` : ""}
                      </p>
                      {outcome.retainedBasisRef ? (
                        <p className="mt-2">Retained-Basis: {outcome.retainedBasisRef}</p>
                      ) : null}
                    </li>
                  ))}
                </ol>
                {execution.erasureProofs.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {execution.erasureProofs.length} append-only Erasure-/Retention-Proofs gespeichert.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))}

          {privacyCase.type === "CORRECT" ? (
            <Card>
              <CardHeader><CardTitle as="h2">Beantragte Korrektur</CardTitle></CardHeader>
              <CardContent className="grid gap-3">
                {privacyCase.correction.fields.map((field) => (
                  <div key={field.fieldCode} className="rounded-lg border p-3">
                    <p className="font-medium">{field.fieldCode}</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm">{field.correctionText}</p>
                  </div>
                ))}
                {privacyCase.correction.outcomeCode ? <p>Ergebnis: {privacyCase.correction.outcomeCode}</p> : null}
                {privacyCase.correction.domainEventRefs.length > 0 ? (
                  <p className="break-all text-xs text-muted-foreground">Domain-Events: {privacyCase.correction.domainEventRefs.join(", ")}</p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {privacyCase.type === "DELETE" ? (
            <Card>
              <CardHeader><CardTitle as="h2">Löschungs- und Retentionsergebnis</CardTitle></CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <p>Abhängigkeiten: {privacyCase.deletion.dependencyCodes.join(", ") || "noch nicht geprüft"}</p>
                <p>Ergebnis: {privacyCase.deletion.outcomeCode ?? "offen"}</p>
                <p className="text-muted-foreground">
                  {executions.some((execution) => execution.kind === "ERASURE")
                    ? "COMPLETED wird nur nach terminalen Processor-Outcomes und append-only Erasure-/Retention-Proofs gesetzt."
                    : "Noch kein realer Phase-22-Vollzug. Ein früheres Assessment allein gilt ausdrücklich nicht als Löschung oder Anonymisierung."}
                </p>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader><CardTitle as="h2">Unveränderlicher Verlauf</CardTitle></CardHeader>
            <CardContent>
              <ol className="grid gap-2">
                {privacyCase.events.map((event, index) => (
                  <li key={`${event.kind}-${event.createdAt.toISOString()}-${index}`} className="rounded-lg border p-3 text-sm">
                    <p className="font-medium">{event.kind} · {event.toStatus}</p>
                    {event.safeNote ? <p className="mt-2 whitespace-pre-wrap">{event.safeNote}</p> : null}
                    <p className="mt-1 text-xs text-muted-foreground">{event.reasonCode ?? "–"} · {formatDateTime(event.createdAt)}</p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <aside className="grid content-start gap-3">
          {privacyCase.status === "PENDING" ? (
            <PrivacyCaseActionForm
              operation="privacy-start-identity"
              {...base}
              idempotencyKey={randomUUID()}
              label="Identitätsprüfung starten"
            />
          ) : null}

          {privacyCase.status === "IDENTITY_CHECK" ? (
            <PrivacyCaseActionForm
              operation="privacy-verify-identity"
              {...base}
              idempotencyKey={randomUUID()}
              label="Bestätigte Identität übernehmen"
            >
              <p className="text-xs text-muted-foreground">
                Nur möglich, nachdem die Kandidatin oder der Kandidat die laufende Challenge im eigenen Konto bestätigt hat.
              </p>
            </PrivacyCaseActionForm>
          ) : null}

          {privacyCase.status === "IN_PROGRESS" &&
          canProcess &&
          activeApproval === null ? (
            <PrivacyCaseActionForm
              operation="privacy-request-execution-approval"
              {...base}
              idempotencyKey={randomUUID()}
              label="Unabhängige Vollzugsfreigabe anfordern"
            >
              <p className="text-xs leading-5 text-muted-foreground">
                Diese Bestätigung ist nur für diesen Fall und die beantragte
                Aktion gültig. Danach muss eine zweite Privacy-Person die
                persistierte Freigabe separat bestätigen; erst dann wird ein
                Worker-Auftrag erzeugt.
              </p>
              <StepUpGrantControl
                action={`PRIVACY_${privacyCase.type}_EXECUTE`}
                purpose="ADMIN_PRIVACY"
                resourceId={privacyCase.id}
                securityHref="/admin/security/authenticators"
              />
            </PrivacyCaseActionForm>
          ) : null}

          {privacyCase.status === "IN_PROGRESS" &&
          activeApproval?.status === "PENDING" &&
          activeApproval.requestedByUserId !== admin.id &&
          canApprove ? (
            <PrivacyCaseActionForm
              operation="privacy-approve-execution"
              {...base}
              idempotencyKey={randomUUID()}
              label="Freigeben und genau einmal einreihen"
            >
              <input
                type="hidden"
                name="approvalId"
                value={activeApproval.id}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Antrag von <span className="font-mono">{activeApproval.requestedByUserId}</span>.
                Selbstfreigabe ist serverseitig ausgeschlossen. Die Freigabe
                verfällt {formatDateTime(activeApproval.expiresAt)}.
              </p>
              <StepUpGrantControl
                action={`PRIVACY_${privacyCase.type}_RELEASE`}
                purpose="ADMIN_PRIVACY"
                resourceId={activeApproval.id}
                securityHref="/admin/security/authenticators"
              />
            </PrivacyCaseActionForm>
          ) : null}

          {privacyCase.status === "IN_PROGRESS" && activeApproval !== null ? (
            <Card>
              <CardHeader>
                <CardTitle as="h2">Persistierte Vollzugsfreigabe</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-xs leading-5 text-muted-foreground">
                <p className="break-all font-mono">{activeApproval.id}</p>
                <p>
                  {activeApproval.status === "CONSUMED"
                    ? "Unabhängig freigegeben und atomar in die Worker-Queue gestellt."
                    : activeApproval.requestedByUserId === admin.id
                      ? "Wartet auf eine zweite unabhängige Privacy-Person. Du kannst den eigenen Antrag nicht freigeben."
                      : "Wartet auf die getrennte Freigabe einer berechtigten Privacy-Person."}
                </p>
              </CardContent>
            </Card>
          ) : null}

          {!terminal ? (
            <PrivacyCaseActionForm
              operation="privacy-reject"
              {...base}
              idempotencyKey={randomUUID()}
              label="Anfrage ablehnen"
              destructive
            >
              <select name="reasonCode" className={INPUT_CLASS} required>
                <option value="IDENTITY_NOT_VERIFIED">Identität nicht verifiziert</option>
                <option value="DUPLICATE">Duplikat</option>
                <option value="OUT_OF_SCOPE">Ausserhalb des Umfangs</option>
                <option value="INSUFFICIENT_INFORMATION">Unzureichende Angaben</option>
                <option value="ABUSIVE_REQUEST">Missbräuchliche Anfrage</option>
              </select>
              <textarea name="safeNote" maxLength={500} className={TEXTAREA_CLASS} placeholder="Optionale sichere Begründung" />
            </PrivacyCaseActionForm>
          ) : null}

          <PrivacyCaseActionForm
            operation="privacy-add-note"
            {...base}
            idempotencyKey={randomUUID()}
            label="Interne Notiz speichern"
          >
            <textarea name="note" maxLength={1000} required className={TEXTAREA_CLASS} placeholder="Nur notwendige interne Information; wird nicht per E-Mail versendet." />
          </PrivacyCaseActionForm>
        </aside>
      </div>
    </div>
  );
}
