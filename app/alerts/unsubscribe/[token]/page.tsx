import type { Metadata } from "next";
import Link from "next/link";
import { BellOffIcon } from "lucide-react";

import { JobAlertUnsubscribeForm } from "@/components/candidate/job-alert-unsubscribe-form";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const metadata: Metadata = {
  title: "Jobabo pausieren",
  referrer: "no-referrer",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};

export default async function JobAlertUnsubscribePage({
  params,
}: Readonly<{ params: Promise<{ token: string }> }>) {
  const { token } = await params;
  return (
    <main className="mx-auto grid min-h-[70vh] max-w-2xl place-items-center px-4 py-12">
      <Card className="w-full">
        <CardHeader>
          <span className="mb-2 grid size-12 place-items-center rounded-xl bg-secondary text-secondary-foreground">
            <BellOffIcon className="size-6" aria-hidden="true" />
          </span>
          <h1 className="font-heading text-xl font-medium leading-snug">
            Jobabo sicher pausieren
          </h1>
        </CardHeader>
        <CardContent className="grid gap-6">
          <JobAlertUnsubscribeForm token={token} />
          <p className="text-sm leading-6 text-muted-foreground">
            Du kannst ein Jobabo nach der Anmeldung wieder ausdrücklich
            aktivieren, sofern die separate Service-Zustellung freigegeben ist.
          </p>
          <Link href="/jobs" className="text-sm font-medium text-primary hover:underline">
            Zur Stellensuche
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
