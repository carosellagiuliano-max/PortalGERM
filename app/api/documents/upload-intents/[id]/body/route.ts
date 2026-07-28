import { getCurrentUser } from "@/lib/auth/current-user";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import {
  documentJson,
  webReadableToAsyncIterable,
} from "@/lib/documents/http";
import { uploadDocumentIntentBody } from "@/lib/documents/vault-service";
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
  if (
    (user?.role !== "CANDIDATE" &&
      user?.role !== "EMPLOYER" &&
      user?.role !== "RECRUITER") ||
    !isValidAuthMutationOrigin(context) ||
    request.body === null
  ) {
    return documentJson({ code: "NOT_FOUND" }, 404);
  }
  const contentLength = parseContentLength(
    request.headers.get("content-length"),
  );
  const environment = getServerEnvironment();
  const result = await uploadDocumentIntentBody(
    {
      actorUserId: user.id,
      intentId: id,
      body: webReadableToAsyncIterable(request.body),
      declaredContentLength: contentLength,
      correlationId: context.correlationId,
    },
    {
      database: getDatabase(),
      environment,
      objectStore: createDocumentObjectStore(environment),
      scanner: createDocumentMalwareScanner(environment),
    },
  );
  if (!result.ok) {
    const status =
      result.code === "DOCUMENT_VAULT_UNAVAILABLE"
        ? 503
        : result.code === "NOT_FOUND"
          ? 404
          : result.code === "INTENT_EXPIRED"
            ? 410
            : 422;
    return documentJson(
      { code: result.code, detailCode: result.detailCode },
      status,
    );
  }
  return documentJson({
    documentVersionId: result.documentVersionId,
    sizeBytes: result.sizeBytes,
    sha256: result.sha256,
    status: result.status,
    duplicate: result.duplicate,
  });
}

function parseContentLength(value: string | null): number | null {
  return value !== null && /^\d{1,7}$/u.test(value) ? Number(value) : null;
}
