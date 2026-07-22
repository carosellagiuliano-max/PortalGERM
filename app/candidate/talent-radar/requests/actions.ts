"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/current-user";
import { consumeRequestRateLimit } from "@/lib/auth/rate-limit-runtime";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { getServerEnvironment } from "@/lib/config/env";
import type { KeyringEntry } from "@/lib/config/env-schema";
import { getDatabase } from "@/lib/db/client";
import type { RevealValue } from "@/lib/privacy/reveal-dto";
import {
  acceptContactRequest,
  declineContactRequest,
} from "@/lib/talentradar/contact-requests";
import {
  buildCandidateRevealPreview,
  grantRevealFields,
  revokeIdentityReveal,
} from "@/lib/talentradar/reveal";

const GENERIC_ERROR = "Die Aktion konnte nicht sicher ausgeführt werden.";
const RATE_LIMIT_ERROR =
  "Zu viele Aktionen in kurzer Zeit. Bitte versuche es später erneut.";
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const lifecycleSchema = z.strictObject({
  requestId: z.uuid(),
  idempotencyKey: z.string().regex(IDEMPOTENCY_KEY),
  confirmed: z.literal(true),
});
const previewSchema = z.strictObject({
  requestId: z.uuid(),
  fields: z
    .array(z.enum(["DISPLAY_NAME", "EMAIL", "PHONE", "CV_METADATA"]))
    .min(1)
    .max(4)
    .refine((fields) => new Set(fields).size === fields.length),
});
const grantSchema = z.strictObject({
  requestId: z.uuid(),
  confirmationToken: z.string().min(40).max(4_096),
  idempotencyKey: z.string().regex(IDEMPOTENCY_KEY),
  confirmed: z.literal(true),
});
const revokeSchema = z.strictObject({
  requestId: z.uuid(),
  grantId: z.uuid(),
  reasonCode: z.enum(["PRIVACY_CHOICE", "TRUST_CONCERN", "OTHER"]),
  confirmationVersion: z.literal("identity-reveal-revoke-v1"),
  idempotencyKey: z.string().regex(IDEMPOTENCY_KEY),
  confirmed: z.literal(true),
});

export type CandidateRadarActionState = Readonly<{
  status: "idle" | "error";
  message: string;
}>;

export type CandidateRevealPreviewState = CandidateRadarActionState &
  Readonly<{
    preview?: Readonly<{
      values: readonly RevealValue[];
      confirmationToken: string;
      expiresAt: string;
      recipientCompanyName: string;
      noticeVersion: string;
    }>;
  }>;

export async function acceptCandidateRadarRequestAction(
  _previousState: CandidateRadarActionState,
  formData: FormData,
): Promise<CandidateRadarActionState> {
  return runLifecycleAction("ACCEPT", formData);
}

export async function declineCandidateRadarRequestAction(
  _previousState: CandidateRadarActionState,
  formData: FormData,
): Promise<CandidateRadarActionState> {
  return runLifecycleAction("DECLINE", formData);
}

export async function previewCandidateRadarRevealAction(
  _previousState: CandidateRevealPreviewState,
  formData: FormData,
): Promise<CandidateRevealPreviewState> {
  const dependencies = await actionDependencies();
  if (dependencies === null) return errorState(GENERIC_ERROR);
  const parsed = previewSchema.safeParse({
    requestId: formData.get("requestId"),
    fields: formData.getAll("fields"),
  });
  if (!parsed.success) {
    return errorState("Wähle mindestens ein noch nicht freigegebenes Feld aus.");
  }
  if (!(await consumeCandidateActionRateLimit(dependencies))) {
    return errorState(RATE_LIMIT_ERROR);
  }

  const result = await buildCandidateRevealPreview(
    dependencies.database,
    {
      actorUserId: dependencies.userId,
      contactRequestId: parsed.data.requestId,
      fields: parsed.data.fields,
      now: new Date(),
    },
    revealKeyring(
      dependencies.environment.secrets.keyrings.REVEAL_CONFIRMATION_KEYS,
    ),
  );
  if (!result.ok) {
    return errorState(revealPreviewError(result.code));
  }

  return Object.freeze({
    status: "idle" as const,
    message: "",
    preview: Object.freeze({
      values: result.values,
      confirmationToken: result.confirmationToken,
      expiresAt: result.expiresAt.toISOString(),
      recipientCompanyName: result.recipientCompanyName,
      noticeVersion: result.noticeVersion,
    }),
  });
}

