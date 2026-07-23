"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import type { TalentRadarActionState } from "@/components/employer/TalentRadar/action-state";
import {
  abuseReportContentSchema,
  createResolvedAbuseReport,
} from "@/lib/abuse/public-report";
import { getEmployerContext } from "@/lib/auth/employer-context";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { buildCatalogUpgradePrompt } from "@/lib/billing/upgrade-prompt";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { emailProvider } from "@/lib/providers/email";
import { toRadarEligibilityEnvironment } from "@/lib/talentradar/eligibility";
import { cancelEmployerContactRequest } from "@/lib/talentradar/contact-requests";
import {
  createEnvironmentRadarContactProofPort,
  createRadarContactRateLimitPort,
  radarCandidateReportTargetInputSchema,
  resolveEmployerRadarCandidateReportTarget,
  sendContactRequest,
} from "@/lib/talentradar/request-contact";

export async function sendContactRequestAction(
  _previousState: TalentRadarActionState,
  formData: FormData,
): Promise<TalentRadarActionState> {
  const dependencies = await mutationDependencies();
  if (dependencies === null) return unsafeRequest();

  const result = await sendContactRequest(
    {
      opaqueCandidateId: stringField(formData, "opaqueCandidateId"),
      signedSearchSession: stringField(formData, "signedSearchSession"),
      subject: stringField(formData, "subject"),
      messagePreview: stringField(formData, "messagePreview"),
      idempotencyKey: stringField(formData, "idempotencyKey"),
    },
    {
      actor: dependencies.actor,
      correlationId: dependencies.request.correlationId,
      database: dependencies.database,
      eligibilityEnvironment: toRadarEligibilityEnvironment(
        dependencies.environment.APP_ENV,
      ),
      proofPort: createEnvironmentRadarContactProofPort(
        dependencies.environment,
      ),
      rateLimitPort: createRadarContactRateLimitPort({
        database: dependencies.database,
        environment: dependencies.environment,
        request: dependencies.request,
      }),
      now: dependencies.now,
    },
  );

  if (!result.ok) {
    if (result.code === "LIMIT") {
      return Object.freeze({
        status: "error" as const,
        message:
          "Aktuell ist kein nutzbarer Kontakt-Credit verfügbar. Es wurde nichts verändert.",
        upgradePrompt: await buildCatalogUpgradePrompt(
          {
            reason: "CONTACT_FUNDING_UNAVAILABLE",
            suggestedProductSlug: result.suggestedProductSlug ?? "contact-pack-10",
            actorRole: dependencies.role,
          },
          { database: dependencies.database, now: dependencies.now },
        ),
      });
    }
    return contactError(result.code, result.retryAfterSeconds);
  }

  revalidatePath("/employer/talent-radar");
  revalidatePath("/employer/talent-radar/requests");
  revalidatePath(`/employer/talent-radar/requests/${result.value.requestId}`);
  return Object.freeze({
    status: "success" as const,
    message: result.replay === true
      ? "Die bereits sicher gespeicherte Kontaktanfrage wurde wiedergefunden."
      : "Kontaktanfrage gesendet. Die Identität bleibt bis zu einer separaten Freigabe anonym.",
    requestId: result.value.requestId,
    nextIdempotencyKey: randomUUID(),
  });
}

export async function cancelContactRequestAction(
  _previousState: TalentRadarActionState,
  formData: FormData,
): Promise<TalentRadarActionState> {
  const dependencies = await mutationDependencies();
  if (dependencies === null) return unsafeRequest();

  const requestId = stringField(formData, "requestId");
  const result = await cancelEmployerContactRequest(
    {
      requestId,
      idempotencyKey: stringField(formData, "idempotencyKey"),
    },
    dependencies.actor,
    {
      correlationId: dependencies.request.correlationId,
      database: dependencies.database,
      now: dependencies.now,
    },
  );
  if (!result.ok) {
    const message = result.code === "CONFLICT"
      ? "Nur eine noch ausstehende Kontaktanfrage kann zurückgezogen werden."
      : result.code === "TRUST_REQUIRED"
        ? "Die Anfrage kann wegen des aktuellen Firmenstatus nicht geändert werden."
        : "Die Kontaktanfrage konnte nicht sicher zurückgezogen werden.";
    return Object.freeze({ status: "error" as const, message });
  }

  revalidatePath("/employer/talent-radar/requests");
  revalidatePath(`/employer/talent-radar/requests/${result.value.requestId}`);
  return Object.freeze({
    status: "success" as const,
    message: result.replay === true
      ? "Die Kontaktanfrage war bereits zurückgezogen."
      : "Kontaktanfrage zurückgezogen. Der verwendete Credit wird nicht automatisch erstattet.",
    nextIdempotencyKey: randomUUID(),
  });
}

