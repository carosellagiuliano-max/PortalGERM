"use client";

import { useRef, useState } from "react";
import {
  CheckCircle2Icon,
  DownloadIcon,
  FileWarningIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UploadCloudIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MAXIMUM_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

type VaultVersion = Readonly<{
  id: string;
  safeFilename: string;
  declaredMimeType: string;
  detectedMimeType: string | null;
  sizeBytes: number | null;
  status: string;
  sequence: number;
}>;

type UiState =
  | "EMPTY"
  | "UPLOADING"
  | "FINALIZING"
  | "QUARANTINED"
  | "SCANNING"
  | "CLEAN"
  | "REJECTED"
  | "INFECTED"
  | "SCAN_FAILED"
  | "CONFLICT"
  | "DELETE_PENDING"
  | "EXPIRED_GRANT"
  | "REVOKED"
  | "PROVIDER_DEGRADED"
  | "SUCCESS";

export function DocumentVaultCard({
  enabled,
  cleanReadsEnabled,
  initialVersions,
  currentVersionId,
}: Readonly<{
  enabled: boolean;
  cleanReadsEnabled: boolean;
  initialVersions: readonly VaultVersion[];
  currentVersionId: string | null;
}>) {
  const initialCurrent =
    initialVersions.find((version) => version.id === currentVersionId) ??
    initialVersions[0] ??
    null;
  const [version, setVersion] = useState<VaultVersion | null>(initialCurrent);
  const [state, setState] = useState<UiState>(() =>
    mapVersionStatus(initialCurrent?.status),
  );
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState(
    enabled
      ? initialCurrent === null
        ? "Noch kein CV im sicheren Vault."
        : statusMessage(mapVersionStatus(initialCurrent.status))
      : "Der Byte-Vault ist deaktiviert. Legacy-Metadaten bleiben nicht downloadbar.",
  );
  const [selected, setSelected] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  async function upload() {
    if (selected === null || busy) return;
    setBusy(true);
    setState("UPLOADING");
    setProgress(0);
    setMessage("Upload wird verschlüsselt in die Quarantäne übertragen.");
    focusStatus(statusRef);
    try {
      const intentResponse = await fetch("/api/documents/upload-intents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: selected.name,
          declaredMimeType: selected.type,
          expectedSizeBytes: selected.size,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const intent = await readJson(intentResponse);
      if (
        !intentResponse.ok ||
        typeof intent.intentId !== "string" ||
        typeof intent.documentVersionId !== "string"
      ) {
        throw uiFailure(intent.code);
      }
      await uploadFileWithProgress(
        `/api/documents/upload-intents/${intent.intentId}/body`,
        selected,
        setProgress,
      );
      setState("QUARANTINED");
      setMessage("Upload abgeschlossen. Die Datei ist in Quarantäne und noch nicht lesbar.");

      setState("FINALIZING");
      setMessage("Provider-Receipt, Grösse und Hash werden abgeglichen.");
      const finalizeResponse = await fetch(
        `/api/documents/upload-intents/${intent.intentId}/finalize`,
        { method: "POST" },
      );
      const finalized = await readJson(finalizeResponse);
      if (!finalizeResponse.ok) throw uiFailure(finalized.code);

      const uploadedVersion: VaultVersion = {
        id: intent.documentVersionId,
        safeFilename: selected.name,
        declaredMimeType: selected.type,
        detectedMimeType: null,
        sizeBytes: selected.size,
        status: "QUARANTINED",
        sequence: (version?.sequence ?? 0) + 1,
      };
      setVersion(uploadedVersion);
      setState("SCANNING");
      setMessage("Dateityp und Sicherheitsrichtlinien werden geprüft.");
      const scanResponse = await fetch(
        `/api/documents/versions/${intent.documentVersionId}/scan`,
        { method: "POST" },
      );
      const scanned = await readJson(scanResponse);
      if (!scanResponse.ok || typeof scanned.status !== "string") {
        throw uiFailure(scanned.code);
      }
      const terminal = mapVersionStatus(scanned.status);
      setState(terminal);
      setMessage(statusMessage(terminal));
      setVersion({
        ...uploadedVersion,
        detectedMimeType: terminal === "CLEAN" ? selected.type : null,
        status: scanned.status,
      });
      setSelected(null);
      if (fileInput.current !== null) fileInput.current.value = "";
    } catch (error) {
      const failure =
        error instanceof Error ? error.message : "PROVIDER_DEGRADED";
      const next =
        failure === "UPLOAD_CONFLICT"
          ? "CONFLICT"
          : failure === "INTENT_EXPIRED"
            ? "CONFLICT"
            : failure === "INFECTED"
              ? "INFECTED"
              : "PROVIDER_DEGRADED";
      setState(next);
      setMessage(statusMessage(next));
    } finally {
      setBusy(false);
      focusStatus(statusRef);
    }
  }

  async function retryScan() {
    if (version === null || busy) return;
    setBusy(true);
    setState("SCANNING");
    setMessage("Der Sicherheitscheck wird erneut ausgeführt.");
    try {
      const response = await fetch(
        `/api/documents/versions/${version.id}/scan`,
        { method: "POST" },
      );
      const payload = await readJson(response);
      if (!response.ok || typeof payload.status !== "string") {
        throw uiFailure(payload.code);
      }
      const terminal = mapVersionStatus(payload.status);
      setState(terminal);
      setMessage(statusMessage(terminal));
      setVersion({ ...version, status: payload.status });
      setSelected(null);
      if (fileInput.current !== null) fileInput.current.value = "";
    } catch {
      setState("PROVIDER_DEGRADED");
      setMessage(statusMessage("PROVIDER_DEGRADED"));
    } finally {
      setBusy(false);
      focusStatus(statusRef);
    }
  }

  async function download() {
    if (version === null || busy || !cleanReadsEnabled) return;
    setBusy(true);
    try {
      const grantResponse = await fetch(
        `/api/documents/versions/${version.id}/read-grants`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      const grant = await readJson(grantResponse);
      if (!grantResponse.ok || typeof grant.token !== "string") {
        throw uiFailure(grant.code);
      }
      const response = await fetch("/api/documents/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: grant.token }),
      });
      if (!response.ok) {
        const failure = await readJson(response);
        throw uiFailure(failure.code);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = version.safeFilename;
      anchor.click();
      URL.revokeObjectURL(url);
      setState("SUCCESS");
      setMessage("Der einmalige Download wurde sicher abgeschlossen.");
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const next =
        code === "GRANT_EXPIRED"
          ? "EXPIRED_GRANT"
          : code === "GRANT_REVOKED"
            ? "REVOKED"
            : "PROVIDER_DEGRADED";
      setState(next);
      setMessage(statusMessage(next));
    } finally {
      setBusy(false);
      focusStatus(statusRef);
    }
  }

  async function requestDeletion() {
    if (version === null || busy) return;
    if (!window.confirm("CV zur geprüften Löschung vormerken? Bestehende Bewerbungsnachweise bleiben unverändert.")) {
      return;
    }
    setBusy(true);
    const response = await fetch(
      `/api/documents/versions/${version.id}/delete-request`,
      { method: "POST" },
    );
    if (response.ok) {
      setState("DELETE_PENDING");
      setMessage(
        "Löschung vorgemerkt. Die fachliche Prüfung erfolgt über die Datenschutz- und Legal-Hold-Policy.",
      );
      setVersion({ ...version, status: "DELETE_PENDING" });
    } else {
      setState("PROVIDER_DEGRADED");
      setMessage(statusMessage("PROVIDER_DEGRADED"));
    }
    setBusy(false);
    focusStatus(statusRef);
  }

  const canUpload = enabled && !busy;
  const canRead =
    cleanReadsEnabled &&
    version !== null &&
    (version.status === "CLEAN" || version.status === "REPLACED") &&
    !busy;

  return (
    <div className="grid gap-5" data-document-vault="true">
      {!enabled ? (
        <Alert>
          <ShieldCheckIcon aria-hidden="true" />
          <AlertTitle>Sicherer Dokumenten-Vault deaktiviert</AlertTitle>
          <AlertDescription>
            Es werden über diesen Bereich keine Dateibytes angenommen. Der
            produktive Storage-/Scanner-Vertrag benötigt noch die späteren
            Datenschutz-, Worker- und Step-up-Gates.
          </AlertDescription>
        </Alert>
      ) : null}

      <div
        ref={statusRef}
        tabIndex={-1}
        className="grid gap-2 rounded-xl border bg-muted/20 p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-live="polite"
        aria-atomic="true"
        data-vault-state={state}
      >
        <div className="flex flex-wrap items-center gap-2 font-semibold">
          {statusIcon(state)}
          <span>{statusLabel(state)}</span>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">{message}</p>
        {version === null ? null : (
          <p className="break-words text-sm">
            {version.safeFilename}
            {version.sizeBytes === null
              ? ""
              : ` · ${formatBytes(version.sizeBytes)}`}
            {version.sequence > 0 ? ` · Version ${version.sequence}` : ""}
          </p>
        )}
        {state === "UPLOADING" ? (
          <div className="grid gap-1">
            <progress
              className="h-2 w-full"
              max={100}
              value={progress}
              aria-label={`Uploadfortschritt ${progress} Prozent`}
            />
            <span className="text-xs text-muted-foreground">
              {progress} % übertragen
            </span>
          </div>
        ) : null}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="vault-cv">
          CV hochladen oder ersetzen (PDF, PNG, JPEG, WebP)
        </Label>
        <Input
          ref={fileInput}
          id="vault-cv"
          type="file"
          className="min-h-11"
          accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
          disabled={!canUpload}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0] ?? null;
            const error = validateFile(file);
            if (error !== null) {
              setSelected(null);
              setState("REJECTED");
              setMessage(error);
              event.currentTarget.value = "";
              focusStatus(statusRef);
              return;
            }
            setSelected(file);
            setState(version === null ? "EMPTY" : mapVersionStatus(version.status));
            setMessage(
              file === null
                ? statusMessage(mapVersionStatus(version?.status))
                : `${file.name} ist bereit für den quarantänebasierten Upload.`,
            );
          }}
        />
        <p className="text-xs leading-5 text-muted-foreground">
          Maximal 5 MB. Der Server prüft deklarierte und tatsächliche Bytes,
          Dateisignatur, MIME-Typ und Sicherheitsrichtlinien.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          onClick={upload}
          disabled={!canUpload || selected === null}
          className="min-h-11"
        >
          <UploadCloudIcon aria-hidden="true" />
          {version === null ? "Sicher hochladen" : "CV ersetzen"}
        </Button>
        {state === "SCAN_FAILED" || state === "PROVIDER_DEGRADED" ? (
          <Button
            type="button"
            variant="outline"
            onClick={retryScan}
            disabled={version === null || busy}
            className="min-h-11"
          >
            <RefreshCwIcon aria-hidden="true" />
            Scan erneut versuchen
          </Button>
        ) : null}
        {version !== null ? (
          <Button
            type="button"
            variant="outline"
            onClick={download}
            disabled={!canRead}
            className="min-h-11"
          >
            <DownloadIcon aria-hidden="true" />
            Einmalig herunterladen
          </Button>
        ) : null}
        {version !== null &&
        (version.status === "CLEAN" || version.status === "REPLACED") ? (
          <Button
            type="button"
            variant="outline"
            onClick={requestDeletion}
            disabled={busy}
            className="min-h-11"
          >
            <Trash2Icon aria-hidden="true" />
            Löschung vormerken
          </Button>
        ) : null}
      </div>
    </div>
  );
}

