"use client";

import Link from "next/link";
import { ArrowRightIcon, LockKeyholeIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { UpgradePrompt } from "@/lib/billing/upgrade-prompt";

export function UpgradeDialog({
  prompt,
  defaultOpen = false,
  triggerLabel = "Upgrade-Optionen anzeigen",
}: Readonly<{
  prompt: UpgradePrompt;
  defaultOpen?: boolean;
  triggerLabel?: string;
}>) {
  return (
    <Dialog defaultOpen={defaultOpen}>
      <DialogTrigger
        render={<Button type="button" variant="outline" className="w-fit" />}
      >
        <LockKeyholeIcon aria-hidden="true" />
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{prompt.title}</DialogTitle>
          <DialogDescription>{prompt.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>
            Später
          </DialogClose>
          <Link href={prompt.cta.href} className={buttonVariants()}>
            {prompt.cta.label}
            <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
