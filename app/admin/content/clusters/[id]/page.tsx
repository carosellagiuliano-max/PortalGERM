import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminActionForm } from "@/components/admin/action-form";
import { MetricCard } from "@/components/admin/MetricCard";
import { Badge } from "@/components/ui/badge";
import { getClusterAssessmentDetail } from "@/lib/admin/content";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";

export const metadata: Metadata = { title: "Cluster-Launch" };

export default async function ClusterAssessmentPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const [{ id }, admin] = await Promise.all([params, requireAdminPage()]);
  const dependencies = { actor: { userId: admin.id, email: admin.email, role: admin.role, status: admin.status }, correlationId: "admin-cluster-detail", database: getDatabase(), now: new Date() } as const;
  const item = await getClusterAssessmentDetail(dependencies, id);
  if (item === null) notFound();
  return <div className="grid gap-6"><header><div className="flex gap-2"><Badge>{item.status}</Badge><Badge variant="outline">{item.policyVersion}</Badge><Badge variant="outline">{item.dataProvenance}</Badge></div><h1 className="mt-3 text-3xl font-semibold">{item.canton.code} × {item.category.name}</h1><p className="mt-2 text-muted-foreground">Fenster {item.evidenceWindowStart.toLocaleString("de-CH")} bis {item.evidenceWindowEnd.toLocaleString("de-CH")} · Hash {item.evidenceHash}</p></header><section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><MetricCard label="LIVE Jobs" value={item.liveJobCount} /><MetricCard label="Aktive Kandidaten" value={item.activeCandidateCount} /><MetricCard label="Aktive Arbeitgeber" value={item.activeEmployerCount} /><MetricCard label="Response Rate" value={`${item.responseRateBasisPoints} bp`} /><MetricCard label="Content Coverage" value={`${item.contentCoverageBasisPoints} bp`} /><MetricCard label="Median Bewerbungen ×2" value={item.medianApplicationsTimes2} /></section><p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Content-Publish allein aktiviert weder SEO noch Akquisition. Product- und Ops-Freigabe sind separate Events; Aktivierung prüft Gültigkeit und LIVE-Provenienz erneut.</p><div className="grid gap-3 sm:grid-cols-2">{item.status === "READY" && item.productApprovedAt === null ? <AdminActionForm operation="cluster-transition" label="Product freigeben" hidden={{ assessmentId: item.id, action: "PRODUCT_APPROVE", reasonCode: "PRODUCT_EVIDENCE_APPROVED", idempotencyKey: randomUUID() }} /> : null}{item.status === "READY" && item.opsApprovedAt === null ? <AdminActionForm operation="cluster-transition" label="Ops freigeben" hidden={{ assessmentId: item.id, action: "OPS_APPROVE", reasonCode: "OPS_EVIDENCE_APPROVED", idempotencyKey: randomUUID() }} /> : null}{item.status === "READY" && item.dataProvenance === "LIVE" && item.productApprovedAt !== null && item.opsApprovedAt !== null ? <AdminActionForm operation="cluster-transition" label="Cluster aktivieren" hidden={{ assessmentId: item.id, action: "ACTIVATE", reasonCode: "DUAL_APPROVAL_COMPLETE", idempotencyKey: randomUUID() }} /> : null}{item.status === "DRAFT" ? <p className="rounded-lg border p-3 text-sm text-muted-foreground">Mindestens ein Markt-Schwellenwert ist nicht erfüllt; Freigaben bleiben gesperrt.</p> : null}{item.status === "READY" && item.dataProvenance !== "LIVE" ? <p className="rounded-lg border p-3 text-sm text-muted-foreground">Demo-Evidenz zeigt den Ablauf, kann aber nicht als LIVE-Cluster aktiviert werden.</p> : null}{item.status === "ACTIVATED" ? <AdminActionForm operation="cluster-transition" label="Cluster widerrufen" destructive hidden={{ assessmentId: item.id, action: "REVOKE", reasonCode: "CLUSTER_REVIEW_REQUIRED", idempotencyKey: randomUUID() }} /> : null}</div></div>;
}
