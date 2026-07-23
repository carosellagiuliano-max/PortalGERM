import { getDatabase } from "@/lib/db/client";
import { checkDatabaseHealth } from "@/lib/db/health";
import {
  CORRELATION_ID_HEADER,
  normalizeCorrelationId,
} from "@/lib/utils/correlation-id";

export const dynamic = "force-dynamic";

export async function GET(request?: Request) {
  const correlationId = normalizeCorrelationId(
    request?.headers.get(CORRELATION_ID_HEADER),
  );
  const responseHeaders = {
    "Cache-Control": "no-store",
    [CORRELATION_ID_HEADER]: correlationId,
  };

  try {
    const health = await checkDatabaseHealth(getDatabase());
    return Response.json(
      health.ready
        ? { status: "ready" }
        : { status: "unavailable", correlationId },
      {
        status: health.ready ? 200 : 503,
        headers: responseHeaders,
      },
    );
  } catch {
    return Response.json(
      { status: "unavailable", correlationId },
      {
        status: 503,
        headers: responseHeaders,
      },
    );
  }
}
