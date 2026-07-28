"use client";

import { useActionState } from "react";

import {
  beginCompanyVerificationAction,
  submitCompanyVerificationAppealAction,
  verifyCompanyDomainAction,
  type CompanyVerificationActionState,
} from "@/app/employer/verification/actions";
import { CompanyVerificationDocumentUploader } from "@/components/employer/company-verification-document-uploader";
import { StepUpGrantControl } from "@/components/security/step-up-grant-control";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const IDLE: CompanyVerificationActionState = Object.freeze({
  status: "idle",
  message: "",
});

type VerificationWorkspace = Readonly<{
  membershipId: string;
  membershipRole: "OWNER" | "ADMIN" | "RECRUITER" | "VIEWER";
  canManage: boolean;
  company: Readonly<{
    id: string;
    name: string;
    uid: string | null;
    status: string;
    website: string | null;
    cantonCode: string | null;
  }>;
  current: null | Readonly<{
    id: string;
    status: string;
    policyVersion: string;
    version: number;
    reviewDueAt: Date | null;
    decidedAt: Date | null;
    createdAt: Date;
    evidence: readonly Readonly<{
      id: string;
      type: string;
      status: string;
      reasonCode: string | null;
      checkedAt: Date | null;
      validTo: Date | null;
      domainChallenge: null | Readonly<{
        id: string;
        domain: string;
        status: string;
        expiresAt: Date;
        verifiedAt: Date | null;
      }>;
    }>[];
    appeals: readonly Readonly<{
      id: string;
      status: string;
      safeStatement: string;
      decisionReasonCode: string | null;
      createdAt: Date;
    }>[];
    events: readonly Readonly<{
      kind: string;
      toStatus: string;
      reasonCode: string | null;
      createdAt: Date;
    }>[];
  }>;
  trust: Readonly<{
    current: boolean;
    strongVerified: boolean;
    reason: string;
    badge: null | Readonly<{
      label: string;
      scopeLabel: string;
      verifiedAt: Date;
      validUntil: Date;
    }>;
  }>;
}>;

