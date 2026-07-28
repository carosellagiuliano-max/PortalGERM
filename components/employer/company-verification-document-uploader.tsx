"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  attachCompanyVerificationDocumentAction,
  type CompanyVerificationActionState,
} from "@/app/employer/verification/actions";
import { StepUpGrantControl } from "@/components/security/step-up-grant-control";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MAX_BYTES = 5 * 1024 * 1024;
const IDLE: CompanyVerificationActionState = Object.freeze({
  status: "idle",
  message: "",
});

export function CompanyVerificationDocumentUploader({
  companyId,
  verificationRequestId,
  stepUpRequired,
}: Readonly<{
  companyId: string;
  verificationRequestId: string;
  stepUpRequired: boolean;
}>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<CompanyVerificationActionState>(IDLE);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("verificationDocument");
    if (!(file instanceof File) || file.size < 1 || file.size > MAX_BYTES) {
      setState({
        status: "error",
        code: "INVALID_UPLOAD",
        message: "Wähle eine unterstützte Datei zwischen 1 Byte und 5 MB.",
      });
      return;
    }
    setPending(true);
    setState({
      status: "idle",
      message: "",
    });
    try {
      const intent = await jsonRequest(
        "/api/company-verification/documents/upload-intents",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            declaredMimeType: file.type,
            expectedSizeBytes: file.size,
            idempotencyKey: crypto.randomUUID(),
          }),
        },
      );
      const intentId = safeString(intent.intentId);
      const documentVersionId = safeString(intent.documentVersionId);
      if (intentId === null || documentVersionId === null) {
        throw new Error("INVALID_INTENT_RESPONSE");
      }
      await jsonRequest(`/api/documents/upload-intents/${intentId}/body`, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      await jsonRequest(`/api/documents/upload-intents/${intentId}/finalize`, {
        method: "POST",
      });
      const scan = await jsonRequest(
        `/api/documents/versions/${documentVersionId}/scan`,
        { method: "POST" },
      );
      if (scan.status !== "CLEAN") throw new Error("DOCUMENT_NOT_CLEAN");
      data.delete("verificationDocument");
      data.set("verificationRequestId", verificationRequestId);
      data.set("documentVersionId", documentVersionId);
      data.set("idempotencyKey", crypto.randomUUID());
      const attached = await attachCompanyVerificationDocumentAction(IDLE, data);
      setState(attached);
      if (attached.status === "success") {
        form.reset();
        router.refresh();
      }
    } catch {
      setState({
        status: "error",
        code: "UPLOAD_FAILED",
        message:
          "Das Dokument konnte nicht vollständig geprüft und zugeordnet werden. Es wurde kein Dokument-Trust erteilt.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="grid gap-4 rounded-xl border p-4 sm:p-5"
      onSubmit={submit}
    >
      <div>
        <h2 className="text-lg font-semibold">Optionales Prüfdokument</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          PDF, PNG, JPG oder WebP bis 5 MB. Die Datei bleibt privat,
          verschlüsselt und wird vor der Zuordnung auf Schadsoftware geprüft.
        </p>
      </div>
      {state.status === "idle" ? null : (
        <Alert
          aria-live="polite"
          variant={state.status === "error" ? "destructive" : "default"}
        >
          <AlertTitle>
            {state.status === "success" ? "Dokument zugeordnet" : "Nicht möglich"}
          </AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-2">
        <Label htmlFor="company-verification-document">Nachweisdatei</Label>
        <Input
          id="company-verification-document"
          name="verificationDocument"
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
          required
        />
      </div>
      {stepUpRequired ? (
        <StepUpGrantControl
          action="COMPANY_VERIFICATION_CHANGE"
          purpose="EMPLOYER_COMPANY_TRUST"
          resourceId={verificationRequestId}
          securityHref="/employer/settings/security"
          tenantId={companyId}
        />
      ) : null}
      <Button className="w-full sm:w-fit" disabled={pending} type="submit">
        {pending ? "Upload und Prüfung laufen …" : "Dokument sicher prüfen"}
      </Button>
    </form>
  );
}

async function jsonRequest(path: string, init: RequestInit) {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(payload)) {
    throw new Error("SAFE_DOCUMENT_REQUEST_FAILED");
  }
  return payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
