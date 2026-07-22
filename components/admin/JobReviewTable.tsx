import { randomUUID } from "node:crypto";

import Link from "next/link";

import { AdminActionForm, adminInputClass } from "@/components/admin/action-form";
import { Badge } from "@/components/ui/badge";
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
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[68rem] text-left text-sm">
        <thead className="bg-muted/60">
          <tr><th className="p-3">Job</th><th className="p-3">Firma</th><th className="p-3">Status</th><th className="p-3">Score</th><th className="p-3">Boost</th><th className="p-3"><span className="sr-only">Öffnen</span></th></tr>
        </thead>
        <tbody className="divide-y">
          {jobs.map((job) => {
            const boost = job.boosts[0];
            return (
              <tr key={job.id} className="align-top">
                <td className="p-3 font-medium">{job.currentRevision?.title ?? "Ohne Titel"}</td>
                <td className="p-3">{job.company.name}</td>
                <td className="p-3"><Badge variant="outline">{job.status}</Badge></td>
                <td className="p-3 tabular-nums">{job.currentRevision?.scoreSnapshots?.[0] ? `${job.currentRevision.scoreSnapshots[0].scorePoints}/${job.currentRevision.scoreSnapshots[0].maxPoints}` : "–"}</td>
                <td className="p-3">
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
                </td>
                <td className="p-3 text-right"><Link className="text-primary underline" href={`/admin/jobs/${job.id}`}>Prüfen</Link></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
