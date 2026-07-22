import type { Metadata } from "next";
import Link from "next/link";

import { ClusterEvaluationForm } from "@/components/admin/ClusterEvaluationForm";
import { ContentEditor } from "@/components/admin/ContentEditor";
import { Badge } from "@/components/ui/badge";
import { listAdminContent } from "@/lib/admin/content";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";

export const metadata: Metadata = { title: "Content Operations" };

export default async function AdminContentPage() {
  const admin = await requireAdminPage();
  const dependencies = {
    actor: {
      userId: admin.id,
      email: admin.email,
      role: admin.role,
      status: admin.status,
    },
    correlationId: "admin-content-read",
    database: getDatabase(),
    now: new Date(),
  } as const;
  const data = await listAdminContent(dependencies);
  if (data === null) return null;

  return (
    <div className="grid gap-8">
      <header>
        <p className="eyebrow">Editorial Operations</p>
        <h1 className="mt-2 text-3xl font-semibold">Content</h1>
        <p className="mt-2 text-muted-foreground">
          Draft → Review → Approve → Publish. Veröffentlichung aktiviert weder SEO-Indexierung noch Cluster-Akquisition automatisch.
        </p>
      </header>
      <ContentEditor />
      <ClusterEvaluationForm cantons={data.cantons} categories={data.categories} />
      <section>
        <h2 className="text-xl font-semibold">Seiten</h2>
        <div className="mt-4 grid gap-3">
          {data.pages.length === 0 ? (
            <p className="text-muted-foreground">Keine Content-Seiten.</p>
          ) : data.pages.map((page) => (
            <Link
              key={page.id}
              href={`/admin/content/${page.id}`}
              className="flex items-center justify-between rounded-lg border bg-card p-4 hover:bg-muted/30"
            >
              <div>
                <p className="font-medium">{page.revisions[0]?.title ?? page.slug}</p>
                <p className="text-xs text-muted-foreground">{page.type} · {page.canonicalPath} · durch Content- und Liquiditätsgate geschützt</p>
              </div>
              <Badge>{page.revisions[0]?.status ?? "LEER"}</Badge>
            </Link>
          ))}
        </div>
      </section>
      <section>
        <h2 className="text-xl font-semibold">Cluster-Launch-Assessments</h2>
        <div className="mt-4 grid gap-3">
          {data.assessments.map((assessment) => (
            <Link
              key={assessment.id}
              href={`/admin/content/clusters/${assessment.id}`}
              className="flex items-center justify-between rounded-lg border bg-card p-4 hover:bg-muted/30"
            >
              <div>
                <p className="font-medium">{assessment.canton.code} · {assessment.category.name}</p>
                <p className="text-xs text-muted-foreground">{assessment.policyVersion} · gültig bis {assessment.validUntil.toLocaleString("de-CH")}</p>
              </div>
              <Badge variant="outline">{assessment.status}</Badge>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
