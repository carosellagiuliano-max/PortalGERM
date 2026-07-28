import { getEmployerContext } from "@/lib/auth/employer-context";
import { consumeRequestRateLimit } from "@/lib/auth/rate-limit-runtime";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { documentJson, readBoundedJson } from "@/lib/documents/http";
import { createCompanyVerificationDocumentUploadIntent } from "@/lib/documents/vault-service";
import {
  createDocumentMalwareScanner,
  createDocumentObjectStore,
} from "@/lib/providers/storage/document-storage-composition";
import { recordRateLimitDenial } from "@/lib/security/rate-limit-audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const [employer, context] = await Promise.all([
    getEmployerContext(),
    getAuthRequestContext(),
  ]);
  const current = employer?.current ?? null;
  if (
    employer === null ||
    current === null ||
    (current.membershipRole !== "OWNER" &&
      current.membershipRole !== "ADMIN") ||
    !isValidAuthMutationOrigin(context)
  ) {
    return documentJson({ code: "NOT_FOUND" }, 404);
  }
  const payload = await readBoundedJson(request);
  if (!isUploadIntentPayload(payload)) {
    return documentJson({ code: "INVALID_UPLOAD" }, 400);
  }
  const environment = getServerEnvironment();
  const database = getDatabase();
  const now = new Date();
  const rate = await consumeRequestRateLimit(
    "DOCUMENT_UPLOAD_INTENT",
    { userId: employer.user.id },
    context,
    now,
    { environment, database },
  );
  if (!rate.allowed) {
    await recordRateLimitDenial(
      rate.audit,
      {
        actorKind: "USER",
        actorUserId: employer.user.id,
        capability: "COMPANY_VERIFICATION_DOCUMENT_UPLOAD",
        targetId: current.companyId,
        targetType: "COMPANY",
      },
      {
        database,
        environment,
        request: context,
        now,
      },
    );
    return documentJson(
      { code: "RATE_LIMITED", retryAfterSeconds: rate.retryAfterSeconds },
      429,
      { "Retry-After": String(rate.retryAfterSeconds) },
    );
  }
  const result = await createCompanyVerificationDocumentUploadIntent(
    {
      actorUserId: employer.user.id,
      companyId: current.companyId,
      membershipId: current.membershipId,
      filename: payload.filename,
      declaredMimeType: payload.declaredMimeType,
      expectedSizeBytes: payload.expectedSizeBytes,
      ...(payload.expectedSha256 === undefined
        ? {}
        : { expectedSha256: payload.expectedSha256 }),
      idempotencyKey: payload.idempotencyKey,
      correlationId: context.correlationId,
    },
    {
      database,
      environment,
      objectStore: createDocumentObjectStore(environment),
      scanner: createDocumentMalwareScanner(environment),
      now,
    },
  );
  if (!result.ok) {
    const status =
      result.code === "DOCUMENT_VAULT_UNAVAILABLE"
        ? 503
        : result.code === "UPLOAD_QUOTA_EXCEEDED"
          ? 429
          : result.code === "NOT_AUTHORIZED"
            ? 404
            : result.code === "INVALID_UPLOAD"
              ? 400
              : 409;
    return documentJson(
      { code: result.code, detailCode: result.detailCode },
      status,
    );
  }
  return documentJson(
    {
      intentId: result.intentId,
      documentVersionId: result.documentVersionId,
      expiresAt: result.expiresAt.toISOString(),
      status: result.status,
      duplicate: result.duplicate,
    },
    result.duplicate ? 200 : 201,
  );
}

function isUploadIntentPayload(value: unknown): value is {
  filename: string;
  declaredMimeType: string;
  expectedSizeBytes: number;
  expectedSha256?: string;
  idempotencyKey: string;
} {
  if (!isRecord(value)) return false;
  return (
    typeof value.filename === "string" &&
    typeof value.declaredMimeType === "string" &&
    typeof value.expectedSizeBytes === "number" &&
    typeof value.idempotencyKey === "string" &&
    (value.expectedSha256 === undefined ||
      typeof value.expectedSha256 === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
