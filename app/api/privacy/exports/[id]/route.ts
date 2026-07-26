import { getCurrentUser } from "@/lib/auth/current-user";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { asyncIterableToWebReadable } from "@/lib/documents/http";
import { consumePrivacyExportV2 } from "@/lib/privacy/export-v2";
import { createPrivacyExportObjectStore } from "@/lib/providers/storage/privacy-export-storage";

export async function POST(
  request: Request,
  context: Readonly<{ params: Promise<{ id: string }> }>,
) {
  const [user, { id }] = await Promise.all([getCurrentUser(), context.params]);
  if (user === null || !sameOrigin(request)) return unavailable();
  const body = await request.formData().catch(() => null);
  const token = body?.get("token");
  if (typeof token !== "string") return unavailable();
  const database = getDatabase();
  const challenge = await database.privacyIdentityChallenge.findFirst({
    where: {
      userId: user.id,
      verifiedAt: { not: null },
      consumedAt: { not: null },
    },
    orderBy: { verifiedAt: "desc" },
    select: { id: true, verifiedAt: true },
  });
  const environment = getServerEnvironment();
  if (
    challenge?.verifiedAt === null ||
    challenge === null ||
    challenge.verifiedAt.getTime() < Date.now() - 15 * 60 * 1_000
  ) {
    return unavailable();
  }
  const result = await consumePrivacyExportV2(
    {
      artifactId: id,
      ownerUserId: user.id,
      token,
      stepUpEvidenceRef: `sandbox:privacy-challenge:${challenge.id}`,
    },
    {
      database,
      exportStore: createPrivacyExportObjectStore(environment),
      exportKeyring: environment.secrets.keyrings.PRIVACY_EXPORT_KEYS,
      processingMode: environment.PRIVACY_PROCESSING_MODE,
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
