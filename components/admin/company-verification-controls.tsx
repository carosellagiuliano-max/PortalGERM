"use client";

import { useActionState } from "react";

import {
  companyVerificationAdminAction,
  type CompanyVerificationAdminActionState,
} from "@/app/admin/company-verification/actions";
import { StepUpGrantControl } from "@/components/security/step-up-grant-control";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const IDLE: CompanyVerificationAdminActionState = Object.freeze({
  status: "idle",
  message: "",
});

export function CompanyVerificationReviewControls({
  request,
  actorUserId,
  canApprove,
  stepUpRequired,
  idempotencyKeys,
}: Readonly<{
  request: Readonly<{
    id: string;
    companyId: string;
    status: string;
    riskLevel: "NORMAL" | "HIGH" | "MANUAL_EXCEPTION";
    version: number;
    requestedBy: Readonly<{ id: string }>;
    assignedReviewerUserId: string | null;
    appeals: readonly Readonly<{ id: string; status: string }>[];
  }>;
  actorUserId: string;
  canApprove: boolean;
  stepUpRequired: boolean;
  idempotencyKeys: readonly string[];
}>) {
  const [state, action, pending] = useActionState(
    companyVerificationAdminAction,
    IDLE,
  );
  const assignedToMe = request.assignedReviewerUserId === actorUserId;
  const key = (index: number) => idempotencyKeys[index] ?? "";

  return (
    <div className="grid gap-4">
      <Feedback state={state} />
      {request.requestedBy.id === actorUserId ? (
        <Alert variant="destructive">
          <AlertTitle>Funktionstrennung aktiv</AlertTitle>
          <AlertDescription>
            Antragsteller:innen dürfen den eigenen Firmenantrag weder übernehmen
            noch entscheiden.
          </AlertDescription>
        </Alert>
      ) : request.assignedReviewerUserId === null ? (
        <ActionForm
          action={action}
          operation="assign"
          request={request}
          idempotencyKey={key(0)}
          stepUpRequired={stepUpRequired}
          stepUpAction="COMPANY_VERIFICATION_ASSIGN"
          submitLabel="Mir zur Prüfung zuweisen"
          pending={pending}
        />
      ) : !assignedToMe ? (
        <Alert>
          <AlertTitle>Bereits zugewiesen</AlertTitle>
          <AlertDescription>
            Nur die aktuell zugewiesene Person kann diese Version entscheiden.
          </AlertDescription>
        </Alert>
      ) : request.riskLevel === "NORMAL" ? (
        <div className="grid gap-3">
          <DecisionForm action={action} request={request} idempotencyKey={key(1)} decision="APPROVE" label="Identität freigeben" pending={pending} stepUpRequired={stepUpRequired} />
          <DecisionForm action={action} request={request} idempotencyKey={key(2)} decision="REQUEST_CHANGES" label="Neue Nachweise verlangen" pending={pending} stepUpRequired={stepUpRequired} />
          <DecisionForm action={action} request={request} idempotencyKey={key(3)} decision="REJECT" label="Antrag ablehnen" destructive pending={pending} stepUpRequired={stepUpRequired} />
          {request.status === "VERIFIED" ? <DecisionForm action={action} request={request} idempotencyKey={key(4)} decision="REVOKE" label="Trust sofort widerrufen" destructive pending={pending} stepUpRequired={stepUpRequired} /> : null}
        </div>
      ) : (
        <ActionForm
          action={action}
          operation="request-independent-approval"
          request={request}
          idempotencyKey={key(5)}
          stepUpRequired={stepUpRequired}
          stepUpAction="COMPANY_VERIFICATION_DECIDE"
          submitLabel="Unabhängige Freigabe anfordern"
          pending={pending}
        >
          <input name="riskLevel" type="hidden" value={request.riskLevel} />
          <ReasonField defaultValue="INDEPENDENT_REVIEW_REQUIRED" />
        </ActionForm>
      )}

      {canApprove ? (
        <form action={action} className="grid gap-3 rounded-xl border p-4">
          <h3 className="font-semibold">Unabhängige Freigabe abschliessen</h3>
          <p className="text-xs text-muted-foreground">
            Approval-ID aus der separaten Reviewer-Anforderung. Dieselbe Person
            und der Antragsteller sind serverseitig ausgeschlossen.
          </p>
          <input name="operation" type="hidden" value="approve-independent" />
          <input name="idempotencyKey" type="hidden" value={key(6)} />
          <div className="grid gap-2">
            <Label htmlFor="approval-id">Approval-ID</Label>
            <Input id="approval-id" name="approvalId" required />
          </div>
          <ReasonField defaultValue="INDEPENDENT_APPROVAL_CONFIRMED" />
          {stepUpRequired ? (
            <StepUpGrantControl
              action="COMPANY_VERIFICATION_DECIDE"
              purpose="COMPANY_VERIFICATION"
              resourceId={request.id}
              securityHref="/admin/security/authenticators"
              tenantId={request.companyId}
            />
          ) : null}
          <Button type="submit" disabled={pending}>Unabhängig freigeben</Button>
        </form>
      ) : null}

      {canApprove
        ? request.appeals
            .filter((appeal) => appeal.status === "OPEN")
            .map((appeal, index) => (
              <form key={appeal.id} action={action} className="grid gap-3 rounded-xl border p-4">
                <h3 className="font-semibold">Einspruch entscheiden</h3>
                <input name="operation" type="hidden" value="decide-appeal" />
                <input name="appealId" type="hidden" value={appeal.id} />
                <input name="idempotencyKey" type="hidden" value={key(7 + index)} />
                <ReasonField defaultValue="APPEAL_REVIEW_COMPLETED" />
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" name="decision" value="APPROVE" disabled={pending}>Neue Prüfung zulassen</Button>
                  <Button type="submit" name="decision" value="REJECT" variant="destructive" disabled={pending}>Einspruch ablehnen</Button>
                </div>
                {stepUpRequired ? (
                  <StepUpGrantControl
                    action="COMPANY_VERIFICATION_APPEAL_DECIDE"
                    purpose="COMPANY_VERIFICATION"
                    resourceId={request.id}
                    securityHref="/admin/security/authenticators"
                    tenantId={request.companyId}
                  />
                ) : null}
              </form>
            ))
        : null}
    </div>
  );
}

