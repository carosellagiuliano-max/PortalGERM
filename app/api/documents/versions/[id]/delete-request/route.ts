import { getCurrentUser } from "@/lib/auth/current-user";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { documentJson } from "@/lib/documents/http";
import { requestCandidateDocumentDeletion } from "@/lib/documents/vault-service";
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
    user?.role !== "CANDIDATE" ||
    !isValidAuthMutationOrigin(context)
  ) {
    return documentJson({ code: "NOT_FOUND" }, 404);
  }
  const environment = getServerEnvironment();
  const result = await requestCandidateDocumentDeletion(
    {
      actorUserId: user.id,
      documentVersionId: id,
      correlationId: context.correlationId,
    },
    {
      database: getDatabase(),
      environment,
      objectStore: createDocumentObjectStore(environment),
      scanner: createDocumentMalwareScanner(environment),
    },
  );
  return result.ok
    ? documentJson(result)
    : documentJson({ code: result.code }, result.code === "NOT_FOUND" ? 404 : 409);
}
