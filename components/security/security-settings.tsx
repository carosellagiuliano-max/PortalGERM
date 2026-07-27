"use client";

import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { useMemo, useState, useTransition } from "react";

import {
  authenticateTotpAction,
  beginTotpEnrollmentAction,
  beginWebAuthnAuthenticationAction,
  beginWebAuthnEnrollmentAction,
  completeTotpEnrollmentAction,
  completeWebAuthnAuthenticationAction,
  completeWebAuthnEnrollmentAction,
  consumeRecoveryCodeAction,
  revokeAuthenticatorAction,
  type SecurityActionResult,
} from "@/app/security/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type AuthenticatorSummary = Readonly<{
  id: string;
  kind: "WEBAUTHN" | "TOTP";
  status: "PENDING" | "ACTIVE" | "REVOKED" | "COMPROMISED";
  label: string;
  verifiedAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}>;

type AssuranceSummary = Readonly<{
  level: "AAL1" | "AAL2" | "RECOVERY";
  method: string;
  verifiedAt: string;
  expiresAt: string;
}> | null;

type TotpEnrollment = Readonly<{
  authenticatorId: string;
  challengeId: string;
  secret: string;
  uri: string;
  expiresAt: string;
}>;

export function SecuritySettings({
  authenticators,
  assurance,
  remainingRecoveryCodes,
  adminMfaRequired,
}: Readonly<{
  authenticators: readonly AuthenticatorSummary[];
  assurance: AssuranceSummary;
  remainingRecoveryCodes: number;
  adminMfaRequired: boolean;
}>) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [label, setLabel] = useState("Mein Sicherheitsgerät");
  const [totpEnrollment, setTotpEnrollment] =
    useState<TotpEnrollment | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [authenticationCode, setAuthenticationCode] = useState("");
  const [selectedTotp, setSelectedTotp] = useState(
    () =>
      authenticators.find(
        (factor) => factor.kind === "TOTP" && factor.status === "ACTIVE",
      )?.id ?? "",
  );
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[] | null>(
    null,
  );
  const activeFactors = useMemo(
    () => authenticators.filter((factor) => factor.status === "ACTIVE"),
    [authenticators],
  );

  function run<T>(
    operation: () => Promise<SecurityActionResult<T>>,
    successMessage: string,
    onSuccess?: (value: Readonly<T>) => void,
  ) {
    setMessage(null);
    startTransition(async () => {
      const result = await operation();
      if (!result.ok) {
        setMessage({ kind: "error", text: result.message });
        return;
      }
      onSuccess?.(result.value);
      setMessage({ kind: "success", text: successMessage });
    });
  }

  function beginPasskey() {
    run(
      async () => {
        const started = await beginWebAuthnEnrollmentAction(label);
        if (!started.ok) return started;
        try {
          const response = await startRegistration({
            optionsJSON: started.value.options,
          });
          return completeWebAuthnEnrollmentAction({
            authenticatorId: started.value.authenticatorId,
            challengeId: started.value.challengeId,
            response,
          });
        } catch {
          return {
            ok: false,
            code: "CANCELLED",
            message:
              "Die Passkey-Anfrage wurde abgebrochen oder vom Gerät nicht unterstützt.",
          } as const;
        }
      },
      "Der Passkey ist aktiv. Speichere die neuen Wiederherstellungscodes.",
      (value) => setRecoveryCodes(value.recoveryCodes),
    );
  }

  function verifyPasskey() {
    run(
      async () => {
        const started = await beginWebAuthnAuthenticationAction();
        if (!started.ok) return started;
        try {
          const response = await startAuthentication({
            optionsJSON: started.value.options,
          });
          return completeWebAuthnAuthenticationAction({
            challengeId: started.value.challengeId,
            response,
          });
        } catch {
          return {
            ok: false,
            code: "CANCELLED",
            message:
              "Die Passkey-Bestätigung wurde abgebrochen oder ist fehlgeschlagen.",
          } as const;
        }
      },
      "Die aktuelle Sitzung besitzt jetzt frische AAL2-Assurance.",
    );
  }

  return (
    <div className="grid gap-6">
      {adminMfaRequired ? (
        <div
          className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4"
          role="status"
        >
          <strong>Admin-MFA ist verpflichtend.</strong>
          <p className="mt-1 text-sm text-muted-foreground">
            Andere Adminbereiche bleiben gesperrt, bis diese Sitzung mit einem
            aktiven Faktor als AAL2 bestätigt ist.
          </p>
        </div>
      ) : null}

      {message ? (
        <div
          className={
            message.kind === "error"
              ? "rounded-lg border border-destructive/40 p-4 text-sm text-destructive"
              : "rounded-lg border border-emerald-500/40 p-4 text-sm text-emerald-700 dark:text-emerald-300"
          }
          role={message.kind === "error" ? "alert" : "status"}
          tabIndex={-1}
        >
          {message.text}
        </div>
      ) : null}

      <section className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Aktuelle Sitzung</p>
            <h2 className="mt-1 text-xl font-semibold">Assurance</h2>
          </div>
          <Badge
            variant={assurance?.level === "AAL2" ? "secondary" : "outline"}
          >
            {assurance?.level ?? "AAL1"}
          </Badge>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {assurance === null
            ? "Diese Sitzung wurde noch nicht mit einem zweiten Faktor bestätigt."
            : `${assurance.method} bestätigt; gültig bis ${formatDate(assurance.expiresAt)}.`}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {activeFactors.some((factor) => factor.kind === "WEBAUTHN") ? (
            <Button disabled={pending} onClick={verifyPasskey} type="button">
              Mit Passkey bestätigen
            </Button>
          ) : null}
        </div>
        {activeFactors.some((factor) => factor.kind === "TOTP") ? (
          <form
            className="mt-4 grid max-w-xl gap-3 sm:grid-cols-[1fr_10rem_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              run(
                () =>
                  authenticateTotpAction({
                    authenticatorId: selectedTotp,
                    code: authenticationCode,
                  }),
                "Die aktuelle Sitzung besitzt jetzt frische AAL2-Assurance.",
                () => setAuthenticationCode(""),
              );
            }}
          >
            <label className="grid gap-1 text-sm">
              TOTP-Gerät
              <select
                className="h-10 rounded-lg border bg-background px-3"
                onChange={(event) => setSelectedTotp(event.target.value)}
                value={selectedTotp}
              >
                {activeFactors
                  .filter((factor) => factor.kind === "TOTP")
                  .map((factor) => (
                    <option key={factor.id} value={factor.id}>
                      {factor.label}
                    </option>
                  ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              6-stelliger Code
              <input
                autoComplete="one-time-code"
                className="h-10 rounded-lg border bg-background px-3 font-mono"
                inputMode="numeric"
                maxLength={6}
                onChange={(event) => setAuthenticationCode(event.target.value)}
                pattern="[0-9]{6}"
                required
                value={authenticationCode}
              />
            </label>
            <Button
              className="self-end"
              disabled={pending || selectedTotp === ""}
              type="submit"
            >
              Bestätigen
            </Button>
          </form>
        ) : null}
      </section>

      <section className="rounded-xl border bg-card p-5">
        <p className="eyebrow">Bevorzugter Faktor</p>
        <h2 className="mt-1 text-xl font-semibold">Passkey registrieren</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Der private Schlüssel bleibt auf deinem Gerät. Server und Browser
          binden jede Challenge an diese Sitzung, Origin und RP-ID.
        </p>
        <label className="mt-4 grid max-w-md gap-1 text-sm">
          Gerätename
          <input
            className="h-10 rounded-lg border bg-background px-3"
            maxLength={100}
            minLength={2}
            onChange={(event) => setLabel(event.target.value)}
            value={label}
          />
        </label>
        <Button
          className="mt-3"
          disabled={pending || label.trim().length < 2}
          onClick={beginPasskey}
          type="button"
        >
          Passkey registrieren
        </Button>
      </section>

      <section className="rounded-xl border bg-card p-5">
        <p className="eyebrow">Kontrollierter Fallback</p>
        <h2 className="mt-1 text-xl font-semibold">TOTP registrieren</h2>
        {totpEnrollment === null ? (
          <>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              TOTP ist der kontrollierte Fallback, falls kein Passkey-Gerät
              verfügbar ist. Der Schlüssel wird serverseitig verschlüsselt.
            </p>
            <Button
              className="mt-4"
              disabled={pending || label.trim().length < 2}
              onClick={() =>
                run(
                  () => beginTotpEnrollmentAction(label),
                  "TOTP-Enrollment gestartet. Übertrage den Schlüssel in deine Authenticator-App.",
                  setTotpEnrollment,
                )
              }
              type="button"
              variant="outline"
            >
              TOTP einrichten
            </Button>
          </>
        ) : (
          <div className="mt-4 grid gap-4">
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="text-sm font-medium">
                Manueller Schlüssel (nur jetzt sichtbar)
              </p>
              <code className="mt-2 block break-all text-sm">
                {totpEnrollment.secret}
              </code>
              <details className="mt-3 text-sm">
                <summary>OTP-URI anzeigen</summary>
                <code className="mt-2 block break-all text-xs">
                  {totpEnrollment.uri}
                </code>
              </details>
              <p className="mt-3 text-xs text-muted-foreground">
                Enrollment läuft bis {formatDate(totpEnrollment.expiresAt)}.
              </p>
            </div>
            <form
              className="flex max-w-md flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                run(
                  () =>
                    completeTotpEnrollmentAction({
                      authenticatorId: totpEnrollment.authenticatorId,
                      challengeId: totpEnrollment.challengeId,
                      code: totpCode,
                    }),
                  "TOTP ist aktiv. Speichere die neuen Wiederherstellungscodes.",
                  (value) => {
                    setRecoveryCodes(value.recoveryCodes);
                    setTotpEnrollment(null);
                    setTotpCode("");
                  },
                );
              }}
            >
              <label className="grid flex-1 gap-1 text-sm">
                Erster 6-stelliger Code
                <input
                  autoComplete="one-time-code"
                  className="h-10 rounded-lg border bg-background px-3 font-mono"
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) => setTotpCode(event.target.value)}
                  pattern="[0-9]{6}"
                  required
                  value={totpCode}
                />
              </label>
              <Button disabled={pending} type="submit">
                TOTP aktivieren
              </Button>
            </form>
          </div>
        )}
      </section>

      {recoveryCodes ? (
        <section
          className="rounded-xl border border-amber-500/50 bg-amber-500/5 p-5"
          aria-labelledby="recovery-codes-heading"
        >
          <p className="eyebrow">Einmalige Anzeige</p>
          <h2 className="mt-1 text-xl font-semibold" id="recovery-codes-heading">
            Wiederherstellungscodes speichern
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Jeder Code funktioniert genau einmal. Nach Verlassen dieser Seite
            werden die Klartextcodes nicht erneut geladen.
          </p>
          <ul className="mt-4 grid gap-2 font-mono sm:grid-cols-2">
            {recoveryCodes.map((code) => (
              <li className="rounded border bg-background px-3 py-2" key={code}>
                {code}
              </li>
            ))}
          </ul>
          <Button
            className="mt-4"
            onClick={() => setRecoveryCodes(null)}
            type="button"
            variant="outline"
          >
            Ich habe sie sicher gespeichert
          </Button>
        </section>
      ) : null}

      <section className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Aktive Geräte</p>
            <h2 className="mt-1 text-xl font-semibold">Faktoren verwalten</h2>
          </div>
          <Badge variant="outline">{activeFactors.length} aktiv</Badge>
        </div>
        {authenticators.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            Noch kein Faktor registriert.
          </p>
        ) : (
          <ul className="mt-4 grid gap-3">
            {authenticators.map((factor) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                key={factor.id}
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{factor.label}</strong>
                    <Badge
                      variant={
                        factor.status === "ACTIVE" ? "secondary" : "outline"
                      }
                    >
                      {factor.kind} · {factor.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {factor.lastUsedAt
                      ? `Zuletzt verwendet: ${formatDate(factor.lastUsedAt)}`
                      : "Noch nicht zur Anmeldung verwendet."}
                  </p>
                </div>
                {factor.status === "ACTIVE" ? (
                  <Button
                    disabled={pending}
                    onClick={() =>
                      run(
                        () =>
                          revokeAuthenticatorAction({
                            authenticatorId: factor.id,
                            reasonCode: "USER_DEVICE_REMOVED",
                          }),
                        "Der Faktor wurde widerrufen. Eine damit erteilte Assurance ist nicht mehr gültig.",
                      )
                    }
                    type="button"
                    variant="outline"
                  >
                    Faktor widerrufen
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border bg-card p-5">
        <p className="eyebrow">Geräteverlust</p>
        <h2 className="mt-1 text-xl font-semibold">
          Wiederherstellungscode verwenden
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {remainingRecoveryCodes} unbenutzte Codes. Recovery gibt nur eine
          kurze Recovery-Assurance und ersetzt keine AAL2-Freigabe.
        </p>
        <form
          className="mt-4 flex max-w-xl flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            run(
              () => consumeRecoveryCodeAction(recoveryCode),
              "Der Wiederherstellungscode wurde einmalig verbraucht.",
              () => setRecoveryCode(""),
            );
          }}
        >
          <label className="grid flex-1 gap-1 text-sm">
            Wiederherstellungscode
            <input
              autoComplete="off"
              className="h-10 rounded-lg border bg-background px-3 font-mono"
              maxLength={64}
              onChange={(event) => setRecoveryCode(event.target.value)}
              required
              value={recoveryCode}
            />
          </label>
          <Button disabled={pending} type="submit" variant="outline">
            Code verwenden
          </Button>
        </form>
      </section>
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Zurich",
  }).format(new Date(value));
}
