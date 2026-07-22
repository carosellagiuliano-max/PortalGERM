import { randomUUID } from "node:crypto";

import Link from "next/link";

import { AdminActionForm, adminInputClass, adminTextareaClass } from "@/components/admin/action-form";
import { Badge } from "@/components/ui/badge";
import type { AdminCockpitSignal } from "@/lib/admin/cockpit";

export function SignalCards({ signals }: Readonly<{ signals: readonly AdminCockpitSignal[] }>) {
  return signals.length === 0 ? <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Keine belastbaren Signale. Fehlende Analytics-Samples erzeugen bewusst keine spekulativen Karten.</p> : <div className="grid gap-4 lg:grid-cols-2">{signals.map((signal, index) => <article key={`${signal.reason}-${signal.companyId}-${signal.jobId ?? index}`} className="rounded-xl border bg-card p-5"><div className="flex flex-wrap gap-2"><Badge variant="secondary">{signal.reason}</Badge>{signal.dataProvenance === "DEMO" ? <Badge variant="outline">Demo-Evidenz</Badge> : null}</div><h3 className="mt-3 font-semibold">{signal.title}</h3><p className="mt-2 text-sm text-muted-foreground">{signal.evidence}</p><p className="mt-4 text-sm"><strong>Vorschlag:</strong> {signal.suggestedAction}</p>{signal.leadId === undefined || signal.leadStatus === undefined ? <Link href={`/admin/companies/${signal.companyId}`} className="mt-4 inline-flex rounded-lg border px-3 py-2 text-sm font-medium text-primary">Firma und Sales-Kontext prüfen →</Link> : <div className="mt-4 grid gap-3"><AdminActionForm operation="lead-manage" label="Vorbefüllte Notiz speichern" hidden={{ leadId: signal.leadId, action: "NOTE", reasonCode: signal.reason, idempotencyKey: randomUUID() }}><textarea name="safeNote" required className={adminTextareaClass} defaultValue={`${signal.suggestedAction} Evidenz: ${signal.evidence}`} /></AdminActionForm><AdminActionForm operation="lead-manage" label="Lead-Status aktualisieren" hidden={{ leadId: signal.leadId, action: "STATUS", reasonCode: signal.reason, idempotencyKey: randomUUID() }}><select name="status" defaultValue={signal.leadStatus} className={adminInputClass}><option>NEW</option><option>CONTACTED</option><option>QUALIFIED</option><option>WON</option><option>LOST</option></select><label className="grid gap-1 text-xs text-muted-foreground">Nächste Aktion bei offenem Lead<input name="nextAt" type="datetime-local" defaultValue={toLocalDateTime(signal.suggestedNextAt)} className={adminInputClass} /></label></AdminActionForm></div>}</article>)}</div>;
}

function toLocalDateTime(value: string | undefined): string | undefined {
  return value?.slice(0, 16);
}
