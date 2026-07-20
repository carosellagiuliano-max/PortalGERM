"use client";

import { useState } from "react";
import { CheckIcon, Share2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";

export function ShareButton({ title }: Readonly<{ title: string }>) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
      } else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2_000);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setCopied(false);
    }
  }

  return (
    <Button type="button" variant="outline" size="lg" onClick={share}>
      {copied ? <CheckIcon aria-hidden="true" /> : <Share2Icon aria-hidden="true" />}
      {copied ? "Link kopiert" : "Teilen"}
    </Button>
  );
}
