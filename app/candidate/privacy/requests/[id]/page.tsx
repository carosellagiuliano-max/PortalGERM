import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PrivacyCaseCancelForm } from "@/components/candidate/privacy-case-cancel-form";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import { getServerEnvironment } from "@/lib/config/env";
import { derivePrivacyExportDownloadToken } from "@/lib/privacy/export-v2";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = {
  title: "Datenschutzfall",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CandidatePrivacyRequestDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const [{ id }, user] = await Promise.all([params, requireCandidatePage()]);
  const privacyCase = await getDatabase().privacyRequest.findFirst({
    where: { id, requesterUserId: user.id },
    select: {
      id: true,
      type: true,
      status: true,
      version: true,
      noticeVersion: true,
      dueAt: true,
      verifiedAt: true,
      completedAt: true,
      rejectionCode: true,
      safeOutcomeNote: true,
      correctionOutcome: true,
      domainEventRefs: true,
      deletionDependencies: true,
      deletionOutcome: true,
      exportManifest: true,
      exportManifestChecksum: true,
      exportExpiresAt: true,
      exportArtifacts: {
        where: { status: "READY" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          ownerUserId: true,
          encryptionKeyVersion: true,
          expiresAt: true,
          manifestHash: true,
          sizeBytes: true,
        },
      },
      createdAt: true,
      correctionFields: {
        orderBy: { fieldCode: "asc" },
        select: { fieldCode: true, correctionText: true, reviewedAt: true },
      },
      events: {
        where: { kind: { not: "NOTE_ADDED" } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          kind: true,
          toStatus: true,
          reasonCode: true,
          createdAt: true,
        },
      },
      challenges: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          expiresAt: true,
          attempts: true,
          verifiedAt: true,
          consumedAt: true,
        },
      },
      executions: {
        orderBy: { createdAt: "desc" },
        include: {
          processorOutcomes: {
            orderBy: { processorKey: "asc" },
            select: {
              processorKey: true,
              status: true,
              outcomeCode: true,
              retainedBasisRef: true,
              attemptCount: true,
              nextRetryAt: true,
            },
          },
        },
      },
    },
  });
  if (privacyCase === null) notFound();
  const challenge = privacyCase.challenges[0] ?? null;
  const artifact = privacyCase.exportArtifacts[0] ?? null;
  const environment = getServerEnvironment();
  const downloadToken =
    artifact === null || artifact.expiresAt <= new Date()
      ? null
      : derivePrivacyExportDownloadToken(
          environment.secrets.keyrings.PRIVACY_EXPORT_KEYS,
          artifact.encryptionKeyVersion,
          artifact.id,
          artifact.ownerUserId,
          artifact.expiresAt,
        );
  const cancellable = ["PENDING", "IDENTITY_CHECK"].includes(privacyCase.status);

  return (
    <section className="grid gap-6" aria-labelledby="privacy-case-title">
      <header>
        <p className="eyebrow">Datenschutzfall</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge>{privacyCase.type}</Badge>
          <Badge variant="outline">{privacyCase.status}</Badge>
        </div>
        <h1 id="privacy-case-title" className="mt-3 break-all font-mono text-2xl">
          {privacyCase.id}
        </h1>
        <p className="mt-2 max-w-3xl leading-7 text-muted-foreground">
          Erstellt {formatDateTime(privacyCase.createdAt)} · internes Serviceziel {formatDateTime(privacyCase.dueAt)}. Das ist keine rechtliche Fristzusage.
        </p>
      </header>

      {privacyCase.status === "IDENTITY_CHECK" && challenge !== null ? (
        <Card>
          <CardHeader><CardTitle as="h2">Identität bestätigen</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm leading-6 text-muted-foreground">
              Bestätige dein aktuelles Passwort direkt im geschützten Bereich. Das Passwort wird weder in diesem Fall noch im Audit gespeichert.
            </p>
            <p className="text-sm">
              Status: {challenge.verifiedAt ? "erfolgreich bestätigt" : "Bestätigung offen"} · Versuche {challenge.attempts}/5 · gültig bis {formatDateTime(challenge.expiresAt)}
            </p>
            {challenge.verifiedAt === null && challenge.consumedAt === null ? (
              <Link
                href={`/candidate/privacy/requests/${privacyCase.id}/verify`}
                className={buttonVariants({ className: "w-fit" })}
              >
                Passwort sicher bestätigen
              </Link>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {privacyCase.type === "CORRECT" ? (
        <Card>
          <CardHeader><CardTitle as="h2">Korrektur</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {privacyCase.correctionFields.map((field) => (
              <div key={field.fieldCode} className="rounded-lg border p-3">
                <p className="font-medium">{field.fieldCode}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm">{field.correctionText}</p>
                <p className="mt-1 text-xs text-muted-foreground">{field.reviewedAt ? `Geprüft ${formatDateTime(field.reviewedAt)}` : "Noch nicht geprüft"}</p>
              </div>
            ))}
            <p>Ergebnis: {privacyCase.correctionOutcome ?? "noch offen"}</p>
            {privacyCase.domainEventRefs.length > 0 ? (
              <p className="break-all text-xs text-muted-foreground">Referenzierte Änderungen: {privacyCase.domainEventRefs.join(", ")}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {privacyCase.type === "DELETE" ? (
        <Card>
          <CardHeader><CardTitle as="h2">Löschungsprüfung</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm leading-6">
            <p>Abhängigkeiten: {privacyCase.deletionDependencies.join(", ") || "noch nicht geprüft"}</p>
            <p>Ergebnis: {privacyCase.deletionOutcome ?? "noch offen"}</p>
            <p className="font-medium">Ein Abschluss ist erst zulässig, wenn alle Processor-Outcomes terminal und nachvollziehbar sind.</p>
          </CardContent>
        </Card>
      ) : null}

      {privacyCase.type === "EXPORT" && privacyCase.exportManifest !== null ? (
        <Card>
          <CardHeader><CardTitle as="h2">Exportartefakt</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p>Das Manifest beschreibt die tatsächlich verarbeiteten Kategorien. Paketbytes werden weder hier noch im Audit angezeigt.</p>
            <p className="break-all">Prüfsumme: {privacyCase.exportManifestChecksum}</p>
            <p>Download gültig bis: {privacyCase.exportExpiresAt ? formatDateTime(privacyCase.exportExpiresAt) : "–"}</p>
            {artifact !== null ? (
              <p>{artifact.sizeBytes ?? 0} Bytes · Manifest <span className="break-all font-mono">{artifact.manifestHash}</span></p>
            ) : null}
            {artifact !== null && downloadToken !== null ? (
              <form method="post" action={`/api/privacy/exports/${artifact.id}`}>
                <input type="hidden" name="token" value={downloadToken} />
                <button className={buttonVariants()} type="submit">
                  Export einmalig herunterladen
                </button>
              </form>
            ) : (
              <p className="font-medium">Der Einmal-Download ist nicht mehr verfügbar.</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {privacyCase.rejectionCode || privacyCase.safeOutcomeNote ? (
        <Card>
          <CardHeader><CardTitle as="h2">Ergebnis</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {privacyCase.rejectionCode ? <p>Grund: {privacyCase.rejectionCode}</p> : null}
            {privacyCase.safeOutcomeNote ? <p className="whitespace-pre-wrap">{privacyCase.safeOutcomeNote}</p> : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle as="h2">Statusverlauf</CardTitle></CardHeader>
        <CardContent>
          <ol className="grid gap-2">
            {privacyCase.events.map((event) => (
              <li key={event.id} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">{event.kind} · {event.toStatus}</p>
                <p className="mt-1 text-xs text-muted-foreground">{event.reasonCode ?? "–"} · {formatDateTime(event.createdAt)}</p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {privacyCase.executions.map((execution) => (
        <Card key={execution.id}>
          <CardHeader>
            <CardTitle as="h2">
              Vollzug · {execution.kind} · {execution.status}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm leading-6 text-muted-foreground">
              {execution.checkpoint}/{execution.requiredProcessors.length} Processor
              terminal. Teilfehler oder Holds bleiben sichtbar und verhindern
              einen falschen Abschluss.
            </p>
            <ol className="grid gap-2">
              {execution.processorOutcomes.map((outcome) => (
                <li className="rounded-lg border p-3 text-sm" key={outcome.processorKey}>
                  <p className="font-medium">
                    {outcome.processorKey} · {outcome.status}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {outcome.outcomeCode ?? "Outcome offen"} · Versuch {outcome.attemptCount}
                    {outcome.nextRetryAt ? ` · nächster Lauf ${formatDateTime(outcome.nextRetryAt)}` : ""}
                  </p>
                  {outcome.retainedBasisRef ? (
                    <p className="mt-2 text-sm">
                      Eng begrenzt behalten: {outcome.retainedBasisRef}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ))}

      {cancellable ? (
        <PrivacyCaseCancelForm
          requestId={privacyCase.id}
          version={privacyCase.version}
          idempotencyKey={randomUUID()}
        />
      ) : null}
    </section>
  );
}
