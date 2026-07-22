import Link from "next/link";
import { LockKeyholeIcon } from "lucide-react";

import { UpgradeDialog } from "@/components/billing/upgrade-dialog";
import { buttonVariants } from "@/components/ui/button";
import type { UpgradePrompt } from "@/lib/billing/upgrade-prompt";

export function PlanGate({
  allowed,
  title,
  explanation,
  upgradePrompt,
  children,
}: Readonly<{
  allowed: boolean;
  title: string;
  explanation: string;
  upgradePrompt?: UpgradePrompt;
  children: React.ReactNode;
}>) {
  if (allowed) return <>{children}</>;
  return (
    <div className="rounded-xl border border-dashed bg-muted/30 p-6">
      <LockKeyholeIcon className="size-6 text-muted-foreground" aria-hidden="true" />
      <h2 className="mt-3 text-lg font-semibold">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{explanation}</p>
      {upgradePrompt === undefined ? (
        <Link href="/pricing" className={buttonVariants({ variant: "outline", className: "mt-4" })}>
          Pläne vergleichen
        </Link>
      ) : (
        <div className="mt-4">
          <UpgradeDialog prompt={upgradePrompt} triggerLabel="Upgrade-Optionen anzeigen" />
        </div>
      )}
    </div>
  );
}
