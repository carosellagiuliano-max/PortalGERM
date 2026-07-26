import { getCurrentUser } from "@/lib/auth/current-user";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
} from "@/lib/auth/request-context";
import { getDatabase } from "@/lib/db/client";
import { documentJson } from "@/lib/documents/http";
import { revokeDocumentReadGrant } from "@/lib/documents/vault-service";

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
  if (user === null || !isValidAuthMutationOrigin(context)) {
    return documentJson({ code: "NOT_FOUND" }, 404);
  }
  const result = await revokeDocumentReadGrant(
    { actorUserId: user.id, grantId: id },
    getDatabase(),
  );
  return result === "MISSING"
    ? documentJson({ code: "NOT_FOUND" }, 404)
    : documentJson({ status: result });
}
