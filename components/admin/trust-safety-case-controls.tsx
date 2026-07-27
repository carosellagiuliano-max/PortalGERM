"use client";

import { useActionState, useState } from "react";

import {
  assignTrustSafetyCaseAction,
  decideTrustSafetyAppealAction,
  decideTrustSafetyCaseAction,
} from "@/app/admin/trust-safety/actions";
import { INITIAL_TRUST_SAFETY_ACTION_STATE } from "@/app/admin/trust-safety/action-state";
import { StepUpGrantControl } from "@/components/security/step-up-grant-control";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function TrustSafetyAssignmentForm({
  caseId,
  version,
  currentAssigneeUserId,
}: Readonly<{
  caseId: string;
  version: number;
  currentAssigneeUserId: string | null;
}>) {
  const [state, action, pending] = useActionState(
    assignTrustSafetyCaseAction,
    INITIAL_TRUST_SAFETY_ACTION_STATE,
  );
  return (
    <form action={action} className="grid gap-3 rounded-xl border p-4">
      <input name="caseId" type="hidden" value={caseId} />
      <input name="expectedVersion" type="hidden" value={version} />
      <input name="reasonCode" type="hidden" value="CASE_ASSIGNMENT" />
      <Label htmlFor="trust-assignee">Berechtigte Review-User-ID</Label>
      <Input
        id="trust-assignee"
        name="assigneeUserId"
        defaultValue={currentAssigneeUserId ?? ""}
        required
        pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
      />
      <ActionFeedback state={state} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Zuweisung wird geprüft …" : "Fall zuweisen"}
      </Button>
    </form>
  );
}

export function TrustSafetyDecisionForm({
  caseId,
  companyId,
  version,
}: Readonly<{
  caseId: string;
  companyId: string | null;
  version: number;
}>) {
  const [state, action, pending] = useActionState(
    decideTrustSafetyCaseAction,
    INITIAL_TRUST_SAFETY_ACTION_STATE,
  );
  const [decision, setDecision] = useState<"HOLD" | "REVOKE" | "RESOLVE">(
    "HOLD",
  );
  return (
    <form action={action} className="grid gap-3 rounded-xl border p-4">
      <input name="caseId" type="hidden" value={caseId} />
      <input name="expectedVersion" type="hidden" value={version} />
      <div className="grid gap-2">
        <Label htmlFor="trust-decision">Entscheid</Label>
        <select
          id="trust-decision"
          name="decision"
          value={decision}
          onChange={(event) =>
            setDecision(
              event.currentTarget.value as "HOLD" | "REVOKE" | "RESOLVE",
            )
          }
          className="h-10 rounded-md border bg-background px-3 text-sm"
        >
          <option value="HOLD">Reversibel halten</option>
          <option value="REVOKE">Bestätigten Vorfall widerrufen</option>
          <option value="RESOLVE">Ohne Containment schliessen</option>
        </select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="trust-reason">Reason Code</Label>
        <Input
          id="trust-reason"
          name="reasonCode"
          defaultValue="MANUAL_TRUST_REVIEW"
          pattern="[A-Z][A-Z0-9_]{1,63}"
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="trust-safe-note">Sicher sichtbare Begründung</Label>
        <Textarea
          id="trust-safe-note"
          name="safeNote"
          minLength={10}
          maxLength={1000}
          required
          placeholder="Keine geheimen Signale, Gerätewerte oder Daten Dritter."
        />
      </div>
      <StepUpGrantControl
        purpose="TRUST_SAFETY"
        action={`TRUST_${decision}`}
        tenantId={companyId}
        resourceId={caseId}
        securityHref="/admin/security/authenticators"
      />
      <ActionFeedback state={state} />
      <Button
        type="submit"
        variant={decision === "REVOKE" ? "destructive" : "default"}
        disabled={pending}
      >
        {pending ? "Entscheid wird atomar geprüft …" : "Entscheid ausführen"}
      </Button>
    </form>
  );
}

export function TrustSafetyAppealDecisionForm({
  appealId,
  caseId,
  companyId,
  caseVersion,
}: Readonly<{
  appealId: string;
  caseId: string;
  companyId: string | null;
  caseVersion: number;
}>) {
  const [state, action, pending] = useActionState(
    decideTrustSafetyAppealAction,
    INITIAL_TRUST_SAFETY_ACTION_STATE,
  );
  const [decision, setDecision] = useState<"APPROVE" | "REJECT">("REJECT");
  return (
    <form action={action} className="grid gap-3 rounded-xl border p-4">
      <input name="appealId" type="hidden" value={appealId} />
      <input
        name="expectedCaseVersion"
        type="hidden"
        value={caseVersion}
      />
      <Label htmlFor={`appeal-decision-${appealId}`}>
        Unabhängiger Appeal-Entscheid
      </Label>
      <select
        id={`appeal-decision-${appealId}`}
        name="decision"
        value={decision}
        onChange={(event) =>
          setDecision(event.currentTarget.value as "APPROVE" | "REJECT")
        }
        className="h-10 rounded-md border bg-background px-3 text-sm"
      >
        <option value="REJECT">Ablehnen, Containment bleibt</option>
        <option value="APPROVE">Gutheissen und reversibel wiederherstellen</option>
      </select>
      <Input
        aria-label="Appeal Reason Code"
        name="reasonCode"
        defaultValue={
          decision === "APPROVE"
            ? "APPEAL_VERIFIED_RESTORE"
            : "APPEAL_REJECTED_REVIEWED"
        }
        pattern="[A-Z][A-Z0-9_]{1,63}"
        required
      />
      <StepUpGrantControl
        purpose="TRUST_SAFETY"
        action={
          decision === "APPROVE"
            ? "TRUST_APPEAL_APPROVE"
            : "TRUST_APPEAL_REJECT"
        }
        tenantId={companyId}
        resourceId={caseId}
        securityHref="/admin/security/authenticators"
      />
      <ActionFeedback state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Appeal wird geprüft …" : "Appeal final entscheiden"}
      </Button>
    </form>
  );
}

function ActionFeedback({
  state,
}: Readonly<{
  state: typeof INITIAL_TRUST_SAFETY_ACTION_STATE;
}>) {
  if (state.status === "idle") return null;
  return (
    <p
      className={
        state.status === "success"
          ? "text-sm text-emerald-700 dark:text-emerald-300"
          : "text-sm text-destructive"
      }
      role={state.status === "success" ? "status" : "alert"}
    >
      {state.message}
    </p>
  );
}
