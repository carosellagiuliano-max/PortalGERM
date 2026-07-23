import { NextResponse } from "next/server";

import { sanitizePrivateRequestPath } from "@/lib/auth/route-guards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const next = sanitizePrivateRequestPath(requestUrl.searchParams.get("next"));
  const login = new URL("/login", request.url);
  login.searchParams.set("reason", "session");
  if (next !== null) login.searchParams.set("next", next);
  const response = NextResponse.redirect(login, 303);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set(
    "X-Robots-Tag",
    "noindex, nofollow, noarchive, nosnippet",
  );
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
