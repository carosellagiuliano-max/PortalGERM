import "server-only";

import { headers } from "next/headers";

import { getServerEnvironment } from "@/lib/config/env";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import { verifyCsrfOrigin } from "@/lib/security/csrf";
import { normalizeIpAddress } from "@/lib/utils/hash";
import {
  CORRELATION_ID_HEADER,
  normalizeCorrelationId,
} from "@/lib/utils/correlation-id";

export const INTERNAL_REQUEST_PATH_HEADER = "x-sth-pathname";
export const INTERNAL_SOURCE_IP_HEADER = "x-sth-source-ip";

export type AuthRequestContext = Readonly<{
  correlationId: string;
  expectedOrigin: string;
  origin: string | null;
  production: boolean;
  sourceIp: string;
  userAgent: string | null;
}>;

export async function getAuthRequestContext(): Promise<AuthRequestContext> {
  const requestHeaders = await headers();
  const environment = getServerEnvironment();

  return Object.freeze({
    correlationId: normalizeCorrelationId(
      requestHeaders.get(CORRELATION_ID_HEADER),
    ),
    expectedOrigin: environment.APP_URL,
    origin: requestHeaders.get("origin"),
    production: shouldUseSecureAuthCookies(environment.APP_ENV),
    sourceIp: readInternalSourceIp(
      requestHeaders.get(INTERNAL_SOURCE_IP_HEADER),
    ),
    userAgent: requestHeaders.get("user-agent")?.slice(0, 512) ?? null,
  });
}

export function shouldUseSecureAuthCookies(
  appEnvironment: ServerEnvironment["APP_ENV"],
): boolean {
  return appEnvironment !== "local";
}

export function isValidAuthMutationOrigin(
  context: Pick<AuthRequestContext, "expectedOrigin" | "origin">,
): boolean {
  const decision = verifyCsrfOrigin({
    method: "POST",
    originHeader: context.origin,
    expectedOrigin: context.expectedOrigin,
  });
  if (decision.allowed) return true;

  // Local development commonly alternates between localhost and 127.0.0.1.
  // Treat only those two explicit loopback names as equivalent on the same
  // protocol and port; no production hostname receives this exception.
  try {
    const actual = new URL(context.origin ?? "");
    const expected = new URL(context.expectedOrigin);
    const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
    return (
      loopback.has(actual.hostname) &&
      loopback.has(expected.hostname) &&
      actual.protocol === expected.protocol &&
      actual.port === expected.port
    );
  } catch {
    return false;
  }
}

function readInternalSourceIp(value: string | null): string {
  if (value === null) return "127.0.0.1";
  try {
    return normalizeIpAddress(value);
  } catch {
    return "127.0.0.1";
  }
}
