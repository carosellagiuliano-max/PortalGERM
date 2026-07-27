import type { Metadata } from "next";

import { SecuritySettings } from "@/components/security/security-settings";
import { TrustAppeals } from "@/components/security/trust-appeals";
import { getSecurityPageModel } from "@/lib/auth/assurance/security-page";
import { requireEmployerPage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import { listOwnedTrustSafetyCases } from "@/lib/trust-safety/case-service";

export const metadata: Metadata = { title: "Kontosicherheit" };

export default async function EmployerSecurityPage() {
  const user = await requireEmployerPage();
  const [model, trustCases] = await Promise.all([
    getSecurityPageModel(user, "employer-security-settings-read"),
    listOwnedTrustSafetyCases(getDatabase(), user.id),
  ]);
  if (model === null) return null;
  return (
    <div className="grid gap-6">
      <header>
        <p className="eyebrow">Kontosicherheit</p>
        <h1 className="mt-2 text-3xl font-semibold">
          Sicherheitsfaktoren verwalten
        </h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Bestätige Billing-, Team-, Export- und Trust-Aktionen mit einer
          frischen, an diese Sitzung gebundenen Assurance.
        </p>
      </header>
      <SecuritySettings {...model} adminMfaRequired={false} />
      <TrustAppeals cases={trustCases} />
    </div>
  );
}