export async function reportRadarCandidateAction(
  _previousState: TalentRadarActionState,
  formData: FormData,
): Promise<TalentRadarActionState> {
  const dependencies = await mutationDependencies();
  if (dependencies === null) return unsafeRequest();

  const targetInput = radarCandidateReportTargetInputSchema.safeParse({
    opaqueCandidateId: stringField(formData, "opaqueCandidateId"),
    signedSearchSession: stringField(formData, "signedSearchSession"),
  });
  const content = abuseReportContentSchema.safeParse({
    reasonCode: formData.get("reasonCode"),
    description: formData.get("description"),
  });
  if (!targetInput.success || !content.success) {
    return Object.freeze({
      status: "error" as const,
      message:
        "Bitte wähle einen Grund und beschreibe den Verdacht mit mindestens 20 Zeichen.",
    });
  }

  const target = await resolveEmployerRadarCandidateReportTarget(
    targetInput.data,
    {
      actor: dependencies.actor,
      database: dependencies.database,
      proofPort: createEnvironmentRadarContactProofPort(
        dependencies.environment,
      ),
      now: dependencies.now,
    },
  );
  if (target === null) {
    return Object.freeze({
      status: "error" as const,
      message:
        "Dieses anonyme Profil ist nicht mehr verfügbar. Bitte aktualisiere die Suche.",
    });
  }

  const result = await createResolvedAbuseReport(
    content.data,
    {
      id: target.userId,
      targetType: "USER",
      companyId: target.companyId,
    },
    {
      currentUser: dependencies.currentUser,
      database: dependencies.database,
      emailProvider,
      environment: dependencies.environment,
      request: dependencies.request,
      now: dependencies.now,
    },
  );
  if (!result.ok) {
    return Object.freeze({
      status: "error" as const,
      message:
        result.code === "RATE_LIMITED"
          ? "Zu viele Meldungen in kurzer Zeit. Bitte versuche es später erneut."
          : "Die Meldung konnte nicht sicher erfasst werden.",
    });
  }

  revalidatePath("/employer/talent-radar");
  revalidatePath("/admin/reports");
  return Object.freeze({
    status: "success" as const,
    message: "Danke. Das anonyme Profil wurde sicher zur Prüfung gemeldet.",
  });
}

async function mutationDependencies() {
  const [context, request] = await Promise.all([
    getEmployerContext(),
    getAuthRequestContext(),
  ]);
  if (
    context === null ||
    context.current === null ||
    !isValidAuthMutationOrigin(request) ||
    context.user.status !== "ACTIVE" ||
    !["OWNER", "ADMIN", "RECRUITER"].includes(
      context.current.membershipRole,
    )
  ) {
    return null;
  }

  return Object.freeze({
    currentUser: context.user,
    actor: Object.freeze({
      userId: context.user.id,
      companyId: context.current.companyId,
      membershipId: context.current.membershipId,
    }),
    role: context.current.membershipRole,
    database: getDatabase(),
    environment: getServerEnvironment(),
    request,
    now: new Date(),
  });
}

function contactError(
  code: string,
  retryAfterSeconds: number | undefined,
): TalentRadarActionState {
  const messages: Readonly<Record<string, string>> = Object.freeze({
    INVALID_INPUT: "Bitte prüfe Betreff und Nachricht.",
    FORBIDDEN:
      "Talent Radar ist für diese Firma oder deine Rolle derzeit nicht verfügbar.",
    NOT_FOUND:
      "Dieses anonyme Profil ist nicht mehr verfügbar. Bitte aktualisiere die Suche.",
    PENDING_DUPLICATE:
      "Für dieses anonyme Talent besteht bereits eine offene Kontaktanfrage.",
    RECONTACT_COOLDOWN:
      "Eine erneute Kontaktanfrage ist innerhalb der Schutzfrist noch nicht möglich.",
    IDEMPOTENCY_CONFLICT:
      "Diese Anfrage konnte nicht sicher wiederholt werden. Bitte lade die Seite neu.",
    WRITE_FAILED:
      "Die Kontaktanfrage konnte nicht gespeichert werden. Bitte versuche es später erneut.",
  });
  const message = code === "RATE_LIMITED"
    ? `Zu viele Kontaktversuche. Bitte warte ${Math.max(1, retryAfterSeconds ?? 1)} Sekunden.`
    : messages[code] ?? "Die Kontaktanfrage konnte nicht sicher ausgeführt werden.";
  return Object.freeze({ status: "error" as const, message });
}

function unsafeRequest(): TalentRadarActionState {
  return Object.freeze({
    status: "error" as const,
    message:
      "Die Anfrage konnte nicht sicher bestätigt werden. Bitte lade die Seite neu.",
  });
}

function stringField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
