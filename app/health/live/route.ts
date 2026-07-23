import { getBuildIdentifier } from "@/lib/health/build-identifier";
import {
  CORRELATION_ID_HEADER,
  normalizeCorrelationId,
} from "@/lib/utils/correlation-id";

export const dynamic = "force-dynamic";

export function GET(request?: Request) {
  const correlationId = normalizeCorrelationId(
    request?.headers.get(CORRELATION_ID_HEADER),
  );

  return Response.json(
    { status: "ok", buildId: getBuildIdentifier() },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        [CORRELATION_ID_HEADER]: correlationId,
      },
    },
  );
}
