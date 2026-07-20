import type { Metadata } from "next";

import { AuthCard, AuthTextLink } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Neues Passwort festlegen",
  description: "Ein neues Passwort für SwissTalentHub festlegen.",
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer",
};

export default function ResetPasswordPage() {
  return (
    <AuthCard
      eyebrow="Einmaliger Sicherheitslink"
      title="Neues Passwort festlegen"
      description="Wähle ein starkes neues Passwort. Ungültige, abgelaufene und bereits verwendete Links werden aus Sicherheitsgründen gleich behandelt."
      footer={
        <>
          Link nicht mehr gültig?{" "}
          <AuthTextLink href="/forgot-password">Neuen Link anfordern</AuthTextLink>
        </>
      }
    >
      <ResetPasswordForm />
    </AuthCard>
  );
}
