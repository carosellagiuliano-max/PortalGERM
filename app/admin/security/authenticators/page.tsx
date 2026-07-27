import type { Metadata } from "next";

import { SecuritySettings } from "@/components/security/security-settings";
import { SecurityTabs } from "@/components/admin/security-tabs";
import { getSecurityPageModel } from "@/lib/auth/assurance/security-page";
import { requireAdminPage } from "@/lib/auth/route-guards";

export const metadata: Metadata = { title: "Admin-Authentisierung" };

export default async function AdminAuthenticatorsPage() {
  const user = await requireAdminPage();
  const model = await getSecurityPageModel(
    user,
    "admin-security-authenticators-read",
  );
  if (model === null) return null;
  return (
    <div className="grid gap-6">
      <header>
        <p className="eyebrow">Phase 25A · Security</p>
        <h1 className="mt-2 text-3xl font-semibold">
          Passkeys, TOTP und Recovery
        </h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Registriere einen Passkey oder den kontrollierten TOTP-Fallback.
          Privilegierte Adminaktionen verlangen eine frische, serverseitig
          gespeicherte AAL2-Assurance.
        </p>
      </header>
      <SecurityTabs />
      <SecuritySettings {...model} />
    </div>
  );
}
