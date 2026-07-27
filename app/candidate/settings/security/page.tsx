import type { Metadata } from "next";

import { SecuritySettings } from "@/components/security/security-settings";
import { TrustAppeals } from "@/components/security/trust-appeals";
import { getSecurityPageModel } from "@/lib/auth/assurance/security-page";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import { listOwnedTrustSafetyCases } from "@/lib/trust-safety/case-service";

export const metadata: Metadata = { title: "Kontosicherheit" };

export default async function CandidateSecurityPage() {
  const user = await requireCandidatePage();
  const [model, trustCases] = await Promise.all([
    getSecurityPageModel(user, "candidate-security-settings-read"),
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
          Passkeys, TOTP und einmalige Recovery-Codes schützen
          Datenschutz-, Radar- und Kontoaktionen.
        </p>
      </header>
      <SecuritySettings {...model} adminMfaRequired={false} />
      <TrustAppeals cases={trustCases} />
    </div>
  );
}
