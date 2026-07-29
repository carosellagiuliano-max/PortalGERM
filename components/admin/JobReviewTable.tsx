import { randomUUID } from "node:crypto";

import Link from "@/components/shared/app-link";

import { AdminActionForm, adminInputClass } from "@/components/admin/action-form";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveTable,
  ResponsiveTableCell,
} from "@/components/ui/responsive-table";
import { formatDateTime } from "@/lib/utils/format";

type JobReviewRow = Readonly<{
  id: string;
  status: string;
  company: Readonly<{ name: string }>;
  currentRevision: Readonly<{
    title: string;
    scoreSnapshots: readonly Readonly<{
      scorePoints: number;
      maxPoints: number;
    }>[];
  }> | null;
  boosts: readonly Readonly<{ id: string; endsAt: Date }>[];
}>;

export function JobReviewTable({ jobs }: Readonly<{ jobs: readonly JobReviewRow[] }>) {
  if (jobs.length === 0) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Keine Jobs in dieser Queue.</p>;
  }
  return (
    <ResponsiveTable label="Job-Prüfung und verfügbare Aktionen">
        <thead className="bg-muted/60">
          <tr><th className="p-3">Job</th><th className="p-3">Firma</th><th className="p-3">Status</th><th className="p-3">Score</th><th className="p-3">Boost</th><th className="sticky right-0 border-l bg-muted p-3"><span className="sr-only">Öffnen</span></th></tr>
        </thead>
        <tbody className="divide-y">
          {jobs.map((job) => {
            const boost = job.boosts[0];
            return (
              <tr key={job.id} className="align-top">
                <ResponsiveTableCell className="p-3 font-medium" label="Job" primary>{job.currentRevision?.title ?? "Ohne Titel"}</ResponsiveTableCell>
                <ResponsiveTableCell className="p-3" label="Firma">{job.company.name}</ResponsiveTableCell>
                <ResponsiveTableCell className="p-3" label="Status"><Badge variant="outline">{job.status}</Badge></ResponsiveTableCell>
                <ResponsiveTableCell className="p-3 tabular-nums" label="Score">{job.currentRevision?.scoreSnapshots?.[0] ? `${job.currentRevision.scoreSnapshots[0].scorePoints}/${job.currentRevision.scoreSnapshots[0].maxPoints}` : "–"}</ResponsiveTableCell>
                <ResponsiveTableCell className="p-3" label="Boost">
                  {boost === undefined ? "–" : (
                    <div className="grid gap-2">
                      <Badge>Geboostet bis {formatDateTime(boost.endsAt)}</Badge>
                      <AdminActionForm
                        className="min-w-56"
                        operation="job-boost-cancel"
                        label="Boost beenden"
                        destructive
                        hidden={{ boostId: boost.id, idempotencyKey: randomUUID() }}
                      >
                        <label className="grid gap-1 text-xs">Moderationsgrund<input className={adminInputClass} name="reason" minLength={5} maxLength={500} required defaultValue="ADMIN_MODERATION_REVIEW" /></label>
                        <p className="text-xs text-muted-foreground">Keine Rückerstattung im MVP.</p>
                      </AdminActionForm>
                    </div>
                  )}
                </ResponsiveTableCell>
                <ResponsiveTableCell
                  className="sticky right-0 border-l bg-background p-3 text-right shadow-[-6px_0_8px_-8px_rgba(15,23,42,0.35)]"
                  label="Aktion"
                  actions
                >
                  <Link className="whitespace-nowrap text-primary underline" href={`/admin/jobs/${job.id}`}>Prüfen</Link>
                </ResponsiveTableCell>
              </tr>
            );
          })}
        </tbody>
    </ResponsiveTable>
  );
}
