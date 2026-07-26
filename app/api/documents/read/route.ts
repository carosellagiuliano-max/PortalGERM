import { getCurrentUser } from "@/lib/auth/current-user";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import {
  asyncIterableToWebReadable,
  documentJson,
  readBoundedJson,
  safeContentDisposition,
} from "@/lib/documents/http";
import { consumeDocumentReadGrant } from "@/lib/documents/vault-service";
import {
  createDocumentMalwareScanner,
  createDocumentObjectStore,
} from "@/lib/providers/storage/document-storage-composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const [user, context, payload] = await Promise.all([
    getCurrentUser(),
    getAuthRequestContext(),
    readBoundedJson(request),
  ]);
  if (
    user === null ||
    !isValidAuthMutationOrigin(context) ||
    !isRecord(payload) ||
    typeof payload.token !== "string" ||
    payload.token.length < 32 ||
    payload.token.length > 128
  ) {
    return documentJson({ code: "NOT_FOUND" }, 404);
  }
  const environment = getServerEnvironment();
  const result = await consumeDocumentReadGrant(
    {
      actorUserId: user.id,
      token: payload.token,
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
    return documentJson(
      { code: result.code },
      result.code === "DOCUMENT_VAULT_UNAVAILABLE" ||
        result.code === "PROVIDER_DEGRADED"
        ? 503
        : result.code === "GRANT_EXPIRED"
          ? 410
          : 404,
    );
  }
  return new Response(asyncIterableToWebReadable(result.body), {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": safeContentDisposition(result.safeFilename),
      "Content-Length": String(result.sizeBytes),
      "Content-Type": result.mimeType,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Document-Sha256": result.sha256,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