export async function grantCandidateRadarRevealAction(
  _previousState: CandidateRadarActionState,
  formData: FormData,
): Promise<CandidateRadarActionState> {
  const dependencies = await actionDependencies();
  if (dependencies === null) return errorState(GENERIC_ERROR);
  const parsed = grantSchema.safeParse({
    requestId: formData.get("requestId"),
    confirmationToken: formData.get("confirmationToken"),
    idempotencyKey: formData.get("idempotencyKey"),
    confirmed: formData.get("confirmed") === "true",
  });
  if (!parsed.success) return errorState(GENERIC_ERROR);
  if (!(await consumeCandidateActionRateLimit(dependencies))) {
    return errorState(RATE_LIMIT_ERROR);
  }

  const environment = dependencies.environment;
  const result = await grantRevealFields(
    dependencies.database,
    {
      actorUserId: dependencies.userId,
      contactRequestId: parsed.data.requestId,
      confirmationToken: parsed.data.confirmationToken,
      idempotencyKey: parsed.data.idempotencyKey,
      now: new Date(),
    },
    {
      confirmation: revealKeyring(
        environment.secrets.keyrings.REVEAL_CONFIRMATION_KEYS,
      ),
      pii: revealKeyring(environment.secrets.keyrings.PII_REVEAL_KEYS),
    },
  );
  if (!result.ok) return errorState(revealGrantError(result.code));

  revalidateRequestPaths(parsed.data.requestId);
  redirect(
    `/candidate/talent-radar/requests/${parsed.data.requestId}?updated=revealed`,
  );
}

export async function revokeCandidateRadarRevealAction(
  _previousState: CandidateRadarActionState,
  formData: FormData,
): Promise<CandidateRadarActionState> {
  const dependencies = await actionDependencies();
  if (dependencies === null) return errorState(GENERIC_ERROR);
  const parsed = revokeSchema.safeParse({
    requestId: formData.get("requestId"),
    grantId: formData.get("grantId"),
    reasonCode: formData.get("reasonCode"),
    confirmationVersion: formData.get("confirmationVersion"),
    idempotencyKey: formData.get("idempotencyKey"),
    confirmed: formData.get("confirmed") === "true",
  });
  if (!parsed.success) return errorState(GENERIC_ERROR);
  if (!(await consumeCandidateActionRateLimit(dependencies))) {
    return errorState(RATE_LIMIT_ERROR);
  }

  const result = await revokeIdentityReveal(dependencies.database, {
    actorUserId: dependencies.userId,
    grantId: parsed.data.grantId,
    reasonCode: parsed.data.reasonCode,
    confirmationVersion: parsed.data.confirmationVersion,
    idempotencyKey: parsed.data.idempotencyKey,
    now: new Date(),
  });
  if (!result.ok) return errorState(GENERIC_ERROR);

  revalidateRequestPaths(parsed.data.requestId);
  redirect(
    `/candidate/talent-radar/requests/${parsed.data.requestId}?updated=revoked`,
  );
}

