import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/current-user";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
  shouldUseSecureAuthCookies,
} from "@/lib/auth/request-context";
import { createPrismaSessionStore } from "@/lib/auth/session-store";
import {
  getSessionCookieOptions,
  readSessionCookie,
  rotateSession,
  SESSION_POLICY_V1,
} from "@/lib/auth/session";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const request = await getAuthRequestContext();
  if (!isValidAuthMutationOrigin(request)) {
    return noStoreResponse(null, 403);
  }
  const cookieStore = await cookies();
  const token = readSessionCookie(cookieStore);
  const user = await getCurrentUser();
  if (token === undefined || user === null) {
    // Do not clear cookies here: two tabs can refresh the same old token while
    // one response has already installed the rotated token. A later 401 must
    // not overwrite that fresh cookie. Authoritative page guards clear truly
    // stale sessions through /session/clear.
    return noStoreResponse(null, 401);
  }

  const environment = getServerEnvironment();
  const rotated = await rotateSession(token, {
    store: createPrismaSessionStore(getDatabase()),
    clock: { now: new Date() },
  });
  if (rotated !== null) {
    cookieStore.set(
      SESSION_POLICY_V1.cookieName,
      rotated.token,
      getSessionCookieOptions(
        rotated.record.absoluteExpiresAt,
        shouldUseSecureAuthCookies(environment.APP_ENV),
      ),
    );
  }
  return noStoreResponse(null, 204);
}

function noStoreResponse(body: BodyInit | null, status: number) {
  return new NextResponse(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
