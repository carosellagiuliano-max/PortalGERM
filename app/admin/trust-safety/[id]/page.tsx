import type { Metadata } from "next";
import Link from "@/components/shared/app-link";
import { notFound } from "next/navigation";

import {
  TrustSafetyAppealDecisionForm,
  TrustSafetyAssignmentForm,
  TrustSafetyDecisionForm,
} from "@/components/admin/trust-safety-case-controls";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import { getTrustSafetyCase } from "@/lib/trust-safety/case-service";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Trust-&-Safety-Fall" };
export const dynamic = "force-dynamic";

export default async function TrustSafetyCasePage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const [actor, { id }] = await Promise.all([requireAdminPage(), params]);
  const trustCase = await getTrustSafetyCase(id, {
    actor: {
      userId: actor.id,
      email: actor.email,
      role: actor.role,
      status: actor.status,
      sessionId: actor.sessionId,
      capabilities: actor.capabilities,
    },
    correlationId: "trust-safety-case-read",
    database: getDatabase(),
    now: new Date(),
  });
  if (trustCase === null) notFound();
  const openAppeals = trustCase.appeals.filter(
    (appeal) => appeal.status === "OPEN",
  );
  return (
    <section aria-labelledby="trust-case-title" className="grid gap-6">
      <header>
        <Link
          href="/admin/trust-safety"
          className={buttonVariants({ variant: "ghost" })}
        >
          ← Zur Trust-&amp;-Safety-Queue
        </Link>
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge>{trustCase.status}</Badge>
          <Badge variant="outline">{trustCase.severity}</Badge>
          <Badge variant="outline">{trustCase.category}</Badge>
        </div>
        <h1 id="trust-case-title" className="mt-3 text-3xl font-semibold">
          Fall {trustCase.id.slice(0, 8)}
        </h1>
        <p className="mt-2 text-muted-foreground">
          Sicherer Grund: {trustCase.safeReasonCode}. Policy{" "}
          {trustCase.policyVersion}, Version {trustCase.version}.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Scope und SLA</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p>
              Subject: {trustCase.subjectType} ·{" "}
              <span className="break-all font-mono">
                {trustCase.subjectId}
              </span>
            </p>
            <p>
              Firma:{" "}
              <span className="break-all font-mono">
                {trustCase.companyId ?? "keine"}
              </span>
            </p>
            <p>Review bis {formatDateTime(trustCase.reviewDueAt)}</p>
            <p>
              Hold-Ablauf:{" "}
              {trustCase.holdExpiresAt
                ? formatDateTime(trustCase.holdExpiresAt)
                : "nicht gesetzt"}
            </p>
            <p>
              Assignee:{" "}
              <span className="break-all font-mono">
                {trustCase.assigneeUserId ?? "nicht zugewiesen"}
              </span>
            </p>
          </CardContent>
        </Card>
        <TrustSafetyAssignmentForm
          caseId={trustCase.id}
          version={trustCase.version}
          currentAssigneeUserId={trustCase.assigneeUserId}
        />
      </div>

      {trustCase.status === "OPEN" || trustCase.status === "IN_REVIEW" ? (
        <TrustSafetyDecisionForm
          caseId={trustCase.id}
          companyId={trustCase.companyId}
          version={trustCase.version}
        />
      ) : null}

      {openAppeals.map((appeal) => (
        <Card key={appeal.id}>
          <CardHeader>
            <CardTitle as="h2">Offener Widerspruch</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="whitespace-pre-wrap text-sm">
              {appeal.safeStatement}
            </p>
            <p className="text-xs text-muted-foreground">
              Eingereicht {formatDateTime(appeal.createdAt)} · Decisionversion{" "}
              {appeal.decisionVersion}
            </p>
            <TrustSafetyAppealDecisionForm
              appealId={appeal.id}
              caseId={trustCase.id}
              companyId={trustCase.companyId}
              caseVersion={trustCase.version}
            />
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle as="h2">Containment-Effekte</CardTitle>
        </CardHeader>
        <CardContent>
          {trustCase.effects.length === 0 ? (
            <p className="text-muted-foreground">
              Noch keine fachliche Sperrwirkung.
            </p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {trustCase.effects.map((effect) => (
                <li key={effect.id} className="rounded-lg border p-3">
                  {effect.effectScope}: {effect.previousState} →{" "}
                  {effect.appliedState} ·{" "}
                  {effect.reversedAt ? "wiederhergestellt" : "wirksam"} ·{" "}
                  {effect.reversible ? "reversibel" : "nicht reversibel"}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Unveränderliche Fallhistorie</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-3">
            {trustCase.events.map((event) => (
              <li key={event.id} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">
                  {event.kind} · {event.reasonCode}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(event.createdAt)} · Actor{" "}
                  {event.actorUserId ?? "SYSTEM"}
                </p>
                {event.safeNote ? (
                  <p className="mt-2 whitespace-pre-wrap">{event.safeNote}</p>
                ) : null}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </section>
  );
}
