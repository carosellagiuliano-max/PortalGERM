import { getCurrentAuthContext } from "@/lib/auth/current-user";
import { getAuthRequestContext } from "@/lib/auth/request-context";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { asyncIterableToWebReadable } from "@/lib/documents/http";
import { consumePrivacyExportV2 } from "@/lib/privacy/export-v2";
import { createPrivacyExportObjectStore } from "@/lib/providers/storage/privacy-export-storage";
import { bindObjectStoreToProviderAuthority } from "@/lib/providers/storage/provider-authority-bound-object-store";
import { privacyExportStoreActivationBinding } from "@/lib/privacy/provider-activation-binding";

export async function POST(
  request: Request,
  context: Readonly<{ params: Promise<{ id: string }> }>,
) {
  const [auth, requestContext, { id }] = await Promise.all([
    getCurrentAuthContext(),
    getAuthRequestContext(),
    context.params,
  ]);
  if (
    auth === null ||
    auth.user.role !== "CANDIDATE" ||
    !sameOrigin(request)
  ) {
    return unavailable();
  }
  const body = await request.formData().catch(() => null);
  const token = body?.get("token");
  const stepUpEvidenceId = body?.get("stepUpEvidenceId");
  const stepUpGrantToken = body?.get("stepUpGrantToken");
  if (
    typeof token !== "string" ||
    typeof stepUpEvidenceId !== "string" ||
    typeof stepUpGrantToken !== "string"
  ) {
    return unavailable();
  }
  const database = getDatabase();
  const environment = getServerEnvironment();
  const result = await consumePrivacyExportV2(
    {
      artifactId: id,
      ownerUserId: auth.user.id,
      token,
      stepUpEvidenceId,
      stepUpGrantToken,
    },
    {
      database,
      exportStore: bindObjectStoreToProviderAuthority({
        binding: privacyExportStoreActivationBinding(environment),
        database,
        delegate: createPrivacyExportObjectStore(environment),
        environment,
      }),
      exportKeyring: environment.secrets.keyrings.PRIVACY_EXPORT_KEYS,
      processingMode: environment.PRIVACY_PROCESSING_MODE,
      stepUpActor: {
        userId: auth.user.id,
        sessionId: auth.session.id,
        role: auth.user.role,
        status: auth.user.status,
      },
      correlationId: requestContext.correlationId,
      now: new Date(),
    },
  );
  if (!result.ok) return unavailable();
  return new Response(asyncIterableToWebReadable(result.body), {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Content-Length": String(result.contentLength),
      "Content-Type": result.contentType,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

function unavailable() {
  return Response.json(
    { error: "EXPORT_UNAVAILABLE" },
    {
      status: 404,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}
