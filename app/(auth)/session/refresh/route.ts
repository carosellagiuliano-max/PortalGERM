import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getCurrentAuthContext } from "@/lib/auth/current-user";
import {
  getAuthRequestContext,
  isValidAuthMutationOrigin,
  shouldUseSecureAuthCookies,
} from "@/lib/auth/request-context";
import { createPrismaSessionStore } from "@/lib/auth/session-store";
import {
  getSessionRotationDueAt,
  getSessionCookieOptions,
  readSessionCookie,
  rotateSession,
  SESSION_POLICY_V1,
} from "@/lib/auth/session";
import {
  SESSION_REFRESH_AFTER_HEADER,
  SESSION_REFRESH_STATE_HEADER,
  SESSION_REFRESH_STATES,
  SESSION_REFRESH_STALE_RETRY_MILLISECONDS,
  SESSION_REFRESH_TRANSIENT_RETRY_MILLISECONDS,
} from "@/lib/auth/session-refresh-contract";
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
  const context = await getCurrentAuthContext();
  if (token === undefined || context === null) {
    // Do not clear cookies here: two tabs can refresh the same old token while
    // one response has already installed the rotated token. A later 401 must
    // not overwrite that fresh cookie. Authoritative page guards clear truly
    // stale sessions through /session/clear.
    return noStoreResponse(null, 401, SESSION_REFRESH_STALE_RETRY_MILLISECONDS);
  }

  const now = new Date();
  if (context.session.presentedTokenState === "PREVIOUS") {
    // A request already in flight can still authenticate through the bounded
    // previous-token overlap after another tab promotes the successor. Never
    // reissue the successor to that old bearer: doing so would let a replayed
    // previous token upgrade itself. A real same-browser tab shares the cookie
    // jar and therefore retries with the already-installed current token.
    return noStoreResponse(
      null,
      409,
      SESSION_REFRESH_TRANSIENT_RETRY_MILLISECONDS,
    );
  }
  const rotationDelay = Math.max(
    0,
    getSessionRotationDueAt(context.session).getTime() - now.getTime(),
  );
  if (rotationDelay > 0) {
    return noStoreResponse(
      null,
      204,
      rotationDelay,
      SESSION_REFRESH_STATES.current,
    );
  }
  const environment = getServerEnvironment();
  const rotated = await rotateSession(token, {
    store: createPrismaSessionStore(getDatabase()),
    clock: { now },
    rotationKey: environment.secrets.session,
  });
  if (rotated !== null) {
    writeRotatedCookie(cookieStore, rotated, environment.APP_ENV);
    return noStoreResponse(
      null,
      204,
      SESSION_POLICY_V1.rotationAgeMilliseconds,
      SESSION_REFRESH_STATES.staged,
    );
  }
  // A pending-token deadline is a credential-validity boundary, not a retry
  // backoff. Returning it here could pause a racing tab for nearly the full
  // idle TTL after another tab wins promotion.
  return noStoreResponse(
    null,
    409,
    SESSION_REFRESH_TRANSIENT_RETRY_MILLISECONDS,
  );
}

function writeRotatedCookie(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  rotated: Readonly<{
    token: string;
    record: Readonly<{ absoluteExpiresAt: Date }>;
  }>,
  appEnvironment: Parameters<typeof shouldUseSecureAuthCookies>[0],
) {
  cookieStore.set(
    SESSION_POLICY_V1.cookieName,
    rotated.token,
    getSessionCookieOptions(
      rotated.record.absoluteExpiresAt,
      shouldUseSecureAuthCookies(appEnvironment),
    ),
  );
}

function noStoreResponse(
  body: BodyInit | null,
  status: number,
  refreshAfterMilliseconds?: number,
  refreshState?: (typeof SESSION_REFRESH_STATES)[keyof typeof SESSION_REFRESH_STATES],
) {
  const headers = new Headers({
    "Cache-Control": "private, no-store, max-age=0",
  });
  if (refreshAfterMilliseconds !== undefined) {
    headers.set(
      SESSION_REFRESH_AFTER_HEADER,
      String(Math.max(0, Math.ceil(refreshAfterMilliseconds))),
    );
  }
  if (refreshState !== undefined) {
    headers.set(SESSION_REFRESH_STATE_HEADER, refreshState);
  }
  return new NextResponse(body, {
    status,
    headers,
  });
}
