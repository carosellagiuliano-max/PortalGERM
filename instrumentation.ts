import type { Instrumentation } from "next";

import {
  CORRELATION_ID_HEADER,
  normalizeCorrelationId,
} from "@/lib/utils/correlation-id";
import { normalizeErrorReference } from "@/lib/utils/error-reference";
import { createLogger } from "@/lib/utils/logger";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getServerEnvironment } = await import("@/lib/config/env");
    getServerEnvironment();
  }
}

export const onRequestError: Instrumentation.onRequestError = (
  error,
  request,
  context,
) => {
  const rawCorrelationId = request.headers[CORRELATION_ID_HEADER];
  const correlationId = normalizeCorrelationId(
    Array.isArray(rawCorrelationId) ? rawCorrelationId[0] : rawCorrelationId,
  );
  const errorReference = normalizeErrorReference(
    typeof error === "object" && error !== null && "digest" in error
      ? error.digest
      : undefined,
  );

  createLogger().error(
    "request_failed",
    {
      method: request.method,
      routePath: context.routePath,
      routeType: context.routeType,
      routerKind: context.routerKind,
      ...(errorReference === undefined ? {} : { errorReference }),
    },
    correlationId,
  );
};
