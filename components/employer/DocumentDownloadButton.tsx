"use client";

import { useState } from "react";
import { DownloadIcon, LoaderCircleIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export function DocumentDownloadButton({
  applicationId,
  documentVersionId,
  safeFilename,
}: Readonly<{
  applicationId: string;
  documentVersionId: string;
  safeFilename: string;
}>) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function download() {
    setPending(true);
    setMessage("Einmalige Berechtigung wird geprüft …");
    try {
      const grantResponse = await fetch(
        `/api/documents/versions/${documentVersionId}/read-grants`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ applicationId }),
        },
      );
      const grant = await safeJson(grantResponse);
      if (!grantResponse.ok || typeof grant.token !== "string") {
        throw new Error(
          grant.code === "DOCUMENT_VAULT_UNAVAILABLE"
            ? "Der sichere Download ist derzeit deaktiviert."
            : "Die aktuelle Firmen- oder Stellenberechtigung reicht nicht mehr aus.",
        );
      }
      const readResponse = await fetch("/api/documents/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: grant.token }),
      });
      if (!readResponse.ok) {
        const failure = await safeJson(readResponse);
        throw new Error(
          failure.code === "GRANT_EXPIRED"
            ? "Die kurzlebige Freigabe ist abgelaufen. Bitte erneut versuchen."
            : "Der Vault ist vorübergehend nicht verfügbar.",
        );
      }
      const blob = await readResponse.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = safeFilename;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage("Einmaliger Download abgeschlossen.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Der Download konnte nicht sicher abgeschlossen werden.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid justify-items-start gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11"
        onClick={download}
        disabled={pending}
      >
        {pending ? (
          <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
        ) : (
          <DownloadIcon aria-hidden="true" />
        )}
        {pending ? "Berechtigung wird geprüft" : "CV einmalig herunterladen"}
      </Button>
      {message ? (
        <p className="text-xs leading-5 text-muted-foreground" aria-live="polite">
          {message}
        </p>
      ) : null}
    </div>
  );
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = (await response.json()) as unknown;
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
