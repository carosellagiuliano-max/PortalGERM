import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isIP } from "node:net";

import {
  CORRELATION_ID_HEADER,
  normalizeCorrelationId,
} from "@/lib/utils/correlation-id";

export { CORRELATION_ID_HEADER } from "@/lib/utils/correlation-id";

export const TRUSTED_PATHNAME_HEADER = "x-sth-pathname";
export const TRUSTED_SOURCE_IP_HEADER = "x-sth-source-ip";

const SESSION_COOKIE_NAME = "session";
const OPAQUE_SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PRIVATE_ROUTE_PREFIXES = ["/candidate", "/employer", "/admin"] as const;
const SAFE_FALLBACK_IP = "127.0.0.1";

export function proxy(request: NextRequest) {
  const correlationId = normalizeCorrelationId(
    request.headers.get(CORRELATION_ID_HEADER),
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CORRELATION_ID_HEADER, correlationId);
  requestHeaders.set(
    TRUSTED_PATHNAME_HEADER,
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  requestHeaders.set(TRUSTED_SOURCE_IP_HEADER, resolveTrustedSourceIp(request));

  if (
    isPrivatePath(request.nextUrl.pathname) &&
    !isPlausibleSessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value)
  ) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set(
      "next",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    const response = NextResponse.redirect(loginUrl);
    response.headers.set(CORRELATION_ID_HEADER, correlationId);
    if (request.cookies.has(SESSION_COOKIE_NAME)) {
      response.cookies.delete(SESSION_COOKIE_NAME);
    }
    return response;
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set(CORRELATION_ID_HEADER, correlationId);

  return response;
}

function isPrivatePath(pathname: string) {
  return PRIVATE_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isPlausibleSessionToken(token: string | undefined) {
  return token !== undefined && OPAQUE_SESSION_TOKEN_PATTERN.test(token);
}

function resolveTrustedSourceIp(request: NextRequest) {
  const trustedProxyHops = parseTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS);
  if (trustedProxyHops === undefined) return SAFE_FALLBACK_IP;

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor === null) return SAFE_FALLBACK_IP;
  const chain = forwardedFor.split(",").map((value) => value.trim());
  const candidate = chain[chain.length - trustedProxyHops];

  return candidate !== undefined && isIP(candidate) !== 0
    ? candidate
    : SAFE_FALLBACK_IP;
}

function parseTrustedProxyHops(value: string | undefined) {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff2?)$).*)",
  ],
};
