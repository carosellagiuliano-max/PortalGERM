import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  hasAdminCapability,
  PHASE_14_PRIVACY_ADMIN_CAPABILITIES,
} from "@/lib/admin/capabilities";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import { PrivacyRequestStatus } from "@/lib/generated/prisma/enums";
import { createPostgresPrivacyCaseService } from "@/lib/privacy/privacy-case-service";

export const metadata: Metadata = { title: "Datenschutzfälle" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

const AGE_LABELS = {
  LT_24_HOURS: "unter 24 Stunden",
  ONE_TO_THREE_DAYS: "1–3 Tage",
  FOUR_TO_SEVEN_DAYS: "4–7 Tage",
  EIGHT_TO_THIRTY_DAYS: "8–30 Tage",
  OVER_THIRTY_DAYS: "über 30 Tage",
} as const;

const DUE_LABELS = {
  OVERDUE: "überfällig",
  DUE_WITHIN_TWO_DAYS: "in höchstens 2 Tagen",
  DUE_WITHIN_SEVEN_DAYS: "in höchstens 7 Tagen",
  DUE_WITHIN_FOURTEEN_DAYS: "in höchstens 14 Tagen",
  DUE_LATER: "später fällig",
} as const;

export default async function AdminPrivacyRequestsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ status?: string }> }>) {
  const [admin, query] = await Promise.all([
    requireAdminPage(),
    searchParams,
  ]);
  const status = PrivacyRequestStatus[query.status as keyof typeof PrivacyRequestStatus];
  const actor = {
    userId: admin.id,
    capabilities: PHASE_14_PRIVACY_ADMIN_CAPABILITIES.filter((capability) =>
      hasAdminCapability(
        { userId: admin.id, role: admin.role, status: admin.status },
        capability,
      ),
    ),
  } as const;
  const result = await createPostgresPrivacyCaseService(getDatabase()).listAdminQueue(
    actor,
    { ...(status === undefined ? {} : { status }), limit: 50 },
    new Date(),
  );
  if (!result.ok) notFound();

  return (
    <div className="grid gap-6">
      <header>
        <p className="eyebrow">Privacy Operations · Mock</p>
        <h1 className="mt-2 text-3xl font-semibold">Datenschutzfälle</h1>
        <p className="mt-2 max-w-3xl leading-7 text-muted-foreground">
          Die Queue zeigt absichtlich nur Fallnummer, Typ, Status und grobe
          Zeitklassen. Personen- und Inhaltsdaten erscheinen erst im begründeten
          Einzelfallzugriff.
        </p>
      </header>

      <form method="get" className="flex flex-wrap gap-3 rounded-lg border bg-card p-3">
        <label className="grid gap-1 text-sm">
          Status
          <select
            name="status"
            defaultValue={status ?? ""}
            className="h-9 rounded-lg border px-3 text-sm"
          >
            <option value="">Alle Status</option>
            {Object.values(PrivacyRequestStatus).map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <button className="self-end rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">
          Filtern
        </button>
      </form>

      <div className="grid gap-3">
        {result.cases.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
            Keine Fälle in dieser Queue.
          </p>
        ) : (
          result.cases.map((privacyCase) => (
            <Link
              key={privacyCase.id}
              href={`/admin/privacy-requests/${privacyCase.id}?justification=QUEUE_TRIAGE`}
              className="grid gap-3 rounded-lg border bg-card p-4 hover:bg-muted/30 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div>
                <p className="font-mono text-sm">{privacyCase.id}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Alter: {AGE_LABELS[privacyCase.ageBucket]} · Ziel: {DUE_LABELS[privacyCase.dueBucket]}
                </p>
              </div>
              <div className="flex gap-2">
                <Badge variant="outline">{privacyCase.type}</Badge>
                <Badge variant={privacyCase.dueBucket === "OVERDUE" ? "destructive" : "secondary"}>
                  {privacyCase.status}
                </Badge>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