export function CompanyTrustWorkflow({
  workspace,
  activation,
  idempotencyKeys,
  stepUpRequired,
}: Readonly<{
  workspace: VerificationWorkspace;
  activation: Readonly<{
    trustV2: "disabled" | "observe" | "enforce";
    registerCheck: boolean;
    domainChallenge: boolean;
    document: boolean;
  }>;
  idempotencyKeys: Readonly<{
    begin: string;
    domain: string;
    appeal: string;
  }>;
  stepUpRequired: boolean;
}>) {
  const [beginState, beginAction, beginPending] = useActionState(
    beginCompanyVerificationAction,
    IDLE,
  );
  const [domainState, domainAction, domainPending] = useActionState(
    verifyCompanyDomainAction,
    IDLE,
  );
  const [appealState, appealAction, appealPending] = useActionState(
    submitCompanyVerificationAppealAction,
    IDLE,
  );
  const current = workspace.current;
  const challenge = current?.evidence
    .map((evidence) => evidence.domainChallenge)
    .find((value) => value !== null);
  const actionRequestId = beginState.requestId ?? null;
  const actionChallengeId = beginState.challengeId ?? null;
  const persistedPendingRequest =
    current?.policyVersion === "COMPANY_TRUST_POLICY_V2" &&
    current.status === "PENDING"
      ? current
      : null;
  const domainRequestId =
    actionRequestId ?? persistedPendingRequest?.id ?? null;
  const domainChallengeId =
    actionChallengeId ?? challenge?.id ?? null;
  const featureReady =
    activation.trustV2 !== "disabled" &&
    activation.registerCheck &&
    activation.domainChallenge;
  const mayStart =
    actionRequestId === null &&
    (current === null ||
      current.policyVersion !== "COMPANY_TRUST_POLICY_V2" ||
      ["VERIFIED", "REJECTED", "REVOKED"].includes(current.status));

  return (
    <div className="grid gap-6">
      <TrustSummary workspace={workspace} />

      {!featureReady ? (
        <Alert>
          <AlertTitle>Strukturierte Prüfung noch gesperrt</AlertTitle>
          <AlertDescription>
            Register- und Domainadapter sind für diese Umgebung nicht gemeinsam
            freigegeben. Historische Prüfungen erzeugen deshalb kein starkes
            öffentliches Abzeichen.
          </AlertDescription>
        </Alert>
      ) : null}

      {!workspace.canManage ? (
        <Alert>
          <AlertTitle>Schreibgeschützte Rolle</AlertTitle>
          <AlertDescription>
            {workspace.membershipRole} kann Status und Verlauf sehen. Nur Owner
            und Firmen-Admins dürfen Nachweise einreichen oder Einspruch erheben.
          </AlertDescription>
        </Alert>
      ) : null}

      {workspace.canManage && featureReady && mayStart ? (
        <form action={beginAction} className="grid gap-4 rounded-xl border p-4 sm:p-5">
          <div>
            <h2 className="text-lg font-semibold">
              {current === null ? "Prüfung starten" : "Aktuelle Prüfung erneuern"}
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Der Sandbox-Registerabgleich akzeptiert nur hinterlegte fiktive
              Testfirmen. Eine Eingabe allein erzeugt nie Trust.
            </p>
          </div>
          <ActionFeedback state={beginState} />
          <input
            name="expectedCurrentRequestId"
            type="hidden"
            value={current?.id ?? ""}
          />
          <input
            name="idempotencyKey"
            type="hidden"
            value={idempotencyKeys.begin}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="UID" name="uid" defaultValue={workspace.company.uid ?? "CHE-111.000.001"} pattern="CHE-[0-9]{3}\.[0-9]{3}\.[0-9]{3}" />
            <Field label="Rechtlicher Firmenname" name="legalName" defaultValue={workspace.company.name} />
            <Field label="Registerkanton" name="cantonCode" defaultValue={workspace.company.cantonCode ?? "ZH"} pattern="[A-Z]{2}" />
            <Field label="Zu prüfende Domain" name="domain" defaultValue={websiteDomain(workspace.company.website)} placeholder="firma.example.test" />
          </div>
          {stepUpRequired ? (
            <StepUpGrantControl
              action="COMPANY_VERIFICATION_CHANGE"
              purpose="EMPLOYER_COMPANY_TRUST"
              resourceId={current?.id ?? workspace.company.id}
              securityHref="/employer/settings/security"
              tenantId={workspace.company.id}
            />
          ) : null}
          <Button type="submit" disabled={beginPending} className="w-full sm:w-fit">
            {beginPending ? "Register wird geprüft …" : "Register prüfen und Challenge starten"}
          </Button>
          {beginState.challengeToken ? (
            <Alert>
              <AlertTitle>Einmaliges Domain-Geheimnis</AlertTitle>
              <AlertDescription>
                <p>
                  Hinterlege für <strong>{beginState.domain}</strong> exakt
                  folgenden Nachweis. Dieses Geheimnis wird nach einem Reload
                  nicht erneut angezeigt:
                </p>
                <code className="mt-3 block overflow-x-auto rounded bg-muted p-3 text-xs">
                  sth-domain-verification={beginState.challengeToken}
                </code>
              </AlertDescription>
            </Alert>
          ) : null}
        </form>
      ) : null}

      {workspace.canManage &&
      featureReady &&
      domainRequestId !== null &&
      domainChallengeId !== null &&
      (actionChallengeId !== null || challenge?.status === "PENDING") ? (
        <form action={domainAction} className="grid gap-4 rounded-xl border p-4 sm:p-5">
          <div>
            <h2 className="text-lg font-semibold">Domainkontrolle bestätigen</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Fünf Fehlversuche sind zulässig. Abgelaufene oder wiederverwendete
              Challenges erteilen keinen Trust.
            </p>
          </div>
          <ActionFeedback state={domainState} />
          <input name="verificationRequestId" type="hidden" value={domainRequestId} />
          <input name="challengeId" type="hidden" value={domainChallengeId} />
          <input name="idempotencyKey" type="hidden" value={idempotencyKeys.domain} />
          <Field label="Challenge-Geheimnis" name="challengeToken" defaultValue={beginState.challengeToken ?? ""} minLength={32} />
          <Field label="Gefundener Nachweis" name="presentedProof" defaultValue={beginState.challengeToken ? `sth-domain-verification=${beginState.challengeToken}` : ""} minLength={32} />
          {stepUpRequired ? (
            <StepUpGrantControl
              action="COMPANY_DOMAIN_CHANGE"
              purpose="EMPLOYER_COMPANY_TRUST"
              resourceId={domainRequestId}
              securityHref="/employer/settings/security"
              tenantId={workspace.company.id}
            />
          ) : null}
          <Button type="submit" disabled={domainPending} className="w-full sm:w-fit">
            {domainPending ? "Domain wird geprüft …" : "Domainnachweis prüfen"}
          </Button>
        </form>
      ) : null}

      {workspace.canManage &&
      current !== null &&
      ["REJECTED", "REVOKED"].includes(current.status) ? (
        <form action={appealAction} className="grid gap-4 rounded-xl border p-4 sm:p-5">
          <div>
            <h2 className="text-lg font-semibold">Entscheidung anfechten</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Der Einspruch stellt Trust nicht automatisch wieder her. Eine
              andere berechtigte Person entscheidet und kann neue Nachweise verlangen.
            </p>
          </div>
          <ActionFeedback state={appealState} />
          <input name="verificationRequestId" type="hidden" value={current.id} />
          <input name="idempotencyKey" type="hidden" value={idempotencyKeys.appeal} />
          <div className="grid gap-2">
            <Label htmlFor="company-trust-appeal">Sachliche Begründung</Label>
            <Textarea id="company-trust-appeal" name="safeStatement" minLength={20} maxLength={2_000} required rows={5} />
          </div>
          {stepUpRequired ? (
            <StepUpGrantControl
              action="COMPANY_VERIFICATION_CHANGE"
              purpose="EMPLOYER_COMPANY_TRUST"
              resourceId={current.id}
              securityHref="/employer/settings/security"
              tenantId={workspace.company.id}
            />
          ) : null}
          <Button type="submit" disabled={appealPending} variant="outline" className="w-full sm:w-fit">
            {appealPending ? "Einspruch wird gespeichert …" : "Einspruch einreichen"}
          </Button>
        </form>
      ) : null}

      {workspace.canManage &&
      activation.document &&
      current !== null &&
      ["PENDING", "CHANGES_REQUESTED"].includes(current.status) ? (
        <CompanyVerificationDocumentUploader
          companyId={workspace.company.id}
          verificationRequestId={current.id}
          stepUpRequired={stepUpRequired}
        />
      ) : null}

      <EvidenceHistory current={current} documentEnabled={activation.document} />
    </div>
  );
}