async function uploadFileWithProgress(
  url: string,
  file: File,
  onProgress: (value: number) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      try {
        const payload = JSON.parse(request.responseText) as { code?: string };
        reject(uiFailure(payload.code));
      } catch {
        reject(uiFailure("PROVIDER_DEGRADED"));
      }
    });
    request.addEventListener("error", () =>
      reject(uiFailure("PROVIDER_DEGRADED")),
    );
    request.send(file);
  });
}

function validateFile(file: File | null): string | null {
  if (file === null) return null;
  if (file.size <= 0 || file.size > MAXIMUM_BYTES) {
    return "Die Datei muss zwischen 1 Byte und 5 MB gross sein.";
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return "Erlaubt sind ausschliesslich PDF, PNG, JPEG oder WebP.";
  }
  if (
    /[\/\\\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(file.name)
  ) {
    return "Der Dateiname enthält nicht erlaubte Zeichen.";
  }
  return null;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = (await response.json()) as unknown;
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function uiFailure(code: unknown): Error {
  return new Error(typeof code === "string" ? code : "PROVIDER_DEGRADED");
}

function mapVersionStatus(value: string | undefined): UiState {
  if (value === "CLEAN" || value === "REPLACED") return "CLEAN";
  if (value === "REJECTED") return "REJECTED";
  if (value === "INFECTED") return "INFECTED";
  if (value === "SCAN_FAILED") return "SCAN_FAILED";
  if (value === "DELETE_PENDING" || value === "HELD") return "DELETE_PENDING";
  if (value === "QUARANTINED") return "QUARANTINED";
  if (value === "SCANNING") return "SCANNING";
  if (value === "UPLOADING") return "UPLOADING";
  return "EMPTY";
}

function statusLabel(state: UiState): string {
  const labels: Record<UiState, string> = {
    EMPTY: "Kein CV im Vault",
    UPLOADING: "Upload läuft",
    FINALIZING: "Upload wird finalisiert",
    QUARANTINED: "In Quarantäne",
    SCANNING: "Sicherheitscheck läuft",
    CLEAN: "Geprüft und freigegeben",
    REJECTED: "Datei abgewiesen",
    INFECTED: "Sicherheitsrisiko erkannt",
    SCAN_FAILED: "Sicherheitscheck fehlgeschlagen",
    CONFLICT: "Uploadkonflikt",
    DELETE_PENDING: "Löschung vorgemerkt",
    EXPIRED_GRANT: "Downloadfreigabe abgelaufen",
    REVOKED: "Downloadfreigabe widerrufen",
    PROVIDER_DEGRADED: "Vault vorübergehend nicht verfügbar",
    SUCCESS: "Download abgeschlossen",
  };
  return labels[state];
}

function statusMessage(state: UiState): string {
  const messages: Record<UiState, string> = {
    EMPTY: "Noch kein CV im sicheren Vault.",
    UPLOADING: "Die Datei wird begrenzt und verschlüsselt übertragen.",
    FINALIZING: "Grösse und Hash werden mit dem Provider abgeglichen.",
    QUARANTINED: "Die Datei bleibt bis zum erfolgreichen Scan nicht lesbar.",
    SCANNING: "Dateityp und Sicherheitsrichtlinien werden geprüft.",
    CLEAN: "Diese Version ist geprüft und kann für Bewerbungen verwendet werden.",
    REJECTED: "Dateityp, Dateisignatur oder Dateiinhalt erfüllen die Richtlinie nicht.",
    INFECTED: "Die Datei bleibt gesperrt. Details werden aus Sicherheitsgründen nicht angezeigt.",
    SCAN_FAILED: "Die Datei bleibt gesperrt. Du kannst den Scan erneut versuchen.",
    CONFLICT: "Ein anderer aktiver Upload ist vorhanden oder der Intent ist abgelaufen.",
    DELETE_PENDING: "Die Bytes bleiben bis zur Phase-22-Policy und Legal-Hold-Prüfung gesperrt erhalten.",
    EXPIRED_GRANT: "Fordere eine neue einmalige Downloadfreigabe an.",
    REVOKED: "Die aktuelle Berechtigung gilt nicht mehr.",
    PROVIDER_DEGRADED: "Es wurden keine unsicheren Fallbacks verwendet. Bitte versuche es später erneut.",
    SUCCESS: "Der einmalige Download wurde verbraucht.",
  };
  return messages[state];
}

function statusIcon(state: UiState) {
  if (state === "CLEAN" || state === "SUCCESS") {
    return <CheckCircle2Icon className="size-5 text-emerald-600" aria-hidden="true" />;
  }
  if (
    state === "UPLOADING" ||
    state === "FINALIZING" ||
    state === "SCANNING"
  ) {
    return <LoaderCircleIcon className="size-5 animate-spin" aria-hidden="true" />;
  }
  if (
    state === "REJECTED" ||
    state === "INFECTED" ||
    state === "SCAN_FAILED" ||
    state === "PROVIDER_DEGRADED"
  ) {
    return <FileWarningIcon className="size-5 text-amber-600" aria-hidden="true" />;
  }
  return <ShieldCheckIcon className="size-5 text-primary" aria-hidden="true" />;
}

function focusStatus(ref: React.RefObject<HTMLDivElement | null>) {
  window.setTimeout(() => ref.current?.focus(), 0);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  return `${Math.ceil(value / 1024)} KB`;
}
