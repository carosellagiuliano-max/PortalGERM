import { randomUUID } from "node:crypto";

import {
  AdminActionForm,
  adminInputClass,
} from "@/components/admin/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils/format";

export type SearchLearningReviewRow = Readonly<{
  id: string;
  windowStart: Date;
  locale: string;
  searchPolicyVersion: string;
  conceptKeys: readonly string[];
  reviewLabel: string | null;
  resultBucket: string;
  observationCount: number;
  status: "ACTIONABLE" | "REVIEWED";
  actionableAt: Date | null;
  expiresAt: Date;
  releaseOutcomeCode: string | null;
}>;

export function SearchLearningReview({
  rows,
}: Readonly<{ rows: readonly SearchLearningReviewRow[] }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Datenschutzarme Such-Lernqueue</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Sichtbar werden nur Tagesaggregate von mindestens zehn verschiedenen
          pseudonymen Beiträgern. Originale Rohsuchtexte, Kontaktdaten und
          Sitzungskennungen werden nie gespeichert oder angezeigt; erst ab der
          Schwelle erscheint der redigierte Normalbegriff für den Fachreview.
        </p>
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Aktuell gibt es keinen k-anonymen Suchbucket zur Prüfung.
          </p>
        ) : (
          <ul className="grid gap-3">
            {rows.map((row) => (
              <li key={row.id} className="grid gap-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{row.status}</Badge>
                  <Badge variant="outline">
                    {row.observationCount} unterschiedliche Beiträger
                  </Badge>
                  <Badge variant="outline">
                    Ergebnisbucket {row.resultBucket}
                  </Badge>
                </div>
                <p className="font-medium">
                  {row.reviewLabel ??
                    (row.conceptKeys.length > 0
                      ? row.conceptKeys.join(" · ")
                      : "Nicht aufgelöster, pseudonymisierter Suchbucket")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {row.locale} · {row.searchPolicyVersion} · Fenster{" "}
                  {formatDateTime(row.windowStart)} · verfällt{" "}
                  {formatDateTime(row.expiresAt)}
                </p>
                {row.status === "ACTIONABLE" ? (
                  <AdminActionForm
                    operation="search-learning-review"
                    label="Fachprüfung beginnen"
                    hidden={{
                      aggregateId: row.id,
                      action: "REVIEW",
                      reasonCode: "SEARCH_BUCKET_REVIEW_STARTED",
                      idempotencyKey: randomUUID(),
                    }}
                  />
                ) : (
                  <div className="grid gap-3 lg:grid-cols-2">
                    <AdminActionForm
                      operation="search-learning-review"
                      label="Als Release-Kandidat markieren"
                      hidden={{
                        aggregateId: row.id,
                        action: "PROMOTE",
                        reasonCode: "SEARCH_BUCKET_PROMOTED",
                        idempotencyKey: randomUUID(),
                      }}
                    >
                      <label className="grid gap-1 text-sm">
                        Freigabe-/Release-Referenz
                        <input
                          className={adminInputClass}
                          name="releaseOutcomeCode"
                          defaultValue="TAXONOMY_RELEASE_CANDIDATE"
                          pattern="[A-Z][A-Z0-9_.-]{1,63}"
                          required
                        />
                      </label>
                    </AdminActionForm>
                    <AdminActionForm
                      operation="search-learning-review"
                      label="Bucket verwerfen"
                      destructive
                      hidden={{
                        aggregateId: row.id,
                        action: "REJECT",
                        reasonCode: "SEARCH_BUCKET_REJECTED",
                        idempotencyKey: randomUUID(),
                      }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
