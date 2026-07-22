"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { verifyPassword } from "@/lib/auth/password";
import { consumeRequestRateLimit } from "@/lib/auth/rate-limit-runtime";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { requireCandidatePage } from "@/lib/auth/route-guards";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { createPostgresPrivacyCaseService } from "@/lib/privacy/privacy-case-service";

const verifyInputSchema = z.strictObject({
  requestId: z.uuid(),
  version: z.coerce.number().int().nonnegative(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u),
  password: z.string().min(1).max(200),
});

export type CandidatePrivacyVerifyState = Readonly<{
  status: "idle" | "success" | "error";
  message: string;
  nextIdempotencyKey: string;
}>;

export async function completeCandidatePrivacyChallengeAction(
  _previous: CandidatePrivacyVerifyState,
  formData: FormData,
): Promise<CandidatePrivacyVerifyState> {
  const nextIdempotencyKey = randomUUID();
  const [user, request] = await Promise.all([
    requireCandidatePage(),
    getAuthRequestContext(),
  ]);
  if (!isValidAuthMutationOrigin(request)) {
    return genericFailure(nextIdempotencyKey);
  }
  const parsed = verifyInputSchema.safeParse({
    requestId: formData.get("requestId"),
    version: formData.get("version"),
    idempotencyKey: formData.get("idempotencyKey"),
    password: formData.get("password"),
  });
  if (!parsed.success) return genericFailure(nextIdempotencyKey);

  const database = getDatabase();
  const now = new Date();
  try {
    const rate = await consumeRequestRateLimit(
      "PRIVACY_IDENTITY_CHALLENGE",
      { userId: user.id },
      request,
      now,
      { database, environment: getServerEnvironment() },
    );
    if (!rate.allowed) return genericFailure(nextIdempotencyKey);

    const credential = await database.credential.findUnique({
      where: { userId: user.id },
      select: { passwordHash: true },
    });
    const credentialVerified =
      credential === null
        ? false
        : await verifyPassword(parsed.data.password, credential.passwordHash);
    const result = await createPostgresPrivacyCaseService(
      database,
    ).completeIdentityChallenge(
      { userId: user.id },
      {
        requestId: parsed.data.requestId,
        version: parsed.data.version,
        idempotencyKey: parsed.data.idempotencyKey,
      },
      { credentialVerified },
      now,
    );
    if (!result.ok) return genericFailure(nextIdempotencyKey);

    revalidatePath(`/candidate/privacy/requests/${parsed.data.requestId}`);
    revalidatePath(`/candidate/privacy/requests/${parsed.data.requestId}/verify`);
    revalidatePath(`/admin/privacy-requests/${parsed.data.requestId}`);
    return Object.freeze({
      status: "success",
      message:
        "Identität bestätigt. Die Datenschutzstelle kann den Fall nun in Bearbeitung nehmen.",
      nextIdempotencyKey,
    });
  } catch {
    return genericFailure(nextIdempotencyKey);
  }
}

function genericFailure(nextIdempotencyKey: string): CandidatePrivacyVerifyState {
  return Object.freeze({
    status: "error",
    message:
      "Die Bestätigung war nicht möglich. Prüfe die Eingabe oder starte nach Ablauf eine neue Identitätsprüfung über den Support.",
    nextIdempotencyKey,
  });
}
