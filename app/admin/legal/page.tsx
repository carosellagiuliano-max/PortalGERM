import type { Metadata } from "next";
import { forbidden } from "next/navigation";

import { adminLegalAction } from "@/app/admin/legal/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdminCapabilityPage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import { getAdminLegalControlPlane } from "@/lib/legal/admin-read";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Legal & Processing Gates" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

const INPUT =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm";
const TEXTAREA =
  "min-h-48 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm";

export default async function AdminLegalPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ result?: string }> }>) {
  const [admin, query] = await Promise.all([
    requireAdminCapabilityPage("ADMIN_LEGAL_READ"),
    searchParams,
  ]);
  const data = await getAdminLegalControlPlane({
    actor: {
      userId: admin.id,
      email: admin.email,
      role: admin.role,
      status: admin.status,
      capabilities: admin.capabilities,
    },
    correlationId: "admin-legal-read",
    database: getDatabase(),
    now: new Date(),
  });
  if (data === null) forbidden();
  const { documents, approvals, inventory } = data;
  const canDraft = admin.capabilities.includes("ADMIN_LEGAL_DRAFT");
  const canReview = admin.capabilities.includes("ADMIN_LEGAL_REVIEW");
  const canPublish = admin.capabilities.includes("ADMIN_LEGAL_PUBLISH");

  return (
    <div className="grid gap-6">
      <header>
        <p className="eyebrow">Phase 22 · Legal Control Plane</p>
        <h1 className="mt-2 text-3xl font-semibold">Legal & Processing Gates</h1>
        <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
          Entwurf, unabhängige Prüfung und Veröffentlichung sind getrennte
          Schritte. Eine Veröffentlichung ist keine AVG-, AVV- oder
          DSFA-Freigabe; dafür ist zusätzlich ein gültiges Processing Gate nötig.
        </p>
        {query.result ? (
          <p className="mt-3 rounded-lg border bg-muted p-3 text-sm" role="status">
            Ergebnis: {query.result}
          </p>
        ) : null}
      </header>

      {canDraft ? <Card>
        <CardHeader><CardTitle as="h2">Neuen Rechtsentwurf anlegen</CardTitle></CardHeader>
        <CardContent>
          <form action={adminLegalAction} className="grid gap-4">
            <input type="hidden" name="operation" value="create-draft" />
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-sm">Dokumenttyp
                <select name="type" className={INPUT} required>
                  {["PRIVACY", "TERMS", "IMPRINT", "COOKIE", "ANALYTICS", "AVG_NOTICE", "DPA", "DSFA"].map((type) => <option key={type}>{type}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm">Locale
                <select name="locale" className={INPUT} defaultValue="de-CH">
                  {["de-CH", "fr-CH", "it-CH", "en-CH"].map((locale) => <option key={locale}>{locale}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm">Titel
                <input name="title" className={INPUT} minLength={3} maxLength={200} required />
              </label>
              <label className="grid gap-1 text-sm">Kanonischer Slug
                <input name="slug" className={INPUT} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required />
              </label>
              <label className="grid gap-1 text-sm">Versionsbezeichnung
                <input name="versionLabel" className={INPUT} placeholder="2026-07-v1" required />
              </label>
              <label className="grid gap-1 text-sm">Änderungszusammenfassung
                <input name="changeSummary" className={INPUT} minLength={3} maxLength={1000} required />
              </label>
            </div>
            <label className="grid gap-1 text-sm">Inhalt (sicheres Markdown)
              <textarea name="contentMarkdown" className={TEXTAREA} minLength={80} maxLength={100000} required />
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="requiresReconsent" value="true" />
              Diese Revision verlangt nach Veröffentlichung eine erneute Zustimmung.
            </label>
            <Button type="submit" className="w-fit">Entwurf speichern</Button>
          </form>
        </CardContent>
      </Card> : null}

      <section className="grid gap-4" aria-labelledby="legal-documents-title">
        <h2 id="legal-documents-title" className="text-2xl font-semibold">Dokumente und Revisionen</h2>
        {documents.length === 0 ? (
          <Card><CardContent>Noch keine Entwürfe vorhanden.</CardContent></Card>
        ) : documents.map((document) => (
          <Card key={document.id}>
            <CardHeader>
              <CardTitle as="h3">{document.title}</CardTitle>
              <div className="flex flex-wrap gap-2"><Badge>{document.type}</Badge><Badge variant="outline">{document.locale}</Badge><Badge variant="secondary">/{document.slug}</Badge></div>
            </CardHeader>
            <CardContent className="grid gap-4">
              {document.revisions.map((revision) => {
                const publication = document.publications.find((item) => item.legalRevisionId === revision.id);
                return (
                  <div className="grid gap-3 rounded-lg border p-4" key={revision.id}>
                    <div className="flex flex-wrap gap-2"><Badge>{revision.status}</Badge><Badge variant="outline">{revision.versionLabel}</Badge>{publication ? <Badge variant="secondary">Publication {publication.status}</Badge> : null}</div>
                    <p className="text-sm">{revision.changeSummary}</p>
                    <p className="break-all font-mono text-xs text-muted-foreground">{revision.contentHash}</p>
                    {canReview && ["DRAFT", "IN_REVIEW"].includes(revision.status) ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        {["approve-revision", "reject-revision"].map((operation) => (
                          <form action={adminLegalAction} className="flex flex-wrap items-end gap-2" key={operation}>
                            <input type="hidden" name="operation" value={operation} />
                            <input type="hidden" name="revisionId" value={revision.id} />
                            <label className="grid flex-1 gap-1 text-sm">Reason-Code
                              <input name="reasonCode" className={INPUT} defaultValue={operation === "approve-revision" ? "COUNSEL_REVIEWED" : "REVIEW_REJECTED"} required />
                            </label>
                            <Button variant={operation === "approve-revision" ? "default" : "destructive"} type="submit">{operation === "approve-revision" ? "Unabhängig freigeben" : "Ablehnen"}</Button>
                          </form>
                        ))}
                      </div>
                    ) : null}
                    {canPublish && revision.status === "APPROVED" && publication === undefined ? (
                      <form action={adminLegalAction} className="grid gap-3 md:grid-cols-3">
                        <input type="hidden" name="operation" value="publish-revision" />
                        <input type="hidden" name="revisionId" value={revision.id} />
                        <label className="grid gap-1 text-sm">Wirksam ab
                          <input type="datetime-local" name="effectiveAt" className={INPUT} required />
                        </label>
                        <label className="grid gap-1 text-sm">Ablauf (optional)
                          <input type="datetime-local" name="expiresAt" className={INPUT} />
                        </label>
                        <label className="grid gap-1 text-sm">Reason-Code
                          <input name="reasonCode" className={INPUT} defaultValue="LEGAL_PUBLICATION_APPROVED" required />
                        </label>
                        <Button type="submit" className="w-fit">Als dritter Actor veröffentlichen</Button>
                      </form>
                    ) : null}
                    {canPublish && publication?.status === "CURRENT" ? (
                      <form action={adminLegalAction} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="operation" value="revoke-publication" />
                        <input type="hidden" name="publicationId" value={publication.id} />
                        <label className="grid flex-1 gap-1 text-sm">Widerrufsgrund
                          <input name="reasonCode" className={INPUT} defaultValue="LEGAL_REVIEW_REQUIRED" required />
                        </label>
                        <Button variant="destructive" type="submit">Veröffentlichung widerrufen</Button>
                      </form>
                    ) : null}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle as="h2">Processing Approvals</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {approvals.length === 0 ? <p>Keine Freigabe hinterlegt — alle betroffenen Flows bleiben gesperrt.</p> : approvals.map((approval) => (
              <div className="rounded-lg border p-3" key={approval.id}>
                <p className="font-medium">{approval.scope} · {approval.processorKey}</p>
                <p>{approval.status} · {approval.region} · {approval.version}</p>
                <p className="text-xs text-muted-foreground">Review {formatDateTime(approval.reviewAt)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle as="h2">Privacy-Inventar</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {inventory.length === 0 ? <p>Noch keine signierte Dateninventar-Version aktiviert.</p> : inventory.map((version) => (
              <div className="rounded-lg border p-3" key={version.id}>
                <p className="font-medium">{version.version} · {version.status}</p>
                <p>{version._count.entries} Zeilen · Owner {version.owner}</p>
                <p className="break-all font-mono text-xs text-muted-foreground">{version.contentHash}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
