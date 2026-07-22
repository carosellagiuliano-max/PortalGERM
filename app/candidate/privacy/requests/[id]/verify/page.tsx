import { randomUUID } from "node:crypto";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PrivacyIdentityVerifyForm } from "@/components/candidate/privacy-identity-verify-form";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import { formatDateTime } from "@/lib/utils/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "Identität bestätigen",
  robots: { index: false, follow: false },
};

export default async function CandidatePrivacyVerifyPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const [{ id }, user] = await Promise.all([params, requireCandidatePage()]);
  const privacyCase = await getDatabase().privacyRequest.findFirst({
    where: {
      id,
      requesterUserId: user.id,
      status: "IDENTITY_CHECK",
      requester: { status: "ACTIVE", emailVerifiedAt: { not: null } },
    },
    select: {
      id: true,
      version: true,
      type: true,
      challenges: {
        where: { consumedAt: null },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { expiresAt: true, attempts: true, verifiedAt: true },
      },
    },
  });
  const challenge = privacyCase?.challenges[0] ?? null;
  if (privacyCase === null || challenge === null) notFound();

  return (
    <section className="mx-auto grid max-w-2xl gap-6" aria-labelledby="verify-title">
      <header>
        <p className="eyebrow">Geschützte Identitätsprüfung</p>
        <h1 id="verify-title" className="mt-2 text-3xl font-semibold">
          Datenschutzanfrage bestätigen
        </h1>
        <p className="mt-3 leading-7 text-muted-foreground">
          Für den Fall {privacyCase.id} ({privacyCase.type}). Die Bestätigung ist bis {formatDateTime(challenge.expiresAt)} gültig; höchstens fünf Versuche sind möglich.
        </p>
      </header>
      <Card>
        <CardHeader><CardTitle as="h2">Aktuelles Passwort prüfen</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm leading-6 text-muted-foreground">
            Das Passwort wird nur gegen deinen aktuellen Credential-Hash geprüft. Es wird nicht gespeichert, nicht protokolliert und nicht an Admins weitergegeben.
          </p>
          {challenge.verifiedAt ? (
            <p className="rounded-lg border bg-muted/20 p-3 text-sm">
              Die Identität wurde bereits bestätigt. Die Datenschutzstelle kann den Fall nun übernehmen.
            </p>
          ) : (
            <PrivacyIdentityVerifyForm
              requestId={privacyCase.id}
              version={privacyCase.version}
              idempotencyKey={randomUUID()}
            />
          )}
        </CardContent>
      </Card>
      <Link href={`/candidate/privacy/requests/${privacyCase.id}`} className={buttonVariants({ variant: "outline", className: "w-fit" })}>
        Zurück zum Fall
      </Link>
    </section>
  );
}