function TrustSummary({ workspace }: Readonly<{ workspace: VerificationWorkspace }>) {
  return (
    <Alert variant={workspace.trust.current ? "default" : "destructive"}>
      <AlertTitle className="flex flex-wrap items-center gap-2">
        Trust-Status
        <Badge variant={workspace.trust.strongVerified ? "default" : "outline"}>
          {workspace.trust.badge?.label ?? "Kein starkes Abzeichen"}
        </Badge>
      </AlertTitle>
      <AlertDescription>
        {workspace.trust.badge ? (
          <p>
            {workspace.trust.badge.scopeLabel}; gültig bis{" "}
            {formatDate(workspace.trust.badge.validUntil)}.
          </p>
        ) : (
          <p>
            Grund: {workspace.trust.reason}. Ein alter Status wird nicht still
            zu einer Register- und Domainprüfung hochgestuft.
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}

function EvidenceHistory({
  current,
  documentEnabled,
}: Readonly<{
  current: VerificationWorkspace["current"];
  documentEnabled: boolean;
}>) {
  return (
    <section className="grid gap-3" aria-labelledby="trust-evidence-title">
      <div>
        <h2 id="trust-evidence-title" className="text-lg font-semibold">Nachweise und Verlauf</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Dokumentinhalt, Challenge-Geheimnis, Providerrohantwort und interne
          Reviewer-Notizen werden hier nicht ausgegeben.
        </p>
      </div>
      {current === null ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Noch kein Prüfzyklus.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {current.evidence.map((evidence) => (
              <article key={evidence.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium">{evidenceLabel(evidence.type)}</h3>
                  <Badge variant={evidence.status === "VALID" ? "default" : "outline"}>{evidence.status}</Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {evidence.checkedAt ? `Geprüft ${formatDate(evidence.checkedAt)}` : "Noch nicht geprüft"}
                  {evidence.validTo ? ` · gültig bis ${formatDate(evidence.validTo)}` : ""}
                </p>
              </article>
            ))}
          </div>
          {current.events.length === 0 ? null : (
            <ol className="grid gap-2 border-l pl-4 text-sm">
              {current.events.map((event, index) => (
                <li key={`${event.kind}-${event.createdAt.toString()}-${index}`}>
                  <strong>{event.kind}</strong> → {event.toStatus}
                  <span className="block text-xs text-muted-foreground">
                    {formatDate(event.createdAt)}
                    {event.reasonCode ? ` · ${event.reasonCode}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      <p className="text-xs text-muted-foreground">
        Firmenverifikationsdokumente: {documentEnabled ? "Vault-Adapter freigegeben" : "gesperrt, bis Vault und Scanner grün sind"}.
      </p>
    </section>
  );
}

function ActionFeedback({ state }: Readonly<{ state: CompanyVerificationActionState }>) {
  if (state.status === "idle") return null;
  return (
    <Alert variant={state.status === "error" ? "destructive" : "default"} aria-live="polite">
      <AlertTitle>{state.status === "success" ? "Gespeichert" : "Nicht möglich"}</AlertTitle>
      <AlertDescription>{state.message}</AlertDescription>
    </Alert>
  );
}

function Field({
  label,
  name,
  ...input
}: Readonly<{
  label: string;
  name: string;
}> & React.ComponentProps<typeof Input>) {
  const id = `company-trust-${name}`;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} required maxLength={253} {...input} />
    </div>
  );
}

function websiteDomain(value: string | null) {
  if (value === null) return "";
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function evidenceLabel(value: string) {
  return {
    UID_REGISTER: "UID-Register",
    DOMAIN_CHALLENGE: "Domainkontrolle",
    DOCUMENT: "Vault-Dokument",
    MANUAL_EXCEPTION: "Manuelle Ausnahme",
    LEGACY_MANUAL: "Historischer Nachweis",
  }[value] ?? value;
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Zurich",
  }).format(new Date(value));
}
