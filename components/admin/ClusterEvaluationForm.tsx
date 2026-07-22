import { randomUUID } from "node:crypto";

import { AdminActionForm, adminInputClass } from "@/components/admin/action-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ClusterEvaluationForm({
  cantons,
  categories,
}: Readonly<{
  cantons: readonly Readonly<{ id: string; code: string; name: string }>[];
  categories: readonly Readonly<{ id: string; name: string }>[];
}>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Liquiditätscluster neu bewerten</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Die Bewertung liest ein halboffenes 30-Tage-Fenster und eine 90-Tage-Aktivitätsperiode. Sie erzeugt unveränderliche Evidenz; Demo- und Testdaten zählen nie.
        </p>
        <AdminActionForm
          operation="cluster-evaluate"
          label="Unveränderliche Bewertung erstellen"
          hidden={{ idempotencyKey: randomUUID() }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              Kanton
              <select name="cantonId" className={adminInputClass} required>
                {cantons.map((canton) => (
                  <option key={canton.id} value={canton.id}>{canton.code} · {canton.name}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Kategorie
              <select name="categoryId" className={adminInputClass} required>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
          </div>
        </AdminActionForm>
        <AdminActionForm
          operation="cluster-expire"
          label="Abgelaufene Aktivierungen projizieren"
          hidden={{ idempotencyKey: randomUUID() }}
          className="mt-4"
        />
      </CardContent>
    </Card>
  );
}
