import { NextResponse } from "next/server";

import { logoutCurrentSession } from "@/lib/auth/logout-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await logoutCurrentSession();
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_ORIGIN_DENIED") {
      return new Response("Forbidden", { status: 403 });
    }
    throw error;
  }
  return NextResponse.redirect(new URL("/login?loggedOut=1", request.url), 303);
}
