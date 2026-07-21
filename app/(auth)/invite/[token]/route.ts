import { NextResponse } from "next/server";

import {
  clearInviteResumeCookie,
  createInviteResumeCookie,
  INVITE_RESUME_PATH,
  writeInviteResumeCookie,
} from "@/lib/auth/invite-resume";
import { shouldUseSecureAuthCookies } from "@/lib/auth/request-context";
import { getServerEnvironment } from "@/lib/config/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: Readonly<{ params: Promise<{ token: string }> }>,
) {
  const { token } = await params;
  const environment = getServerEnvironment();
  const secure = shouldUseSecureAuthCookies(environment.APP_ENV);
  const response = NextResponse.redirect(
    new URL(INVITE_RESUME_PATH, request.url),
    303,
  );

  if (/^[A-Za-z0-9_-]{32,128}$/u.test(token)) {
    writeInviteResumeCookie(
      response.cookies,
      createInviteResumeCookie(
        { token, now: new Date(), secure },
        environment.secrets.session,
      ),
    );
  } else {
    clearInviteResumeCookie(response.cookies, secure);
  }

  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set(
    "X-Robots-Tag",
    "noindex, nofollow, noarchive, nosnippet",
  );
  return response;
}
