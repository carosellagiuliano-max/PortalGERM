import { getCurrentUser } from "@/lib/auth/current-user";
import { getEmployerContext } from "@/lib/auth/employer-context";
import { consumeRequestRateLimit } from "@/lib/auth/rate-limit-runtime";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { documentJson, readBoundedJson } from "@/lib/documents/http";
import { issueDocumentReadGrant } from "@/lib/documents/vault-service";
import { recordRateLimitDenial } from "@/lib/security/rate-limit-audit";
import {
  createDocumentMalwareScanner,
  createDocumentObjectStore,
} from "@/lib/providers/storage/document-storage-composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [{ id }, user, context] = await Promise.all([
    params,
    getCurrentUser(),
    getAuthRequestContext(),
  ]);
  if (user === null || !isValidAuthMutationOrigin(context)) {
    return documentJson({ code: "NOT_FOUND" }, 404);
  }
  const payload = await readBoundedJson(request);
  if (!isRecord(payload)) {
    return documentJson({ code: "INVALID_INPUT" }, 400);
  }
  const environment = getServerEnvironment();
  const database = getDatabase();
  const rate = await consumeRequestRateLimit(
    "DOCUMENT_READ_GRANT",
    { userId: user.id },
    context,
    new Date(),
    { environment, database },
  );
  if (!rate.allowed) {
    await recordRateLimitDenial(
      rate.audit,
      {
        actorKind: "USER",
        actorUserId: user.id,
        capability: "DOCUMENT_SINGLE_OBJECT_READ",
        targetId: id,
        targetType: "DOCUMENT_VERSION",
      },
      {
        database,
        environment,
        request: context,
        now: new Date(),
      },
    );
    return documentJson(
      { code: "RATE_LIMITED", retryAfterSeconds: rate.retryAfterSeconds },
      429,
      { "Retry-After": String(rate.retryAfterSeconds) },
    );
  }

  let audience:
    | Readonly<{
        applicationId: string;
        companyId: string;
        membershipId: string;
      }>
    | undefined;
  if (user.role === "EMPLOYER" || user.role === "RECRUITER") {
    const employer = await getEmployerContext();
    const applicationId = payload.applicationId;
    if (
      employer?.current === null ||
      employer?.current === undefined ||
      typeof applicationId !== "string"
    ) {
      return documentJson({ code: "NOT_FOUND" }, 404);
    }
    audience = Object.freeze({
      applicationId,
      companyId: employer.current.companyId,
      membershipId: employer.current.membershipId,
    });
  } else if (user.role !== "CANDIDATE") {
    return documentJson({ code: "NOT_FOUND" }, 404);
  }
  const result = await issueDocumentReadGrant(
    {
      actorUserId: user.id,
      documentVersionId: id,
      ...(audience ?? {}),
      correlationId: context.correlationId,
    },
    {
      database,
      environment,
      objectStore: createDocumentObjectStore(environment),
      scanner: createDocumentMalwareScanner(environment),
    },
  );
  if (!result.ok) {
    return documentJson(
      { code: result.code },
      result.code === "DOCUMENT_VAULT_UNAVAILABLE"
        ? 503
        : result.code === "NOT_FOUND"
          ? 404
          : 403,
    );
  }
  return documentJson({
    grantId: result.grantId,
    token: result.token,
    expiresAt: result.expiresAt.toISOString(),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
