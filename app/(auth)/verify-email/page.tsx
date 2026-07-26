import type { Metadata } from "next";

import { AuthCard, AuthTextLink } from "@/components/auth/auth-card";
import { VerifyEmailForm } from "@/components/auth/verify-email-form";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "E-Mail-Adresse bestätigen",
  description: "E-Mail-Adresse für SwissTalentHub sicher bestätigen.",
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer",
};

export default async function VerifyEmailPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const query = await searchParams;
  const next = typeof query.next === "string" ? query.next : undefined;
  return (
    <AuthCard
      eyebrow="Identität bestätigen"
      title="E-Mail-Adresse bestätigen"
      description="Der Link ist einmalig und zeitlich begrenzt. Abgelaufene, ersetzte und bereits verwendete Links werden aus Sicherheitsgründen gleich behandelt."
      footer={
        <>
          Bereits bestätigt?{" "}
          <AuthTextLink href="/login">Zur Anmeldung</AuthTextLink>
        </>
      }
    >
      <VerifyEmailForm next={next} />
    </AuthCard>
  );
}
