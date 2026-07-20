import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { COMPANY_CONTEXT_COOKIE_POLICY_V1 } from "@/lib/auth/company-context-cookie";
import { sanitizePrivateRequestPath } from "@/lib/auth/route-guards";
import { clearSessionCookie } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const cookieStore = await cookies();
  clearSessionCookie(cookieStore);
  cookieStore.delete(COMPANY_CONTEXT_COOKIE_POLICY_V1.cookieName);

  const requestUrl = new URL(request.url);
  const next = sanitizePrivateRequestPath(requestUrl.searchParams.get("next"));
  const login = new URL("/login", request.url);
  login.searchParams.set("reason", "session");
  if (next !== null) login.searchParams.set("next", next);
  const response = NextResponse.redirect(login, 303);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}
