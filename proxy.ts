import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  CORRELATION_ID_HEADER,
  normalizeCorrelationId,
} from "@/lib/utils/correlation-id";

export { CORRELATION_ID_HEADER } from "@/lib/utils/correlation-id";

export function proxy(request: NextRequest) {
  const correlationId = normalizeCorrelationId(
    request.headers.get(CORRELATION_ID_HEADER),
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CORRELATION_ID_HEADER, correlationId);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set(CORRELATION_ID_HEADER, correlationId);

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff2?)$).*)",
  ],
};