function DecisionForm({
  action,
  request,
  decision,
  idempotencyKey,
  label,
  destructive = false,
  pending,
  stepUpRequired,
}: Readonly<{
  action: (formData: FormData) => void;
  request: Parameters<typeof CompanyVerificationReviewControls>[0]["request"];
  decision: "APPROVE" | "REQUEST_CHANGES" | "REJECT" | "REVOKE";
  idempotencyKey: string;
  label: string;
  destructive?: boolean;
  pending: boolean;
  stepUpRequired: boolean;
}>) {
  return (
    <ActionForm
      action={action}
      operation="decide"
      request={request}
      idempotencyKey={idempotencyKey}
      stepUpRequired={stepUpRequired}
      stepUpAction={decision === "REVOKE" ? "COMPANY_VERIFICATION_REVOKE" : "COMPANY_VERIFICATION_DECIDE"}
      submitLabel={label}
      destructive={destructive}
      pending={pending}
    >
      <input name="decision" type="hidden" value={decision} />
      <ReasonField defaultValue={decision === "APPROVE" ? "REGISTER_AND_DOMAIN_REVIEWED" : decision === "REQUEST_CHANGES" ? "EVIDENCE_UPDATE_REQUIRED" : decision === "REJECT" ? "EVIDENCE_INSUFFICIENT" : "TRUST_RISK_CONFIRMED"} />
    </ActionForm>
  );
}

function ActionForm({
  action,
  operation,
  request,
  idempotencyKey,
  stepUpRequired,
  stepUpAction,
  submitLabel,
  destructive = false,
  pending,
  children,
}: Readonly<{
  action: (formData: FormData) => void;
  operation: string;
  request: Parameters<typeof CompanyVerificationReviewControls>[0]["request"];
  idempotencyKey: string;
  stepUpRequired: boolean;
  stepUpAction: string;
  submitLabel: string;
  destructive?: boolean;
  pending: boolean;
  children?: React.ReactNode;
}>) {
  return (
    <form action={action} className="grid gap-3 rounded-xl border p-4">
      <input name="operation" type="hidden" value={operation} />
      <input name="verificationRequestId" type="hidden" value={request.id} />
      <input name="expectedVersion" type="hidden" value={request.version} />
      <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
      {children}
      {stepUpRequired ? (
        <StepUpGrantControl
          action={stepUpAction}
          purpose="COMPANY_VERIFICATION"
          resourceId={request.id}
          securityHref="/admin/security/authenticators"
          tenantId={request.companyId}
        />
      ) : null}
      <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={pending}>
        {pending ? "Wird gespeichert …" : submitLabel}
      </Button>
    </form>
  );
}

function ReasonField({ defaultValue }: Readonly<{ defaultValue: string }>) {
  return (
    <div className="grid gap-2">
      <Label>Pflichtgrund</Label>
      <Input name="reasonCode" defaultValue={defaultValue} pattern="[A-Z][A-Z0-9_]{1,63}" required />
    </div>
  );
}

function Feedback({ state }: Readonly<{ state: CompanyVerificationAdminActionState }>) {
  if (state.status === "idle") return null;
  return (
    <Alert variant={state.status === "error" ? "destructive" : "default"} aria-live="polite">
      <AlertTitle>{state.status === "success" ? "Gespeichert" : "Abgelehnt"}</AlertTitle>
      <AlertDescription>
        {state.message}
        {state.approvalId ? <code className="mt-2 block break-all rounded bg-muted p-2">{state.approvalId}</code> : null}
      </AlertDescription>
    </Alert>
  );
}