async function runLifecycleAction(
  action: "ACCEPT" | "DECLINE",
  formData: FormData,
): Promise<CandidateRadarActionState> {
  const dependencies = await actionDependencies();
  if (dependencies === null) return errorState(GENERIC_ERROR);
  const parsed = lifecycleSchema.safeParse({
    requestId: formData.get("requestId"),
    idempotencyKey: formData.get("idempotencyKey"),
    confirmed: formData.get("confirmed") === "true",
  });
  if (!parsed.success) return errorState(GENERIC_ERROR);
  if (!(await consumeCandidateActionRateLimit(dependencies))) {
    return errorState(RATE_LIMIT_ERROR);
  }

  const command = {
    requestId: parsed.data.requestId,
    idempotencyKey: parsed.data.idempotencyKey,
  };
  const serviceDependencies = {
    correlationId: dependencies.correlationId,
    database: dependencies.database,
    now: new Date(),
  };
  const result =
    action === "ACCEPT"
      ? await acceptContactRequest(
          command,
          { userId: dependencies.userId },
          serviceDependencies,
        )
      : await declineContactRequest(
          command,
          { userId: dependencies.userId },
          serviceDependencies,
        );
  if (!result.ok) {
    return errorState(
      result.code === "CONFLICT"
        ? "Diese Anfrage ist nicht mehr offen. Lade die Seite neu."
        : result.code === "TRUST_REQUIRED"
          ? "Die Firma ist derzeit nicht verifiziert."
          : GENERIC_ERROR,
    );
  }

  revalidateRequestPaths(parsed.data.requestId);
  redirect(
    `/candidate/talent-radar/requests/${parsed.data.requestId}?updated=${
      action === "ACCEPT" ? "accepted" : "declined"
    }`,
  );
}

async function actionDependencies() {
  const [user, request] = await Promise.all([
    getCurrentUser(),
    getAuthRequestContext(),
  ]);
  if (user?.role !== "CANDIDATE" || !isValidAuthMutationOrigin(request)) {
    return null;
  }
  return Object.freeze({
    userId: user.id,
    correlationId: request.correlationId,
    request,
    environment: getServerEnvironment(),
    database: getDatabase(),
  });
}

async function consumeCandidateActionRateLimit(
  dependencies: NonNullable<Awaited<ReturnType<typeof actionDependencies>>>,
): Promise<boolean> {
  const decision = await consumeRequestRateLimit(
    "APPLICATION_CANDIDATE_MUTATION",
    { userId: dependencies.userId },
    dependencies.request,
    new Date(),
    {
      database: dependencies.database,
      environment: dependencies.environment,
    },
  );
  return decision.allowed;
}

function revealKeyring(
  entries: readonly KeyringEntry<
    "REVEAL_CONFIRMATION_KEYS" | "PII_REVEAL_KEYS"
  >[],
) {
  return Object.freeze(
    entries.map(({ version, key }) =>
      key.withValue((secret) => Object.freeze({ version, secret })),
    ),
  );
}

function revalidateRequestPaths(requestId: string): void {
  revalidatePath("/candidate/talent-radar");
  revalidatePath("/candidate/talent-radar/requests");
  revalidatePath(`/candidate/talent-radar/requests/${requestId}`);
  revalidatePath("/candidate/messages");
}

function revealPreviewError(code: string): string {
  if (code === "FIELD_UNAVAILABLE") {
    return "Mindestens ein gewählter Wert ist im SwissJobPass nicht verfügbar.";
  }
  if (code === "ALREADY_REVEALED") {
    return "Mindestens ein gewähltes Feld wurde bereits freigegeben.";
  }
  return GENERIC_ERROR;
}

function revealGrantError(code: string): string {
  if (code === "STALE_REVEAL_PREVIEW") {
    return "Deine Daten haben sich seit der Vorschau geändert. Erstelle eine neue Vorschau.";
  }
  if (code === "INVALID_CONFIRMATION") {
    return "Die Vorschau ist abgelaufen oder wurde bereits verwendet. Erstelle eine neue Vorschau.";
  }
  if (code === "FIELD_UNAVAILABLE") {
    return "Mindestens ein gewählter Wert ist nicht mehr verfügbar.";
  }
  if (code === "ALREADY_REVEALED") {
    return "Mindestens ein gewähltes Feld wurde bereits freigegeben.";
  }
  return GENERIC_ERROR;
}

function errorState(message: string): CandidateRadarActionState {
  return Object.freeze({ status: "error" as const, message });
}
