import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminActionForm } from "@/components/admin/action-form";
import { MetricCard } from "@/components/admin/MetricCard";
import { Badge } from "@/components/ui/badge";
import { getClusterAssessmentDetail } from "@/lib/admin/content";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import { decideClusterV2Activation } from "@/lib/seo/cluster-launch-policy-v2";

export const metadata: Metadata = { title: "Cluster-Launch" };

export default async function ClusterAssessmentPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const [{ id }, admin] = await Promise.all([params, requireAdminPage()]);
  const dependencies = {
    actor: {
      userId: admin.id,
      email: admin.email,
      role: admin.role,
      status: admin.status,
      capabilities: admin.capabilities,
    },
    correlationId: "admin-cluster-detail",
    database: getDatabase(),
    now: new Date(),
  } as const;
  const item = await getClusterAssessmentDetail(dependencies, id);
  if (item === null) notFound();
  const searchQualityDecision =
    item.policyVersion === "CLUSTER_LAUNCH_POLICY_V2"
      ? decideClusterV2Activation(item.searchQualityEvidence)
      : ({ allowed: true } as const);
  return (
    <div className="grid gap-6">
      <header>
        <div className="flex gap-2">
          <Badge>{item.status}</Badge>
          <Badge variant="outline">{item.policyVersion}</Badge>
          <Badge variant="outline">{item.dataProvenance}</Badge>
        </div>
        <h1 className="mt-3 text-3xl font-semibold">
          {item.canton.code} × {item.category.name}
        </h1>
        <p className="mt-2 text-muted-foreground">
          Fenster {item.evidenceWindowStart.toLocaleString("de-CH")} bis{" "}
          {item.evidenceWindowEnd.toLocaleString("de-CH")} · Hash{" "}
          {item.evidenceHash}
        </p>
      </header>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard label="LIVE Jobs" value={item.liveJobCount} />
        <MetricCard
          label="Aktive Kandidaten"
          value={item.activeCandidateCount}
        />
        <MetricCard
          label="Aktive Arbeitgeber"
          value={item.activeEmployerCount}
        />
        <MetricCard
          label="Response Rate"
          value={`${item.responseRateBasisPoints} bp`}
        />
        <MetricCard
          label="Content Coverage"
          value={`${item.contentCoverageBasisPoints} bp`}
        />
        <MetricCard
          label="Median Bewerbungen ×2"
          value={item.medianApplicationsTimes2}
        />
      </section>
      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        Content-Publish allein aktiviert weder SEO noch Akquisition. Product-
        und Ops-Freigabe sind separate Events; Aktivierung prüft Gültigkeit und
        LIVE-Provenienz erneut.
      </p>
      {item.policyVersion === "CLUSTER_LAUNCH_POLICY_V2" ? (
        <section
          aria-labelledby="search-quality-title"
          className="grid gap-3 rounded-lg border p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="search-quality-title" className="text-lg font-semibold">
              Suchqualitäts-Freigabe V2
            </h2>
            <Badge
              variant={
                searchQualityDecision.allowed ? "outline" : "destructive"
              }
            >
              {searchQualityDecision.allowed
                ? "fachlich freigabefähig"
                : "Aktivierung gesperrt"}
            </Badge>
          </div>
          {item.searchQualityEvidence === null ? (
            <p className="text-sm text-muted-foreground">
              Es fehlt ein unveränderlicher Query-/Top‑K-Nachweis. Eine frühere
              V1-Freigabe ersetzt diesen Nachweis nicht.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  label="Precision@10"
                  value={`${item.searchQualityEvidence.precisionAt10Bps} bp`}
                />
                <MetricCard
                  label="Recall@10"
                  value={`${item.searchQualityEvidence.recallAt10Bps} bp`}
                />
                <MetricCard
                  label="Coverage"
                  value={`${item.searchQualityEvidence.coverageBps} bp`}
                />
                <MetricCard
                  label="Relevante Top-K Jobs"
                  value={item.searchQualityEvidence.relevantTopKJobs}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                {item.searchQualityEvidence.selectionStatus} ·{" "}
                {item.searchQualityEvidence.searchPolicyVersion} ·{" "}
                {item.searchQualityEvidence.taxonomyVersion} ·{" "}
                {item.searchQualityEvidence.rankingVersion}
              </p>
              <p className="text-sm">
                Fachreview:{" "}
                {item.searchQualityEvidence.expertReviewedAt === null
                  ? "nicht vorhanden"
                  : item.searchQualityEvidence.expertReviewedAt.toLocaleString(
                      "de-CH",
                    )}
              </p>
            </>
          )}
          {!searchQualityDecision.allowed ? (
            <p className="text-sm text-destructive">
              Sperrgrund: {searchQualityDecision.reason}
            </p>
          ) : null}
        </section>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {item.status === "READY" && item.productApprovedAt === null ? (
          <AdminActionForm
            operation="cluster-transition"
            label="Product freigeben"
            hidden={{
              assessmentId: item.id,
              action: "PRODUCT_APPROVE",
              reasonCode: "PRODUCT_EVIDENCE_APPROVED",
              idempotencyKey: randomUUID(),
            }}
          />
        ) : null}
        {item.status === "READY" && item.opsApprovedAt === null ? (
          <AdminActionForm
            operation="cluster-transition"
            label="Ops freigeben"
            hidden={{
              assessmentId: item.id,
              action: "OPS_APPROVE",
              reasonCode: "OPS_EVIDENCE_APPROVED",
              idempotencyKey: randomUUID(),
            }}
          />
        ) : null}
        {item.status === "READY" &&
        item.dataProvenance === "LIVE" &&
        item.productApprovedAt !== null &&
        item.opsApprovedAt !== null &&
        searchQualityDecision.allowed ? (
          <AdminActionForm
            operation="cluster-transition"
            label="Cluster aktivieren"
            hidden={{
              assessmentId: item.id,
              action: "ACTIVATE",
              reasonCode: "DUAL_APPROVAL_AND_SEARCH_EVIDENCE_COMPLETE",
              idempotencyKey: randomUUID(),
            }}
          />
        ) : null}
        {item.status === "DRAFT" ? (
          <p className="rounded-lg border p-3 text-sm text-muted-foreground">
            Mindestens ein Markt-Schwellenwert ist nicht erfüllt; Freigaben
            bleiben gesperrt.
          </p>
        ) : null}
        {item.status === "READY" && item.dataProvenance !== "LIVE" ? (
          <p className="rounded-lg border p-3 text-sm text-muted-foreground">
            Demo-Evidenz zeigt den Ablauf, kann aber nicht als LIVE-Cluster
            aktiviert werden.
          </p>
        ) : null}
        {item.status === "ACTIVATED" ? (
          <AdminActionForm
            operation="cluster-transition"
            label="Cluster widerrufen"
            destructive
            hidden={{
              assessmentId: item.id,
              action: "REVOKE",
              reasonCode: "CLUSTER_REVIEW_REQUIRED",
              idempotencyKey: randomUUID(),
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
