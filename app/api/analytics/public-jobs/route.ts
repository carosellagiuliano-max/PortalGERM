import { recordPublicJobAnalyticsAction } from "@/app/(public)/jobs/actions";
import { readBoundedJson } from "@/lib/documents/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAXIMUM_ANALYTICS_BODY_BYTES = 4_096;

export async function POST(request: Request): Promise<Response> {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/u.test(declaredLength) &&
    Number(declaredLength) > MAXIMUM_ANALYTICS_BODY_BYTES
  ) {
    return emptyResponse(413);
  }
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") return emptyResponse(400);

  const payload = await readBoundedJson(
    request,
    MAXIMUM_ANALYTICS_BODY_BYTES,
  ).catch(() => null);
  if (payload === null) return emptyResponse(400);

  await recordPublicJobAnalyticsAction(payload).catch(() => undefined);
  return emptyResponse(204);
}

function emptyResponse(status: 204 | 400 | 413): Response {
  return new Response(null, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
