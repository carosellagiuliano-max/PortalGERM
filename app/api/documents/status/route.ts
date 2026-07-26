import { getCurrentUser } from "@/lib/auth/current-user";
import { getDatabase } from "@/lib/db/client";
import { documentJson } from "@/lib/documents/http";
import { getCandidateDocumentVaultView } from "@/lib/documents/vault-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (user?.role !== "CANDIDATE") {
    return documentJson({ code: "NOT_FOUND" }, 404);
  }
  const view = await getCandidateDocumentVaultView(user.id, getDatabase());
  return view === null
    ? documentJson({ code: "NOT_FOUND" }, 404)
    : documentJson(view);
}
