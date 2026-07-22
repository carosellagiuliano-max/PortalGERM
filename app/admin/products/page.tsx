import { randomUUID } from "node:crypto";
import type { Metadata } from "next";

import {
  AdminActionForm,
  adminInputClass,
} from "@/components/admin/action-form";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { listAdminProducts } from "@/lib/billing/admin-billing";
import { getDatabase } from "@/lib/db/client";
import { formatChfFromRappen, formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Produktkatalog" };

export default async function AdminProductsPage() {
  const user = await requireAdminPage();
  const now = new Date();
  const products = await listAdminProducts({
    actor: {
      userId: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    },
    correlationId: crypto.randomUUID(),
    database: getDatabase(),
    now,
  });
  if (products === null) return null;
  const future = new Date(now.getTime() + 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  return (
    <div className="grid gap-6">
      <header>
        <p className="eyebrow">Versionierter Katalog</p>
        <h1 className="mt-2 text-3xl font-semibold">Produkte</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          P1/P2- und Success-Fee-Versionen bleiben ohne Release-Entscheid,
          Handler und erlaubten Self-Service serverseitig gesperrt.
        </p>
      </header>
      <AdminActionForm
        operation="catalog-project-due"
        label="Fällige Versionen aktivieren"
      >
        <p className="text-sm text-muted-foreground">
          Aktiviert und beendet fällige Plan- und Produktversionen anhand der
          aktuellen Serverzeit. Der Vorgang ist wiederholbar und erzeugt keine
          doppelten Übergänge.
        </p>
      </AdminActionForm>
      <div className="grid gap-5">
        {products.map((product) => {
          const source = product.versions[0];
          const releaseScope = releaseScopeFor(product.type);
          const availableDecisions = product.releaseDecisions.filter(
            (decision) =>
              decision.releasedVersion === null &&
              decision.expiresAt.getTime() > now.getTime(),
          );
          return (
            <Card key={product.id}>
              <CardHeader>
                <CardTitle
                  as="h2"
                  className="flex flex-wrap items-center gap-2"
                >
                  {product.name}
                  <Badge variant="outline">{product.code}</Badge>
                  <Badge>{product.type}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                {product.versions.map((version) => (
                  <div
                    key={version.id}
                    className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto]"
                  >
                    <div>
                      <div className="flex gap-2">
                        <Badge variant="outline">v{version.version}</Badge>
                        <Badge>{version.status}</Badge>
                      </div>
                      <p className="mt-2 font-medium">
                        {formatChfFromRappen(version.netPriceRappen)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {version.creditAmount === null
                          ? "keine Credits"
                          : version.creditAmount + " " + version.creditType}{" · "}
                        {version.durationDays === null
                          ? "ohne Dauer"
                          : version.durationDays + " Tage"}
                      </p>
                    </div>
                    <div className="text-sm">
                      <p>
                        [{formatDateTime(version.validFrom)},{" "}
                        {version.validTo === null
                          ? "∞"
                          : formatDateTime(version.validTo)}
                        )
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {version.isPublic ? "öffentlich" : "intern"} ·{" "}
                        {version.isSelfService
                          ? "Self-Service"
                          : "kein Self-Service"}{" "}
                        · Priorität {version.priority}
                      </p>
                      <p className="text-muted-foreground">
                        {version.requiresLegalReview
                          ? "Legal Review erforderlich"
                          : "kein Legal-Review-Flag"}{" "}
                        · {version._count.orderLines} Order-Line(s)
                      </p>
                      {version.releaseDecisionId === null ? null : (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Release-Entscheid: {version.releaseDecisionId}
                        </p>
                      )}
                    </div>
                    {version.status === "INACTIVE" ? null : (
                      <AdminActionForm
                        operation="catalog-product-deactivate"
                        label="Deaktivieren"
                        destructive
                        hidden={{
                          versionId: version.id,
                          reasonCode: "CATALOG_AVAILABILITY_ENDED",
                          idempotencyKey: randomUUID(),
                        }}
                      />
                    )}
                  </div>
                ))}
                {releaseScope === null ? null : (
                  <AdminActionForm
                    operation="catalog-product-release-decide"
                    label="Release-Entscheid aufzeichnen"
                    hidden={{
                      productId: product.id,
                      allowsPublic: releaseScope.allowsPublic,
                      allowsSelfService: releaseScope.allowsSelfService,
                      idempotencyKey: randomUUID(),
                    }}
                  >
                    <p className="text-sm text-muted-foreground">
                      Dieser unveränderliche Entscheid erlaubt nur den exakt
                      ausgewiesenen P1-Scope. Er aktiviert noch keine Version
                      und kann Success Fee nicht freischalten.
                    </p>
                    <label className="grid gap-1 text-sm">
                      Entscheidgrund
                      <input
                        name="reasonCode"
                        defaultValue={`${releaseScope.tier}_PRODUCT_RELEASE_APPROVED`}
                        pattern="[A-Z][A-Z0-9_]{1,63}"
                        required
                        className={adminInputClass}
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      Begründung (mindestens 20 Zeichen)
                      <textarea
                        name="rationale"
                        minLength={20}
                        maxLength={1000}
                        required
                        className={adminInputClass}
                        defaultValue="Handler, Preis, Zielkontext und Betriebsverantwortung wurden geprüft."
                      />
                    </label>
                  </AdminActionForm>
                )}
                {product.releaseDecisions.length === 0 ? null : (
                  <div className="rounded-lg border p-3 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">Release-Entscheide</p>
                    <ul className="mt-2 grid gap-1">
                      {product.releaseDecisions.map((decision) => (
                        <li key={decision.id}>
                          {decision.releaseTier} · {decision.reasonCode} ·
                          {decision.allowsPublic ? " öffentlich" : " intern"} ·
                          {decision.allowsSelfService ? " Self-Service" : " kein Self-Service"} · {decision.releasedVersion === null ? "verfügbar" : `verwendet für v${decision.releasedVersion.version}`}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {source === undefined ? null : (
                  <AdminActionForm
                    operation="catalog-product-schedule"
                    label="Neue Produktversion terminieren"
                    hidden={{
                      productId: product.id,
                      sourceVersionId: source.id,
                      idempotencyKey: randomUUID(),
                    }}
                  >
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                      <label className="grid gap-1 text-sm">
                        Netto (Rappen)
                        <input
                          name="netPriceRappen"
                          type="number"
                          min="0"
                          defaultValue={source.netPriceRappen}
                          required
                          className={adminInputClass}
                        />
                      </label>
                      <label className="grid gap-1 text-sm">
                        Gültig ab
                        <input
                          name="validFrom"
                          type="date"
                          defaultValue={future}
                          required
                          className={adminInputClass}
                        />
                      </label>
                      <label className="grid gap-1 text-sm">
                        Gültig bis
                        <input
                          name="validTo"
                          type="date"
                          className={adminInputClass}
                        />
                      </label>
                      <label className="grid gap-1 text-sm">
                        Sichtbarkeit
                        <select
                          name="isPublic"
                          defaultValue={String(releaseScope?.allowsPublic ?? source.isPublic)}
                          className={adminInputClass}
                        >
                          <option value="true">öffentlich</option>
                          <option value="false">intern</option>
                        </select>
                      </label>
                      <label className="grid gap-1 text-sm">
                        Checkout
                        <select
                          name="isSelfService"
                          defaultValue={String(releaseScope?.allowsSelfService ?? source.isSelfService)}
                          className={adminInputClass}
                        >
                          <option value="true">Self-Service</option>
                          <option value="false">kein Self-Service</option>
                        </select>
                      </label>
                    </div>
                    <label className="grid gap-1 text-sm">
                      Release-Entscheid (für P1/P2 erforderlich)
                      <select name="releaseDecisionId" className={adminInputClass}>
                        <option value="">Kein Release-Entscheid</option>
                        {availableDecisions.map((decision) => (
                          <option key={decision.id} value={decision.id}>
                            {decision.releaseTier} · {decision.reasonCode} · {decision.id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-sm">
                      Pflichtgrund
                      <input
                        name="reasonCode"
                        defaultValue="FUTURE_PRICE_SCHEDULE"
                        pattern="[A-Z][A-Z0-9_]{1,63}"
                        required
                        className={adminInputClass}
                      />
                    </label>
                  </AdminActionForm>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function releaseScopeFor(productType: string) {
  if (productType === "ADDITIONAL_JOB") {
    return { tier: "P1", allowsPublic: true, allowsSelfService: true } as const;
  }
  if (productType === "IMPORT_SETUP") {
    return { tier: "P1", allowsPublic: false, allowsSelfService: false } as const;
  }
  return null;
}
