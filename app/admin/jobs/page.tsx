import type { Metadata } from "next";
import { forbidden } from "next/navigation";

import { AdminActionForm } from "@/components/admin/action-form";
import { JobReviewTable } from "@/components/admin/JobReviewTable";
import Link from "@/components/shared/app-link";
import { listAdminJobs } from "@/lib/admin/jobs";
import { requireAdminCapabilityPage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";

export const metadata: Metadata = { title: "Job-Prüfung" };

const tabs = [
  { key: "PENDING", label: "Pending Review" },
  { key: "APPROVED", label: "Approved" },
  { key: "PUBLISHED", label: "Published" },
  { key: "REJECTED", label: "Rejected" },
  { key: "CLOSED", label: "Closed" },
  { key: "ALL", label: "All" },
] as const;

export default async function AdminJobsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ status?: string }> }>) {
  const [admin, query] = await Promise.all([
    requireAdminCapabilityPage("ADMIN_JOB_REVIEW"),
    searchParams,
  ]);
  const tab =
    tabs.find((item) => item.key === query.status)?.key ?? "PENDING";
  const dependencies = {
    actor: {
      userId: admin.id,
      email: admin.email,
      role: admin.role,
      status: admin.status,
      capabilities: admin.capabilities,
    },
    correlationId: "admin-jobs-read",
    database: getDatabase(),
    now: new Date(),
  } as const;
  const jobs = await listAdminJobs(dependencies, tab);
  if (jobs === null) forbidden();
  const canProjectBoosts = admin.capabilities.includes(
    "ADMIN_JOB_BOOST_MANAGE",
  );

  return (
    <div className="grid gap-6">
      <header>
        <p className="eyebrow">Supply Operations</p>
        <h1 className="mt-2 text-3xl font-semibold">Job-Prüfung</h1>
        <p className="mt-2 text-muted-foreground">
          Jeder Schritt folgt der Statusmaschine; Veröffentlichung prüft Firma,
          Revision, Restriktionen und Quota erneut atomar.
        </p>
      </header>
      {canProjectBoosts ? (
        <AdminActionForm
          operation="boost-status-project"
          label="Boost-Statusprojektion ausführen"
        >
          <p className="text-sm text-muted-foreground">
            Expliziter, wiederholbarer Operations-Lauf. Öffentliche GET-Aufrufe
            schreiben keine Statusänderungen.
          </p>
        </AdminActionForm>
      ) : null}
      <nav className="flex flex-wrap gap-2" aria-label="Job-Status">
        {tabs.map((item) => (
          <Link
            key={item.key}
            className={`whitespace-nowrap rounded-lg border px-3 py-2 text-sm ${
              item.key === tab ? "bg-primary text-primary-foreground" : "bg-card"
            }`}
            href={`/admin/jobs?status=${item.key}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <JobReviewTable jobs={jobs} />
    </div>
  );
}
