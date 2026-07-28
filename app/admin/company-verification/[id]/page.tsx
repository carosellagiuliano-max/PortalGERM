import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CompanyVerificationReviewControls } from "@/components/admin/company-verification-controls";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getCompanyVerificationReview } from "@/lib/companies/verification/admin-service";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = {
  title: "Firmenprüfung bearbeiten",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function AdminCompanyVerificationDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const [{ id }, user] = await Promise.all([params, requireAdminPage()]);
  const environment = getServerEnvironment();
  const request = await getCompanyVerificationReview(
    {
      actor: {
        userId: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        capabilities: user.capabilities,
        sessionId: user.sessionId,
      },
      correlationId: "admin-company-verification-detail",
      database: getDatabase(),
      now: new Date(),
      stepUpMode: environment.PRIVILEGED_STEP_UP_MODE,
    },
    id,
  );
  if (request === null) notFound();

  return (
    <section className="grid gap-6" aria-labelledby="company-verification-review-title">
      <header>
        <Link href="/admin/company-verification" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          Zur Prüfqueue
        </Link>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge>{request.status}</Badge>
          <Badge variant={request.riskLevel === "NORMAL" ? "outline" : "destructive"}>{request.riskLevel}</Badge>
          <Badge variant="outline">Version {request.version}</Badge>
        </div>
        <h1 id="company-verification-review-title" className="mt-3 text-3xl font-semibold">
          {request.company.name}
        </h1>
        <p className="mt-2 text-muted-foreground">
          UID {request.company.uid ?? "offen"} · Policy {request.policyVersion} ·
          fällig {request.reviewDueAt ? formatDateTime(request.reviewDueAt) : "ohne SLA"}
        </p>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-5">
          <Card>
            <CardHeader><CardTitle as="h2">Strukturierte Evidenz</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              {request.evidence.length === 0 ? (
                <p className="text-sm text-muted-foreground">Keine Evidenz. Freigabe ist fail-closed.</p>
              ) : request.evidence.map((evidence) => (
                <article key={evidence.id} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong>{evidence.type}</strong>
                    <Badge variant={evidence.status === "VALID" ? "default" : "destructive"}>{evidence.status}</Badge>
                  </div>
                  <dl className="mt-3 grid gap-1 text-xs text-muted-foreground">
                    <div><dt className="inline font-medium text-foreground">Quelle:</dt> <dd className="inline">{evidence.source} / {evidence.providerKey ?? "kein Provider"}</dd></div>
                    <div><dt className="inline font-medium text-foreground">Gültigkeit:</dt> <dd className="inline">{evidence.validFrom ? formatDateTime(evidence.validFrom) : "—"} bis {evidence.validTo ? formatDateTime(evidence.validTo) : "—"}</dd></div>
                    {evidence.domainChallenge ? <div><dt className="inline font-medium text-foreground">Domain:</dt> <dd className="inline">{evidence.domainChallenge.domain} · {evidence.domainChallenge.status}</dd></div> : null}
                    {evidence.documentVersionId ? <div><dt className="inline font-medium text-foreground">Vault-Version:</dt> <dd className="inline">{evidence.documentVersionId}</dd></div> : null}
                  </dl>
                  {evidence.checks.length === 0 ? null : (
                    <ol className="mt-3 grid gap-1 text-xs">
                      {evidence.checks.map((check) => (
                        <li key={check.id}>
                          {check.providerUseCase}: <strong>{check.result}</strong>
                          {check.failureCode ? ` · ${check.failureCode}` : ""}
                        </li>
                      ))}
                    </ol>
                  )}
                </article>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle as="h2">Entscheidungs- und Einspruchshistorie</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              {request.decisions.map((decision) => (
                <article key={decision.id} className="rounded-lg border p-3 text-sm">
                  <strong>{decision.kind}</strong> · {decision.scope} · {decision.reasonCode}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(decision.decidedAt)} · Review {decision.decidedBy.name ?? decision.decidedBy.email}
                    {decision.approvedBy ? ` · zweite Freigabe ${decision.approvedBy.name ?? decision.approvedBy.email}` : ""}
                  </p>
                </article>
              ))}
              {request.appeals.map((appeal) => (
                <article key={appeal.id} className="rounded-lg border p-3 text-sm">
                  <strong>Einspruch {appeal.status}</strong>
                  <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{appeal.safeStatement}</p>
                </article>
              ))}
              {request.decisions.length === 0 && request.appeals.length === 0 ? (
                <p className="text-sm text-muted-foreground">Noch keine Entscheidung oder Einspruch.</p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <aside>
          <CompanyVerificationReviewControls
            request={request}
            actorUserId={user.id}
            canApprove={user.capabilities.includes("COMPANY_VERIFICATION_APPROVE")}
            stepUpRequired={environment.PRIVILEGED_STEP_UP_MODE === "enforce"}
            idempotencyKeys={Array.from({ length: 20 }, () => randomUUID())}
          />
        </aside>
      </div>
    </section>
  );
}
