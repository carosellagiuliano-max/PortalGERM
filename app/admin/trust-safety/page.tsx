import type { Metadata } from "next";
import Link from "next/link";

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
import { listTrustSafetyCases } from "@/lib/trust-safety/case-service";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Trust & Safety" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  status?: string | string[];
  assignee?: string | string[];
  cursor?: string | string[];
}>;

export default async function TrustSafetyQueuePage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const [actor, query] = await Promise.all([
    requireAdminPage(),
    searchParams,
  ]);
  const result = await listTrustSafetyCases(
    {
      actor: {
        userId: actor.id,
        email: actor.email,
        role: actor.role,
        status: actor.status,
        sessionId: actor.sessionId,
        capabilities: actor.capabilities,
      },
      correlationId: "trust-safety-queue-read",
      database: getDatabase(),
      now: new Date(),
    },
    {
      status: scalar(query.status),
      assigneeUserId: scalar(query.assignee),
      cursor: scalar(query.cursor),
    },
  );
  if (result === null) return null;
  return (
    <section aria-labelledby="trust-queue-title" className="grid gap-6">
      <header>
        <p className="eyebrow">Security Operations</p>
        <h1 id="trust-queue-title" className="mt-2 text-3xl font-semibold">
          Trust-&amp;-Safety-Fälle
        </h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Versionierte Signale eröffnen nachvollziehbare Reviews. Ein Signal
          allein löscht nichts irreversibel; Hold, Revoke, Restore und Appeal
          benötigen serverseitige Rechte und frische Bestätigung.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Queue</CardTitle>
        </CardHeader>
        <CardContent>
          {result.rows.length === 0 ? (
            <p className="text-muted-foreground">Keine passenden Fälle.</p>
          ) : (
            <div className="grid gap-3">
              {result.rows.map((trustCase) => (
                <Link
                  key={trustCase.id}
                  href={`/admin/trust-safety/${trustCase.id}`}
                  className="grid gap-2 rounded-xl border p-4 hover:bg-muted/30 sm:grid-cols-[1fr_auto]"
                >
                  <div>
                    <p className="font-medium">
                      {trustCase.category} · {trustCase.subjectType}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {trustCase.safeReasonCode} · Review{" "}
                      {formatDateTime(trustCase.reviewDueAt)}
                    </p>
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                      {trustCase.id}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    <Badge variant="outline">{trustCase.severity}</Badge>
                    <Badge>{trustCase.status}</Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
          {result.nextCursor === null ? null : (
            <Link
              className={buttonVariants({
                variant: "outline",
                className: "mt-4",
              })}
              href={`/admin/trust-safety?cursor=${result.nextCursor}`}
            >
              Weitere Fälle
            </Link>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function scalar(value: string | string[] | undefined) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
