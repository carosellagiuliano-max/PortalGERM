import { getCurrentUser } from "@/lib/auth/current-user";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { documentJson } from "@/lib/documents/http";
import { finalizeDocumentUploadIntent } from "@/lib/documents/vault-service";
import {
  createDocumentMalwareScanner,
  createDocumentObjectStore,
} from "@/lib/providers/storage/document-storage-composition";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _request: Request,
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
    !isValidAuthMutationOrigin(context)
  ) {
    return documentJson({ code: "NOT_FOUND" }, 404);
  }
  const environment = getServerEnvironment();
  const result = await finalizeDocumentUploadIntent(
    { actorUserId: user.id, intentId: id },
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
      result.code === "DOCUMENT_VAULT_UNAVAILABLE"
        ? 503
        : result.code === "NOT_FOUND"
          ? 404
          : result.code === "INTENT_EXPIRED"
            ? 410
            : 409,
    );
  }
  return documentJson(result);
}
