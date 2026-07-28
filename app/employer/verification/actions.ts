"use server";

import { revalidatePath } from "next/cache";

import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { requireEmployerPage } from "@/lib/auth/route-guards";
import {
  createCompanyVerificationProviders,
  companyVerificationRuntimeFlags,
} from "@/lib/companies/verification/composition";
import {
  attachCompanyVerificationDocument,
  beginCompanyVerification,
  submitCompanyVerificationAppeal,
  verifyCompanyDomainChallenge,
  type CompanyVerificationOwnerResult,
} from "@/lib/companies/verification/owner-service";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { requireEmployerCompanyContext } from "@/lib/employer/context";
import { COMPANY_VERIFICATION_SANDBOX_FIXTURES } from "@/lib/providers/company-verification/sandbox-fixtures";

export type CompanyVerificationActionState = Readonly<{
  status: "idle" | "success" | "error";
  message: string;
  code?: string;
  requestId?: string;
  challengeId?: string;
  challengeToken?: string;
  domain?: string;
}>;

export async function beginCompanyVerificationAction(
  _previous: CompanyVerificationActionState,
  formData: FormData,
): Promise<CompanyVerificationActionState> {
  const security = await secureContext();
  if (!security.ok) return security.state;
  const input = strictForm(formData, [
    "expectedCurrentRequestId",
    "uid",
    "legalName",
    "cantonCode",
    "domain",
    "idempotencyKey",
    "stepUpEvidenceId",
    "stepUpGrantToken",
  ]);
  if (input === null) return invalidState();
  const result = await beginCompanyVerification(
    {
      companyId: security.context.companyId,
      membershipId: security.context.membershipId,
      expectedCurrentRequestId:
        input.expectedCurrentRequestId === ""
          ? null
          : input.expectedCurrentRequestId,
      uid: input.uid,
      legalName: input.legalName,
      cantonCode: input.cantonCode,
      domain: input.domain,
      idempotencyKey: input.idempotencyKey,
      ...optionalStepUp(input),
    },
    security.dependencies,
  );
  if (!result.ok) return resultState(result);
  revalidateVerificationPaths();
  return Object.freeze({
    status: "success",
    message: result.replay
      ? "Der Prüfzyklus war bereits angelegt. Das einmalige Challenge-Geheimnis wird bei Wiederholung nicht erneut ausgegeben."
      : "Registerabgleich gespeichert. Hinterlege jetzt den angezeigten Domain-Nachweis und bestätige ihn.",
    requestId: result.value.requestId,
    challengeId: result.value.challengeId,
    ...(result.value.challengeToken === null
      ? {}
      : { challengeToken: result.value.challengeToken }),
    domain: result.value.domain,
  });
}

export async function verifyCompanyDomainAction(
  _previous: CompanyVerificationActionState,
  formData: FormData,
): Promise<CompanyVerificationActionState> {
  const security = await secureContext();
  if (!security.ok) return security.state;
  const input = strictForm(formData, [
    "verificationRequestId",
    "challengeId",
    "challengeToken",
    "presentedProof",
    "idempotencyKey",
    "stepUpEvidenceId",
    "stepUpGrantToken",
  ]);
  if (input === null) return invalidState();
  const result = await verifyCompanyDomainChallenge(
    {
      companyId: security.context.companyId,
      membershipId: security.context.membershipId,
      verificationRequestId: input.verificationRequestId,
      challengeId: input.challengeId,
      challengeToken: input.challengeToken,
      presentedProof: input.presentedProof,
      idempotencyKey: input.idempotencyKey,
      ...optionalStepUp(input),
    },
    security.dependencies,
  );
  if (!result.ok) return resultState(result);
  revalidateVerificationPaths();
  return Object.freeze({
    status: "success",
    message:
      result.value.domainResult === "EXACT_MATCH"
        ? "Domainkontrolle bestätigt. Der Antrag ist bereit für die unabhängige Prüfung."
        : "Der Domainnachweis stimmt nicht. Prüfe Wert und Geheimnis; es wurde kein Trust erteilt.",
    requestId: result.value.requestId,
    challengeId: result.value.challengeId,
  });
}

export async function submitCompanyVerificationAppealAction(
  _previous: CompanyVerificationActionState,
  formData: FormData,
): Promise<CompanyVerificationActionState> {
  const security = await secureContext();
  if (!security.ok) return security.state;
  const input = strictForm(formData, [
    "verificationRequestId",
    "safeStatement",
    "idempotencyKey",
    "stepUpEvidenceId",
    "stepUpGrantToken",
  ]);
  if (input === null) return invalidState();
  const result = await submitCompanyVerificationAppeal(
    {
      companyId: security.context.companyId,
      membershipId: security.context.membershipId,
      verificationRequestId: input.verificationRequestId,
      safeStatement: input.safeStatement,
      idempotencyKey: input.idempotencyKey,
      ...optionalStepUp(input),
    },
    security.dependencies,
  );
  if (!result.ok) return resultState(result);
  revalidateVerificationPaths();
  return Object.freeze({
    status: "success",
    message: result.replay
      ? "Dieser Einspruch wurde bereits sicher gespeichert."
      : "Der Einspruch wurde gespeichert und wird unabhängig geprüft.",
    requestId: input.verificationRequestId,
  });
}

export async function attachCompanyVerificationDocumentAction(
  _previous: CompanyVerificationActionState,
  formData: FormData,
): Promise<CompanyVerificationActionState> {
  const security = await secureContext();
  if (!security.ok) return security.state;
  const input = strictForm(formData, [
    "verificationRequestId",
    "documentVersionId",
    "idempotencyKey",
    "stepUpEvidenceId",
    "stepUpGrantToken",
  ]);
  if (input === null) return invalidState();
  const result = await attachCompanyVerificationDocument(
    {
      companyId: security.context.companyId,
      membershipId: security.context.membershipId,
      verificationRequestId: input.verificationRequestId,
      documentVersionId: input.documentVersionId,
      idempotencyKey: input.idempotencyKey,
      ...optionalStepUp(input),
    },
    security.dependencies,
  );
  if (!result.ok) return resultState(result);
  revalidateVerificationPaths();
  return Object.freeze({
    status: "success",
    message: result.replay
      ? "Dieses geprüfte Dokument war dem Prüfzyklus bereits zugeordnet."
      : "Das geprüfte Dokument wurde dem Prüfzyklus sicher zugeordnet.",
    requestId: input.verificationRequestId,
  });
}

async function secureContext() {
  const [user, context, request] = await Promise.all([
    requireEmployerPage(),
    requireEmployerCompanyContext(),
    getAuthRequestContext(),
  ]);
  if (!isValidAuthMutationOrigin(request)) {
    return Object.freeze({
      ok: false as const,
      state: Object.freeze({
        status: "error" as const,
        code: "FORBIDDEN",
        message: "Die Anfrage konnte nicht sicher bestätigt werden.",
      }),
    });
  }
  const environment = getServerEnvironment();
  const providers = createCompanyVerificationProviders(
    COMPANY_VERIFICATION_SANDBOX_FIXTURES,
  );
  return Object.freeze({
    ok: true as const,
    context,
    dependencies: Object.freeze({
      actor: {
        userId: user.id,
        sessionId: user.sessionId,
        role: user.role,
        status: user.status,
      },
      auditIpContext: {
        sourceIp: request.sourceIp,
        keyring: environment.secrets.keyrings.AUDIT_IP_HASH_KEYS,
      },
      correlationId: request.correlationId,
      database: getDatabase(),
      now: new Date(),
      ...companyVerificationRuntimeFlags(),
      registerProvider: providers.register,
      domainProvider: providers.domain,
    }),
  });
}

function strictForm(formData: FormData, fields: readonly string[]) {
  const allowed = new Set(fields);
  if (
    [...formData.keys()].some(
      (key) => !key.startsWith("$ACTION_") && !allowed.has(key),
    )
  ) {
    return null;
  }
  const values: Record<string, string> = {};
  for (const field of fields) {
    const entries = formData.getAll(field);
    if (entries.length > 1 || (entries[0] !== undefined && typeof entries[0] !== "string")) {
      return null;
    }
    values[field] =
      typeof entries[0] === "string" ? entries[0].trim() : "";
  }
  return values;
}

function optionalStepUp(input: Record<string, string>) {
  return {
    ...(input.stepUpEvidenceId
      ? { stepUpEvidenceId: input.stepUpEvidenceId }
      : {}),
    ...(input.stepUpGrantToken
      ? { stepUpGrantToken: input.stepUpGrantToken }
      : {}),
  };
}

function resultState(
  result: Extract<CompanyVerificationOwnerResult<unknown>, { ok: false }>,
): CompanyVerificationActionState {
  const messages = {
    INVALID_INPUT: "Bitte prüfe alle Eingaben.",
    FEATURE_DISABLED:
      "Die strukturierte Prüfung ist für diese Umgebung oder Kohorte noch nicht freigegeben.",
    CAPACITY_BLOCKED:
      "Die Prüfqueue hat ihre sichere Aufnahmekapazität erreicht. Neue Prüfungen bleiben pausiert, bis ausreichend Review-Kapazität verfügbar ist.",
    FORBIDDEN: "Deine aktuelle Firmenrolle erlaubt diese Aktion nicht.",
    NOT_FOUND: "Der Prüfzyklus ist nicht mehr verfügbar.",
    CONFLICT:
      "Der Prüfstatus wurde inzwischen geändert. Lade die Seite neu und verwende den aktuellen Stand.",
    STEP_UP_REQUIRED:
      "Bestätige diese sensible Änderung zuerst in den Sicherheitseinstellungen.",
    PROVIDER_UNAVAILABLE:
      "Der Prüfprovider ist momentan nicht verfügbar. Es wurde kein Trust erteilt.",
    WRITE_FAILED:
      "Die Änderung konnte nicht vollständig gespeichert werden. Bitte versuche es erneut.",
  } as const;
  return Object.freeze({
    status: "error",
    code: result.code,
    message: messages[result.code],
  });
}

function invalidState(): CompanyVerificationActionState {
  return Object.freeze({
    status: "error",
    code: "INVALID_INPUT",
    message: "Das Formular ist unvollständig oder enthält unerwartete Felder.",
  });
}

function revalidateVerificationPaths() {
  for (const path of [
    "/employer/verification",
    "/employer/company",
    "/employer/dashboard",
    "/employer/talent-radar",
    "/companies",
    "/jobs",
  ]) {
    revalidatePath(path);
  }
}
